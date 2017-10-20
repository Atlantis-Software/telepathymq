var assert = require('assert');
var fs = require('fs');
var Ipc = require('../index');

describe('connection', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  it('client should register on server', function(done) {
    server.on('register', function(identity) {
      assert.equal(identity, 'client');
      done();
    });
    server.listen(8060, function() {
      client.register('server', 'tcp://localhost:8060');
    });
  });

  it('server should register on client', function(done) {
    client.on('register', function(identity) {
      assert.equal(identity, 'server');
      done();
    });
    server.listen(8060, function() {
      client.register('server', 'tcp://localhost:8060');
    });
  });

  it('should connect using tls protocol', function(done) {
    client.on('register', function(identity) {
      assert.equal(identity, 'server');
      done();
    });
    var tlsOpts = {
      requestCert: true,
      rejectUnauthorized: true,
      key: fs.readFileSync('test.key'),
      cert: fs.readFileSync('test.crt'),
      ca: [fs.readFileSync('test.crt')]
    };
    server.listen('tls://localhost:8060', tlsOpts, function() {
      client.register('server', 'tls://localhost:8060', tlsOpts);
    });
  });

  afterEach(function(done) {
    server.removeAllListeners();
    client.removeAllListeners();
    client.close(function() {
      server.close(function() {
        done();
      });
    });
  });
});