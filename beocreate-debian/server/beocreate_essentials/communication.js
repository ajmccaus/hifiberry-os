/*Copyright 2018 Bang & Olufsen A/S
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.*/

// Communication

// Handles socket communication between the sound system and the client.

// hbosng port: the service is announced through the system's avahi-daemon (the
// mDNS responder NG runs), by an `avahi-publish` child given argv only, so this
// process opens no mDNS socket on the LAN. BEO_AVAHI_PUBLISH is the binary
// (default "avahi-publish"; the test seam).
var spawn = require('child_process').spawn;
var fs = require('fs');
var server = require('websocket').server;
var http = require('http');
var https = require('https');
var eventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = BeoCom;

var acceptedProtocols = [];
var acceptConnections = true;
var connections = [];
var connectionLinks = [];
var socket;
var wsPort = 0;
var connectionID = 0;

const decoder = new TextDecoder();

function BeoCom() {
	if (!(this instanceof BeoCom)) return new BeoCom();
	eventEmitter.call(this);
}

util.inherits(BeoCom, eventEmitter);

BeoCom.prototype.startSocket = function(options, callback) {
	self = this;
	
	if (!options) options = {};
	
	if (options.port) {
		wsPort = options.port;
	} else {
		wsPort = 1337; // Default port.
	}
	
	if (options.acceptedProtocols) {
		acceptedProtocols = options.acceptedProtocols;
	} else {
		acceptedProtocols = [];
	}
	
	if (options.server) {
		// Use an existing server instance.
		socket = new server({
			httpServer: options.server
		});
	} else {
		if (!options.ssl) {
			// If SSL is not specified, run a normal HTTP server.
			socket = new server({
				httpServer: http.createServer().listen(wsPort)
			});
			//return true;
		} else {
			// If SSL is set to true, run a HTTPS server.
			socket = new server({
				httpServer: https.createServer({
					key:fs.readFileSync(options.sslKey), 
					cert:fs.readFileSync(options.sslCert)
				}).listen(wsPort)
			});
			//return true;
		}
	}
	
	socket.on('request', function(request) {

		// hbosng port: refuse cross-site pages. A browser always sends Origin; it must name
		// the host the client asked for (nginx passes Host through as $http_host).
		// Non-browser clients send no Origin and are allowed.
		if (request.origin && !sameOrigin(request.origin, request.host)) {
			request.reject(403);
			return;
		}

		if (request.requestedProtocols) {
			if (acceptedProtocols.indexOf(request.requestedProtocols[0]) != -1) {
				protocol = request.requestedProtocols[0];
			} else {
				protocol = null;
			}
		} else {
			protocol = null;
		}
		
		if (protocol != null && acceptConnections) {
			var connection = request.accept(protocol, request.origin);
			newConnection = addClient(connection, protocol);
			
			self.emit('open', newConnection.ID, newConnection.protocol);
	
			connection.on('message', function(message) {
				// Incoming data.
				// data should always be in serialised JSON format.
				if (message.type == "utf8") {
					try {
						jsonObject = JSON.parse(message.utf8Data);
						self.emit('data', jsonObject, findID(connection));
					} catch (error) {
						// Try cleaning up garbage from the message and run it through parser again.
						try {
							var utf8Data = message.utf8Data.slice(0, message.utf8Data.lastIndexOf("}")+1);
							jsonObject = JSON.parse(utf8Data);
							self.emit('data', jsonObject, findID(connection));
						} catch (error2) {
							console.error("Error in processing received data:", error2, message);
						}
					}
				} else if (message.type == "binary") {
					try {
						jsonObject = JSON.parse(decoder.decode(message.binaryData));
						self.emit('data', jsonObject, findID(connection));
					} catch (error) {
						console.error("Error in processing received data:", error, message);
					}
				}
				
			});
	
			connection.on('close', function(connection) {
				rmID = removeClient(connection);
				//console.log("Client disconnected.");
				self.emit('close', rmID);
			});
		} else {
			request.reject();
		}
	});
	
	
	if (callback) callback(true);
}

