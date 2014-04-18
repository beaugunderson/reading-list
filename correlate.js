var async = require('async');
var cheerio = require('cheerio');
var fs = require('fs');
var Levenshtein = require('levenshtein');
var request = require('request');
var xml2js = require('xml2js');
var _ = require('lodash');

var SEARCH_URL = 'https://www.goodreads.com/search.xml';

var BOOKS = require('./guardian-books.json');

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
  if (terms.length === 3) {
    terms = [terms[2]];
  }

  var queryString = {
    key: process.env.GOODREADS_KEY,
    q: terms.join(' ')
  };

  request.get({ url: SEARCH_URL, qs: queryString }, function (err, res, body) {
    xml2js.parseString(body, {
      explicitArray: false,
      ignoreAttrs: true
    }, function (err, body) {
      if (err || res.statusCode !== 200) {
        return cb(err);
      }

      var works = body.GoodreadsResponse.search.results.work;

      if (!Array.isArray(works)) {
        works = [works];
      }

      works = _.sortBy(works, function (result) {
        var book = result.best_book || result;

        // This is a tiebreaker based on the number of ratings
        var distance = 1 / (parseInt(result.ratings_count, 10) || 1);

        // Sort based on closeness to the specified title and author
        if (terms.length === 2) {
          distance += new Levenshtein(book.title, terms[0]).distance;
          distance += new Levenshtein(book.author.name, terms[1]).distance;
        }

        return distance;
      });

      var work = _.first(works);

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

async.eachSeries(BOOKS, function (book, cbEach) {
  search(book, function (err, result) {
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
