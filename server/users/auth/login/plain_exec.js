// Login by `email` provider (email/password or nick/password)


'use strict';


var _         = require('lodash');
var recaptcha = require('nodeca.core/lib/recaptcha');


module.exports = function (N, apiPath) {
  var rateLimit = require('./_rate_limit')(N);


  // Don't set "required" flag, to manually fill
  N.validate(apiPath, {
    email_or_nick: { type: 'string' }
  , pass:          { type: 'string' }
  , recaptcha_challenge_field: { type: 'string', 'default': '' }
  , recaptcha_response_field:  { type: 'string', 'default': '' }
  , redirect_id: { format: 'mongo' }
  });


  // Touch rate limits in lazy style - do not wait for callbacks.
  //
  function updateRateLimits(clientIp) {
    rateLimit.ip.update(clientIp);
    rateLimit.total.update();
  }


  N.wire.before(apiPath, function login_guest_only(env, callback) {
    N.wire.emit('internal:users.redirect_not_guest', env, callback);
  });


  // If there is neither email_or_nick or pass - stop before database queries.
  //
  N.wire.before(apiPath, function check_params(env) {
    if (_.isEmpty(env.params.email_or_nick) ||
        _.isEmpty(env.params.pass)) {
      return {
        code:    N.io.CLIENT_ERROR
      , message: env.t('login_failed')
      , fields:  [ 'email_or_nick', 'pass' ]
      , captcha: false
      };
    }
  });


  // Check for too many total logins (60 attempts / 60 seconds).
  // That can cause too hight CPU use in bcrypt.
  // Do soft limit - ask user to enter captcha to make sure he is not a bot.
  //
  N.wire.before(apiPath, function check_total_rate_limit(env, callback) {
    rateLimit.total.check(function (err, isExceeded) {
      if (err) {
        callback(err);
        return;
      }

      env.data.captcha_required = isExceeded;

      // If limit is not exceeded - skip captcha check.
      if (!env.data.captcha_required) {
        callback();
        return;
      }

      var privateKey = N.config.options.recaptcha.private_key
        , clientIp   = env.req.ip
        , challenge  = env.params.recaptcha_challenge_field
        , response   = env.params.recaptcha_response_field;

      if (!response) {
        updateRateLimits(clientIp);
        callback({
          code:    N.io.CLIENT_ERROR
        , message: env.t('missed_captcha_solution')
        , captcha: env.data.captcha_required
        });
        return;
      }

      recaptcha.verify(privateKey, clientIp, challenge, response, function (err, valid) {
        if (err || !valid) {
          updateRateLimits(clientIp);
          callback({
            code:    N.io.CLIENT_ERROR
          , message: env.t('wrong_captcha_solution')
          , fields:  [  'recaptcha_response_field' ]
          , captcha: env.data.captcha_required
          });
          return;
        }

        callback();
      });
    });
  });


  // Check for too many invalid logins (5 attempts / 300 seconds) from single IP
  // Do hard limit - ask user to wait 5 minutes.
  //
  N.wire.before(apiPath, function check_ip_rate_limit(env, callback) {
    rateLimit.ip.check(env.req.ip, function (err, isExceeded) {
      if (err) {
        callback(err);
        return;
      }

      if (isExceeded) {
        updateRateLimits(env.req.ip);
        callback({
          code:    N.io.CLIENT_ERROR
        , message: env.t('too_many_attempts')
        , fields: [ 'recaptcha_response_field' ]
        , captcha: env.data.captcha_required
        });
        return;
      }

      callback();
    });
  });


  // Try to find auth data using `email_or_nick` as an email.
  //
  N.wire.on(apiPath, function find_authlink_by_email(env, callback) {
    if (env.data.user && env.data.authLink) {
      callback();
      return;
    }

    N.models.users.AuthLink
      .findOne({ 'email': env.params.email_or_nick, 'type': 'plain', 'exist' : true })
      .exec(function (err, authLink) {

      if (err) {
        callback(err);
        return;
      }

      if (!authLink) {
        callback(); // There is no error - let next hooks do their job.
        return;
      }

      N.models.users.User
        .findOne({ '_id': authLink.user_id })
        .lean(true)
        .exec(function (err, user) {

        if (err) {
          callback(err);
          return;
        }

        if (!user) {
          callback(); // There is no error - let next hooks do their job.
          return;
        }

        env.data.user     = user;
        env.data.authLink = authLink;

        callback();
      });
    });
  });


  // Try to find auth data using `email_or_nick` as a nick.
  //
  N.wire.on(apiPath, function find_authlink_by_nick(env, callback) {
    if (env.data.user && env.data.authLink) {
      callback();
      return;
    }

    N.models.users.User
      .findOne({ 'nick': env.params.email_or_nick })
      .lean(true)
      .exec(function (err, user) {

      if (err) {
        callback(err);
        return;
      }

      if (!user) {
        callback(); // There is no error - let next hooks do their job.
        return;
      }

      N.models.users.AuthLink
        .findOne({ 'user_id': user._id, 'type': 'plain', 'exist': true })
        .exec(function (err, authLink) {

        if (err) {
          callback(err);
          return;
        }

        if (!authLink) {
          callback(); // There is no error - let next hooks do their job.
        }

        env.data.user     = user;
        env.data.authLink = authLink;

        callback();
      });
    });
  });


  N.wire.on(apiPath, function login_do(env, callback) {
    // user not found or doesn't have authlink record for plain login
    if (!env.data.user || !env.data.authLink) {
      updateRateLimits(env.req.ip);
      callback({
        code:    N.io.CLIENT_ERROR,
        message: env.t('login_failed'),
        fields:  [ 'email_or_nick', 'pass' ],
        captcha: env.data.captcha_required
      });
      return;
    }

    env.data.authLink.checkPass(env.params.pass, function(err, success) {
      if (err) {
        callback(err);
        return;
      }

      // password mismatch
      if (!success) {
        updateRateLimits(env.req.ip);
        callback({
          code:    N.io.CLIENT_ERROR
        , message: env.t('login_failed')
        , fields:  [ 'email_or_nick', 'pass' ]
        , captcha: env.data.captcha_required
        });
        return;
      }

      // Set login redirect URL.
      env.data.redirect_id = env.params.redirect_id;
      N.wire.emit('internal:users.login', env, function set_redirect() {
        env.res.redirect_url = env.data.redirect_url;
        callback();
      });
    });
  });


  // Clear data user for oauth.
  //
  N.wire.after(apiPath, function clear_oauth_data(env) {
    env.session = _.omit(env.session, 'state');
    env.session = _.omit(env.session, 'oauth');
  });

};
