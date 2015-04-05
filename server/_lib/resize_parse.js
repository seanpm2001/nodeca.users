// Read, validate and prepare uploads configuration for media and avatars
//
// Params:
// - config object
//
// Returns config similar to input config, but with extended 'types' property like this:
// types: {
//   png: {
//     max_size: 2000000,
//     resize: {
//       orig: { width: 1280, skip_size: 1000000, type: 'png' },
//       md: { width: 640 },
//       sm: { max_width: 170, height: 150 }
//     }
//   },
//   zip: {
//     max_size: 2000000
//   }
// }
//

'use strict';

var _           = require('lodash');
var mimoza      = require('mimoza');
var validator   = require('is-my-json-valid');
var util        = require('util');

var configRules = {
  additionalProperties: false,
  properties: {
    extentions: {
      type: 'array',
      uniqueItems: true,
      minItems: 1,
      items: { type: 'string', pattern: /[a-z]+/ },
      required: true
    },
    max_size:      { type: 'number' },
    jpeg_quality:  { type: 'number' },
    gif_animation: { type: 'boolean' },
    resize:        { type: 'object' },
    types:         { type: 'object' }
  }
};

var validateConfigRules = validator(configRules, { verbose: true });


var typeConfigRules = {
  additionalProperties: true,
  properties: {
    max_size:      { type: 'number' },
    jpeg_quality:  { type: 'number' },
    gif_animation: { type: 'boolean' },
    resize:        { type: 'object' }
  }
};

var validateTypeConfigRules = validator(typeConfigRules, { verbose: true });


var resizeConfigRules = {
  additionalProperties: true,
  properties: {
    skip_size:    { type: 'number' },
    type:         { 'enum': [ 'jpeg', 'png', 'gif' ] },
    from:         { 'enum': [ 'orig', 'md', 'sm' ] },
    width:        { type: 'number' },
    height:       { type: 'number' },
    max_width:    { type: 'number' },
    max_height:   { type: 'number' },
    jpeg_quality: { type: 'number' },
    unsharp:      { type: 'boolean' }
  }
};

var validateResizeConfigRules = validator(resizeConfigRules, { verbose: true });


module.exports = _.memoize(function (uploadsConfig) {
  var config = _.cloneDeep(uploadsConfig);

  config.types = config.types || {};
  config.resize = config.resize || {};

  // Validate options
  var errors = [];

  // Check common uploads options
  if (!validateConfigRules(config)) {
    errors = errors.concat(validateConfigRules.errors);
  }

  // Check type specific options
  _.forEach(config.types, function (type) {
    if (!validateTypeConfigRules(config)) {
      errors = errors.concat(validateTypeConfigRules.errors);
    }
  });

  // Check resize options
  _.forEach(config.resize, function (resize) {
    if (!validateResizeConfigRules(config)) {
      errors = errors.concat(validateResizeConfigRules.errors);
    }
  });

  // Throw an error if validation failed
  if (errors.length > 0) {
    var errorMessages = [];
    for (var i = 0; i < errors.length; i++) {
      errorMessages.push(util.format("'%s' %s '%s'", errors[i].field, errors[i].message, errors[i].value));
    }
    throw new Error(errorMessages.join(', '));
  }

  var typesOptions = {};

  // Combine all options by file type
  _.forEach(config.extentions, function (ext) {
    var mimeType = mimoza.getMimeType(ext);

    // Get real extension (like 'jpg' instead 'jpeg')
    var realExtension = mimoza.getExtension(mimeType).replace('.', '');

    var configForExt = {
      max_size: config.max_size
    };

    // For images fill resize options
    if (mimeType.indexOf('image/') !== -1) {
      configForExt.resize = {};

      _.forEach(config.resize || {}, function (previewOptions, key) {
        // Get specific preview options by type
        var previewTypeOptions = ((config.types[realExtension] || {}).resize || {})[key] || {};

        // Override preview options by type preview options
        configForExt.resize[key] = _.assign({}, previewOptions, previewTypeOptions);

        // For jpeg preview assign 'jpeg_quality' option
        if (configForExt.resize[key].type === 'jpeg' ||
            (realExtension === 'jpeg' && !configForExt.resize[key].type)) {
          configForExt.resize[key].jpeg_quality =
            configForExt.resize[key].jpeg_quality || previewTypeOptions.jpeg_quality || config.jpeg_quality;
        }

        // For gif preview assign 'gif_animation' option
        if (configForExt.resize[key].type === 'gif' ||
            (realExtension === 'gif' && !configForExt.resize[key].type)) {
          configForExt.resize[key].gif_animation = previewTypeOptions.gif_animation || config.gif_animation;
        }
      });
    }

    // Override global options by type options
    _.assign(configForExt, _.omit(config.types[realExtension] || {}, 'resize'));

    typesOptions[ext] = configForExt;
  });

  // Override type options by result
  config.types = typesOptions;

  return config;
}, function (uploadsConfig) {
  return JSON.stringify(uploadsConfig);
});
