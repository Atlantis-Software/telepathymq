var assert = require('assert');
var Ipc = require('../index');
var fs = require('fs');
var path = require('path');
var through2 = require('through2');
var stream = require('stream');
var asynk = require('asynk');

describe('stream', function() {

  var server = new Ipc('server');
  var client = new Ipc('client');

  before(function(done) {
    server.listen(8060);
    client.register('server', 'tcp://localhost:8060', function() {
      done();
    });
  });

  it('should work with readable stream', function(done) {
    var receivedData;
    server.on('myStream', function(incoming) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData) {
          receivedData = chunk;
        } else {
          receivedData = Buffer.concat([receivedData, chunk]);
        };
        cb();
      });

      incoming.pipe(outputStream);

      outputStream
      .on('finish', function() {
        var fileBuffer = fs.readFileSync(path.join(__dirname, 'testFile.txt'));
        assert.equal(receivedData.length, fileBuffer.length, 'Received buffer should be the same size as the one sent');
        assert.equal(receivedData.toString(), fileBuffer.toString(), 'Data should be the same');
        done();
      });
    });


    var myStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));
    client.stream('server', 'myStream', myStream);
  });

  it('should work with writable stream', function(done) {
    var receivedData;

    server.on('myStream', function(outgoing) {
      var myStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));
      myStream.pipe(outgoing);
    });

    var outputStream = new stream.Writable();
    outputStream._write = function (chunk, encoding, next) {
      if (!receivedData) {
        receivedData = chunk;
      } else {
        receivedData = Buffer.concat([receivedData, chunk]);
      }
      next();
    };

    client.stream('server', 'myStream', outputStream);

    outputStream
    .on('finish', function() {
      var fileBuffer = fs.readFileSync(path.join(__dirname, 'testFile.txt'));
      assert.equal(receivedData.length, fileBuffer.length, 'Received buffer should be the same size as the one sent');
      assert.equal(receivedData.toString(), fileBuffer.toString(), 'Data should be the same');
      done();
    });
  });

  it('should work with duplex stream (client I&O -> server I&O)', function(done) {
    var receivedData1;
    var receivedData2;

    var deferred1 = asynk.deferred();
    var deferred2 = asynk.deferred();

    asynk.when(deferred1, deferred2).done(function() {
      var fileBuffer = fs.readFileSync(path.join(__dirname, 'testFile.txt'));
      assert.equal(receivedData1.length, fileBuffer.length*2, 'first test');
      assert.equal(receivedData2.length, fileBuffer.length*2, 'second test');
      done();
    });

    var fileStream1 = fs.createReadStream(path.join(__dirname, 'testFile.txt'));
    var fileStream2 = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

    server.on('myStream', function(streamNode) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData2) {
          receivedData2 = chunk;
        } else {
          receivedData2 = Buffer.concat([receivedData2, chunk]);
        }
        cb();
      });

      outputStream
      .on('finish', function() {
        deferred2.resolve();
      });

      streamNode.pipe(outputStream);
      fileStream2.pipe(streamNode);
    });

    var inputStream = through2(function(chunk, enc, cb) {
      cb(null, chunk);
    });

    var outputStream = through2(function(chunk, enc, cb) {
      if (!receivedData1) {
        receivedData1 = chunk;
      } else {
        receivedData1 = Buffer.concat([receivedData1, chunk]);
      }
      cb();
    });

    outputStream
    .on('finish', function() {
      deferred1.resolve();
    });

    client.stream('server', 'myStream', inputStream);

    inputStream.pipe(outputStream);
    fileStream1.pipe(inputStream);
  });

  it('should work with duplex stream (client -> server I&O)', function(done) {
    var receivedData;
    var expectedResult = '';

    server.on('myStream', function(streamNode) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData) {
          receivedData = chunk;
        } else {
          receivedData = Buffer.concat([receivedData, chunk]);
        }
        cb();
      });

      outputStream
      .on('finish', function() {
        assert.equal(receivedData.length, expectedResult.length, 'first test');
        assert.equal(receivedData.toString(), expectedResult, 'second test');
        done();
      });

      streamNode.pipe(outputStream);
      for (var i = 0; i < 30; ++i) {
        expectedResult += 'winnerwinnerchickendinner';
        streamNode.write('winnerwinner');
      }
      streamNode.end();
    });

    var inputStream = through2(function(chunk, enc, cb) {
      var data = chunk.toString();
      data += 'chickendinner';
      cb(null, data);
    });

    client.stream('server', 'myStream', inputStream);
  });

  it('should work with duplex stream (client O -> server I)', function(done) {
    var receivedData;
    var expectedResult = '';

    server.on('myStream', function(streamNode) {
      for (var i = 0; i < 30; ++i) {
        expectedResult += 'winnerwinnerchickendinner';
        streamNode.write('winnerwinner');
      }
      streamNode.end();
    });

    var inputStream = through2(function(chunk, enc, cb) {
      var data = chunk.toString();
      data += 'chickendinner';
      cb(null, data);
    });

    var outputStream = through2(function(chunk, enc, cb) {
      if (!receivedData) {
        receivedData = chunk;
      } else {
        receivedData = Buffer.concat([receivedData, chunk]);
      }
      cb();
    });

    outputStream
    .on('finish', function() {
      assert.equal(receivedData.length, expectedResult.length, 'first test');
      assert.equal(receivedData.toString(), expectedResult, 'second test');
      done();
    });

    client.stream('server', 'myStream', inputStream);
    inputStream.pipe(outputStream);
  });

  it('should work with duplex stream (client I -> server O)', function(done) {
    var receivedData;
    var expectedResult = '';

    server.on('myStream', function(streamNode) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData) {
          receivedData = chunk;
        } else {
          receivedData = Buffer.concat([receivedData, chunk]);
        }
        cb();
      });

      outputStream
      .on('finish', function() {
        assert.equal(receivedData.length, expectedResult.length, 'first test');
        assert.equal(receivedData.toString(), expectedResult, 'second test');
        done();
      });

      streamNode.pipe(outputStream);
    });

    var inputStream = through2(function(chunk, enc, cb) {
      var data = chunk.toString();
      data += 'chickendinner';
      cb(null, data);
    });

    client.stream('server', 'myStream', inputStream);

    for (var i = 0; i < 30; ++i) {
      expectedResult += 'winnerwinnerchickendinner';
      inputStream.write('winnerwinner');
    }
    inputStream.end();
  });

  it('should work with duplex stream (client O -> server I&O)', function(done) {
    var receivedData1;
    var receivedData2;

    var deferred1 = asynk.deferred();
    var deferred2 = asynk.deferred();

    asynk.when(deferred1, deferred2).done(function() {
      var fileBuffer = fs.readFileSync(path.join(__dirname, 'testFile.txt'));
      assert.equal(receivedData1.length, fileBuffer.length, 'first test');
      assert.equal(receivedData2.length, fileBuffer.length, 'second test');
      done();
    });

    var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

    server.on('myStream', function(streamNode) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData2) {
          receivedData2 = chunk;
        } else {
          receivedData2 = Buffer.concat([receivedData2, chunk]);
        }
        cb();
      });

      outputStream
      .on('finish', function() {
        deferred2.resolve();
      });

      streamNode.pipe(outputStream);
      fileStream.pipe(streamNode);
    });

    var inputStream = through2(function(chunk, enc, cb) {
      cb(null, chunk);
    });

    var outputStream = through2(function(chunk, enc, cb) {
      if (!receivedData1) {
        receivedData1 = chunk;
      } else {
        receivedData1 = Buffer.concat([receivedData1, chunk]);
      }
      cb();
    });

    outputStream
    .on('finish', function() {
      deferred1.resolve();
    });

    client.stream('server', 'myStream', inputStream);

    inputStream.pipe(outputStream);
  });

  it('should work with duplex stream (client O -> server I&O) with late piping', function(done) {
    var receivedData1;
    var receivedData2;

    var deferred1 = asynk.deferred();
    var deferred2 = asynk.deferred();

    asynk.when(deferred1, deferred2).done(function() {
      var fileBuffer = fs.readFileSync(path.join(__dirname, 'testFile.txt'));
      assert.equal(receivedData1.length, fileBuffer.length, 'first test');
      assert.equal(receivedData2.length, fileBuffer.length, 'second test');
      done();
    });

    var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

    server.on('myStream', function(streamNode) {
      var outputStream = through2(function(chunk, enc, cb) {
        if (!receivedData2) {
          receivedData2 = chunk;
        } else {
          receivedData2 = Buffer.concat([receivedData2, chunk]);
        }
        cb();
      });

      outputStream
      .on('finish', function() {
        deferred2.resolve();
      });

      setTimeout(function() {
        streamNode.pipe(outputStream);
      }, 500);

      fileStream.pipe(streamNode);
    });

    var inputStream = through2(function(chunk, enc, cb) {
      cb(null, chunk);
    });

    var outputStream = through2(function(chunk, enc, cb) {
      if (!receivedData1) {
        receivedData1 = chunk;
      } else {
        receivedData1 = Buffer.concat([receivedData1, chunk]);
      }
      cb();
    });

    outputStream
    .on('finish', function() {
      deferred1.resolve();
    });

    client.stream('server', 'myStream', inputStream);

    inputStream.pipe(outputStream);
  });

  it('duplex stream (client->server) error should propagate on both sides', function(done) {
    var deferred1 = asynk.deferred();
    var deferred2 = asynk.deferred();
    var myError = new Error('catch that !');

    asynk.when(deferred1, deferred2).done(function(err1, err2) {
      assert.deepEqual(err1, myError);
      assert.equal(err2, myError.message);
      done();
    });

    server.on('myStream', function(stream) {
      var outputStream = through2(function(chunk, enc, cb) {
        cb();
      });

      stream.pipe(outputStream);

      stream.on('error', function(err) {
        deferred2.resolve(err);
      });
    });

    var throwingStream = through2(function(chunk, enc, cb) {
      cb(myError);
    });

    var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

    throwingStream.on('error', function(err) {
      deferred1.resolve(err);
    });

    client.stream('server', 'myStream', throwingStream);
    fileStream.pipe(throwingStream);
  });

  it('duplex stream (server->client) error should propagate on both sides', function(done) {
    var deferred1 = asynk.deferred();
    var deferred2 = asynk.deferred();
    var myError = new Error('catch that !');

    asynk.when(deferred1, deferred2).done(function(err1, err2) {
      assert.deepEqual(err2, myError);
      assert.equal(err1, myError.message);
      done();
    });

    server.on('myStream', function(stream) {
      var outputStream = through2(function(chunk, enc, cb) {
        cb();
      });

      var throwingStream = through2(function(chunk, enc, cb) {
        cb(myError);
      });

      var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

      throwingStream.on('error', function(err) {
        stream.emit('error', err);
      });

      stream.on('error', function(err) {
        deferred2.resolve(err);
      });

      stream.pipe(outputStream);
      fileStream.pipe(throwingStream);
      throwingStream.pipe(stream);

    });

    var outputStream = through2(function(chunk, enc, cb) {
      cb();
    });

    outputStream.on('error', function(err) {
      deferred1.resolve(err);
    });

    client.stream('server', 'myStream', outputStream);
  });

  it('readable stream error should propagate on both sides', function(done) {
    var receivedData;
    var myError = new Error('catch that !');

    server.on('myStream', function(stream) {
      var throwingStream = through2(function(chunk, enc, cb) {
        cb(myError);
      });

      throwingStream.on('error', function(err) {
        stream.emit('error', err);
      });

      stream.pipe(throwingStream);
    });


    var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));

    var throughStream = through2(function(chunk, enc, cb) {
      cb(null, chunk);
    });

    fileStream.pipe(throughStream);

    throughStream.on('error', function(err) {
      assert.equal(err, myError.message);
      done();
    });

    client.stream('server', 'myStream', throughStream);
  });

  it('writable stream error should propagate on both sides', function(done) {
    var receivedData;
    var myError = new Error('catch that !');

    server.on('myStream', function(stream) {
      var fileStream = fs.createReadStream(path.join(__dirname, 'testFile.txt'));
      stream.on('error', function(err) {
        assert.equal(err, myError.message);
        done();
      });
      fileStream.pipe(stream);
    });

    var throwingStream = new stream.Writable();
    throwingStream._write = function (chunk, encoding, next) {
      next(myError);
    };

    client.stream('server', 'myStream', throwingStream);
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
