/*Copyright 2024 HiFiBerry
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

// BEOCREATE SCREEN EXTENSION (hbosng)
// Brightness slider for an attached display (ADR 0002). The mode is queried
// per use (once per drag) with `systemctl show -p LoadState --value
// touch-timeout.service`:
// - daemon mode ("loaded"): touch-timeout is the only backlight writer. This
//   extension never writes sysfs; the settled level reaches the daemon as
//   BEO_SCREEN_ARGS=-b <raw> in <dataDirectory>/touch-timeout.env (read by the
//   drop-in package/touch-timeout-brightness.conf) plus a restart. Playback
//   starting from standby wakes the daemon with SIGUSR1.
// - direct mode (anything else, or systemctl fails): writes the backlight
//   sysfs (/sys/class/backlight, overridable with BEO_BACKLIGHT_DIR) itself
//   and restores the level at startup.
// The UI always shows the persisted level (screen.json), never sysfs, which
// holds the dim level while touch-timeout has the screen dimmed. systemctl is
// BEO_SYSTEMCTL (default "systemctl"; the test seam), run without a shell.

var fs = require("fs");
var path = require("path");
var execFile = require("child_process").execFile;

var debug = beo.debug;
var version = require("./package.json").version;

var defaultSettings = {
	"brightness": 75 // Percent.
};
var settings = JSON.parse(JSON.stringify(defaultSettings));

var backlightRoot = process.env.BEO_BACKLIGHT_DIR || "/sys/class/backlight";
var backlightDirectory = null; // Full path of the detected backlight device.
var maxBrightness = 255;

var daemonEnvFile = path.join(beo.dataDirectory, "touch-timeout.env");

// Floor and ceiling in raw backlight units, the same in both modes:
// touch-timeout's -b accepts 15-255 and silently runs its default (150)
// outside it. The floor also keeps a persisted 0 from leaving the kiosk dark
// with no on-device recovery; switching the display off belongs to
// touch-timeout. The persisted floor is the smallest percentage mapping to
// at least MINIMUM_RAW.
var MINIMUM_RAW = 15;
var MAXIMUM_RAW = 255;

// Slide and stop send the same message, so release is detected server-side:
// no message for this long means the slider has settled.
var SETTLE_MS = 500;
var settleTimer = null;
var dragDaemonMode = null; // Promise of the mode, queried once per drag.

function systemctl(args, callback) {
	execFile(process.env.BEO_SYSTEMCTL || "systemctl", args, function(error, stdout) {
		if (error && debug) console.log("'systemctl "+args.join(" ")+"' failed: "+error.message.trim());
		if (callback) callback(error, stdout);
	});
}

function daemonMode() {
	return new Promise(function(resolve) {
		systemctl(["show", "-p", "LoadState", "--value", "touch-timeout.service"], function(error, stdout) {
			resolve(!error && String(stdout).trim() == "loaded");
		});
	});
}

function detectBacklight() {
	// Auto-detect the first backlight device (same approach as touch-timeout).
	backlightDirectory = null;
	try {
		if (fs.existsSync(backlightRoot)) {
			entries = fs.readdirSync(backlightRoot);
			for (var i = 0; i < entries.length; i++) {
				candidate = path.join(backlightRoot, entries[i]);
				if (fs.existsSync(path.join(candidate, "brightness")) &&
					fs.existsSync(path.join(candidate, "max_brightness"))) {
					backlightDirectory = candidate;
					break;
				}
			}
		}
	} catch (error) {
		console.error("Error detecting backlight devices:", error);
	}
	if (backlightDirectory) {
		try {
			maxBrightness = parseInt(fs.readFileSync(path.join(backlightDirectory, "max_brightness"), "utf8").trim());
			if (isNaN(maxBrightness) || maxBrightness <= 0) maxBrightness = 255;
			if (debug) console.log("Backlight device found at '"+backlightDirectory+"' (max brightness "+maxBrightness+").");
		} catch (error) {
			console.error("Error reading backlight maximum brightness:", error);
			backlightDirectory = null;
		}
	} else {
		if (debug) console.log("No backlight devices found at '"+backlightRoot+"'.");
	}
	return backlightDirectory;
}

// Clamps to [floor, 100] percent; null if the value is not a number.
function clampPercentage(percentage) {
	percentage = parseFloat(percentage);
	if (isNaN(percentage)) return null;
	return Math.max(Math.ceil(MINIMUM_RAW * 100 / maxBrightness), Math.min(100, percentage));
}

function rawBrightness(percentage) {
	return Math.max(MINIMUM_RAW, Math.min(MAXIMUM_RAW, Math.round(percentage * maxBrightness / 100)));
}

// Direct mode only.
function writeBacklight(percentage) {
	if (!backlightDirectory) return;
	var raw = rawBrightness(percentage);
	try {
		fs.writeFileSync(path.join(backlightDirectory, "brightness"), String(raw));
		if (debug >= 2) console.log("Screen brightness set to "+percentage+" % ("+raw+"/"+maxBrightness+").");
	} catch (error) {
		console.error("Error writing screen brightness:", error);
	}
}

// Daemon mode only: hand the persisted level to touch-timeout. The env file is
// replaced atomically (temp + rename) so the daemon never reads half of it.
function updateDaemon(restartIfUnchanged) {
	var content = "BEO_SCREEN_ARGS=-b "+rawBrightness(settings.brightness)+"\n";
	var current = null;
	try {
		current = fs.readFileSync(daemonEnvFile, "utf8");
	} catch (error) {} // Missing: written below.
	if (current == content && !restartIfUnchanged) return;
	if (current != content) {
		try {
			fs.writeFileSync(daemonEnvFile+".tmp", content);
			fs.renameSync(daemonEnvFile+".tmp", daemonEnvFile);
		} catch (error) {
			console.error("Error writing touch-timeout arguments:", error);
			return;
		}
	}
	systemctl(["restart", "touch-timeout.service"]);
}

function setBrightness(percentage) {
	if (!backlightDirectory) detectBacklight();
	percentage = clampPercentage(percentage);
	if (backlightDirectory && percentage != null) {
		settings.brightness = percentage;
		if (!dragDaemonMode) dragDaemonMode = daemonMode();
		dragDaemonMode.then(function(daemon) {
			// The latest level, not this message's: it may have moved on meanwhile.
			if (!daemon) writeBacklight(settings.brightness);
		});
		clearTimeout(settleTimer);
		settleTimer = setTimeout(settleBrightness, SETTLE_MS);
	}
	sendBrightnessToUI();
}

function settleBrightness() {
	var mode = dragDaemonMode;
	dragDaemonMode = null;
	settleTimer = null;
	beo.saveSettings("screen", settings, true); // Once per drag, not per tick (SD card).
	mode.then(function(daemon) {
		if (daemon) updateDaemon(true);
	});
}

function sendBrightnessToUI() {
	if (!backlightDirectory) detectBacklight();
	beo.sendToUI("screen", {header: "brightness", content: {
		brightness: settings.brightness,
		available: (backlightDirectory) ? true : false
	}});
}

beo.bus.on('general', function(event) {

	if (event.header == "startup") {
		detectBacklight();
		if (backlightDirectory) {
			// A persisted level below the floor (older version, hand-edited
			// file) is clamped up so the screen is never restored to black.
			var level = clampPercentage(settings.brightness);
			if (level == null) level = defaultSettings.brightness;
			if (level != settings.brightness) {
				settings.brightness = level;
				beo.saveSettings("screen", settings, true);
			}
			daemonMode().then(function(daemon) {
				if (daemon) {
					updateDaemon(false);
				} else {
					writeBacklight(settings.brightness);
				}
			});
		}
	}

	if (event.header == "activatedExtension") {
		if (event.content.extension == "screen") {
			sendBrightnessToUI();
		}
	}
});

beo.bus.on("sources", function(event) {
	// Playback starting from standby wakes a dimmed or blanked screen.
	if (event.header == "sourcesChanged" &&
		event.content.fromStandby && event.content.currentSource) {
		daemonMode().then(function(daemon) {
			// Errors are ignored: e.g. the daemon is not running this boot.
			if (daemon) systemctl(["kill", "--signal=SIGUSR1", "touch-timeout.service"]);
		});
	}
});

beo.bus.on("screen", function(event) {

	switch (event.header) {
		case "settings":
			if (event.content.settings) {
				settings = Object.assign(settings, event.content.settings);
			}
			break;
		case "getBrightness":
			sendBrightnessToUI();
			break;
		case "setBrightness":
			brightness = undefined;
			if (event.content != undefined) {
				if (typeof event.content == "number") {
					brightness = event.content;
				} else if (event.content.percentage != undefined) {
					brightness = event.content.percentage;
				} else if (event.content.brightness != undefined) {
					brightness = event.content.brightness;
				}
			}
			if (brightness != undefined) setBrightness(brightness);
			break;
	}
});

module.exports = {
	version: version
};
