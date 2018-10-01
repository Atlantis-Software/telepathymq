var assert = require('assert');
var fs = require('fs');
var Ipc = require('../index');

describe('certificate', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  it('should throw if the certificate is not yet in effect', function(done) {
    client.on('register', function(identity) {
      assert.equal(identity, 'server');
      done();
    });
    var tlsOpts = {
      requestCert: true,
      rejectUnauthorized: true,
      key: fs.readFileSync('notYet.key'),
      cert: fs.readFileSync('notYet.crt'),
      ca: [fs.readFileSync('notYet.crt')]
    };
    try {
      server.listen('tls://localhost:8060', tlsOpts, function() {
        assert(false, 'Server should not start');
      });
    } catch(e) {
      assert.equal(e.message, 'Invalid certificate');
      done();
    }
  });

  it('should throw if the certificate is expired', function(done) {
    client.on('register', function(identity) {
      assert.equal(identity, 'server');
      done();
    });
    var tlsOpts = {
      requestCert: true,
      rejectUnauthorized: true,
      key: fs.readFileSync('tooLate.key'),
      cert: fs.readFileSync('tooLate.crt'),
      ca: [fs.readFileSync('tooLate.crt')]
    };
    try {
      server.listen('tls://localhost:8060', tlsOpts, function() {
        assert(false, 'Server should not start');
      });
    } catch(e) {
      assert.equal(e.message, 'Invalid certificate');
      done();
    }
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
