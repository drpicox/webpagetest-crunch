#!/usr/bin/env node
'use strict';

var _       = require('lodash');
var cheerio = require('cheerio');
var json2csv = require('json2csv');
var Promise = require('q').Promise;
var Q       = require('q');
var queue   = require('queue-async');
var request = require('request');

var REMOTE_URL = 'http://www.webpagetest.org';
var requestQueue = queue(4);

function requestUrl(url) {
	return Promise(function(resolve, reject) {
		requestQueue.defer(function(cb) {
			request(url, function(error, response, body) {				
				if (!error && response.statusCode == 200) {
					resolve(body);
				} else {
					reject(error || response);
				}
				console.error(url);
				cb(null, null);
			});
		});
	});
}

function requestLog() {
	return requestUrl(REMOTE_URL + '/testlog.php?days=7&filter=&all=on');
}

function convertHtmlToHistories(body) {
	var result = [];
	var $ = cheerio.load(body);
	var $history = $('table.history');

	$history.find('tr').each(function(idx) {
		if (idx < 50 || idx > 91) { return; }

		var $row = $(this);
		var $location = $row.find('.location');
		var $url = $row.find('.url');
		result.push({
			id: $url.find('a').attr('href').slice(8, -1),
			date: $row.find('.date').text(),
			network: $location.find('b').eq(1).text(),
			url: $url.text(),
		});
	});

	return result;
}

function convertHistoriesToResults(histories) {
	return Q.all(histories.map(convertHistoryToResult));
}

function convertHistoryToResult(history) {
	return requestUrl(REMOTE_URL + '/xmlResult/' + history.id + '/')
	.then(function(body) {
		return parseResult(history, body);
	});
}

function parseResult(history, body) {
	var $ = cheerio.load(body, {
		xmlMode: true,
	});

	var result = {
		id: history.id,
		date: history.date,
		network: history.network,
		url: history.url,
		statusCode: $('response > statusCode').text(),
		statusText: $('response > statusText').text(),
	};

	if (result.statusCode < 200) {
		return result;
	}

	_.assign(result, {
		summary: $('response > data > summary').text(),
		completed: $('response > data > completed').text(),
		connectivity: $('response > data > connectivity').text(),
		bwDown: $('response > data > bwDown').text(),
		bwUp: $('response > data > bwUp').text(),
		latency: $('response > data > latency').text(),
		mobile: $('response > data > mobile').text(),
	});

	var runs = [];
	$('response > data > run').each(function() {
		var $run = $(this);
		
		runs.push({
			firstView: convert$ViewToRow($, result, $run.find('firstView'), 'first'), 
			repeatView: convert$ViewToRow($, result, $run.find('repeatView'), 'repeat'), 
		});
	});

	result.runs = runs;

	return result;
}

function convert$ViewToRow($, result, $view, viewName) {
	if (!$view.length) { return false; }

	var row = {view: viewName};
	_.assign(row, result);
	assign$PropertiesToRow($, '', $view.find('results'), row);
	assign$PropertiesToRow($, 'page_', $view.find('pages'), row);
	assign$PropertiesToRow($, 'image_', $view.find('images'), row);
	assign$FramesToRow($, $view.find('videoFrames'), row);

	row.domContentLoadedEventTime = row.domContentLoadedEventEnd - row.domContentLoadedEventStart;
	return row;
}

function assign$PropertiesToRow($, prepend, $object, row) {
	$object.children().each(function() {
		var val = $(this).text();
		if (/^\d+$/.test(val)) {
			val = parseInt(val, 10);
		}
		row[prepend + this.tagName] = val;
	});
}

function assign$FramesToRow($, frames, row) {
	var found70 = false;
	frames.find('frame').each(function() {
		var $frame = $(this);
		var complete = parseInt($frame.find('VisuallyComplete').text(), 10);
		if (!found70 &&  complete >= 70) {
			found70 = true;
			row.visual70_time = parseInt($frame.find('time').text(), 10);
			row.visual70_complete = complete;
			row.visual70_image = $frame.find('image').text();
		}
	})
}

function convertResultsToRows(results) {

	return _.flatten(results.map(convertResultToRows));
}

function convertResultToRows(result) {
	if (!result.runs) {
		return [result];
	}

	return _.flatten(result.runs.map(convertRunToRows));
}

function convertRunToRows(run) {
	if (run.firstView && run.repeatView) {
		return [run.firstView, run.repeatView];
	}

	return [run.firstView || run.repeatView];
}

function convertRowsToCSV(rows) {

	var fields = [];
	rows.forEach(function(row) {
		fields = _.union(fields, _.keys(row));
	});

	return Promise(function(resolve, reject) {
		json2csv({data: rows, fields: fields}, function(err, csv) {
			if (err) reject(err); else resolve(csv);
		})
	});

}

requestLog()
.then(convertHtmlToHistories)
.then(convertHistoriesToResults)
.then(convertResultsToRows)
.then(convertRowsToCSV)
.then(function(body) {
	console.log(body);
})
.done();
/*
.catch(function(ops) {
	console.log(ops);
	console.log(ops.stack);
});
*/