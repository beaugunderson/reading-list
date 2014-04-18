var async = require('async');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var request = require('request');
var session = require('express-session');
var swig = require('swig');
var xml2js = require('xml2js');
var _ = require('lodash');

var passport = require('passport');
var GoodreadsStrategy = require('passport-goodreads').Strategy;

var PORT = process.env.PORT || 3000;

var GOODREADS_BASE = 'https://www.goodreads.com';

var GUARDIAN_BOOKS = _.compact(require('./guardian-correlated.json'));

function updateReadBooks(userId) {
  var url = GOODREADS_BASE + '/review/list/';

  var queryString = {
    format: 'xml',
    id: userId,
    key: process.env.GOODREADS_KEY,
    page: 1,
    per_page: 100,
    shelf: 'read',
    v: 2
  };

  var items = [];
  var total;

  async.doWhilst(function (cbDoWhilst) {
    request.get({ url: url, qs: queryString }, function (err, req, res) {
      if (err) {
        return cbDoWhilst(err);
      }

      xml2js.parseString(res, { explicitArray: false }, function (err, body) {
        if (err) {
          return cbDoWhilst(err);
        }

        body = body.GoodreadsResponse.reviews;

        if (!total) {
          total = body.$.total;
        }

        items = items.concat(body.review);

        cbDoWhilst();
      });
    });
  }, function () {
    queryString.page++;

    return items.length < total;
  }, function (err) {
    if (err) {
      console.error('error', err);
    }

    items = _.map(items, function (item) {
      return {
        id: item.book.id._,
        isbn: item.book.isbn
      };
    });

    var editions = _(GUARDIAN_BOOKS).map(function (book) {
      if (!book.editions) {
        return book.id;
      }

      return book.editions;
    })
    .flatten()
    .valueOf();

    var intersection = _.intersection(editions, _.pluck(items, 'id'));

    console.log('intersection: %j', intersection);
    console.log('intersection.length', intersection.length);
  });
}

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

passport.use(new GoodreadsStrategy({
  consumerKey: process.env.GOODREADS_KEY,
  consumerSecret: process.env.GOODREADS_SECRET,
  callbackURL: 'http://lvh.me:' + PORT + '/auth/goodreads/callback'
}, function (token, tokenSecret, profile, done) {
  updateReadBooks(profile.id);

  return done(null, profile);
}));

var app = express();

app.engine('html', swig.renderFile);

app.set('view engine', 'html');
app.set('views', __dirname + '/views');

app.set('view cache', false);

swig.setDefaults({ cache: false });

app.use(morgan());
app.use(bodyParser());
app.use(cookieParser());

app.use(session({ secret: 'goodreads' }));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(__dirname + '/static'));

app.get('/', function (req, res) {
  res.render('index', { books: GUARDIAN_BOOKS });
});

app.get('/auth/goodreads', passport.authenticate('goodreads'));

app.get('/auth/goodreads/callback',
  passport.authenticate('goodreads', { failureDirect: '/login' }),
    function (req, res) {
  res.redirect('/');
});

console.log('Listening on port %d', PORT);

app.listen(PORT);
