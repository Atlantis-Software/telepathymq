
/**
 * Module dependencies.
 */

var Emitter = require('events').EventEmitter;
var Message = require('amp-message');
var Parser = require('amp').Stream;
var url = require('url');
var net = require('net');
var fs = require('fs');
var tls = require('tls');
var _ = require('lodash');

/**
 * Errors to ignore.
 */

var ignore = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ENOENT'
];

/**
 * Expose `Socket`.
 */

module.exports = function(debug) {

  debug = debug || new Function();

  /**
   * Initialize a new `Socket`.
   *
   * A "Socket" encapsulates the ability of being
   * the "client" or the "server" depending on
   * whether `connect()` or `bind()` was called.
   *
   * @api private
   */

  function Socket() {
    var self = this;
    this.server = null;
    this.socks = [];
    this.settings = {
      "hwm": Infinity,
      "identity": String(process.pid),
      "retry timeout": 100,
      "retry max timeout": 5000
    };
    this.callbacks = {};
    this.identity = this.get('identity');
    this.ids = 0;
    this.queue = [];

    this.on('connect', function(){
      var prev = self.queue;
      var len = prev.length;
      self.queue = [];
      debug('trace', 'flush ' + len + ' messages');

      for (var i = 0; i < len; ++i) {
        self.send.apply(this, prev[i]);
      }

      self.emit('flush', prev);
    });
  }

  /**
   * Inherit from `Emitter.prototype`.
   */

  Socket.prototype.__proto__ = Emitter.prototype;

  /**
   * Make it configurable `.set()` etc.
   */

  Socket.prototype.get = function(key) {
    return this.settings[key];
  };

  Socket.prototype.set = function(key, value) {
    this.settings[key] = value;
  };

  /**
  * Provides an `.enqueue()` method to the `sock`. Messages
  * passed to `enqueue` will be buffered until the next
  * `connect` event is emitted.
  *
  * Emits:
  *
  *  - `drop` (msg) when a message is dropped
  *  - `flush` (msgs) when the queue is flushed
  *
  * @param {Object} options
  * @api private
  */

  Socket.prototype.enqueue = function(msg){
    var hwm = this.settings.hwm;
    if (this.queue.length >= hwm) {
      debug('trace', 'drop');
      this.emit('drop', msg);
    }
    this.queue.push(msg);
  };

  /**
   * Return a message id.
   *
   * @return {String}
   * @api private
   */

  Socket.prototype.id = function(){
    var id = this.identity + ':' + this.ids++;
    return id;
  };

  /**
   * Use the given `plugin`.
   *
   * @param {Function} plugin
   * @api private
   */

  Socket.prototype.use = function(plugin){
    plugin(this);
    return this;
  };

  /**
   * Creates a new `Message` and write the `args`.
   *
   * @param {Array} args
   * @return {Buffer}
   * @api private
   */

  Socket.prototype.pack = function(args){
    var msg = new Message(args);
    return msg.toBuffer();
  };

  /**
   * Close all open underlying sockets.
   *
   * @api private
   */

  Socket.prototype.closeSockets = function(fn){
    debug('trace', this.type + ' closing ' + this.socks.length + ' connections');
    var i = this.socks.length;
    if (!i) {
      return fn();
    }
    this.socks.forEach(function(sock){
      if (fn) {
        sock.on('end', function listener(){
          sock.removeListener('close', listener);
          --i || fn();
        });
      }
      sock.end();
    });
  };

  /**
   * Close the socket.
   *
   * Delegates to the server or clients
   * based on the socket `type`.
   *
   * @param {Function} [fn]
   * @api public
   */

  Socket.prototype.close = function(fn){
    debug('trace', this.type + ' closing');
    this.closing = true;
    var i = this.server ? 2 : 1;
    this.closeSockets(function(err) {
      if (err) {
        return fn && fn(err);
      }
      --i || fn && fn();
    });
    if (this.server) this.closeServer(function(err) {
      if (err) {
        return fn && fn(err);
      }
      --i || fn && fn();
    });
  };

  /**
   * Close the server.
   *
   * @param {Function} [fn]
   * @api public
   */

  Socket.prototype.closeServer = function(fn){
    debug('trace', this.type + ' closing server');
    this.server.on('close', this.emit.bind(this, 'close'));
    this.server.close(fn);
  };

  /**
   * Return the server address.
   *
   * @return {Object}
   * @api public
   */

  Socket.prototype.address = function(){
    if (!this.server) return;
    var addr = this.server.address();
    addr.string = (this.get('tls') ? 'tls://' : 'tcp://') + addr.address + ':' + addr.port;
    return addr;
  };

  /**
   * Remove `sock`.
   *
   * @param {Socket} sock
   * @api private
   */

  Socket.prototype.removeSocket = function(sock){
    var i = this.socks.indexOf(sock);
    if (!~i) return;
    debug('trace', this.type + ' remove socket ' + i);
    this.socks.splice(i, 1);
  };

  /**
   * Add `sock`.
   *
   * @param {Socket} sock
   * @api private
   */

  Socket.prototype.addSocket = function(sock){
    var parser = new Parser;
    var i = this.socks.push(sock) - 1;
    debug('trace', this.type + ' add socket ' + i);
    sock.pipe(parser);
    parser.on('data', this.onmessage(sock));
  };

  /**
   * Handle `sock` errors.
   *
   * Emits:
   *
   *  - `error` (err) when the error is not ignored
   *  - `ignored error` (err) when the error is ignored
   *  - `socket error` (err) regardless of ignoring
   *
   * @param {Socket} sock
   * @api private
   */

  Socket.prototype.handleErrors = function(sock){
    var self = this;
    sock.on('error', function(err){
      debug('error', self.type + ' error ' + err.code || err.message);
      self.emit('socket error', err);
      self.removeSocket(sock);
      if (!~ignore.indexOf(err.code)) {
        return self.emit('error', err);
      }
      debug('trace', self.type + ' ignored ' + err.code);
      self.emit('ignored error', err);
    });
  };

  /**
   * Handles framed messages emitted from the parser, by
   * default it will go ahead and emit the "message" events on
   * the socket. However, if the "higher level" socket needs
   * to hook into the messages before they are emitted, it
   * should override this method and take care of everything
   * it self, including emitted the "message" event.
   *
   * @param {net.Socket} sock
   * @return {Function} closure(msg, mulitpart)
   * @api private
   */

  Socket.prototype.onmessage = function(sock){
    var self = this;

    return function (buf){
      var msg = new Message(buf);
      var args = msg.args;
      var id = args.pop();
      var task = args[0];
      var emitter = {
        sock: sock,
        emit: emit
      };
      if (task === 'register') {
        if (sock.writable) {
          sock.write(self.pack(['registered', id]));
        }
        var data = args[1];
        return self.emit('register', data.identity, emitter);
      }
      if (task === 'registered') {
        var fn = self.callbacks[id];
        if (!fn) return debug('error', 'missing callback ' + id);
        delete self.callbacks[id];
        return fn(emitter);
      }

      args = _.cloneDeepWith(args, function(entry) {
        if (_.isObject(entry) && entry.type === 'Buffer' && entry.data) {
          return new Buffer(entry.data);
        }
      });

      args.unshift('message');
      args.push(emitter);
      self.emit.apply(self, args);

      function emit() {
        var fn = function(){};
        var id = self.id();
        var args = Array.prototype.slice.call(arguments);
        args[0] = args[0] || null;

        var hasCallback = 'function' == typeof args[args.length - 1];
        if (hasCallback) fn = args.pop();
        args.push(id);

        if (sock.writable) {
          sock.write(self.pack(args), function(){ fn(true); });
          return true;
        } else {
          debug('trace', 'peer went away');
          process.nextTick(function(){ fn(false); });
          return false;
        }
      }
    };
  };


  /**
   * Connect to `port` at `host` and invoke `fn()`.
   *
   * Defaults `host` to localhost.
   *
   * TODO: needs big cleanup
   *
   * @param {Number|String} port
   * @param {String} host
   * @param {Function} fn
   * @return {Socket}
   * @api public
   */

  Socket.prototype.connect = function(identity, port, host, fn){
    var self = this;
    if ('server' == this.type) throw new Error('cannot connect() after bind()');
    if ('function' == typeof host) {
      fn = host;
      host = undefined;
    }

    if ('string' == typeof port) {
      port = url.parse(port);

      if (port.protocol == "unix:") {
        host = fn;
        fn = undefined;
        port = port.pathname;
      } else {
        host = port.hostname || '0.0.0.0';
        port = parseInt(port.port, 10);
      }
    } else {
      host = host || '0.0.0.0';
    }

    var max = self.get('retry max timeout');
    this.type = 'client';
    var sock;
    var tlsOpts = this.get('tls');

    var onConnect = function() {
      debug('trace', self.type + ' connect');
      self.connected = true;
      self.addSocket(sock);
      self.retry = self.get('retry timeout');
      self.emit('connect', sock);
      fn && fn(null, sock);
    };

    if (tlsOpts) {
      tlsOpts.host = host;
      tlsOpts.port = port;
      debug('trace', self.type + ' connect attempt ' + host + ':' + port);
      sock = tls.connect(tlsOpts, onConnect);
    } else {
      sock = new net.Socket();
      debug('trace', self.type + ' connect attempt ' + host + ':' + port);
      sock.connect(port, host);
      sock.on('connect', onConnect);
    }

    sock.identity = identity;
    sock.setNoDelay();

    this.handleErrors(sock);

    sock.on('close', function() {
      sock.removeAllListeners();
      sock.destroy();
      self.emit('socket close', sock.identity);
      self.connected = false;
      self.removeSocket(sock);
      if (self.closing) {
        return self.emit('close');
      }
      var retry = self.retry || self.get('retry timeout');
      setTimeout(function(){
        debug('trace', self.type + ' attempting reconnect');
        self.emit('reconnect attempt');
        self.connect(identity, port, host, fn);
        self.retry = Math.round(Math.min(max, retry * 1.5));
      }, retry);
    });

    return this;
  };

  Socket.prototype.register = function(identity, host, fn) {
    var self = this;
    var data = {identity: this.get('identity')};
    if ('server' == this.type) throw new Error('cannot connect() after bind()');

    var port;
    if ('number' === typeof host) {
      port = host;
      host = '0.0.0.0';
    } else if ('string' == typeof host) {
      port = url.parse(host);

      if (port.protocol == "unix:") {
        host = fn;
        port = port.pathname;
      } else {
        host = port.hostname || '0.0.0.0';
        port = parseInt(port.port, 10);
      }
    } else {
      throw new Error('invalid host parameter');
    }
    fn = fn || function(){};
    this.connect(identity, port, host, function(err, sock) {
      var args = ['register', data];
      var id = self.id();
      self.callbacks[id] = fn;
      args.push(id);
      if (sock) {
        sock.write(self.pack(args));
      } else {
        debug('trace', 'no connected peers');
        self.enqueue(args);
      }
    });
  };

  /**
   * Handle connection.
   *
   * @param {Socket} sock
   * @api private
   */

  Socket.prototype.onconnect = function(sock){
    var self = this;
    var addr = sock.remoteAddress + ':' + sock.remotePort;
    var tlsOptions = self.get('tls');
    if (tlsOptions && !sock.authorized) {
      debug('error', self.type + ' denied ' + addr + ' for authorizationError ' + sock.authorizationError);
    }
    debug('debug', self.type + ' accept ' + addr);
    this.addSocket(sock);
    this.handleErrors(sock);
    this.emit('connect', sock);
    sock.on('close', function() {
      debug('debug', self.type + ' disconnect ' + addr);
      self.emit('disconnect', sock.identity);
      self.removeSocket(sock);
    });
  };

  /**
   * Bind to `port` at `host` and invoke `fn()`.
   *
   * Defaults `host` to INADDR_ANY.
   *
   * Emits:
   *
   *  - `connection` when a client connects
   *  - `disconnect` when a client disconnects
   *  - `bind` when bound and listening
   *
   * @param {Number|String} port
   * @param {Function} fn
   * @return {Socket}
   * @api public
   */

  Socket.prototype.bind = function(port, host, fn){
    var self = this;
    if ('client' == this.type) throw new Error('cannot bind() after connect()');
    if ('function' == typeof host) {
      fn = host;
      host = undefined;
    }

    var unixSocket = false;

    if ('string' == typeof port) {
      port = url.parse(port);

      if ('unix:' == port.protocol) {
        host = fn;
        fn = undefined;
        port = port.pathname;
        unixSocket = true;
      } else {
        host = port.hostname || '0.0.0.0';
        port = parseInt(port.port, 10);
      }
    } else {
      host = host || '0.0.0.0';
    }

    this.type = 'server';

    var tlsOptions = this.get('tls');
    if (tlsOptions) {
      tlsOptions.requestCert = tlsOptions.requestCert !== false;
      tlsOptions.rejectUnauthorized = tlsOptions.rejectUnauthorized !== false;
      this.server = tls.createServer(tlsOptions, this.onconnect.bind(this));
    } else {
      this.server = net.createServer(this.onconnect.bind(this));
    }

    debug('trace', this.type + ' bind ' + host + ':' + port);
    this.server.on('listening', this.emit.bind(this, 'bind'));

    if (unixSocket) {
      // TODO: move out
      this.server.on('error', function(e) {
        if (e.code == 'EADDRINUSE') {
          // Unix file socket and error EADDRINUSE is the case if
          // the file socket exists. We check if other processes
          // listen on file socket, otherwise it is a stale socket
          // that we could reopen
          // We try to connect to socket via plain network socket
          var clientSocket = new net.Socket();

          clientSocket.on('error', function(e2) {
            if (e2.code == 'ECONNREFUSED') {
              // No other server listening, so we can delete stale
              // socket file and reopen server socket
              fs.unlink(port);
              self.server.listen(port, host, fn);
            }
          });

          clientSocket.connect({path: port}, function() {
            // Connection is possible, so other server is listening
            // on this file socket
            throw e;
          });
        }
      });
    }

    this.server.listen(port, host, fn);
    return this;
  };

  return Socket;
};