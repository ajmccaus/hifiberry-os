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

// BEOCREATE SOURCES
// hbosng port: player control and metadata come from the ACR service
// (REST + WebSocket event stream) instead of audiocontrol2 on port 81.
var exec = require("child_process").exec;
var acr = require("../../beocreate_essentials/acr");

var debug = beo.debug;

var version = require("./package.json").version;


var allSources = {};
var currentSource = null;
var focusedSource = null;

var enabledHifiberrySources = 0;

var startableSources = {}; // Different sources may hold multiple "sub-sources" (connected devices, physical media) that can be started.

var focusIndex = 0; // Increment and assign to each source, so that it's known which one activated latest.
var defaultSettings = {
		"port": 81, // HiFiBerry API port.
		"aliases": {},
		"sourceOrder": []
};
var settings = JSON.parse(JSON.stringify(defaultSettings));

var defaultAliases = {
	cd: {name: "CD", icon: "cd.svg"},
	phono: {name: "Phono", icon: "beogram.svg"},
	tape: {name: "Tape", icon: "tape.svg"},
	tv: {name: "Television", icon: "tv.svg"},
	computer: {name: "Computer", icon: "computer.svg"}
}



beo.bus.on('general', function(event) {
	// See documentation on how to use beo.bus.
	// GENERAL channel broadcasts events that concern the whole system.
	
	//console.dir(event);
	
	if (event.header == "startup") {

		acr.configure({address: beo.systemConfiguration.acrAddress, debug: debug});
		acr.startEvents();

	}


	if (event.header == "activatedExtension") {
		if (event.content.extension == "sources") {
			if (!checkingEnabled) checkEnabled();
		}
	}
});


beo.bus.on("sources", function(event) {
	
	
	switch (event.header) {
		case "settings":
		
			if (event.content.settings) {
				settings = Object.assign(settings, event.content.settings);
			}
			break;
		case "getSources":
			beo.sendToUI("sources", "sources", {sources: allSources, currentSource: currentSource, focusedSource: focusedSource, sourceOrder: settings.sourceOrder});
			break;
		case "getDefaultAliases":
			beo.bus.emit("ui", {target: "sources", header: "defaultAliases", content: {aliases: defaultAliases}});
			break;
		case "arrangeSources":
			if (event.content.sourceOrder) {
				settings.sourceOrder = event.content.sourceOrder;
				if (debug) console.log("Source order is now: "+settings.sourceOrder.join(", ")+".");
				beo.saveSettings("sources", settings);
				beo.sendToUI("sources", {header: "sources", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource, sourceOrder: settings.sourceOrder}});
			}
			break;
		case "setAlias":
			if (event.content.extension) {
				if (event.content.alias) {
					if (event.content.defaultAlias) {
						if (defaultAliases[event.content.alias]) {
							setSourceOptions(event.content.extension, {alias: defaultAliases[event.content.alias]});
						} else {
							setSourceOptions(event.content.extension, {alias: false});
						}
					} else {
						setSourceOptions(event.content.extension, {alias: {name: event.content.alias, icon: null}});
					}
				} else {
					setSourceOptions(event.content.extension, {alias: false});
				}
			}
			break;
		case "startableSources":
			if (event.content.sources && event.content.extension) {
				for (source in startableSources) {
					if (startableSources[source].extension == event.content.extension) {
						if (!event.content.sources[source]) delete startableSources[source];
					}
				}
				for (source in event.content.sources) {
					startableSources[source] = event.content.sources[source];
					startableSources[source].extension = event.content.extension;
				}
				beo.bus.emit("ui", {target: "sources", header: "startableSources", content: startableSources});
			}
			break;
		case "startSource":
			if (event.content.sourceID) {
				extension = event.content.sourceID;
				if (allSources[extension].parentSource) extension = allSources[extension].parentSource;
				if (allSources[extension].startable) {
					beo.sendToUI("sources", {header: "starting", content: {extension: extension}});
					if (allSources[extension].usesHifiberryControl) {
						if (allSources[extension].aka) {
							sourceName = allSources[extension].aka[0];
						} else {
							sourceName = extension;
						}
						audioControl("start", sourceName, function(success) {
							if (!success) {
								beo.bus.emit(extension, {header: "start"});
							}
						});
					} else {
						beo.bus.emit(extension, {header: "start"});
					}
				}
			}
			break;
		case "setSourceVolume":
			if (currentSource && event.content.percentage != undefined) {
				beo.bus.emit(currentSource, {header: "setVolume", content: {percentage: event.content.percentage}});
			}
			break;
		case "metadata": // Metadata from AudioControl.
			if (event.content) {
				processAudioControlMetadata(event.content.body);
			}
			break;
		case "getMetadata":
			audioControlGet("metadata");
			break;
		case "transport":
			transport(event.content.action);
			break;
		case "toggleLove":
			if (focusedSource && allSources[focusedSource].canLove) {
				if (!allSources[focusedSource].metadata.loved) {
					if (debug) console.log("Loving this track...");
					love = true;
				} else {
					if (debug) console.log("Removing this track from loved tracks...");
					love = false;
				}
				if (allSources[focusedSource].usesHifiberryControl) {
					action = (love) ? "love" : "unlove";
					
					audioControl(action, null, function(success) {
						if (success) {
							allSources[focusedSource].metadata.loved = love;
							beo.bus.emit("sources", {header: "sourcesChanged", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource}});
							beo.sendToUI("sources", "sources", {sources: allSources, currentSource: currentSource, focusedSource: focusedSource});
						}
					});
				}
			}
			break;
	}
});


