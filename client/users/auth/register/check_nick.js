/**
 *  Send nick value on server and show error if nick exists
 **/


'use strict';


/*global N, t, window*/


var $ = window.jQuery;
var notify = require('nodeca.core/client/common/_notify');


var DELAY = 500;
var timeout;


N.wire.on(module.apiPath, function register_check_nick(event) {
  var $elem = $(event.currentTarget);

  // make sure previous timeout was cleared
  clearTimeout(timeout);

  // delay request
  timeout = setTimeout(function () {
    var nick = $elem.val();

    N.io.rpc(module.apiPath, { nick: nick }, function (err) {
      var $control_group = $elem.parents('.control-group:first');

      if (err) {
        if (N.io.BAD_REQUEST === err.code) {
          // Problems with nick
          $control_group.addClass('error');
          $control_group.find('.help-block').text(err.message['nick']);
        } else {
          // something fatal
          notify('error', err.message);
        }
      } else {
        // no errors -> restore defaults
        $control_group.removeClass('error');
        $control_group.find('.help-block').text(t('nick_help'));
      }
    });
  }, DELAY);
});
