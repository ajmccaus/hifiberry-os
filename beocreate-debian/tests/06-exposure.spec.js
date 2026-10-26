// Criteria 13-15 of beocreate-debian/PORTING.md (ADR 0001, docs/decisions/):
// 13. The WebSocket refuses a cross-site Origin (and the opaque "null"), also
//     one on the same hostname but another port; a same-origin client and an
//     Origin-less (non-browser) client still connect.
// 14. The REST POST route is gone: POST /general-settings/restartProduct is 404.
// 15. The server is not reachable on the machine's LAN address (loopback only).
// 20. A rename reaches hostnamectl as argv, never through a shell: the pretty
//     name arrives as one argument exactly as typed (quotes, $, & and ;
//     included); the static name keeps only [a-z0-9-].
// 21. The WebSocket cannot reach the settings writer: a settings/saveSettings
//     message leaves system.json byte-for-byte unchanged.
// 22. The artwork proxy relays only ACR's image routes: any other ACR path,
//     also one reached through dot segments, is 404 and never reaches ACR.
// 30. The device layout (system.json port 8080, listenPort 8081): the server
//     answers on 127.0.0.1:8081 and nothing of it accepts on :8080, which
//     belongs to nginx.
// 31. With server.key/server.cert present the HTTPS listener runs, on loopback
//     only: it answers on 127.0.0.1 and is refused on the LAN address.

const {test, expect} = require("@playwright/test");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const os = require("os");
const tls = require("tls");
const {execFileSync} = require("child_process");
const {BeoEnv, httpGet, httpPost, waitFor, SERVER_PORT} = require("./helpers/beo-env");
const {openApp} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;
let server;

test.beforeAll(async () => {
	env = new BeoEnv();
	await env.start();
	server = new URL(env.serverURL);
});

test.afterAll(async () => {
	if (env) await env.stop();
});

// Raw WebSocket handshake; resolves with the HTTP status (101 = accepted).
function upgradeStatus(extraHeaders) {
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: server.hostname,
			port: server.port,
			path: "/",
			headers: Object.assign({
				"Connection": "Upgrade",
				"Upgrade": "websocket",
				"Sec-WebSocket-Version": "13",
				"Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
				"Sec-WebSocket-Protocol": "beocreate"
			}, extraHeaders)
		});
		req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
		req.on("response", res => { res.resume(); resolve(res.statusCode); });
		req.on("error", reject);
		req.setTimeout(5000, () => req.destroy(new Error("timeout")));
		req.end();
	});
}

test("13. the WebSocket refuses a foreign Origin and accepts a same-origin client", async ({page}) => {
	expect(await upgradeStatus({"Origin": "http://evil.example"})).toBe(403);
	expect(await upgradeStatus({"Origin": "null"})).toBe(403);
	expect(await upgradeStatus({"Origin": "http://" + server.hostname + ":9"})).toBe(403);
	expect(await upgradeStatus({"Origin": "http://" + server.host})).toBe(101);
	expect(await upgradeStatus({})).toBe(101);

	// A real browser on the app's own origin still opens the socket.
	await openApp(page);
	const opened = await page.evaluate(() => new Promise(resolve => {
		const ws = new WebSocket("ws://" + location.host, "beocreate");
		ws.onopen = () => { ws.close(); resolve(true); };
		ws.onerror = () => resolve(false);
	}));
	expect(opened).toBe(true);
});

test("14. POST /general-settings/restartProduct is 404", async () => {
	const res = await httpPost(env.serverURL + "/general-settings/restartProduct", {});
	expect(res.status).toBe(404);
});

function lanAddress() {
	const lan = Object.values(os.networkInterfaces()).flat()
		.find(a => a && a.family === "IPv4" && !a.internal);
	return lan ? lan.address : null;
}

// Resolves "connected", "timeout" or the connect error code.
function tcpOutcome(host, port) {
	return new Promise(resolve => {
		const socket = net.connect({host: host, port: Number(port)});
		socket.setTimeout(3000, () => { socket.destroy(); resolve("timeout"); });
		socket.on("connect", () => { socket.destroy(); resolve("connected"); });
		socket.on("error", error => resolve(error.code));
	});
}

