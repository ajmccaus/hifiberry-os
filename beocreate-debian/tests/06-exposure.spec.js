// Criteria 13-15 of beocreate-debian/PORTING.md (ADR 0001, docs/decisions/):
// 13. The WebSocket refuses a cross-site Origin (and the opaque "null");
//     a same-origin client and an Origin-less (non-browser) client still connect.
// 14. The REST POST route is gone: POST /general-settings/restartProduct is 404.
// 15. The server is not reachable on the machine's LAN address (loopback only).

const {test, expect} = require("@playwright/test");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const os = require("os");
const {BeoEnv, httpPost} = require("./helpers/beo-env");
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

test("15. the server does not listen on the machine's LAN address", async () => {
	const lan = Object.values(os.networkInterfaces()).flat()
		.find(a => a && a.family === "IPv4" && !a.internal);
	test.skip(!lan, "no non-internal IPv4 address on this machine");

	const outcome = await new Promise(resolve => {
		const socket = net.connect({host: lan.address, port: Number(server.port)});
		socket.setTimeout(3000, () => { socket.destroy(); resolve("timeout"); });
		socket.on("connect", () => { socket.destroy(); resolve("connected"); });
		socket.on("error", error => resolve(error.code));
	});
	expect(outcome).toBe("ECONNREFUSED");
});
