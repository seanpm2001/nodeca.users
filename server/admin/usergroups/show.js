"use strict";

/*global nodeca, _*/


var UserGroup = nodeca.models.users.UserGroup;

// Validate input parameters
//
var params_schema = {
  _id: {
    type: 'string',
    required: true
  }
};
nodeca.validate(params_schema);


/**
 * admin.usergroups.show(params, callback) -> Void
 *
 *
 * Display usergrroup
 *
 **/
module.exports = function (params, next) {
  var env = this;


  UserGroup.findOne({_id: params._id}).setOptions({ lean: true }).exec(function(err, group) {
    if (err) {
      next(err);
      return;
    }
    if (!group) {
      next({ statusCode: nodeca.io.NOT_FOUND });
      return;
    }

    var settings = nodeca.config.setting_schemas['usergroup'];

    // collect  usergroups items and group it by setting group
    var item_groups = {};
    _.keys(settings).forEach(function(name) {
      var item = settings[name];
      // get value from model if exists
      if (name in group.items) {
        item.value = group.items[name];
      }
      
      var group_name = item['group'];
      if (!item_groups[group_name]) {
        item_groups[group_name] = {};
      }
      item_groups[group_name][name] = item;
    });
    env.data.item_groups = item_groups;

    env.data.usergroup = group;
    next();
  });
};


// Put usergroups items into response data
//
nodeca.filters.after('@', function (params, next) {
  this.response.data.usergroup_id = this.data.usergroup._id;
  this.response.data.item_groups = this.data.item_groups;

  next();
});
