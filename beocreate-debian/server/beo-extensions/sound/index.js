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

// BEOCREATE SYSTEM SOUND EXTENSION
// Mainly handles volume control.
// hbosng port: system volume is controlled through the ACR service
// (/api/volume/*) instead of amixer/audiocontrol2.

var beoDSP = require('../../beocreate_essentials/dsp');
var acr = require('../../beocreate_essentials/acr');



	var debug = beo.debug;
	
	var version = require("./package.json").version;
	
	var defaultSettings = {
		"advancedSoundAdjustmentsEnabled": false,
		"volumeControlRange": [0, 100]
	};
	var settings = JSON.parse(JSON.stringify(defaultSettings));
	
	var defaultSourcesSettings = {
		"port": 81
	};
	var sourcesSettings = JSON.parse(JSON.stringify(defaultSourcesSettings));
	
	
	
	var metadata = {};
	
	var systemVolume = 0; // Master Volume.
	var previousVolume = 0; // Previous volume level. Used to compare if volume has changed.
	
	// Determine which method to use for volume control.
	var volumeControl = false; // 0 = no volume control, 1 = ACR system volume, 2 = direct DSP control.
	var acrVolumeAvailable = false;
	var directDSPVolumeControlAvailable = false;
	var alsaDSPVolumeControlAvailable = false;
	var volumeControlRange = [0, 100];
	
	beo.bus.on('general', function(event) {
		// See documentation on how to use beo.bus.
		// GENERAL channel broadcasts events that concern the whole system.
		
		//console.dir(event);
		
		if (event.header == "startup") {

			if (beo.systemConfiguration.cardType.indexOf("Beocreate") != -1) {

			}

			acr.configure({address: beo.systemConfiguration.acrAddress, debug: debug});
			checkIfACRVolumeAvailable(function() {
				determineVolumeControl();
				getVolume();
			});
		}
		
		if (event.header == "activatedExtension") {
			if (event.content.extension == "sound") {
				
				beo.bus.emit("ui", {target: "sound", header: "advancedSoundAdjustmentsEnabled", content: {enabled: settings.advancedSoundAdjustmentsEnabled}});
				
			}
			
		}
		
		
	});
	
	beo.bus.on('dsp', function(event) {
		
		
		if (event.header == "metadata") {
			
			directDSPVolumeControlAvailable = false;
			alsaDSPVolumeControlAvailable = false;
			
			if (event.content.metadata) {
				metadata = beoDSP.enrichDSPMetadata(event.content.metadata);
				if (metadata.volumeControlRegister) {
					/*beoDSP.readDSP(metadata.volumeControlRegister.value[0], function(response) {
						volumeValue = Math.round(beoDSP.convertVolume("amplification", "%", response.dec));
					});*/
					directDSPVolumeControlAvailable = true;
					if (event.content.fromDSP) {
						alsaDSPVolumeControlAvailable = true;
					}
				} 
			}
			//determineALSAMixer();
			//determineVolumeControl();
		}
		
	});
	
	
	
	beo.bus.on("sound", function(event) {
		// Global, high-level sound control events.
		switch (event.header) {
			
			case "settings":
				if (event.content.settings) {
					settings = Object.assign(settings, event.content.settings);
					
					if (settings.volumeControlRange) {
						for (var i = 0; i < 2; i++) {
							if (settings.volumeControlRange[i]) {
								value = parseFloat(settings.volumeControlRange[i]);
								if (value != NaN) {
									if (value < 0) value = 0;
									if (value > 100) value = 100;
								} else {
									value = (i == 0) ? 0 : 100;
								}
								volumeControlRange[i] = value;
							}
						}
					}
				}
				break;
			case "volume":
				if (event.content.body.percent != undefined) {
					if (debug >= 2) console.log("Volume received from AudioControl: "+event.content.body.percent+" %.");
					reportVolume(event.content.body.percent);
				}
				break;
			case "setVolume":
				setVolume(event.content);
				break;
			case "setVolumeAudioControl":
				setVolumeViaACR(event.content);
				break;
			case "getVolumeAudioControl":
				getVolumeViaACR(console.log);
				break;
			case "mute":
				fade = false;
				if (event.content.fade) fade = true;
				//mute(true, fade);
				break;
			case "unmute":
				fade = (event.content.fade) ? true : false;
				//mute(false, fade);
				break;
			case "toggleMute":
				//fade = (event.content.fade) ? true : false;
				//mute(undefined, fade);
				break;
			case "getVolume":
				getVolume(function() {
					beo.sendToUI("sound", {header: "systemVolume", content: {volume: systemVolume, volumeControl: volumeControl}});
				});
				break;
			case "advancedSoundAdjustmentsEnabled":
				if (event.content && event.content.enabled != undefined) {
					settings.advancedSoundAdjustmentsEnabled = (event.content.enabled) ? true : false;
					beo.bus.emit("settings", {header: "saveSettings", content: {extension: "sound", settings: settings}});
				}
				beo.bus.emit("ui", {target: "sound", header: "advancedSoundAdjustmentsEnabled", content: {enabled: settings.advancedSoundAdjustmentsEnabled}});
				break;
		}
	});
	
	beo.bus.on("sources", function(event) {
		// Capture settings for "sources" extension, because they include the port for AudioControl.
		if (event.header == "settings" && event.content.settings) {
			sourcesSettings = Object.assign(sourcesSettings, event.content.settings);
		}
	});
	
	
	function determineVolumeControl() {
		// Based on what is currently known about the system, which volume control method should be used?
		volumeControl = false;
		if (directDSPVolumeControlAvailable) volumeControl = 2; // Direct DSP control.
		if (acrVolumeAvailable) volumeControl = 1; // ACR system volume control.

		if (debug) {
			if (volumeControl == 0) console.log("System has no volume control.");
			if (volumeControl == 1) console.log("Volume control is via ACR system volume.");
			if (volumeControl == 2) console.log("Volume control is via direct DSP control.");

			if (volumeControlRange[0] != 0 || volumeControlRange[1] != 100) console.log("Volume control range maps to "+volumeControlRange[0]+"-"+volumeControlRange[1]+".");
		}
	}
	
	setVolumeLevel = systemVolume;
	function setVolume(volume, callback) {
		if (typeof volume == "string") {
			if (volume.charAt(0) == "+") {
				if (muted) {
					setVolumeLevel = muted;
					mute(false);
				} else {
					if (volume.length == 1) {
						setVolumeLevel += 1;
					} else {
						setVolumeLevel += parseInt(volume.slice(1));
					}
				}
			} else if (volume.charAt(0) == "-") {
				if (volume.length == 1) {
					setVolumeLevel -= 1;
				} else {
					setVolumeLevel -= parseInt(volume.slice(1));
				}
			}
		} else {
			setVolumeLevel = volume;
		}
		if (setVolumeLevel < 0) setVolumeLevel = 0;
		if (setVolumeLevel > 100) setVolumeLevel = 100;
		if (debug >= 2) console.log("Setting volume: "+setVolumeLevel+" %.");
		switch (volumeControl) {
			case 0: // No volume control.
				callback(null);
				break;
			case 1: // Talk to ACR.
				setVolumeViaACR(mapVolume(setVolumeLevel, false), function(newVolume) {
					reportVolume(newVolume, callback, true);
				});
				break;
			case 3: // Talk to the DSP directly.
				break;
		}
	}

	function getVolume(callback) {
		switch (volumeControl) {
			case 0: // No volume control.
				if (callback) callback(null);
				break;
			case 1: // Talk to ACR.
				getVolumeViaACR(function(newVolume) {
					reportVolume(newVolume, callback);
				});
				break;
			case 2: // Talk to the DSP directly.
				break;
		}
	}
	
	var setVolumeUpdateTimeout;
	
	function reportVolume(trueVolume, callback, fromSetVolume = false) {
		newVolume = mapVolume(trueVolume, true);
		if (systemVolume != newVolume) {
			if (beo.extensions.interact) beo.extensions.interact.runTrigger("sound", "volumeChanged", {volume: newVolume, up: (newVolume > systemVolume)});
			systemVolume = newVolume;
			beo.bus.emit("sound", {header: "systemVolume", content: {volume: newVolume, trueVolume: trueVolume, volumeControl: volumeControl, fromSetVolume: fromSetVolume}});
			beo.sendToUI("sound", {header: "systemVolume", content: {volume: newVolume, volumeControl: volumeControl}});
			
			clearTimeout(setVolumeUpdateTimeout);
			setVolumeUpdateTimeout = setTimeout(function() {
				setVolumeLevel = systemVolume; // Update the "set volume level" shortly after.
			}, 500);
		}
		if (callback) callback(newVolume);
	}
	
	

	var volumeFadeInterval = null;
	var muted = false; // Store previous volume level here during mute.
	var fadeStep = 0; // %, calculated dynamically so that the transition takes about 2,5 seconds.
	
	function mute(operation, fade) {
		
		if (volumeFadeInterval) {
			clearInterval(volumeFadeInterval);
		}
		if (operation == undefined || operation != true || operation != false) operation = (muted) ? false : true;
		
		if (operation == true && !muted) {
			// Mute.
			if (debug) console.log("Muting volume...");
			muted = systemVolume;
			fadeStep = Math.round(muted/20);
			if (fade) {
				volumeFadeInterval = setInterval(function() {
					newVolume = systemVolume - fadeStep;
					if (newVolume <= 0) {
						setVolume(0);
						clearInterval(volumeFadeInterval);
						volumeFadeInterval = null;
						if (debug) console.log("Muted.");
					} else {
						setVolume(newVolume);
					}
				}, 100);
			} else {
				setVolume(0);
			}
		} else if (operation == false && muted) {
			// Unmute.
			if (debug) console.log("Unmuting volume...");
			if (fade) {
				volumeFadeInterval = setInterval(function() {
					fadeStep = Math.round(muted/20);
					newVolume = systemVolume + fadeStep;
					if (newVolume >= muted) {
						newVolume = muted;
						muted = false;
						setVolume(newVolume);
						clearInterval(volumeFadeInterval);
						volumeFadeInterval = null;
						if (debug) console.log("Unmuted.");
					} else {
						setVolume(newVolume);
					}
				}, 100);
			} else {
				newVolume = muted;
				muted = false;
				setVolume(newVolume);
			}
		}
		
	}	
	
	
	function checkIfACRVolumeAvailable(callback) {
		// Ask ACR whether a system volume control exists (GET /api/volume/info).
		acrVolumeAvailable = false;
		acr.getVolumeInfo().then(json => {
			if (json && json.available) {
				acrVolumeAvailable = true;
				if (json.current_state && json.current_state.percentage != undefined) {
					reportVolume(json.current_state.percentage);
				}
			}
			if (callback) callback();
		});
	}


	function setVolumeViaACR(volume, callback) {
		// POST /api/volume/set with a percentage value.
		acr.setVolume(volume).then(result => {
			if (result && result.success != false) {
				newVolume = (result.new_state && result.new_state.percentage != undefined) ? result.new_state.percentage : volume;
				if (debug >= 2) console.log("ACR system volume set to "+newVolume+" %.");
				if (callback) callback(newVolume);
			} else {
				console.error("Error setting volume via ACR.");
				if (callback) callback(null, true);
			}
		});
	}

	function getVolumeViaACR(callback) {
		// GET /api/volume/state.
		acr.getVolumeState().then(json => {
			if (json && json.percentage != undefined) {
				if (callback) callback(json.percentage);
			} else {
				if (callback) callback(null, true);
			}
		});
	}

	// Volume changes made elsewhere (hardware buttons, other UIs) arrive on
	// the shared ACR event stream.
	acr.events.on("volume_changed", function(event) {
		percentage = undefined;
		if (event.percentage != undefined) percentage = event.percentage;
		else if (event.volume && event.volume.percentage != undefined) percentage = event.volume.percentage;
		else if (event.current_state && event.current_state.percentage != undefined) percentage = event.current_state.percentage;
		if (percentage != undefined) {
			if (debug >= 2) console.log("Volume received from ACR event stream: "+percentage+" %.");
			if (!acrVolumeAvailable) {
				acrVolumeAvailable = true;
				determineVolumeControl();
			}
			reportVolume(percentage);
		}
	});

	acr.events.on("connected", function() {
		// Resynchronise volume after (re)connecting to the event stream.
		if (!acrVolumeAvailable) {
			checkIfACRVolumeAvailable(function() {
				determineVolumeControl();
				getVolume();
			});
		} else {
			getVolume();
		}
	});

	function checkCurrentMixerAndReconfigure() {
		// hbosng port: mixer reconfiguration was a buildroot HiFiBerryOS
		// mechanism (reconfigure-players). ACR owns the volume pipeline now,
		// so there is nothing to reconfigure here.
		if (debug) console.log("checkCurrentMixerAndReconfigure: not applicable on this platform.");
	}
	
	function mapVolume(value, toFullScale) {
		if (toFullScale) { // From whatever range specified to 0-100.
			if (value == 0) value = volumeControlRange[0];
			return (value - volumeControlRange[0]) * 100 / (volumeControlRange[1] - volumeControlRange[0]);
		} else { // From 0-100 to whatever range specified.
			if (value == 0) {
				return 0;
			} else {
				return value * (volumeControlRange[1] - volumeControlRange[0]) / 100 + volumeControlRange[0];
			}
		}
	}
	
	function setVolumeControlRange(min = null, max = null) {
		if (min != null && max != null) {
			volumeControlRange[0] = min;
			volumeControlRange[1] = max;
			settings.volumeControlRange = volumeControlRange;
			beo.saveSettings("sound", settings);
			return volumeControlRange;
		} else {
			return false;
		}
	}
	
	function getVolumeControlRange() {
		return settings.volumeControlRange;
	}
	
	interact = {
		triggers: {
				volumeChanged: function(data, interactData) {
					if (!interactData || interactData.option == "any") {
						return data.volume;
					} else {
						if (interactData.option == "up" && data.up) {
							return data.volume;
						} else if (interactData.option == "down" && data.up == false) {
							return data.volume;
						} else {
							return undefined;
						}
					}
				}
			},
		actions: {
				setVolume: function(data, triggerResult, actionResult) {
					switch (data.option) {
						case "up":
							setVolume("+2");
							break;
						case "down":
							setVolume("-2");
							break;
						case "slider":
							setVolume(data.volume);
							break;
						case "result":
							setVolume(parseInt(triggerResult));
							break;
					}
				},
				mute: function(operation = undefined) {
					mute(operation);
				}
			}
	}
	
	
module.exports = {
	version: version,
	setVolume: setVolume,
	getVolume: getVolume,
	checkCurrentMixerAndReconfigure: checkCurrentMixerAndReconfigure,
	mute: mute,
	interact: interact,
	alsaSet: setVolumeViaACR, // hbosng port: kept for API compatibility, now routed to ACR.
	alsaGet: getVolumeViaACR,
	setVolumeControlRange: setVolumeControlRange,
	getVolumeControlRange: getVolumeControlRange
};




