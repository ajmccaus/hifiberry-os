/* Mock backlight sysfs for Beocreate-on-Debian tests.

Creates a fake /sys/class/backlight-style directory tree:
  <dir>/<name>/brightness         (read/write, initial 128, at most max)
  <dir>/<name>/max_brightness     (MOCK_BACKLIGHT_MAX, default 255)
  <dir>/<name>/actual_brightness  (mirrors brightness)

Usage: node mock-backlight.js <target-directory> [<name>]   (name default
"mock-backlight"; run again with another name for a second device)
The Beocreate screen extension is pointed at it with BEO_BACKLIGHT_DIR.
This script only sets up the files and exits; the "device" is plain files.
*/

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
	console.error("Usage: node mock-backlight.js <target-directory> [<name>]");
	process.exit(1);
}
const max = parseInt(process.env.MOCK_BACKLIGHT_MAX || "255", 10);

const deviceDir = path.join(target, process.argv[3] || "mock-backlight");
fs.mkdirSync(deviceDir, {recursive: true});
fs.writeFileSync(path.join(deviceDir, "max_brightness"), max + "\n");
if (!fs.existsSync(path.join(deviceDir, "brightness"))) {
	fs.writeFileSync(path.join(deviceDir, "brightness"), Math.min(128, max) + "\n");
}
fs.writeFileSync(path.join(deviceDir, "actual_brightness"),
	fs.readFileSync(path.join(deviceDir, "brightness")));

console.log("Mock backlight created at " + deviceDir);
