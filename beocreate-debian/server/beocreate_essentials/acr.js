/*Copyright 2024 HiFiBerry

Shared client for the HiFiBerryOS NG Audio Control (ACR) service.
Wraps the documented ACR REST API (default http://127.0.0.1:1080/api) and
the /api/events WebSocket stream so that Beocreate extensions (sources,
sound, ...) can share a single connection and a single source of truth.

API references: acr doc/api.md and doc/websocket.md.

MIT licence (same as the rest of Beocreate 2).*/

var fetch = require("node-fetch");
var EventEmitter = require("events").EventEmitter;
var WebSocketClient = require("websocket").client;

var events = new EventEmitter();
events.setMaxListeners(0);

var debug = 0;
var baseURL = process.env.BEO_ACR_ADDRESS || "http://127.0.0.1:1080";
var connected = false; // WebSocket connection state.
var wsClient = null;
var wsConnection = null;
var reconnectTimeout = null;
var reconnectDelay = 1000;
var started = false;

function configure(options = {}) {
	if (options.address) baseURL = options.address;
	if (process.env.BEO_ACR_ADDRESS) baseURL = process.env.BEO_ACR_ADDRESS;
	if (options.debug != undefined) debug = options.debug;
	return baseURL;
}

function getAddress() {
	return baseURL;
}

// Turn a possibly relative ACR URL (e.g. cover art path) into an absolute one.
function absoluteURL(url) {
	if (!url) return url;
	if (/^https?:\/\//i.test(url)) return url;
	if (url.charAt(0) != "/") url = "/" + url;
	return baseURL + url;
}


// REST HELPERS

async function apiGet(path) {
	try {
		res = await fetch(baseURL + path);
		if (res.status == 200) {
			return await res.json();
		} else {
			if (debug) console.log("ACR GET " + path + " returned " + res.status + ".");
			return null;
		}
	} catch (error) {
		if (debug >= 2) console.log("ACR GET " + path + " failed:", error.message);
		return null;
	}
}

async function apiPost(path, body = undefined) {
	try {
		options = {method: "POST"};
		if (body != undefined) {
			options.headers = {"Content-Type": "application/json"};
			options.body = JSON.stringify(body);
		}
		res = await fetch(baseURL + path, options);
		if (res.status >= 200 && res.status < 300) {
			try {
				return await res.json();
			} catch (error) {
				return {success: true};
			}
		} else {
			if (debug) console.log("ACR POST " + path + " returned " + res.status + ".");
			return null;
		}
	} catch (error) {
		if (debug >= 2) console.log("ACR POST " + path + " failed:", error.message);
		return null;
	}
}

// PLAYERS

function getPlayers() {
	// GET /api/players -> {players: [{name, id, state, is_active, has_library, last_seen}]}
	return apiGet("/api/players");
}

function getActivePlayer() {
	// GET /api/player -> {name, id, state, last_seen}
	return apiGet("/api/player");
}

function getNowPlaying() {
	// GET /api/now-playing -> {player, song, state, shuffle, loop_mode, position}
	return apiGet("/api/now-playing");
}

function sendActiveCommand(command) {
	// POST /api/player/active/send/<command>
	return apiPost("/api/player/active/send/" + encodeURIComponent(command));
}

function sendPlayerCommand(playerName, command) {
	// POST /api/player/<player-name>/command/<command>
	return apiPost("/api/player/" + encodeURIComponent(playerName) + "/command/" + encodeURIComponent(command));
}

// VOLUME

function getVolumeInfo() {
	// GET /api/volume/info -> {available, control_info, current_state: {percentage, ...}, supports_change_monitoring}
	return apiGet("/api/volume/info");
}

function getVolumeState() {
	// GET /api/volume/state -> {percentage, decibels, raw_value}
	return apiGet("/api/volume/state");
}

function setVolume(percentage) {
	// POST /api/volume/set {percentage} -> {success, message, new_state}
	return apiPost("/api/volume/set", {percentage: percentage});
}


// EVENT STREAM (WebSocket /api/events)
// Subscribes once for all players and all event types; re-emits every event
// as "event" plus one emit per event type ("state_changed", "song_changed",
// "volume_changed", ...). Extensions attach with acr.events.on(...).

function startEvents() {
	if (started) return;
	started = true;
	connectEvents();
}

function connectEvents() {
	wsURL = baseURL.replace(/^http/, "ws") + "/api/events";
	wsClient = new WebSocketClient();

	wsClient.on("connectFailed", function(error) {
		if (debug >= 2) console.log("ACR WebSocket connection failed:", error.toString());
		scheduleReconnect();
	});

	wsClient.on("connect", function(connection) {
		wsConnection = connection;
		connected = true;
		reconnectDelay = 1000;
		if (debug) console.log("Connected to ACR event stream at " + wsURL + ".");
		// Subscribe to events for all players (null = all, per websocket.md).
		connection.send(JSON.stringify({players: null}));
		events.emit("connected");

		connection.on("message", function(message) {
			if (message.type != "utf8") return;
			try {
				data = JSON.parse(message.utf8Data);
			} catch (error) {
				return;
			}
			if (!data || !data.type) return;
			if (data.type == "welcome" || data.type == "subscription_updated") return;
			events.emit("event", data);
			events.emit(data.type, data);
		});

		connection.on("close", function() {
			connected = false;
			wsConnection = null;
			if (debug) console.log("ACR event stream closed. Reconnecting...");
			events.emit("disconnected");
			scheduleReconnect();
		});

		connection.on("error", function(error) {
			if (debug >= 2) console.log("ACR event stream error:", error.toString());
		});
	});

	wsClient.connect(wsURL);
}

function scheduleReconnect() {
	if (!started) return;
	clearTimeout(reconnectTimeout);
	reconnectTimeout = setTimeout(function() {
		connectEvents();
	}, reconnectDelay);
	if (reconnectDelay < 30000) reconnectDelay *= 2; // Exponential backoff, capped.
}

function stopEvents() {
	started = false;
	clearTimeout(reconnectTimeout);
	if (wsConnection) {
		try {
			wsConnection.close();
		} catch (error) {}
		wsConnection = null;
	}
	connected = false;
}

module.exports = {
	configure: configure,
	getAddress: getAddress,
	absoluteURL: absoluteURL,
	apiGet: apiGet,
	apiPost: apiPost,
	getPlayers: getPlayers,
	getActivePlayer: getActivePlayer,
	getNowPlaying: getNowPlaying,
	sendActiveCommand: sendActiveCommand,
	sendPlayerCommand: sendPlayerCommand,
	getVolumeInfo: getVolumeInfo,
	getVolumeState: getVolumeState,
	setVolume: setVolume,
	startEvents: startEvents,
	stopEvents: stopEvents,
	events: events,
	isConnected: function() {return connected;}
};
