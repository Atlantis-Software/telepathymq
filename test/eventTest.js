var assert = require('assert');
var Ipc = require('../index');

describe('event', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  before(function(done) {
    server.listen(8060);
    client.register('server', 'tcp://localhost:8060', function() {
      done();
    });
  });

  it('server should receive event from client', function(done) {
    server.on('myEvent', function(msg) {
      assert.equal(msg, 'hello');
      done();
    });
    client.emit('server', 'myEvent', 'hello');
  });

  it('client should receive event from server', function(done) {
    client.on('myEvent', function(msg) {
      assert.equal(msg, 'hello');
      done();
    });
    server.emit('client', 'myEvent', 'hello');
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