// HIFIBERRY AUDIO CONTROL (ACR) INTEGRATION
// These functions translate the documented ACR REST/WebSocket payloads into
// the audiocontrol2 shapes the rest of this extension (and the untouched
// client-side code) was built around.

var playerCapabilities = {}; // Last known capabilities per ACR player name (from capabilities_changed events).
var defaultSupportedCommands = ["play", "pause", "playpause", "stop", "next", "previous"];

function supportedCommandsForPlayer(playerName) {
	if (playerName && playerCapabilities[playerName.toLowerCase()]) {
		return playerCapabilities[playerName.toLowerCase()];
	}
	return defaultSupportedCommands.slice();
}

function translatePlayersToStatus(json) {
	// ACR GET /api/players -> audiocontrol2 /api/player/status shape.
	if (!json || !json.players) return null;
	players = [];
	for (var i = 0; i < json.players.length; i++) {
		players.push({
			name: json.players[i].name,
			state: (json.players[i].state || "unknown").toLowerCase(),
			supported_commands: supportedCommandsForPlayer(json.players[i].name)
		});
	}
	return {players: players, last_updated: new Date().toISOString()};
}

function translateNowPlayingToMetadata(json) {
	// ACR GET /api/now-playing -> audiocontrol2 /api/track/metadata shape.
	if (!json || !json.player || !json.player.name) return null;
	song = (json.song) ? json.song : {};
	artUrl = song.coverart_url || song.artwork_url || song.cover_art_url || null;
	if (artUrl) artUrl = acr.absoluteURL(artUrl);
	return {
		playerName: json.player.name,
		playerState: (json.state || json.player.state || "unknown").toLowerCase(),
		title: (song.title != undefined) ? song.title : song.name,
		artist: song.artist,
		albumTitle: song.album,
		artUrl: artUrl,
		externalArtUrl: null,
		streamUrl: song.uri,
		loved: false,
		loveSupported: false
	};
}

function audioControlGet(dataType, callback) {
	switch (dataType) {
		case "metadata":
			acr.getNowPlaying().then(json => {
				metadata = translateNowPlayingToMetadata(json);
				if (metadata) {
					processAudioControlMetadata(metadata);
					if (callback) callback(true);
				} else {
					if (debug) console.log("No now-playing data retrieved from ACR.");
					if (callback) callback(false);
				}
			});
			break;
		case "status":
			acr.getPlayers().then(json => {
				overview = translatePlayersToStatus(json);
				if (overview) {
					processAudioControlStatus(overview);
					if (callback) callback(true);
				} else {
					if (debug) console.log("No player list retrieved from ACR.");
					if (callback) callback(false);
				}
			});
			break;
		default:
			if (callback) callback(false);
			break;
	}
}


