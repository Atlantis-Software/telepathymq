# telepathymq

a nodejs module for inter-process communication that let you share javascript  object and events over network that support tcp and secure tls sockets.

[![npm version](https://badge.fury.io/js/telepathymq.svg)](https://www.npmjs.com/telepathymq)
[![Build Status](https://travis-ci.org/Atlantis-Software/telepathymq.svg?branch=master)](https://travis-ci.org/Atlantis-Software/telepathymq)
[![Coverage Status](https://coveralls.io/repos/github/Atlantis-Software/telepathymq/badge.svg?branch=master)](https://coveralls.io/github/Atlantis-Software/telepathymq?branch=master)
(https://nodesecurity.io/orgs/atlantis/projects/ee0b54d6-2574-40d1-95ba-a5b704a9d60f)
[![Dependencies Status](https://david-dm.org/Atlantis-Software/telepathymq.svg)](https://david-dm.org/Atlantis-Software/telepathymq)

## Installation
telepathymq is available over npm
```
npm install telepathymq
```

## Sample

this code initialise connection between client and server side and send an "hello world" message
```
var Telepathy = require('telepathymq');

// initialise the server side
// the constructor take a string argument for the instance identity
// used to send data from other node.
// it must be uniq on connected nodes.
var server = new Telepathy('server');
server.listen(8060, function() {
  console.log('server is listening on port 8060');
});
server.on('register', function(identity) {
  console.log(identity + ' has registered on server');
});
server.on('message', function(msg) {
  console.log('message: ' + msg);
});

// initialise the client side
var client = new Telepathy('client');
client.register('server', 'tcp://localhost:8060');
client.on('register', function(identity) {
  console.log(identity + ' has registered on client');
  // emit an event called 'message' on 'server' with a string 'hello world' as data
  client.emit('server', 'message', 'hello world');
});
```

## Methods

### server.listen()
Start a server listening for connections.
Possible signatures:
* listen(port, [ip,] callback) 
* listen(url, options, callback)

### server.listen(port, [ip,] callback) 
port: integer tcp port number
ip: string ip address (optional, default: '0.0.0.0')
callback: function

### server.listen(connectString, [options,] callback)
connectString: string {tcp | tls}://{ip | hostname}:{port}
options: object [see node tls.createServer options](https://nodejs.org/api/tls.html) only use in tls protocol
callback: function

### client.register(identity, connectString, [options,] callback)
immediately initiates connection.
When the connection is established, a `'register'` event will be emitted on the client.

identity: string identity of server node
connectString: string {tcp | tls}://{ip | hostname}:{port}
options: object [see node tls.connect options](https://nodejs.org/api/tls.html) only use in tls protocol
callback: function

### node.emit(identity, eventName, data)
emit an event on identity node.

identity: string identity of the other side node.
eventName: string the name of the event being emited
data: string,object data being sent over event

### node.on(eventName, listener)
Adds the `listener` function to the end of the listeners array for the event named `eventName`.

eventName: string the name of the event.
listener: function

### node.defer(identity, eventName[, data])
return an [asynk](https://www.npmjs.com/package/asynk) promise and send an asynk deferred.

identity: string identity of the other side node.
eventName: string the name of the event being emited
data: string,object data being sent over event

```
server.on('myDefer', function(defer, data) {
  if (data.val === 1) {
    defer.notify('some data');
  }
});

var promise = client.defer('server', 'myDefer', {val: 1});
promise.progress(function(data) {
  console.log(data);
});
```
