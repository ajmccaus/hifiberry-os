// Playwright configuration for the Beocreate-on-Debian port tests.
// The suite starts its own beo-server + mock ACR + mock backlight per spec
// file (see helpers/beo-env.js), so tests must not run in parallel.

const {defineConfig} = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// Use the preinstalled Chromium if the pinned Playwright browser build is not
// present (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD environments).
function findChromium() {
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!root || !fs.existsSync(root)) return undefined;
	const entries = fs.readdirSync(root).filter(e => e.startsWith("chromium-")).sort();
	for (const entry of entries.reverse()) {
		for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
			const candidate = path.join(root, entry, sub);
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

const executablePath = findChromium();

module.exports = defineConfig({
	testDir: __dirname,
	timeout: 60000,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:8080",
		viewport: {width: 1280, height: 800},
		launchOptions: executablePath ? {executablePath: executablePath} : {}
	}
});