function audioControl(operation, extra, callback) {
	switch (operation) {
		case "playPause":
		case "play":
		case "pause":
		case "stop":
		case "next":
		case "previous":
			// Send to the active player: POST /api/player/active/send/<command>.
			acr.sendActiveCommand(operation.toLowerCase()).then(result => {
				if (result && result.success != false) {
					if (callback) callback(true);
				} else {
					if (debug) console.log("Could not send ACR player command '"+operation+"'.");
					if (callback) callback(false);
				}
			});
			break;
		case "start":
			// Activate a source by starting playback on the named player:
			// POST /api/player/<player-name>/command/play.
			acr.sendPlayerCommand(extra, "play").then(result => {
				if (result && result.success != false) {
					if (callback) callback(true);
				} else {
					if (debug) console.log("Could not start ACR player '"+extra+"'.");
					if (callback) callback(false);
				}
			});
			break;
		case "love":
		case "unlove":
			// Favourites are not part of this port (ACR has /api/favourites, but
			// sources marks loveSupported false). Report failure.
			if (callback) callback(false);
			break;
		default:
			if (callback) callback(false);
			break;
	}
}


// ACR EVENT STREAM
// Translate pushed events onto the same processing functions that
// audiocontrol2 used to feed via HTTP callbacks, so downstream logic and
// the client-side code stay unchanged.

acr.events.on("connected", function() {
	// (Re)connected to the event stream: resynchronise the full state.
	if (sourcesRegistered) {
		audioControlGet("status", function() {
			audioControlGet("metadata");
		});
	}
});

acr.events.on("state_changed", function(event) {
	if (!event.player_name) return;
	processAudioControlStatus({
		players: [{
			name: event.player_name,
			state: (event.state || "unknown").toLowerCase(),
			supported_commands: supportedCommandsForPlayer(event.player_name)
		}],
		last_updated: new Date().toISOString()
	});
	// Pull fresh metadata for the now-active player.
	audioControlGet("metadata");
});

acr.events.on("song_changed", function(event) {
	if (!event.player_name) return;
	song = (event.song) ? event.song : {};
	artUrl = song.coverart_url || song.artwork_url || song.cover_art_url || null;
	if (artUrl) artUrl = acr.absoluteURL(artUrl);
	[extension] = matchAudioControlSourceToExtension(event.player_name);
	currentState = (extension && allSources[extension]) ? allSources[extension].playerState : "playing";
	processAudioControlMetadata({
		playerName: event.player_name,
		playerState: currentState,
		title: (song.title != undefined) ? song.title : song.name,
		artist: song.artist,
		albumTitle: song.album,
		artUrl: artUrl,
		externalArtUrl: null,
		streamUrl: song.uri,
		loved: false,
		loveSupported: false
	});
});

acr.events.on("metadata_changed", function(event) {
	// Metadata updates reuse the song_changed translation.
	if (!event.player_name || !event.metadata) return;
	acr.events.emit("song_changed", {player_name: event.player_name, song: event.metadata});
});

acr.events.on("capabilities_changed", function(event) {
	if (!event.player_name || !event.capabilities) return;
	caps = [];
	for (c in event.capabilities) {
		caps.push(String(event.capabilities[c]).toLowerCase());
	}
	playerCapabilities[event.player_name.toLowerCase()] = caps;
	// Refresh transport controls, preserving the current state of the source.
	[extension] = matchAudioControlSourceToExtension(event.player_name);
	currentState = (extension && allSources[extension] && allSources[extension].playerState) ? allSources[extension].playerState : "unknown";
	processAudioControlStatus({
		players: [{
			name: event.player_name,
			state: currentState,
			supported_commands: caps
		}],
		last_updated: new Date().toISOString()
	});
});



audioControlLastUpdated = null;
sourceCheckTimeout = null;