function sameOrigin(origin, host) {
	// An unparsable Origin (e.g. "null" from a sandboxed page) is never same-origin.
	try {
		return new URL(origin).host.toLowerCase() == host.toLowerCase();
	} catch (error) {
		return false;
	}
}

var bonjourStarted = false;
var announcement = null; // {name, serviceType, port, txt} while advertising.
var publisher = null; // The avahi-publish child.

function publish() {
	var args = ["-s", announcement.name, "_" + announcement.serviceType + "._tcp", String(announcement.port)];
	for (var key in announcement.txt) args.push(key + "=" + announcement.txt[key]);
	var child = spawn(process.env.BEO_AVAHI_PUBLISH || "avahi-publish", args, {stdio: "ignore"});
	child.on("error", function(error) {
		console.error("Could not announce the service through avahi:", error.message);
		if (publisher === child) {
			publisher = null;
			bonjourStarted = false;
		}
	});
	child.on("exit", function() {
		if (publisher === child) {
			publisher = null;
			bonjourStarted = false;
		}
	});
	publisher = child;
	bonjourStarted = true;
}

function unpublish() {
	if (publisher) {
		var child = publisher;
		publisher = null;
		child.kill("SIGTERM");
	}
	bonjourStarted = false;
}

BeoCom.prototype.startBonjour = function(options, callback) {
	// ANNOUNCE BONJOUR SERVICE
	// This enables clients that have Bonjour discovery to find the product without requiring the user to know and type in the hostname.
	if (options.name) {
		announcement = {
			name: options.name,
			serviceType: options.serviceType || "beocreate",
			port: options.advertisePort || wsPort,
			txt: options.txtRecord || {}
		};
		unpublish();
		publish();
		if (callback) callback(true);
	}
}

BeoCom.prototype.isBonjourStarted = function() {
	return bonjourStarted;
}

function addClient(connection, protocol) {
	connectionID++;
	newConnection = {ID: connectionID, protocol: protocol}
	connections.push(newConnection);
	connectionLinks.push(connection);
	return newConnection;
}

function removeClient(connection) {
	for (var i = 0; i < connectionLinks.length; i++) {
		if (connectionLinks[i].connected == false) {
			rmIndex = i;
			break;
		}
	}
	rmID = connections[rmIndex].ID;
	connectionLinks.splice(rmIndex, 1);
	connections.splice(rmIndex, 1);
	return rmID;
}

function findID(connection) {
	for (var i = 0; i < connections.length; i++) {
		if (connectionLinks[i] == connection) {
			theID = connections[i].ID;
			break;
		}
	}
	return theID;
}


BeoCom.prototype.updateTxtRecord = function(txtRecord) {
	if (announcement && bonjourStarted) {
		announcement.txt = txtRecord;
		unpublish();
		publish();
	}
}

BeoCom.prototype.disconnectAll = function() {
	socket.closeAllConnections();
}

BeoCom.prototype.stopSocket = function(callback) {
	if (socket) {
		socket.shutDown();
	}
	if (callback) callback(true);
	/*bonjour.unpublishAll(function(result) {
		if (callback) callback(result);
	}); */
}

BeoCom.prototype.stopBonjour = function(callback) {
	unpublish();
	if (callback) callback(true);
}

BeoCom.prototype.restartBonjour = function(callback) {
	if (announcement) {
		unpublish();
		publish();
	}
	if (callback) callback(true);
}

BeoCom.prototype.send = function(jsonObject, restrictBroadcast) {
	jsonString = JSON.stringify(jsonObject);
	if (restrictBroadcast) {
		switch (restrictBroadcast) {
			case "beo-remote":
			case "beocreate-remote":
			case "beo-computer":
			case "beo-source":
				for (var i = 0; i < connections.length; i++) {
					if (connections[i].protocol == restrictBroadcast) {
						connectionLinks[i].sendUTF(jsonString);
					}
				}
				break;
			default:
				for (var i = 0; i < connections.length; i++) {
					if (connections[i].ID == restrictBroadcast) {
						connectionLinks[i].sendUTF(jsonString);
					}
				}
				break;
		}
	}
	else { // Send to all clients
		for (var i = 0; i < connections.length; i++) {
			connectionLinks[i].sendUTF(jsonString);
		}
	}
}