test("15. the server does not listen on the machine's LAN address", async () => {
	const lan = lanAddress();
	test.skip(!lan, "no non-internal IPv4 address on this machine");
	expect(await tcpOutcome(lan, server.port)).toBe("ECONNREFUSED");
});

test("20. a rename reaches hostnamectl as one literal argument per name", async () => {
	const name = 'Kitchen "Hi-Fi" $HOME & Co.; ok';
	await env.wsSend([{target: "product-information", header: "setSystemName", content: {newSystemName: name}}]);
	// The calls after the pretty name: startup also names the system.
	const calls = await waitFor(async () => {
		const log = env.readHostnamectlLog();
		const at = log.findIndex(args => args[1] === "--pretty" && args[2] === name);
		return (at != -1 && log.slice(at).some(args => args[1] === "--static")) ? log.slice(at) : null;
	}, "hostnamectl to be called for both names");
	expect(calls[0]).toEqual(["set-hostname", "--pretty", name]);
	expect(calls).toContainEqual(["set-hostname", "--static", "kitchen-hi-fi-home--co--ok"]);
});

test("21. a settings/saveSettings message over the WebSocket writes nothing", async () => {
	const file = path.join(env.configDir, "system.json");
	const before = fs.readFileSync(file, "utf8");
	const settings = Object.assign(JSON.parse(before), {cardType: "Changed over the WebSocket"});
	await env.wsSend([{target: "settings", header: "saveSettings", content: {extension: "system", settings: settings, immediately: true}}]);
	expect(fs.readFileSync(file, "utf8")).toBe(before);
	expect(fs.existsSync(path.join(env.configDir, "probe.json"))).toBe(false);
	await env.wsSend([{target: "settings", header: "saveSettings", content: {extension: "probe", settings: {}, immediately: true}}]);
	expect(fs.existsSync(path.join(env.configDir, "probe.json"))).toBe(false);
});

test("22. the artwork proxy relays only ACR's image routes", async () => {
	await env.clearAcrRequests();
	for (const remote of ["/api/spotify/access_token", "/api/imagecache/../spotify/access_token",
		"/api/imagecache/%2e%2e/spotify/access_token", "/api/library/mpd/refresh", "/api/version"]) {
		expect((await httpGet(env.serverURL + "/acr-artwork" + remote)).status, remote).toBe(404);
	}
	expect((await httpGet(env.serverURL + "/acr-artwork/api/imagecache/mock.png")).status).toBe(200);
	const reached = (await env.acrRequests()).map(r => r.method + " " + r.path);
	expect(reached).toEqual(["GET /api/imagecache/mock.png"]);
});

// 30-31 replace the env above with the device layout.
test("30. with listenPort 8081 the server leaves the public port 8080 to nginx", async () => {
	await env.stop();
	env = new BeoEnv({listenPort: 8081});
	await env.start();
	expect((await httpGet("http://127.0.0.1:8081/")).status).toBe(200);
	expect(await tcpOutcome("127.0.0.1", SERVER_PORT)).toBe("ECONNREFUSED");
});

test("31. the HTTPS listener binds loopback only", async () => {
	const HTTPS_PORT = 8443;
	await env.stop();
	env = new BeoEnv();
	env.setup();
	const config = path.join(env.configDir, "system.json");
	fs.writeFileSync(config, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(config, "utf8")), {httpsPort: HTTPS_PORT})));
	execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
		"-keyout", path.join(env.configDir, "server.key"), "-out", path.join(env.configDir, "server.cert")], {stdio: "ignore"});
	await env.startAcr();
	await env.startServer();

	// The listener runs (TLS handshake on loopback) ...
	const handshake = await new Promise(resolve => {
		const socket = tls.connect({host: "127.0.0.1", port: HTTPS_PORT, rejectUnauthorized: false}, () => { socket.destroy(); resolve("tls"); });
		socket.on("error", error => resolve(error.code));
	});
	expect(handshake).toBe("tls");
	// ... and not on the LAN address.
	const lan = lanAddress();
	test.skip(!lan, "no non-internal IPv4 address on this machine");
	expect(await tcpOutcome(lan, HTTPS_PORT)).toBe("ECONNREFUSED");
});
