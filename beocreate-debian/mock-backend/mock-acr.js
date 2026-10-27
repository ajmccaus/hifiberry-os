/* Mock ACR (HiFiBerry Audio Control) server for Beocreate-on-Debian tests.

Implements the subset of the documented ACR REST API (acr doc/api.md) and the
/api/events WebSocket stream (doc/websocket.md; event shapes as of acr 0.23.6)
that the Beocreate classic UI port talks to. This mock defines the contract
the port is tested against: endpoint paths, methods and response and event
shapes follow the upstream documentation. Player events carry the documented
common fields, including ACR's known-wrong source.player_id (clients must
read the top-level player_id).

Every received API request is recorded and can be inspected by tests via:
  GET  /__test/requests          -> {requests: [{method, path, body, time}]}
  POST /__test/requests/clear    -> clear the recording
Test-only state manipulation (each broadcasts the matching WS event):
  POST /__test/song              -> merge into the current song; a null value
                                    removes that field (emits song_changed)
  POST /__test/song-information  -> a lookup's partial song (late enrichment),
                                    applied by ACR's rule (api.md "song
                                    information", apply_song_information at
                                    0.23.6): it must carry a title or an artist
                                    and each one it carries must match; only
                                    cover_art_url (over absent or station-logo
                                    art), liked and metadata are merged; the
                                    merged full song is broadcast as a
                                    song_information_update only if it changed
  POST /__test/player-state      -> {player, state}   (emits state_changed)
  POST /__test/volume            -> {percentage}      (emits volume_changed)
  POST /__test/volume-failure    -> {status}: GET /api/volume/state answers
                                    that HTTP status and every volume POST
                                    answers 200 + success:false, as ACR does
                                    (src/api/volume.rs), until {status: null}
  POST /__test/event             -> broadcast a raw event object as-is

Environment:
  MOCK_ACR_PORT             port to listen on (default 1080)
  MOCK_ACR_SPOTIFY_NAME     name of the Spotify-backed player (default
                            "spotify"; real devices may report "librespot")
  MOCK_ACR_SPOTIFY_CAPABILITIES  comma-separated capabilities that player
                            reports in GET /api/players (default: the full
                            transport set)
  MOCK_ACR_VOLUME_AVAILABLE "0" simulates a system without a volume control:
                            /api/volume/info reports available:false and the
                            other /api/volume endpoints fail
*/

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const port = parseInt(process.env.MOCK_ACR_PORT || "1080", 10);
const spotifyPlayerName = process.env.MOCK_ACR_SPOTIFY_NAME || "spotify";
const volumeAvailable = process.env.MOCK_ACR_VOLUME_AVAILABLE !== "0";
// GET /api/players carries each player's capabilities (players.rs PlayerInfo,
// PlayerCapability serialised snake_case).
const FULL_CAPABILITIES = ["play", "pause", "play_pause", "stop", "next", "previous", "seek", "shuffle", "loop"];
const spotifyCapabilities = process.env.MOCK_ACR_SPOTIFY_CAPABILITIES ?
	process.env.MOCK_ACR_SPOTIFY_CAPABILITIES.split(",") : FULL_CAPABILITIES;