function processAudioControlStatus(overview) {
	if (overview.players && overview.last_updated) {
		audioControlLastUpdated = overview.last_updated;
		for (var i = 0; i < overview.players.length; i++) {
			// Go through each source, see their status and update accordingly.
			[extension, childSource] = matchAudioControlSourceToExtension(overview.players[i].name, overview.players[i]);
			if (extension && (extension in allSources)) {
				allSources[extension].childSource = childSource;
				if (childSource && allSources[childSource]) allSources[childSource].parentSource = extension;
				if (overview.players[i].state == "unknown") overview.players[i].state = "stopped";
				
				if (allSources[extension].playerState != overview.players[i].state) {
					allSources[extension].playerState = overview.players[i].state;
					
					if (overview.players[i].state == "playing") {
						sourceActivated(extension);
					} else {
						if (allSources[extension].active) sourceDeactivated(extension, overview.players[i].state);
					}
					
					beo.bus.emit("sources", {header: "playerStateChanged", content: {state: allSources[extension].playerState, extension: extension}});
					
					
					if (overview.players[i].state != "paused" && extension != currentAudioControlSource) {
						// This is not the current AudioControl source but because it is paused, check again after 15 seconds to see if it has changed.
						clearTimeout(sourceCheckTimeout);
						sourceCheckTimeout = setTimeout(function() {
							audioControlGet("status");
						}, 15000);
					}
				}
				
				if (overview.players[i].supported_commands) {
					if (allSources[extension].allowChangingTransportControls) {
						allSources[extension].transportControls = overview.players[i].supported_commands;
						if (allSources[extension].transportControls &&
							typeof allSources[extension].transportControls == "object") {
							for (tc in allSources[extension].transportControls) {
								allSources[extension].transportControls[tc] = allSources[extension].transportControls[tc].toLowerCase();
							}
						}
					}
					if (overview.players[i].supported_commands.indexOf("play") != -1) {
						allSources[extension].startable = true;
					} else {
						allSources[extension].startable = false;
					}
				} else {
					allSources[extension].startable = false;
				}
				
				if (extension == "bluetooth") {
					allSources[extension].aliasInNowPlaying = overview.players[i].name;
				}
				
				if (!allSources[extension].metadata.title) {
					if (overview.players[i].title) allSources[extension].metadata.title = overview.players[i].title;
					if (overview.players[i].artist) allSources[extension].metadata.artist = overview.players[i].artist;
				}
			}
		}
	}
}

var currentAudioControlSource = null;

function processAudioControlMetadata(metadata) {

	[extension, childSource] = matchAudioControlSourceToExtension(metadata.playerName, metadata);
	if (extension && allSources[extension]) { // hbosng port: guard against players whose extension isn't installed (e.g. 'bluetooth' fallback).
		if (allSources[extension].childSource && allSources[extension].childSource != childSource) {
			sourceDeactivated(allSources[extension].childSource, "stopped");
			allSources[allSources[extension].childSource].parentSource = null;
		}
		allSources[extension].childSource = childSource;
		if (childSource && allSources[childSource]) allSources[childSource].parentSource = extension;
		if (metadata.playerState == "unknown") metadata.playerState = "stopped";
		
		if (!focusedSource) {
			if (childSource && allSources[childSource]) {
				focusedSource = childSource;
			} else if (!allSources[extension].backgroundService) {
				focusedSource = extension;
			}
		}
		
		if (extension == "bluetooth") {
			allSources[extension].aliasInNowPlaying = metadata.playerName;
		}
		
		metadataChanged = false;
		playerStateChanged = false;
		
		if (metadata.title != allSources[extension].metadata.title ||
			metadata.artist != allSources[extension].metadata.artist ||
			metadata.albumTitle != allSources[extension].metadata.album ||
			metadata.artUrl != allSources[extension].metadata.picture ||
			metadata.externalArtUrl != allSources[extension].metadata.externalPicture ||
			metadata.loved != allSources[extension].metadata.loved) {
			// Metadata updated.
			allSources[extension].metadata.title = metadata.title;
			allSources[extension].metadata.artist = metadata.artist;
			allSources[extension].metadata.album = metadata.albumTitle;
			allSources[extension].metadata.loved = metadata.loved;
			allSources[extension].metadata.picture = metadata.artUrl;
			allSources[extension].metadata.externalPicture = metadata.externalArtUrl;
			allSources[extension].metadata.picturePort = settings.port;
			allSources[extension].metadata.uri = metadata.streamUrl;
			//beo.bus.emit("sources", {header: "metadataChanged", content: {metadata: allSources[extension].metadata, extension: extension}});
			metadataChanged = true;
			// "Love track" support.
			if (allSources[extension].canLove != metadata.loveSupported) {
				setSourceOptions(extension, {canLove: metadata.loveSupported});
			}
			
			if (childSource && allSources[childSource]) {
				allSources[childSource].metadata = JSON.parse(JSON.stringify(allSources[extension].metadata));
				if (allSources[childSource].canLove != metadata.loveSupported) {
					setSourceOptions(childSource, {canLove: metadata.loveSupported});
				}
			}
		}
		
		if (metadata.playerState != allSources[extension].playerState ||
			(childSource && allSources[childSource] && allSources[childSource].playerState != metadata.playerState)) {
			// Player state updated _for this source_.
			allSources[extension].playerState = metadata.playerState;
			if (childSource && allSources[childSource]) {
				allSources[childSource].playerState = metadata.playerState;
			}

			if (metadata.playerState == "playing") {
				if (childSource && allSources[childSource]) {
					sourceActivated(childSource);
				} else if (extension) {
					sourceActivated(extension);
				}
			} else {
				if (childSource && allSources[childSource]) {
					sourceDeactivated(childSource);
				} else if (extension) {
					sourceDeactivated(extension);
				}
			}
			
			//beo.bus.emit("sources", {header: "playerStateChanged", content: {state: allSources[extension].playerState, extension: extension}});
			playerStateChanged = true;
		}
		
		if (metadataChanged && !playerStateChanged) { // If player state has changed, this info will be sent by the function that keeps track of active sources. If only metadata changes, send it here.
			beo.bus.emit("sources", {header: "sourcesChanged", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource}});
			beo.sendToUI("sources", "sources", {sources: allSources, currentSource: currentSource, focusedSource: focusedSource});
		}
		
		if (extension != currentAudioControlSource) {
			// If the active source indicated in AudioControl metadata changes, there won't be status updates for the previous source. Read it manually.
			currentAudioControlSource = extension;
			setTimeout(function() {
				audioControlGet("status");
			}, 2000);
		}
	}
}

