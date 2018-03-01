var socket = require('./socket');
var EventEmitter = require('events').EventEmitter;
var asynk = require('asynk');
var uuid = require('uuid');
var inherits = require('util').inherits;
var through2 = require('through2');
var _ = require('lodash');

var telepathymq = module.exports = function(identity) {
  EventEmitter.call(this);
  this.identity = identity;
  this.relations = {};
  this.debug = new Function();
  this.defers = {};
  this.streams = {};
  this.socks = [];
  this.ok = true;
};

inherits(telepathymq, EventEmitter);

var messageHandler = function(self, task, event, emitter) {
  switch(task) {
    case 'defer.resolve':
      if (self.defers[event.id]) {
        self.defers[event.id].resolve(event.data);
        delete self.defers[event.id];
      }
      break;
    case 'defer.notify':
      if (self.defers[event.id]) {
        self.defers[event.id].notify(event.data);
      }
      break;
    case 'defer.reject':
      if (self.defers[event.id]) {
        self.defers[event.id].reject(event.data);
        delete self.defers[event.id];
      }
      break;
    case 'defer.new':
      var defer = asynk.deferred();
      defer.done(function(data) {
        event.data = data;
        emitter.emit('defer.resolve', event);
      });
      defer.fail(function(data) {
        event.data = data;
        emitter.emit('defer.reject', event);
      });
      defer.progress(function(data) {
        event.data = data;
        emitter.emit('defer.notify', event);
      });
      EventEmitter.prototype.emit.call(self, event.name, defer, event.data);
      break;

    case 'stream.newIncoming':
      if (!self.streams[event.id]) {
        self.streams[event.id] = {};
        var incomingStream = through2(function(chunk, enc, cb) {
          cb(null, chunk);
        });

        var endNode = through2(function(chunk, enc, cb) {
          cb(null, chunk);
        });

        self.streams[event.id].endNode = endNode;
        self.streams[event.id].incomingStream = incomingStream;
        self.streams[event.id].incomingStream.pipe(self.streams[event.id].endNode);
      }

      EventEmitter.prototype.emit.call(self, event.name, self.streams[event.id].endNode);
      emitter.emit('stream.sendNextChunk', event);
      break;

    case 'stream.newOutgoing':
      if (!self.streams[event.id]) {
        self.streams[event.id] = {};
        var outgoingStream = through2(function(chunk, enc, cb) {
          ++outgoingStream.bufferedChunks;
          if (self.streams[event.id].canSendNextChunk) {
            self.streams[event.id].canSendNextChunk = false;
            event.data = chunk;
            emitter.emit('stream.data', event);
            --outgoingStream.bufferedChunks;
            return cb();
          }
          outgoingStream.once('sendNextChunk', function() {
            event.data = chunk;
            emitter.emit('stream.data', event);
            --outgoingStream.bufferedChunks;
            return cb();
          });
        });

        outgoingStream.bufferedChunks = 0;

        outgoingStream.on('sendNextChunk', function() {
          if (!self.streams[event.id].canSendNextChunk) {
            self.streams[event.id].canSendNextChunk = true;
          }
        });

        outgoingStream.on('finish', function() {
          var waitUntilBufferIsEmpty = function() {
            if (self.streams[event.id].outgoingStream.bufferedChunks === 0) {
              emitter.emit('stream.end', event);
            } else {
              self.streams[event.id].outgoingStream.once('sendNextChunk', function() {
                waitUntilBufferIsEmpty();
              });
            }
          };
          waitUntilBufferIsEmpty();
        });

        var endNode = through2(function(chunk, enc, cb) {
          cb(null, chunk);
        });

        self.streams[event.id].outgoingStream = outgoingStream;
        self.streams[event.id].endNode = endNode;
        self.streams[event.id].canSendNextChunk = true;

        self.streams[event.id].endNode.pipe(self.streams[event.id].outgoingStream);
      }
      EventEmitter.prototype.emit.call(self, event.name, self.streams[event.id].endNode);
      break;

    case 'stream.newDuplex':
      if (!self.streams[event.id]) {
        self.streams[event.id] = {};

        var endNode = through2(function(chunk, enc, cb) {
          self.streams[event.id].outgoingStream.writeThroughNetwork(chunk, enc, cb);
        });

        var outgoingStream = through2(function(chunk, enc, cb) {
          cb();
        });

        outgoingStream.bufferedChunks = 0;

        outgoingStream.writeThroughNetwork = function(chunk, enc, cb) {
          ++outgoingStream.bufferedChunks;
          if (self.streams[event.id].canSendNextChunk) {
            self.streams[event.id].canSendNextChunk = false;
            event.data = chunk;
            emitter.emit('stream.data', event);
            --outgoingStream.bufferedChunks;
            return cb();
          }
          outgoingStream.once('sendNextChunk', function() {
            self.streams[event.id].canSendNextChunk = false;
            event.data = chunk;
            emitter.emit('stream.data', event);
            --outgoingStream.bufferedChunks;
            return cb();
          });
        };

        outgoingStream.on('sendNextChunk', function() {
          if (!self.streams[event.id].canSendNextChunk) {
            self.streams[event.id].canSendNextChunk = true;
          }
        });

        var incomingStream = through2(function(chunk, enc, cb) {
          if (self.streams[event.id].endNode.alreadyErrored) {
            return false;
          }
          self.streams[event.id].endNode.once('drain2', function() {
            cb();
          });
          return self.streams[event.id].endNode.writeToOutPipe(chunk);
        });

        self.streams[event.id].outgoingStream = outgoingStream;
        self.streams[event.id].incomingStream = incomingStream;
        self.streams[event.id].canSendFirstChunk = null;

        self.streams[event.id].endNode = endNode;
        self.streams[event.id].endNode.pipedInto = [];
        self.streams[event.id].endNode.outPipesNotDrained = 0;

        self.streams[event.id].endNode._pipe = self.streams[event.id].endNode.pipe;
        self.streams[event.id].endNode.pipe = function(stream, options) {
          var pipedStream = self.streams[event.id].endNode._pipe(stream, options);
          var pipedStreamFn = pipedStream.listeners('end')[0];
          var pipedStreamInfo = {
            stream: pipedStream,
            fn: pipedStreamFn
          };
          self.streams[event.id].endNode.pipedInto.push(pipedStreamInfo);
          self.streams[event.id].endNode.emit('gotPiped');
        };

        self.streams[event.id].endNode._unpipe = self.streams[event.id].endNode.unpipe;
        self.streams[event.id].endNode.unpipe = function(stream) {
          if (!stream) {
            self.streams[event.id].endNode.pipedInto = [];
          } else {
            self.streams[event.id].endNode.pipedInto.forEach(function(pipedStream, index) {
              if (pipedStream.stream === stream) {
                self.streams[event.id].endNode.pipedInto.splice(index, 1);
              }
            });
          }
          self.streams[event.id].endNode._unpipe(stream);
        };

        self.streams[event.id].endNode.writeToOutPipe = function(data) {
          if (self.streams[event.id].endNode.pipedInto.length === 0) {
            self.streams[event.id].endNode.on('gotPiped', function() {
              self.streams[event.id].endNode.writeToOutPipe(data);
            });
            return false;
          }
          self.streams[event.id].endNode.pipedInto.forEach(function(pipedStream) {
            var canWriteAgain = pipedStream.stream.write(data);
            if (!canWriteAgain) {
              ++self.streams[event.id].endNode.outPipesNotDrained;
              pipedStream.stream.once('drain', function() {
                --self.streams[event.id].endNode.outPipesNotDrained;
                if (self.streams[event.id].endNode.outPipesNotDrained === 0) {
                  self.streams[event.id].endNode.emit('drain2');
                }
              });
            } else {
              if (self.streams[event.id].endNode.outPipesNotDrained === 0) {
                endNode.emit('drain2');
              }
            }
          });
          return false;
        };

        self.streams[event.id].endNode._end = self.streams[event.id].endNode.end;
        self.streams[event.id].endNode.end = function() {
          self.streams[event.id].outgoingStream.end();
          self.streams[event.id].outgoingStream.emit('end');
        }

        self.streams[event.id].endNode.on('error', function(err) {
          self.streams[event.id].endNode.alreadyErrored = true;
          event.data = err.message;
          emitter.emit('stream.error', event);
        });

        self.streams[event.id].outgoingStream.on('end', function() {
          var waitUntilBufferIsEmpty = function() {
            if (self.streams[event.id].outgoingStream.bufferedChunks === 0) {
              emitter.emit('stream.end', event);
            } else {
              self.streams[event.id].outgoingStream.once('sendNextChunk', function() {
                waitUntilBufferIsEmpty();
              });
            }
          };
          waitUntilBufferIsEmpty();
        });

        self.streams[event.id].incomingStream.on('end', function() {
          if (endNode.outPipesNotDrained === 0) {
            endNode._end();
          } else {
            endNode.on('drain2', function() {
              endNode._end();
            });
          }
        });
      }
      EventEmitter.prototype.emit.call(self, event.name, self.streams[event.id].endNode);
      emitter.emit('stream.sendNextChunk', event);
      break;

    case 'stream.data':
      if (self.streams[event.id]) {
        self.processingData = true;
        var canWriteAgain = self.streams[event.id].incomingStream.write(event.data);
        if (canWriteAgain) {
          self.processingData = false;
          emitter.emit('stream.sendNextChunk', event);
        } else {
          self.streams[event.id].incomingStream.once('drain', function() {
            self.processingData = false;
            emitter.emit('stream.sendNextChunk', event);
          });
        }
      }
      break;
    case 'stream.sendNextChunk':
      if (self.streams[event.id]) {
        self.streams[event.id].outgoingStream.emit('sendNextChunk');
      }
      break;
    case 'stream.error':
      if (self.streams[event.id]) {
        if (!self.streams[event.id].endNode.alreadyErrored) {
          self.streams[event.id].endNode.emit('error', event.data);
        };
      }
      break;
    case 'stream.end':
      if (self.streams[event.id]) {
        if (!self.processingData) {
          self.streams[event.id].incomingStream.end();
          self.streams[event.id].incomingStream.emit('end');
        } else {
          self.streams[event.id].incomingStream.once('drain', function() {
            self.streams[event.id].incomingStream.end();
            self.streams[event.id].incomingStream.emit('end');
          });
        }
      }
      break;
  }
};

