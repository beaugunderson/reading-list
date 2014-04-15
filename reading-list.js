var async = require('async');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var morgan = require('morgan');
var request = require('request');
var session = require('express-session');
var xml2js = require('xml2js');
var _ = require('lodash');

var passport = require('passport');
var GoodreadsStrategy = require('passport-goodreads').Strategy;

var app = express();

var PORT = process.env.PORT || 3000;

var GOODREADS_BASE = 'https://www.goodreads.com';

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

      xml2js.parseString(res, function (err, body) {
        if (err) {
          return cbDoWhilst(err);
        }

        body = body.GoodreadsResponse.reviews[0];

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

    //console.log('items: %j', items);

    //"book":[{"id":[{"_":"461927","$":{"type":"integer"}}],"isbn":["0807607339"],

    items = _.map(items, function (item) {
      return {
        id: item.book[0].id[0]._,
        isbn: item.book[0].isbn[0]
      };
    });

    console.log('items: %j', items);
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

app.use(morgan());
app.use(bodyParser());
app.use(cookieParser());

app.use(session({ secret: 'goodreads' }));

app.use(passport.initialize());
app.use(passport.session());

app.get('/', function (req, res) {
  res.send('hello world');
});

app.get('/auth/goodreads', passport.authenticate('goodreads'));

app.get('/auth/goodreads/callback',
  passport.authenticate('goodreads', { failureDirect: '/login' }),
    function (req, res) {
  res.redirect('/');
});

console.log('Listening on port %d', PORT);

app.listen(PORT);