function matchAudioControlSourceToExtension(acSource, data = null) {
    // Determine which extension this belongs to.
    var extension = null;
    var childSource = null;

    if (acSource) {
        acSource = acSource.toLowerCase();
        if (allSources[acSource]) {
            extension = acSource;
            if (allSources[extension].determineChildSource) {
                childSource = allSources[extension].determineChildSource(data);
            }
        } else {
            for (let source in allSources) {
                // Handle aka being undefined, a single string, or an array
                let aka = allSources[source].aka || [];
                if (typeof aka === 'string') {
                    aka = [aka.toLowerCase()]; // Normalize and wrap in an array if it's a string
                } else if (Array.isArray(aka)) {
                    aka = aka.map(a => a ? a.toLowerCase() : ''); // Normalize each element to lowercase
                }	

                // Check if acSource matches any of the aka values
                if (aka.indexOf(acSource) !== -1) {
                    extension = source;
                    if (allSources[extension].determineChildSource) {
                        childSource = allSources[extension].determineChildSource(data);
                    }
                    break;
                }
            }
        }
        if (!extension) {
            extension = "bluetooth"; // Default to "bluetooth" if no extension matches
        }
    }
    return [extension, childSource];
}

// TRANSPORT

function transport(action, overrideHifiberry = false) {
	if (focusedSource) {
		if (allSources[focusedSource].parentSource) {
			controlSource = allSources[focusedSource].parentSource;
		} else {
			controlSource = focusedSource;
		}
		if (allSources[controlSource].transportControls) {
			if (allSources[controlSource].usesHifiberryControl && !overrideHifiberry) {
				audioControl(action, null, function(success) {
					if (!success) {
						transport(action, true);
					}
				});
			} else {
				switch (action) {
					case "playPause":
					case "play":
					case "pause":
					case "stop":
					case "next":
					case "previous":
						beo.bus.emit(controlSource, {header: "transport", content: {action: action}});
						break;
				}
			}
		}
	}
}


// KEEP TRACK OF SOURCES