var eventHandler = function(self, task, event, emitter) {
  switch(task) {
    case 'event.emit':
      EventEmitter.prototype.emit.call(self, event.name, event.data);
      break;
  }
};

telepathymq.prototype.listen = function(port, host, fn) {
  var self = this;
  var Socket = socket(this.debug);
  var sock = new Socket();
  sock.set('identity', this.identity);
  sock.on('register', function(identity, emitter) {
    self.relations[identity] = emitter;
    EventEmitter.prototype.emit.call(self, 'register', identity, emitter);
  });
  sock.on('socket close', function(identity) {
    self.relations[identity] = null;
    EventEmitter.prototype.emit.call(self, 'unregister', identity);
  });
  sock.on('message', function(task, event, emitter) {
    messageHandler(self, task, event, emitter);
    eventHandler(self, task, event, emitter);
  });
  // check for tls protocol
  if (typeof port === 'string' && port.startsWith('tls') && typeof host === 'object') {
    sock.set('tls', host);
    sock.bind(port, fn);
  } else {
    sock.bind(port, host, fn);
  }
  this.socks.push(sock);
}

telepathymq.prototype.register = function(identity, connectString, options, cb) {
  var self = this;
  if (typeof options === 'function') {
    cb = options;
    options = null;
  }
  cb = cb || new Function();
  var Socket = socket(this.debug);
  var sock = new Socket();
  sock.set('identity', this.identity);
  if (connectString.startsWith('tls') && typeof options === 'object') {
    sock.set('tls', options);
  }
  sock.register(identity, connectString, function(emitter) {
    self.relations[identity] = emitter;
    EventEmitter.prototype.emit.call(self, 'register', identity);
    cb();
  });
  sock.on('socket close', function(identity) {
    self.relations[identity] = null;
    EventEmitter.prototype.emit.call(self, 'unregister', identity);
  });
  sock.on('message', function(task, event, emitter) {
    messageHandler(self, task, event, emitter);
    eventHandler(self, task, event, emitter);
  });
  this.socks.push(sock);
}