// A generated 240x240 two-tone PNG used as mock cover art.
const COVER_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAPAAAADwCAIAAACxN37FAAAFI0lEQVR42u3dMW4bVxSG0VmKixTa" +
	"/yq8lJRp0mcBBhxRJOV533+Ar9fMvQfPI4geXj8/PqRMlxEo048ffwGtjmagldIMtFKagVZKM9BK" +
	"aQZaKc1AK6UZaKU0A62UZqCV0gy0UpqBVkoz0EppBlopzUArpRlopTQDrZRmoJXSDLRSmoFWSjPQ" +
	"SmkGWinNQCulGWilNAOtlGagldIMtFKagVZKM9BKaQZaKc1AK6UZaKU0A62UZqCV0gy0UpqBVkoz" +
	"0EppBlopzUArpRlopTQDrZRmoJXSDLRSmoFWSjPQSmkGWinNQCulGWilNAOtlGagldIMtFKagVZK" +
	"M9BKaQZaKc1AK6UZ6Df27z9//z6agT7V7uejGejjEd8Z91magb6j4/vIPk4z0Ld2/Gdln6gZ6DMc" +
	"f7/sQzUDfR7lb2B9rmagX0/5iJ9Y1Qz0C2CVLuN0zUB/nVHvkgKagX7YTfUKG5qB/jjrD3hvutqM" +
	"5mnQ5/4t+rVXXtK8C/pQyi+/hZjmUdClz8E9cy89zXOgAwfzq24qqXkLdI/yl++uqnkIdFvzQ/cY" +
	"1rwCOk/58zfb1jwBekoz0xfNTANNM9NA08w00C/f5eD7NIAun0yDb4eZOqQvmhfedbRj+qJ55M1d" +
	"I6Yvj84776EDmuaO5hHTF807mhdMA72lGWiaU5rzpi+a1zS3TQO9qBlomlOaw6aboGl+xjTQjucj" +
	"NScP6cvxPKs5eUhfjudlzb1D+nI8L2vuHdJAr2sGmuaU5phpoGkGGuiWZqBpTmkumQaaZqCBzmkG" +
	"muaU5oxpoGkGGuiiZqDvAprmt5oG2vF8qubAIQ00zUADHdUMNNApzUD7jTClOfB7IdA0Aw10VzPQ" +
	"HqBTmk9/jAaaZqCB7moGGuiUZqCBTmkGGuiUZqCBTmkGGuiUZqCBTmkGGuiUZqCBTmkG2mc5Upp9" +
	"lgPolGaggU5pBtpjdFwz0KOgA5qBBjqlGWigU5qB9nthSrM3J60f0nnNQA+BjmkGehp0TzPQu6Zp" +
	"BroDOqkZ6FHQVc1AL5qmGegO6LBmoOdAtzUDvWWaZqA7oPOagb416NeantUMdPCQXtAcO56boF9i" +
	"elkz0LVDekRz73jOgn7G9LhmoFOmaT79voBe1Ax03zTNAc0d0E+aprmhGeg5zUDHTdNc0lwD/ahp" +
	"mmOah0D/appmoDumaU5qboL+X9M0VzVnQf/G9JrmkUfnXdBTrAeHkAXN9Obtl0Evm5698TjoTdPL" +
	"/zT1Qa8tePxB68pr/syaG5teuMdp0FP7pjkO+mtbP3HxyZsC+oHPaZTWj3If9Mip5mCeAP1aEPc0" +
	"ce6VA/32/+V6Fg6Uh0C/W8kftHL/KwT6du8IfQjN97i54SUBfdL3njwK6E2MbnIZQEe+y/Vrnp6B" +
	"9f0/EegVza9C9j3hmwJ9w6dYlIE+4x2hHAPd/IY1joFufosPx0Bnv/cEYqD779ZnF2jvCNUGaHtS" +
	"B7QlqQPahtQBbT3qgLYbdUBbjDqgbUUd0FaiDmj7UAe0ZagD2ibUAW0N6oC2A3VAW4A6oE1fHdBG" +
	"rw5oc1cHtKGrA9rE1QFt3OqANmt1QBu0OqBNWR3QRqwOaPNVB7ThqgPaZNUBbazqgDZTdUAbqDqg" +
	"TVMd0EapDmhzVAe0IaoD2gTVAW186oA2O3VAG5w6oE1NHdBGpg5o81IHtGGpA9qk1AFtTOqANiN1" +
	"QBuQOqBNRx3QRqMOaHNRB7ShqAPaRNQBbRzqgDYLdUAbhDqgTUGZ/gPZWZuSliDNqgAAAABJRU5E" +
	"rkJggg==", "base64");

// STATE

const state = {
	players: [
		{
			name: "mpd",
			id: "mpd:localhost:6600",
			state: "Stopped",
			is_active: false,
			has_library: true,
			last_seen: new Date().toISOString(),
			capabilities: FULL_CAPABILITIES
		},
		{
			name: spotifyPlayerName,
			id: spotifyPlayerName,
			state: "Playing",
			is_active: true,
			has_library: false,
			last_seen: new Date().toISOString(),
			capabilities: spotifyCapabilities
		}
	],
	song: {
		title: "Mock Song Title",
		artist: "Mock Artist",
		album: "Mock Album",
		duration: 180,
		stream_url: "spotify:track:mock123", // acr-types Song: stream_url, no uri.
		cover_art_url: "/api/imagecache/mock.png"
	},
	shuffle: false,
	loop_mode: "None",
	position: 12.3,
	volume: {percentage: 42.0}
};

