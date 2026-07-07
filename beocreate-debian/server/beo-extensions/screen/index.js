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
// Controls the brightness of an attached display through the Linux backlight
// sysfs interface (/sys/class/backlight, overridable with BEO_BACKLIGHT_DIR).

var fs = require("fs");
var path = require("path");

var debug = beo.debug;
var version = require("./package.json").version;

var defaultSettings = {
	"brightness": 75 // Percent.
};
var settings = JSON.parse(JSON.stringify(defaultSettings));

var backlightRoot = process.env.BEO_BACKLIGHT_DIR || "/sys/class/backlight";
var backlightDirectory = null; // Full path of the detected backlight device.
var maxBrightness = 255;

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

function applyBrightness(percentage, save) {
	if (percentage == undefined || isNaN(parseFloat(percentage))) return false;
	percentage = parseFloat(percentage);
	if (percentage < 0) percentage = 0;
	if (percentage > 100) percentage = 100;
	if (!backlightDirectory) detectBacklight();
	if (backlightDirectory) {
		scaled = Math.round(percentage / 100 * maxBrightness);
		try {
			fs.writeFileSync(path.join(backlightDirectory, "brightness"), String(scaled));
			if (debug >= 2) console.log("Screen brightness set to "+percentage+" % ("+scaled+"/"+maxBrightness+").");
		} catch (error) {
			console.error("Error writing screen brightness:", error);
			return false;
		}
		settings.brightness = percentage;
		if (save) beo.saveSettings("screen", settings, true); // Save immediately so the level survives restarts.
		return true;
	}
	return false;
}

function getBrightness() {
	if (!backlightDirectory) detectBacklight();
	if (backlightDirectory) {
		try {
			raw = parseInt(fs.readFileSync(path.join(backlightDirectory, "brightness"), "utf8").trim());
			if (!isNaN(raw)) return Math.round(raw / maxBrightness * 100);
		} catch (error) {
			console.error("Error reading screen brightness:", error);
		}
	}
	return null;
}

function sendBrightnessToUI() {
	brightness = getBrightness();
	beo.sendToUI("screen", {header: "brightness", content: {
		brightness: (brightness != null) ? brightness : settings.brightness,
		available: (backlightDirectory) ? true : false
	}});
}

beo.bus.on('general', function(event) {

	if (event.header == "startup") {
		detectBacklight();
		// Restore the persisted brightness level.
		if (backlightDirectory && settings.brightness != undefined) {
			applyBrightness(settings.brightness, false);
		}
	}

	if (event.header == "activatedExtension") {
		if (event.content.extension == "screen") {
			sendBrightnessToUI();
		}
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
			if (brightness != undefined) {
				if (applyBrightness(brightness, true)) {
					beo.sendToUI("screen", {header: "brightness", content: {brightness: settings.brightness, available: true}});
				} else {
					beo.sendToUI("screen", {header: "brightness", content: {brightness: settings.brightness, available: false}});
				}
			}
			break;
	}
});

module.exports = {
	version: version,
	setBrightness: applyBrightness,
	getBrightness: getBrightness
};
