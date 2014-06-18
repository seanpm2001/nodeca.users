// Model for file page (comments, file usage...)

'use strict';


var async     = require('async');
var gm        = require('gm');
var mimoza    = require('mimoza');
var fstools   = require('fs-tools');
var fs        = require('fs');
var exec      = require('child_process').exec;

var Mongoose  = require('mongoose');
var Schema    = Mongoose.Schema;

var configReader  = require('./_lib/size_config_reader');


module.exports = function (N, collectionName) {

  var mediaSizes;
  // Need different options, depending on ImageMagick or GraphicsMagick used.
  var gmConfigOptions;


  var Media = new Schema({
    'file_id'     : Schema.Types.ObjectId,
    'user_id'     : Schema.Types.ObjectId,
    'album_id'    : Schema.Types.ObjectId,
    'created_at'  : { 'type': Date, 'default': Date.now },
    'description' : String
  }, {
    versionKey: false
  });

  // Indexes
  //////////////////////////////////////////////////////////////////////////////

  // Media page, routing
  Media.index({ file_id: 1 });

  // Album page, fetch medias
  // !!! sorting done in memory, because medias count per album is small
  Media.index({ album_id: 1 });

  // "All medias" page, medias list, sorted by date
  Media.index({ user_id: 1, _id: -1 });

  //////////////////////////////////////////////////////////////////////////////


  // Remove files with previews
  //
  Media.pre('remove', function (callback) {
    N.models.core.File.remove(this.file_id, true, callback);
  });


  // Reads image and prepare gm instance
  //
  // - path - path of image file. Required.
  // - size (Object) - size description from config. Required.
  //
  // callback(err, gm, contentType)
  //
  var resizeImage = function (path, size, callback) {
    // Get image size
    gm(path).options(gmConfigOptions).size(function(err, imageSize) {
      if (err) { return callback(err); }

      // Get image format
      this.format(function (err, imageFormat) {
        if (err) { return callback(err); }
        var contentType = mimoza.getMimeType(imageFormat);

        // Resize if image bigger than preview size
        if (imageSize.width > size.width || imageSize.height > size.height) {
          // Resize by height and crop extra
          this
            .quality(size.quality)
            .gravity('Center')
            .resize(null, size.height)
            .crop(size.width, size.height);
        }

        callback(null, this, contentType);
      });
    });
  };


  // Create original image with previews
  //
  // - path - path of image file. Required.
  //
  // callback(err, originalFileId)
  //
  Media.statics.createImage = function (path, callback) {
    var origTmp = fstools.tmpdir();
    var origContentType, origId;

    async.series([

      // First - create orig tmp image (first size in mediaSizes)
      function (next) {
        resizeImage(path, mediaSizes[0], function (err, gm, contentType) {
          if (err) { return next(err); }

          origContentType = contentType;
          gm.write(origTmp, next);
        });
      },

      // Save orig file to gridfs to get
      function (next) {
        N.models.core.File.put(origTmp, { 'contentType': origContentType }, function (err, file) {
          if (err) { return next(err); }
          origId = file._id;
          next();
        });
      },

      // Create previews for all sizes exclude orig (first)
      function (next) {
        async.eachSeries(mediaSizes.slice(1), function (size, next) {
          // Resize
          resizeImage(origTmp, size, function (err, gm) {
            if (err) { return next(err); }

            gm.toBuffer(function (err, buffer) {
              if (err) { return next(err); }

              // Save
              var params = { 'contentType': origContentType, 'filename': origId + '_' + size.size };
              N.models.core.File.put(buffer, params, function (err) {
                next(err);
              });
            });
          });
        }, next);
      }
    ], function (err) {
      fs.unlink(origTmp, function () {
        if (err) {
          // Try to clean up dirty data on error
          if (origId) {
            N.models.core.File.remove(origId, true, function () {
              callback(err);
            });
            return;
          }

          // origId not created
          callback(err);
          return;
        }

        callback(null, origId);
      });
    });
  };


  N.wire.on('init:models', function emit_init_Media(__, callback) {
    // Read config
    mediaSizes = configReader(((N.config.options || {}).users || {}).media_sizes || {});
    if (mediaSizes instanceof Error) {
      callback(mediaSizes);
      return;
    }

    // Check is ImageMagick or GraphicsMagick installed
    // GraphicsMagick prefered
    exec('gm version', function (__, stdout) {
      // Don't check error because condition below is most strict
      if (stdout.indexOf('GraphicsMagick') !== -1) {
        // GraphicsMagick installed continue loading
        gmConfigOptions = {};
        N.wire.emit('init:models.' + collectionName, Media, callback);
        return;
      }

      // Check ImageMagick if GraphicsMagick not found
      exec('convert -version', function (__, stdout) {
        // Don't check error because condition below is most strict
        if (stdout.indexOf('ImageMagick') !== -1) {
          // ImageMagick installed continue loading
          gmConfigOptions = { 'imageMagick': true };
          N.wire.emit('init:models.' + collectionName, Media, callback);
          return;
        }

        callback(new Error('You need GraphicsMagick or ImageMagick to run. Make sure that one of packages is installed and can be found via search path.'));
      });
    });
  });


  N.wire.on('init:models.' + collectionName, function init_model_Media(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
