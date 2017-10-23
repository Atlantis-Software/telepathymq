var assert = require('assert');
var Ipc = require('../index');

describe('defer', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  before(function(done) {
    server.listen(8060);
    client.register('server', 'tcp://localhost:8060', function() {
      done();
    });
  });

  it('.defer() should return a promise', function() {
    var defer = client.defer('server', 'myDefer');
    assert(defer.done);
    assert(defer.fail);
    assert(defer.progress);
    assert(defer.then);
  });

  it('.defer() promise should call .done() when other side resolve', function(done) {
    server.on('myDefer', function(defer) {
      defer.resolve('some data');
    });
    var defer = client.defer('server', 'myDefer');
    defer.done(function(data) {
      assert.equal(data, 'some data');
      done();
    });
  });

  it('.defer() promise should call .fail() when other side reject', function(done) {
    server.on('myDefer', function(defer) {
      defer.reject('some error');
    });
    var defer = client.defer('server', 'myDefer');
    defer.fail(function(error) {
      assert.equal(error, 'some error');
      done();
    });
  });

  it('.defer() promise should call .progress() when other side notify', function(done) {
    server.on('myDefer', function(defer) {
      defer.notify('some data');
    });
    var defer = client.defer('server', 'myDefer');
    defer.progress(function(data) {
      assert.equal(data, 'some data');
      done();
    });
  });

  it('defer event should receive data', function(done) {
    server.on('myDefer', function(defer, data) {
      assert.equal(data.msg, 'some data');
      done();
    });
    client.defer('server', 'myDefer', {msg: 'some data'});
  });

  it('defer event should receive Buffer data', function(done) {
    server.on('myDefer', function(defer, data) {
      assert.deepEqual(data.buffer, Buffer.from('this a Buffer'));
      done();
    });
    client.defer('server', 'myDefer', {buffer: Buffer.from('this a Buffer')});
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