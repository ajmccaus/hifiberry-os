// Test environment for the Beocreate-on-Debian port.
// Starts (and tears down) the mock ACR, a mock backlight sysfs directory and
// the Beocreate server itself, wired together through environment variables.

const {spawn, spawnSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");            // beocreate-debian/
const SERVER_DIR = path.join(ROOT, "server");
const MOCK_DIR = path.join(ROOT, "mock-backend");

const SERVER_PORT = 8080;
const ACR_PORT = 1080;

function httpGet(url) {
	return new Promise((resolve, reject) => {
		const req = http.get(url, res => {
			let data = "";
			res.on("data", chunk => data += chunk);
			res.on("end", () => resolve({status: res.statusCode, body: data}));
		});
		req.on("error", reject);
		req.setTimeout(2000, () => req.destroy(new Error("timeout")));
	});
}

function httpPost(url, body) {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : "";
		const req = http.request(url, {
			method: "POST",
			headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)}
		}, res => {
			let data = "";
			res.on("data", chunk => data += chunk);
			res.on("end", () => resolve({status: res.statusCode, body: data}));
		});
		req.on("error", reject);
		req.write(payload);
		req.end();
	});
}

async function waitFor(fn, description, timeoutMs = 20000, intervalMs = 200) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;
	while (Date.now() < deadline) {
		try {
			const result = await fn();
			if (result) return result;
		} catch (error) {
			lastError = error;
		}
		await new Promise(r => setTimeout(r, intervalMs));
	}
	throw new Error("Timed out waiting for " + description + (lastError ? " (" + lastError.message + ")" : ""));
}

class BeoEnv {

	// options.acrEnv: extra environment variables for the mock ACR process
	// (e.g. {MOCK_ACR_SPOTIFY_NAME: "librespot", MOCK_ACR_VOLUME_AVAILABLE: "0"}).
	constructor(options = {}) {
		this.acrEnv = options.acrEnv || {};
		this.acrProcess = null;
		this.serverProcess = null;
		this.workDir = null;
		this.configDir = null;
		this.backlightDir = null;
	}

	get acrURL() { return "http://127.0.0.1:" + ACR_PORT; }
	get serverURL() { return "http://127.0.0.1:" + SERVER_PORT; }
	get backlightDeviceDir() { return path.join(this.backlightDir, "mock-backlight"); }

	async start() {
		this.workDir = fs.mkdtempSync(path.join(os.tmpdir(), "beo-test-"));
		this.configDir = path.join(this.workDir, "config");
		this.backlightDir = path.join(this.workDir, "backlight");
		fs.mkdirSync(this.configDir, {recursive: true});

		// System configuration for the Beocreate server under test.
		fs.writeFileSync(path.join(this.configDir, "system.json"), JSON.stringify({
			cardType: "Beocreate 4-Channel Amplifier",
			cardFeatures: ["dsp", "arm7"],
			port: SERVER_PORT,
			acrAddress: this.acrURL
		}, null, "\t"));

		// Mock backlight sysfs.
		const result = spawnSync("node", [path.join(MOCK_DIR, "mock-backlight.js"), this.backlightDir], {stdio: "inherit"});
		if (result.status !== 0) throw new Error("mock-backlight.js failed");

		// Mock ACR.
		this.acrProcess = spawn("node", [path.join(MOCK_DIR, "mock-acr.js")], {
			env: Object.assign({}, process.env, {MOCK_ACR_PORT: String(ACR_PORT)}, this.acrEnv),
			stdio: ["ignore", "inherit", "inherit"]
		});
		await waitFor(async () => (await httpGet(this.acrURL + "/api/version")).status === 200, "mock ACR");

		await this.startServer();
	}

	async startServer() {
		// Fail fast if something else is already squatting on the port.
		let portTaken = false;
		try {
			await httpGet(this.serverURL + "/");
			portTaken = true;
		} catch (error) {}
		if (portTaken) throw new Error("Port " + SERVER_PORT + " is already in use; refusing to start beo-server.");

		this.serverProcess = spawn("node", [path.join(SERVER_DIR, "beo-system", "beo-server.js"), "v"], {
			cwd: SERVER_DIR,
			env: Object.assign({}, process.env, {
				BEO_CONFIG_DIR: this.configDir,
				BEO_ACR_ADDRESS: this.acrURL,
				BEO_BACKLIGHT_DIR: this.backlightDir
			}),
			stdio: ["ignore", "inherit", "inherit"]
		});
		await waitFor(async () => (await httpGet(this.serverURL + "/")).status === 200, "beo-server");
		// Give the extensions a moment to finish source registration.
		await new Promise(r => setTimeout(r, 2000));
	}

	async stopServer() {
		if (!this.serverProcess) return;
		const proc = this.serverProcess;
		this.serverProcess = null;
		if (proc.exitCode === null && proc.signalCode === null) {
			await new Promise(resolve => {
				proc.once("exit", resolve);
				proc.kill("SIGTERM");
				const killer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch (e) {} }, 5000);
				killer.unref && killer.unref();
			});
		}
		// Wait until the port is actually free again.
		await waitFor(async () => {
			try {
				await httpGet(this.serverURL + "/");
				return false;
			} catch (error) {
				return true;
			}
		}, "beo-server shutdown");
	}

	async restartServer() {
		await this.stopServer();
		await this.startServer();
	}

	async stop() {
		await this.stopServer().catch(() => {});
		if (this.acrProcess) {
			this.acrProcess.kill("SIGTERM");
			this.acrProcess = null;
		}
		if (this.workDir) fs.rmSync(this.workDir, {recursive: true, force: true});
	}

	// Mock ACR test hooks.
	async acrRequests() {
		const res = await httpGet(this.acrURL + "/__test/requests");
		return JSON.parse(res.body).requests;
	}

	async clearAcrRequests() {
		await httpPost(this.acrURL + "/__test/requests/clear");
	}

	async acrState() {
		const res = await httpGet(this.acrURL + "/__test/state");
		return JSON.parse(res.body);
	}

	async acrHook(pathname, body) {
		return httpPost(this.acrURL + pathname, body);
	}

	// Mock backlight helpers.
	readBrightness() {
		return parseInt(fs.readFileSync(path.join(this.backlightDeviceDir, "brightness"), "utf8").trim());
	}

	writeBrightness(value) {
		fs.writeFileSync(path.join(this.backlightDeviceDir, "brightness"), String(value));
	}

	readScreenSettings() {
		const file = path.join(this.configDir, "screen.json");
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf8"));
	}

	writeScreenSettings(settings) {
		fs.writeFileSync(path.join(this.configDir, "screen.json"), JSON.stringify(settings));
	}
}

module.exports = {BeoEnv, waitFor, httpGet, httpPost};