function sourceActivated(extension, playerState) {
	if (extension &&
		allSources[extension] && 
		allSources[extension].enabled && 
		!allSources[extension].backgroundService) {
		if (allSources[extension].focusIndex)  {
			// Source reactivates, recalculate activation indexes.
			reactivatedSourceFocusIndex = allSources[extension].focusIndex;
			allSources[extension].focusIndex = 0;
			focusIndex--;
			
			for (source in allSources) {
				if (allSources[source].focusIndex > reactivatedSourceFocusIndex) {
					allSources[source].focusIndex--;
				}
			}
		}
		focusIndex++;
		allSources[extension].active = true;
		allSources[extension].focusIndex = focusIndex;
		
		// Stop currently active sources, if the source demands it.
		if (allSources[extension].stopOthers) {
			/*if (allSources[currentSource] && 
				allSources[currentSource].usesHifiberryControl && 
				!allSources[extension].usesHifiberryControl) {
				
				if (!allSources[extension].parentSource || 
					(allSources[allSources[extension].parentSource] && allSources[allSources[extension].parentSource].usesHifiberryControl)) {
					// If the new source isn't part of AudioControl, stop other AudioControl sources manually.
					if (debug) console.log("Pausing sources under HiFiBerry control...");
					audioControl("pause");
				}
			}*/
			var hifiberryPaused = false;
			for (source in allSources) {
				if (source != extension && 
					allSources[source].active) {
					if (allSources[source].parentSource && allSources[allSources[source].parentSource]) {
						var theSource = allSources[source].parentSource;
					} else {
						var theSource = source;
					}
					if (!allSources[theSource].usesHifiberryControl) {
						// Stop all other non-AudioControl sources.
						beo.bus.emit(source, {header: "stop", content: {reason: "sourceActivated"}});
					} else if (!hifiberryPaused && !allSources[extension].usesHifiberryControl) {
						// If the new source isn't part of AudioControl, stop other AudioControl sources manually (issue command once).
						if (debug) console.log("Pausing sources under HiFiBerry control...");
						hifiberryPaused = true;
						audioControl("pause");
					}
				}
			}
		}
		if (playerState) {
			allSources[extension].playerState = playerState;
		}
		
		var fromStandby = (currentSource == null);
		
		determineCurrentSource();
		if (debug) {
			childMsg = (allSources[extension].parentSource) ? " (as child source of '"+allSources[extension].parentSource+"')" : "";
			console.log("Source '"+extension+"' has activated"+childMsg+".");
		}
		
		if (beo.extensions.interact) beo.extensions.interact.runTrigger("sources", "sourceActivated", {source: extension, fromStandby: fromStandby});

	}
}

function sourceDeactivated(extension, playerState) {
	if (extension &&
		allSources[extension] && allSources[extension].active) {
		allSources[extension].active = false;
		if (!allSources[extension].transportControls && Object.keys(allSources[extension].metadata).length == 0) {
			// Remove the focus index from the source if it has no metadata and transport controls.
			deactivatedSourceFocusIndex = allSources[extension].focusIndex;
			allSources[extension].focusIndex = 0;
			focusIndex--;
			
			for (source in allSources) {
				if (allSources[source].focusIndex > deactivatedSourceFocusIndex) {
					allSources[source].focusIndex--;
				}
			}
		}
		
		if (playerState) {
			allSources[extension].playerState = playerState;
			//beo.bus.emit("sources", {header: "playerStateChanged", content: {state: playerState, extension: extension}});
		}
		
		determineCurrentSource();
		if (debug) console.log("Source '"+extension+"' has deactivated.");
		
		if (beo.extensions.interact) beo.extensions.interact.runTrigger("sources", "sourceDeactivated", {source: extension, toStandby: (currentSource == null)});
	
	}
}

function determineCurrentSource() {
	var fromStandby = (currentSource == null);
	activeSourceCount = 0;
	latestSource = null;
	highestFocusIndex = 0;
	focusedSource = null;
	newSource = null;
	for (source in allSources) {
		if (allSources[source].focusIndex > highestFocusIndex) {
			highestFocusIndex = allSources[source].focusIndex;
			focusedSource = source;
			if (allSources[source].active) {
				newSource = source;
				activeSourceCount++;
			}
		}
	}
	if (activeSourceCount == 0) {
		if (currentSource != null) {
			currentSource = null;
		}
	} else {
		if (newSource != currentSource) {
			currentSource = newSource;
		}
	}
	
	beo.bus.emit("sources", {header: "sourcesChanged", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource, fromStandby: fromStandby, toStandby: (currentSource == null)}});
	beo.sendToUI("sources", {header: "sources", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource}});
	logSourceStatus();
}

function logSourceStatus() {
	if (debug >= 2) {
		message = "Sources: [play: "+currentSource+"] [focus: "+focusedSource+"]\n";
		for (source in allSources) {
			message += "["+source+"] active: "+allSources[source].active;
			if (allSources[source].active) message += " ("+allSources[source].focusIndex+". to activate)";
			message += ", state: "+allSources[source].playerState;
			if (allSources[source].metadata.title && allSources[source].metadata.artist) message += ", track: "+allSources[source].metadata.title+" - "+allSources[source].metadata.artist;
			message += "\n";
		}
	}
}


function setMetadata(extension, metadata) {
	
}

