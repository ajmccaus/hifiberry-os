/* Mock backlight sysfs for Beocreate-on-Debian tests.

Creates a fake /sys/class/backlight-style directory tree:
  <dir>/mock-backlight/brightness         (read/write, initial 128)
  <dir>/mock-backlight/max_brightness     (255)
  <dir>/mock-backlight/actual_brightness  (mirrors brightness)

Usage: node mock-backlight.js <target-directory>
The Beocreate screen extension is pointed at it with BEO_BACKLIGHT_DIR.
This script only sets up the files and exits; the "device" is plain files.
*/

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
	console.error("Usage: node mock-backlight.js <target-directory>");
	process.exit(1);
}

const deviceDir = path.join(target, "mock-backlight");
fs.mkdirSync(deviceDir, {recursive: true});
fs.writeFileSync(path.join(deviceDir, "max_brightness"), "255\n");
if (!fs.existsSync(path.join(deviceDir, "brightness"))) {
	fs.writeFileSync(path.join(deviceDir, "brightness"), "128\n");
}
fs.writeFileSync(path.join(deviceDir, "actual_brightness"),
	fs.readFileSync(path.join(deviceDir, "brightness")));

console.log("Mock backlight created at " + deviceDir);