// No volume_scale: a daemon without the field reports raw-scale percentages
// (api.md "Volume scales"), which matches the mock's linear decibel mapping.
const VOLUME_CONTROL = {
	internal_name: "hw:0,0",
	display_name: "Mock Master Volume",
	decibel_range: {min_db: -60.0, max_db: 0.0}
};

function volumeState() {
	const pct = state.volume.percentage;
	return {
		percentage: pct,
		decibels: Math.round((-60 + (pct / 100) * 60) * 10) / 10,
		raw_value: Math.round((pct / 100) * 255)
	};
}

function activePlayer() {
	return state.players.find(p => p.is_active) || null;
}

function findPlayer(name) {
	if (!name) return null;
	if (name === "active") return activePlayer();
	return state.players.find(p => p.name.toLowerCase() === String(name).toLowerCase()) || null;
}

// REQUEST RECORDING

const requests = [];
function record(req) {
	requests.push({
		method: req.method,
		path: req.originalUrl,
		body: (req.body && Object.keys(req.body).length) ? req.body : null,
		time: new Date().toISOString()
	});
}

// EVENT BROADCASTING (WebSocket /api/events)

let wss = null;
function broadcast(event) {
	if (!wss) return;
	const message = JSON.stringify(event);
	wss.clients.forEach(client => {
		if (client.readyState === WebSocket.OPEN) client.send(message);
	});
}

// websocket.md "Event Messages": the top-level player_name/player_id are the
// event's own source; source.player_id is built as "<name>:6600" for every
// player (documented ACR bug), and source has no other fields.
function playerFields(player) {
	return {
		player_name: player.name,
		player_id: player.id,
		source: {player_name: player.name, player_id: player.name + ":6600"}
	};
}

function emitStateChanged(player) {
	broadcast(Object.assign({type: "state_changed", state: player.state.toLowerCase()}, playerFields(player)));
}

function emitSongChanged(player) {
	broadcast(Object.assign({type: "song_changed", song: state.song}, playerFields(player)));
}

function emitSongInformationUpdate(player, song) {
	broadcast(Object.assign({type: "song_information_update", song: song}, playerFields(player)));
}

// Whether a partial song identifies the current one (ACR's
// apply_song_information): each title/artist it carries must match; an
// omitted one is not asserted.
function identifiesCurrentSong(partial) {
	if (partial.title != null && partial.title !== state.song.title) return false;
	if (partial.artist != null && partial.artist !== state.song.artist) return false;
	return true;
}

// ACR merges only these, and artwork belonging to the song is never replaced:
// only absent art or a station logo (song.rs cover_art_is_replaceable).
// Returns whether the stored song changed.
function mergeSongInformation(partial) {
	const song = state.song;
	const metadata = song.metadata || {};
	let changed = false;
	const replaceable = song.cover_art_url == null || metadata.cover_art_source === "station_logo";
	if (partial.cover_art_url != null && partial.cover_art_url !== song.cover_art_url && replaceable) {
		song.cover_art_url = partial.cover_art_url;
		metadata.cover_art_source = "enrichment";
		changed = true;
	}
	if (partial.liked != null && partial.liked !== song.liked) {
		song.liked = partial.liked;
		changed = true;
	}
	Object.keys(partial.metadata || {}).forEach(key => {
		if (JSON.stringify(metadata[key]) !== JSON.stringify(partial.metadata[key])) {
			metadata[key] = partial.metadata[key];
			changed = true;
		}
	});
	song.metadata = metadata;
	return changed;
}

function emitVolumeChanged() {
	// websocket.md "volume_changed": system-wide, no player source.
	if (!volumeAvailable) return;
	broadcast(Object.assign({
		type: "volume_changed",
		control_name: VOLUME_CONTROL.internal_name,
		display_name: VOLUME_CONTROL.display_name
	}, volumeState(), {source: {player_name: null, player_id: "system:6600"}}));
}

// PLAYER STATE TRANSITIONS