telepathymq.prototype.defer = function(identity, eventName, data) {
  var defer = asynk.deferred();
  var emitter = this.relations[identity];
  if (!emitter) {
    defer.reject(new Error(identity + ' is not registered'));
    return defer;
  }
  var deferId = uuid.v4();
  this.defers[deferId] = defer;
  var event = {
    name: eventName,
    id: deferId,
    data: data
  };
  emitter.emit('defer.new', event);
  return defer.promise();
}

telepathymq.prototype.stream = function(identity, eventName, stream) {
  var self = this;
  var emitter = this.relations[identity];
  if (!emitter) {
    defer.reject(new Error(identity + ' is not registered'));
    return defer;
  }

  if (!stream || !_.isObject(stream) || !_.isFunction(stream.pipe)) {
    defer.reject(new Error('invalid stream'));
    return defer;
  }

  var isReadable = false;
  var isWritable = false;

  if (stream.writable !== false && _.isFunction(stream._write) && _.isObject(stream._writableState)) {
    isWritable = true;
  }

  if (stream.readable !== false && _.isFunction(stream._read) && _.isObject(stream._readableState)) {
    isReadable = true;
  }

  var streamId = uuid.v4();
  var event = {
    name: eventName,
    id: streamId
  };

  if (!isReadable && !isWritable) {
    defer.reject(new Error('invalid stream'));
    return defer;
  }

  this.streams[streamId] = {};

  if (isReadable && isWritable) {
    var incomingStream = through2(function(chunk, enc, cb) {
      return cb(null, chunk);
    });

    self.streams[streamId].endNode = stream;
    self.streams[streamId].endNode.countPipedStreams = 0;
    self.streams[streamId].endNode.countEndedStreams = 0;
    self.streams[streamId].incomingStream = incomingStream;

    self.streams[streamId].endNode.on('pipe', function(stream) {
      ++self.streams[streamId].endNode.countPipedStreams;
    });

    self.streams[streamId].endNode.on('unpipe', function(stream) {
      --self.streams[streamId].endNode.countPipedStreams;
      if (self.streams[streamId].endNode.countPipedStreams === 0) {
        self.streams[streamId].endNode.end();
      }
    });

    self.streams[streamId].endNode._end = self.streams[streamId].endNode.end;
    self.streams[streamId].endNode.end = function() {
      ++self.streams[streamId].endNode.countEndedStreams;
      if (self.streams[streamId].endNode.countEndedStreams >= self.streams[streamId].endNode.countPipedStreams) {
        var waitUntilBufferIsEmpty = function() {
          if (self.streams[streamId].endNode._readableState.buffer.length === 0) {
            self.streams[streamId].endNode._end();
            self.streams[streamId].endNode.emit('end');
          } else {
            self.streams[streamId].outgoingStream.once('drain', function() {
              waitUntilBufferIsEmpty();
            });
          }
        }
        waitUntilBufferIsEmpty();
      }
    };

    self.streams[streamId].incomingStream.pipe(self.streams[streamId].endNode);

    var outgoingStream = through2(function(chunk, enc, cb) {
      ++outgoingStream.bufferedChunks;
      if (self.streams[event.id].canSendNextChunk) {
        self.streams[event.id].canSendNextChunk = false;
        event.data = chunk;
        emitter.emit('stream.data', event);
        --outgoingStream.bufferedChunks;
        return cb();
      }
      outgoingStream.once('sendNextChunk', function() {
        self.streams[event.id].canSendNextChunk = false;
        event.data = chunk;
        emitter.emit('stream.data', event);
        --outgoingStream.bufferedChunks;
        return cb();
      });
    });

    self.streams[streamId].outgoingStream = outgoingStream;
    self.streams[streamId].outgoingStream.bufferedChunks = 0;

    self.streams[streamId].outgoingStream.once('sendNextChunk', function() {
      if (_.isNull(self.streams[event.id].canSendNextChunk)) {
        self.streams[event.id].canSendNextChunk = true;
      }
      emitter.emit('stream.sendNextChunk', event);
    });

    self.streams[streamId].outgoingStream.on('sendNextChunk', function() {
      if (!self.streams[event.id].canSendNextChunk) {
        self.streams[event.id].canSendNextChunk = true;
      }
    });

    self.streams[streamId].endNode.pipe(self.streams[streamId].outgoingStream);

    self.streams[streamId].outgoingStream.on('finish', function() {
      var waitUntilBufferIsEmpty = function() {
        if (self.streams[streamId].outgoingStream.bufferedChunks === 0) {
          emitter.emit('stream.end', event);
        } else {
          self.streams[streamId].outgoingStream.once('sendNextChunk', function() {
            waitUntilBufferIsEmpty();
          });
        }
      };
      waitUntilBufferIsEmpty();
    });

    self.streams[event.id].endNode.on('error', function(err) {
      self.streams[event.id].endNode.alreadyErrored = true;
      event.data = err.message;
      emitter.emit('stream.error', event);
    });

    self.streams[streamId].canSendNextChunk = null;
    emitter.emit('stream.newDuplex', event);
    return;
  } else if (isReadable) {
    var outgoingStream = through2(function(chunk, enc, cb) {
      ++outgoingStream.bufferedChunks;
      if (self.streams[event.id].canSendNextChunk) {
        self.streams[event.id].canSendNextChunk = false;
        event.data = chunk;
        emitter.emit('stream.data', event);
        --outgoingStream.bufferedChunks;
        return cb();
      }
      outgoingStream.once('sendNextChunk', function() {
        self.streams[event.id].canSendNextChunk = false;
        event.data = chunk;
        emitter.emit('stream.data', event);
        --outgoingStream.bufferedChunks;
        return cb();
      });
    });

    outgoingStream.bufferedChunks = 0;

    outgoingStream.on('finish', function() {
      var waitUntilBufferIsEmpty = function() {
        if (outgoingStream.bufferedChunks === 0) {
          emitter.emit('stream.end', event);
        } else {
          outgoingStream.once('sendNextChunk', function() {
            waitUntilBufferIsEmpty();
          });
        }
      };
      waitUntilBufferIsEmpty();
    });

    self.streams[streamId].outgoingStream = outgoingStream;
    self.streams[streamId].endNode = stream;
    self.streams[streamId].canSendNextChunk = null;

    self.streams[streamId].outgoingStream.once('sendNextChunk', function() {
      if (_.isNull(self.streams[event.id].canSendNextChunk)) {
        self.streams[event.id].canSendNextChunk = true;
      }
    });

    stream.pipe(outgoingStream);
    emitter.emit('stream.newIncoming', event);
    return;
  } else if (isWritable) {
    var incomingStream = through2(function(chunk, enc, cb) {
      cb(null, chunk);
    });

    incomingStream.pipe(stream);

    stream.on('error', function(err) {
      event.data = err.message;
      emitter.emit('stream.error', event);
    });

    self.streams[streamId].incomingStream = incomingStream;
    self.streams[streamId].endNode = stream;
    emitter.emit('stream.newOutgoing', event);
    return;
  }
}

telepathymq.prototype.emit = function(identity, eventName, data) {
  var emitter = this.relations[identity];
  if (!emitter) {
    return false;
  }
  var event = {
    name: eventName,
    data: data
  };
  emitter.emit('event.emit', event);
  return true;
}

telepathymq.prototype.close = function(cb) {
  cb = cb || new Function();
  asynk.each(this.socks, function(sock, cb) {
    sock.close(cb);
  }).parallel().asCallback(cb);
}
