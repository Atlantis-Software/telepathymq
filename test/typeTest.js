var assert = require('assert');
var Ipc = require('../index');
var _ = require('lodash');

describe('type', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  before(function(done) {
    server.listen(8060);
    client.register('server', 'tcp://localhost:8060', function() {
      done();
    });
  });

  it('object', function(done) {
    server.on('myEvent', function(msg) {
      assert(_.isObject(msg), 'should receive an object');
      assert.equal(msg.attribute, 1, 'should receive an object with an attribute');
      done();
    });
    client.emit('server', 'myEvent', { attribute: 1 });
  });

  it('buffer', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isBuffer(msg), 'should receive a buffer');
      done();
    });
    server.emit('client', 'myEvent', Buffer.from('buffer'));
  });

  it('boolean', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isBoolean(msg), 'should receive a boolean');
      done();
    });
    server.emit('client', 'myEvent', true);
  });

  it('string', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isString(msg), 'should receive a string');
      done();
    });
    server.emit('client', 'myEvent', 'string');
  });

  it('number', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isNumber(msg), 'should receive a string');
      done();
    });
    server.emit('client', 'myEvent', 1);
  });

  it('date', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isDate(msg), 'should receive a date');
      done();
    });
    server.emit('client', 'myEvent', new Date());
  });

  it('array', function(done) {
    client.on('myEvent', function(msg) {
      assert(_.isArray(msg), 'should receive an array');
      assert.equal(msg[0], 0);
      assert.equal(msg[1], 1);
      assert.equal(msg[2], 2);
      done();
    });
    server.emit('client', 'myEvent', [0,1,2]);
  });

  afterEach(function() {
    server.removeAllListeners();
    client.removeAllListeners();
  });

  after(function(done) {
    client.close(function() {
      server.close(function() {
        done();
      });
    });
  });
});
