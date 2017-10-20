var socket = require('./socket');
var EventEmitter = require('events').EventEmitter;
var asynk = require('asynk');
var uuid = require('uuid');
var inherits = require('util').inherits;

var telepathymq = module.exports = function(identity) {
  EventEmitter.call(this);
  this.identity = identity;
  this.relations = {};
  this.debug = new Function();
  this.defers = {};
  this.socks = [];
};

inherits(telepathymq, EventEmitter);

var deferHandler = function(self, task, event, emitter) {
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
    deferHandler(self, task, event, emitter);
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
    deferHandler(self, task, event, emitter);
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