var sourceRegistrationTimeout;
var sourcesRegistered = false;
function setSourceOptions(extension, options, noUpdate) {

	if (beo.extensions[extension]) {
		sourceAdded = false;
		if (!allSources[extension]) {
			sourceAdded = true;
			allSources[extension] = {
				active: false,
				sortName: extension,
				enabled: false,
				playerState: "stopped",
				stopOthers: true,
				transportControls: false,
				allowChangingTransportControls: true,
				usesHifiberryControl: false,
				canLove: false,
				startable: false,
				metadata: {},
				alias: null,
				aliasInNowPlaying: null,
				determineChildSource: false,
				childSources: [],
				backgroundService: false
			};
			if (debug) console.log("Registering source '"+extension+"'...");
		}
		
		if (options.enabled != undefined) allSources[extension].enabled = (options.enabled) ? true : false;
		if (options.transportControls != undefined) {
			if (options.transportControls == true) {
				allSources[extension].transportControls = ["play", "pause", "next", "previous"];
			} else if (options.transportControls == false) {
				allSources[extension].transportControls = false;
			} else {
				allSources[extension].transportControls = options.transportControls;
				if (allSources[extension].transportControls &&
					typeof allSources[extension].transportControls == "object") {
					for (tc in allSources[extension].transportControls) {
						allSources[extension].transportControls[tc] = allSources[extension].transportControls[tc].toLowerCase();
					}
				}
			}
		}
		if (options.sortName) allSources[extension].sortName = options.sortName;
		if (options.stopOthers != undefined) allSources[extension].stopOthers = (options.stopOthers) ? true : false;
		if (options.usesHifiberryControl != undefined) allSources[extension].usesHifiberryControl = (options.usesHifiberryControl) ? true : false;
		if (options.allowChangingTransportControls != undefined) allSources[extension].allowChangingTransportControls = (options.allowChangingTransportControls) ? true : false;
		if (options.aka) allSources[extension].aka = options.aka; // Other variations of the name the source might be called (by HiFiBerry Audiocontrol).
		if (options.canLove) allSources[extension].canLove = options.canLove; // Display or don't display the "love" button.
		if (options.startable) allSources[extension].startable = options.startable; // Can this source be started from Beocreate 2?
		if (options.playerState) allSources[extension].playerState = options.playerState; // Player state.
		if (options.determineChildSource) allSources[extension].determineChildSource = options.determineChildSource; // Custom function to determine the current source from Audiocontrol metadata. Must return name of the source extension.
		if (options.childSources) allSources[extension].childSources = options.childSources; // Child sources this source can pose as.
		if (options.backgroundService) allSources[extension].backgroundService = options.backgroundService; // Sources marked as background services won't be included in source order.
		if (options.alias != undefined) { // An alias is an alternate name and icon for the source in Sources and Now Playing. Within the source's own menu the original name is shown for clarity. Alias is read from settings further below.
			if (options.alias) {
				allSources[extension].alias = {name: options.alias.name, icon: options.alias.icon};
				settings.aliases[extension] = {name: options.alias.name, icon: options.alias.icon};
				if (debug) console.log("Alias for source '"+extension+"' is now "+options.alias.name+".");
			} else {
				allSources[extension].alias = null;
				settings.aliases[extension] = null;
				if (debug) console.log("Alias for source '"+extension+"' was removed.");
			}
			beo.saveSettings("sources", settings);
		}
		if (options.aliasInNowPlaying != undefined) allSources[extension].aliasInNowPlaying = options.aliasInNowPlaying;
		
		
		if (!sourceAdded) { 
			if (!noUpdate) beo.sendToUI("sources", {header: "sources", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource}});
			count = 0;
			for (source in allSources) {
				if (allSources[source].usesHifiberryControl) {
					if (allSources[source].enabled) count++;
				}
			}
			if (count != enabledHifiberrySources) {
				if (debug) console.log(count+" HiFiBerry-controlled sources are now enabled.");
				enabledHifiberrySources = count;
			}
		} else {
			
			if (settings.aliases[extension]) {
				allSources[extension].alias = {name: settings.aliases[extension].name, icon: settings.aliases[extension].icon};
			}
		}
		
		if (!sourcesRegistered) {
			clearTimeout(sourceRegistrationTimeout)
			sourceRegistrationTimeout = setTimeout (function() {
				if (debug) console.log("All sources registered.");
				
				// Order sources:
				orderChanged = false;
				// Check if any sources have been removed from the system.
				for (o in settings.sourceOrder) {
					if (!allSources[settings.sourceOrder[o]] ||
					 	!beo.extensions[settings.sourceOrder[o]] ||
					 	allSources[settings.sourceOrder[o]].backgroundService) {
						// Remove this source from source order.
						delete settings.sourceOrder[o];
						orderChanged = true;
					}
				}
				if (orderChanged) { // Remove gaps in the array.
					settings.sourceOrder = settings.sourceOrder.filter(function (el) {
						return el != null;
					});
				}
				// Check if any new sources exist in the system.
				for (source in allSources) {
					if (settings.sourceOrder.indexOf(source) == -1 && !allSources[source].backgroundService) {
						// This source doesn't exist. Add it to the mix alphabetically (by display name), preserving user order.
						
						titles = [];
						for (o in settings.sourceOrder) {
							titles.push(allSources[settings.sourceOrder[o]].sortName);
						}
						newTitle = allSources[source].sortName;
						newIndex = 0;
						for (t in titles) {
							if ([newTitle, titles[t]].sort()[1] == newTitle) newIndex = t+1;
						}
						settings.sourceOrder.splice(newIndex, 0, source);
						orderChanged = true;
					}
				}
				if (orderChanged) {
					if (debug) console.log("Source order is now: "+settings.sourceOrder.join(", ")+".");
					beo.saveSettings("sources", settings);
				}
				
				beo.bus.emit("sources", {header: "sourcesChanged", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource, sourceOrder: settings.sourceOrder}});
				audioControlGet("status", function(result) {
					audioControlGet("metadata");
				});
				enabledHifiberrySources = 0;
				for (source in allSources) {
					if (allSources[source].usesHifiberryControl) {
						if (allSources[source].enabled) enabledHifiberrySources++;
					}
				}
				sourcesRegistered = true;
				

				
				
			}, 1000);
		}
	}
}