function applyCommand(player, command) {
	const simple = command.split(":")[0];
	switch (simple) {
		case "play":
			state.players.forEach(p => {
				const wasActive = p.is_active;
				if (p === player) {
					p.is_active = true;
					if (p.state !== "Playing") {
						p.state = "Playing";
						emitStateChanged(p);
					} else if (!wasActive) {
						emitStateChanged(p);
					}
				} else {
					p.is_active = false;
					if (p.state === "Playing") {
						p.state = "Paused";
						emitStateChanged(p);
					}
				}
			});
			emitSongChanged(player);
			break;
		case "pause":
			if (player.state !== "Paused") {
				player.state = "Paused";
				emitStateChanged(player);
			}
			break;
		case "playpause":
			player.state = (player.state === "Playing") ? "Paused" : "Playing";
			if (player.state === "Playing") player.is_active = true;
			emitStateChanged(player);
			break;
		case "stop":
			if (player.state !== "Stopped") {
				player.state = "Stopped";
				emitStateChanged(player);
			}
			break;
		case "next":
		case "previous":
			emitSongChanged(player);
			break;
		default:
			// seek:, set_loop:, set_random:, kill... accepted silently.
			break;
	}
	player.last_seen = new Date().toISOString();
}

// EXPRESS APP

const app = express();
app.use(express.json());

// Record every /api request.
app.use("/api", (req, res, next) => {
	record(req);
	next();
});

app.get("/api/version", (req, res) => res.json({version: "0.0.0-mock"}));

app.get("/api/players", (req, res) => res.json({players: state.players}));

app.get("/api/player", (req, res) => {
	const p = activePlayer();
	if (!p) return res.json({name: null, id: null, state: "Unknown", last_seen: null});
	res.json({name: p.name, id: p.id, state: p.state, last_seen: p.last_seen});
});

app.post("/api/players/pause-all", (req, res) => {
	let count = 0;
	state.players.forEach(p => {
		if (p.state === "Playing") {
			p.state = "Paused";
			emitStateChanged(p);
			count++;
		}
	});
	res.json({success: true, message: "Paused or stopped " + count + " players"});
});

app.post("/api/players/stop-all", (req, res) => {
	let count = 0;
	state.players.forEach(p => {
		if (p.state !== "Stopped") {
			p.state = "Stopped";
			emitStateChanged(p);
			count++;
		}
	});
	res.json({success: true, message: "Stopped or paused " + count + " players"});
});

app.post("/api/player/:name/command/:command", (req, res) => {
	const player = findPlayer(req.params.name);
	if (!player) {
		return res.status(404).json({success: false, message: "Player '" + req.params.name + "' not found"});
	}
	applyCommand(player, req.params.command);
	res.json({success: true, message: "Command '" + req.params.command + "' sent successfully to player '" + player.name + "'"});
});

app.get("/api/now-playing", (req, res) => {
	const p = activePlayer();
	res.json({
		player: p,
		song: (p && p.state !== "Stopped") ? state.song : null,
		state: p ? p.state : "Unknown",
		shuffle: state.shuffle,
		loop_mode: state.loop_mode,
		position: state.position
	});
});

app.get("/api/player/:name/queue", (req, res) => {
	const player = findPlayer(req.params.name);
	if (!player) return res.status(404).json({success: false, message: "Player '" + req.params.name + "' not found"});
	res.json({player: player.name, queue: []});
});

app.get("/api/player/:name/meta", (req, res) => {
	const player = findPlayer(req.params.name);
	if (!player) return res.status(404).send("Player not found");
	res.json({player_name: player.name, metadata: {}});
});

// VOLUME

app.get("/api/volume/info", (req, res) => {
	if (!volumeAvailable) {
		return res.json({
			available: false,
			control_info: null,
			current_state: null,
			supports_change_monitoring: false
		});
	}
	res.json({
		available: true,
		control_info: VOLUME_CONTROL,
		current_state: volumeState(),
		supports_change_monitoring: true
	});
});

let volumeFailureStatus = null; // Set by /__test/volume-failure.

// ACR (src/api/volume.rs): GET /state fails with an HTTP error status (503
// without a control); every volume POST answers 200, a failure being
// success:false in the body.
function volumeUnavailable(req, res, next) {
	const failed = !volumeAvailable || volumeFailureStatus;
	if (!failed) return next();
	const body = {success: false, message: volumeAvailable ? "Volume control temporarily unavailable" : "Volume control not available", new_state: null};
	if (req.method == "POST") return res.json(body);
	res.status(volumeAvailable ? volumeFailureStatus : 503).json(body);
}

app.get("/api/volume/state", volumeUnavailable, (req, res) => res.json(volumeState()));

