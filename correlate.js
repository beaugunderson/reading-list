var async = require('async');
var cheerio = require('cheerio');
var fs = require('fs');
var request = require('request');
var xml2js = require('xml2js');
var _ = require('lodash');

var SEARCH_URL = 'https://www.goodreads.com/search.xml';

var books = require('./guardian-books.json');

function getEditions(workId, cb) {
  var EDITIONS_URL = 'https://www.goodreads.com/work/editions/' + workId;

  var queryString = {
    page: 1,
    per_page: 100,
    utf8: '%E2%9C%93'
  };

  var ids = [];
  var total = 0;

  async.doWhilst(function (cbDoWhilst) {
    request.get({ url: EDITIONS_URL, qs: queryString },
        function (err, res, body) {
      var $ = cheerio.load(body, { normalizeWhitespace: true });

      var showingPages = $('.showingPages span').text();
      var matches = showingPages.match(/of (\d+)/);

      if (matches) {
        total = parseInt(matches[1], 10);
      }

      var urls = [];

      $('.editionData > .dataRow:first-child a').each(function () {
        urls.push($(this).attr('href'));
      });

      ids = ids.concat(urls.map(function (url) {
        var matches = url.match(/\/(\d+)([.-]|$)/);

        if (matches) {
          return matches[1];
        } else {
          console.log('malformed url', url);
        }
      }));

      cbDoWhilst(err);
    });
  }, function () {
    queryString.page++;

    return ids.length < total;
  }, function (err) {
    if (err) {
      console.error(err);
    }

    cb(err, ids);
  });
}

function search(terms, cb) {
  var queryString = {
    key: process.env.GOODREADS_KEY,
    q: terms
  };

  request.get({ url: SEARCH_URL, qs: queryString }, function (err, res, body) {
    xml2js.parseString(body, {
      explicitArray: false,
      ignoreAttrs: true
    }, function (err, body) {
      if (err || res.statusCode !== 200) {
        return cb(err);
      }

      body = _.sortBy(body.GoodreadsResponse.search.results.work,
          function (result) {
        return parseInt(result.books_count, 10) *
               (parseInt(result.ratings_count, 10) || 1);
      });

      var work = _.last(body);

      if (!work) {
        console.log('Missing book:', terms);

        return cb();
      }

      getEditions(work.id, function (err, editions) {
        work.editions = editions;

        cb(null, work);
      });
    });
  });
}

var correlatedBooks = [];
var bookIndex = 0;

async.eachSeries(books, function (book, cbEach) {
  search(book.join(' '), function (err, result) {
    if (err) {
      return cbEach(err);
    }

    bookIndex++;

    if (bookIndex % 100 === 0) {
      process.stdout.write(String(bookIndex));
    } else if (bookIndex % 10 === 0) {
      process.stdout.write('.');
    }

    correlatedBooks.push(result);

    fs.writeFile('./guardian-correlated.json',
        JSON.stringify(correlatedBooks, null, 2), function (err) {
      cbEach(err);
    });
  });
}, function (err) {
  if (err) {
    console.error('error', err);
  }
});