var checkingEnabled = false;
var enabledChanged = false;
function checkEnabled(queue, callback) {
	checkingEnabled = true;
	if (!queue) {
		if (debug > 1) console.log("Checking enabled status for all sources...");
		queue = [];
		for (extension in allSources) {
			if (beo.extensions[extension].isEnabled) {
				queue.push(extension);
			}
		}
	}
	if (queue.length > 0) {
		source = queue.shift();
		beo.extensions[source].isEnabled(function(enabled) {
			if (allSources[source].enabled != enabled) {
				enabledChanged = true;
				if (debug) {
					readableStatus = (enabled) ? "enabled" : "disabled";
					if (debug) console.log("Source '"+source+"' is now "+readableStatus+".");
				}
				setSourceOptions(source, {enabled: enabled}, queue.length > 0); // Sends update to UI if this is the last extension to check.
			} else if (queue.length == 0 && enabledChanged) {
				// If the last source to check has not changed but another has, just send update.
				beo.sendToUI("sources", {header: "sources", content: {sources: allSources, currentSource: currentSource, focusedSource: focusedSource}});
			}
			if (queue.length > 0) {
				checkEnabled(queue, callback);
			} else {
				checkingEnabled = false;
				if (callback) callback();
			}
		});
	}
}


function stopAllSources() {
	// Stop currently active sources, if the source demands it.
	acr.apiPost("/api/players/pause-all"); // hbosng port: was /opt/hifiberry/bin/pause-all.
	for (source in allSources) {
		if (allSources[source].active) {
			if (!allSources[source].usesHifiberryControl) {
				// Stop all other non-AudioControl sources.
				beo.bus.emit(source, {header: "stop", content: {reason: "stopAll"}});
			}
		}
	}
}


function getCurrentSource() {
	if (currentSource) {
		return {currentSource: currentSource, data: allSources[currentSource]};
	} else {
		return null
	}
}

interact = {
	triggers: {
			sourceActivated: function(data, interactData) {
				if (!interactData.source) {
					return (data.fromStandby) ? data.source : undefined;
				} else {
					return (data.source == interactData.source) ? data.source : undefined;
				}
			},
			sourceDeactivated: function(data, interactData) {
				if (!interactData.source) {
					return (data.toStandby) ? data.source : undefined;
				} else {
					return (data.source == interactData.source) ? data.source : undefined;
				}
			}
		}
}


module.exports = {
	version: version,
	setSourceOptions: setSourceOptions,
	setMetadata: setMetadata,
	sourceActivated: sourceActivated,
	sourceDeactivated: sourceDeactivated,
	allSources: allSources,
	settings: settings,
	stopAllSources: stopAllSources,
	getCurrentSource: getCurrentSource,
	getSources: function() {return allSources},
	transport: transport,
	interact: interact
};