app.post("/api/volume/set", volumeUnavailable, (req, res) => {
	const body = req.body || {};
	let pct = null;
	if (body.percentage != null) {
		pct = parseFloat(body.percentage);
	} else if (body.raw_value != null) {
		pct = (parseFloat(body.raw_value) / 255) * 100;
	} else if (body.decibels != null) {
		pct = ((parseFloat(body.decibels) + 60) / 60) * 100;
	}
	if (pct == null || isNaN(pct)) {
		return res.json({success: false, message: "No volume value provided", new_state: null});
	}
	if (pct < 0 || pct > 100) {
		return res.json({success: false, message: "Volume percentage " + pct + " is out of range (0-100)", new_state: null});
	}
	state.volume.percentage = Math.round(pct * 10) / 10;
	emitVolumeChanged();
	res.json({success: true, message: "Volume set successfully", new_state: volumeState()});
});

app.post("/api/volume/increase", volumeUnavailable, (req, res) => {
	const amount = parseFloat(req.query.amount || "5");
	state.volume.percentage = Math.min(100, state.volume.percentage + amount);
	emitVolumeChanged();
	res.json({success: true, message: "Volume increased to " + state.volume.percentage + "%", new_state: volumeState()});
});

app.post("/api/volume/decrease", volumeUnavailable, (req, res) => {
	const amount = parseFloat(req.query.amount || "5");
	state.volume.percentage = Math.max(0, state.volume.percentage - amount);
	emitVolumeChanged();
	res.json({success: true, message: "Volume decreased to " + state.volume.percentage + "%", new_state: volumeState()});
});

app.post("/api/volume/mute", volumeUnavailable, (req, res) => {
	state.volume.percentage = (state.volume.percentage === 0) ? 50 : 0;
	emitVolumeChanged();
	res.json({success: true, message: "Volume muted at " + state.volume.percentage + "%", new_state: volumeState()});
});

// COVER ART

// Every image-cache path serves the same image (tests tell artwork apart by URL).
app.get("/api/imagecache/*", (req, res) => {
	res.set("Content-Type", "image/png");
	res.send(COVER_PNG);
});

// TEST HOOKS

app.get("/__test/requests", (req, res) => res.json({requests: requests}));
app.post("/__test/requests/clear", (req, res) => {
	requests.length = 0;
	res.json({success: true});
});
app.get("/__test/state", (req, res) => res.json(state));

app.post("/__test/song", (req, res) => {
	const body = req.body || {};
	Object.keys(body).forEach(key => {
		if (body[key] === null) delete state.song[key];
		else state.song[key] = body[key];
	});
	const p = activePlayer();
	if (p) emitSongChanged(p);
	res.json({success: true, song: state.song});
});

app.post("/__test/song-information", (req, res) => {
	const partial = req.body || {};
	if (partial.title == null && partial.artist == null) {
		return res.status(400).json({success: false, message: "Song information needs a title or an artist"});
	}
	const applied = identifiesCurrentSong(partial) && mergeSongInformation(partial);
	const p = activePlayer();
	if (applied && p) emitSongInformationUpdate(p, state.song);
	res.json({success: true, applied: applied});
});

app.post("/__test/player-state", (req, res) => {
	const player = findPlayer((req.body || {}).player);
	if (!player) return res.status(404).json({success: false, message: "Player not found"});
	player.state = req.body.state;
	if (req.body.is_active != null) {
		state.players.forEach(p => p.is_active = false);
		player.is_active = !!req.body.is_active;
	}
	emitStateChanged(player);
	res.json({success: true, player: player});
});

app.post("/__test/volume", (req, res) => {
	state.volume.percentage = parseFloat((req.body || {}).percentage);
	emitVolumeChanged();
	res.json({success: true, new_state: volumeState()});
});

app.post("/__test/volume-failure", (req, res) => {
	volumeFailureStatus = (req.body || {}).status || null;
	res.json({success: true});
});

app.post("/__test/event", (req, res) => {
	broadcast(req.body);
	res.json({success: true});
});

// SERVERS (HTTP + WebSocket on the same port)

const server = http.createServer(app);
wss = new WebSocket.Server({server: server, path: "/api/events"});

wss.on("connection", ws => {
	ws.send(JSON.stringify({type: "welcome", message: "Connected to AudioControl WebSocket API"}));
	ws.on("message", () => {
		ws.send(JSON.stringify({type: "subscription_updated", message: "Subscription updated"}));
	});
	ws.on("error", () => {});
});

server.listen(port, () => {
	console.log("Mock ACR listening on port " + port + ".");
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
