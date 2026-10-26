// Criteria 37-40 of beocreate-debian/PORTING.md (ADR 0001): the shipped nginx
// site, package/beocreate.nginx, in front of the real server in the device
// layout (nginx :8080, beo-server listenPort 8081). Only the gateway's address
// is remapped (and `listen [::]` dropped where there is no IPv6). The verify
// endpoint is a stub that applies the shipped manifest
// (package/beocreate-auth.json: its prefix -> its tier, anything else risky,
// the gateway's fail-safe) under a policy the test sets: "risky" lets tier ok
// through without a session, "all" lets nothing through without one. It
// stands in for hifiberry-auth's own TierMap/decide(), which is not in this
// repo. "LAN" requests come from 127.0.0.2: every address but 127.0.0.1/::1 is
// gated. Skipped when nginx is not installed.
// 37. LAN under policy risky: 200 and WebSocket 101, the gateway seeing
//     /api/beocreate<uri>; LAN under all: 302 to http://<host>/ without a
//     session, 200 with one; loopback: 200 under all with no subrequest; auth
//     backend down: LAN 500 (fails closed), loopback still 200.
// 38. Through nginx the WebSocket refuses a cross-site Origin (403) and accepts
//     the same origin (101: Host reaches the server with its port), and the UI
//     loads and connects in Chromium.
// 39. Responses forbid cross-site framing: X-Frame-Options SAMEORIGIN and
//     Content-Security-Policy frame-ancestors 'self', also on the sign-in 302.
// 40. While beo-server is down nginx answers with a page that reloads itself
//     (the keyboardless kiosk recovers); once it is back, the UI.

const {test, expect} = require("@playwright/test");
const {spawn} = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const {BeoEnv, waitFor, SERVER_PORT} = require("./helpers/beo-env");
const {openApp} = require("./helpers/ui");

const PACKAGE_DIR = path.resolve(__dirname, "..", "package");
const LAN = "127.0.0.2";
const LAN_HOST = "beocreate.test:" + SERVER_PORT;
const LOOPBACK_HOST = "127.0.0.1:" + SERVER_PORT;
const NGINX = ["/usr/sbin/nginx", "/usr/bin/nginx"].find(p => fs.existsSync(p));

test.skip(!NGINX, "nginx is not installed");
test.describe.configure({mode: "serial"});

// The gateway's verify endpoint, deciding by the shipped manifest.
class AuthStub {
	constructor() {
		this.policy = "risky";
		this.log = []; // One entry per subrequest: {uri, method, session}.
		this.manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "beocreate-auth.json"), "utf8"));
		this.port = 0;
	}
	tier(uri) {
		return uri.startsWith(this.manifest.match_prefix) ? this.manifest.default_tier : "risky";
	}
	start() {
		this.server = http.createServer((req, res) => {
			const uri = req.headers["x-original-uri"] || "";
			const session = /(^|;\s*)session=valid(;|$)/.test(req.headers.cookie || "");
			this.log.push({uri: uri, method: req.headers["x-original-method"], session: session});
			const allowed = session || (this.policy === "risky" && this.tier(uri) === "ok");
			res.writeHead(allowed ? 200 : 401);
			res.end();
		});
		return new Promise(resolve => this.server.listen(this.port, "127.0.0.1", () => {
			this.port = this.server.address().port;
			resolve();
		}));
	}
	stop() {
		return new Promise(resolve => {
			this.server.close(resolve);
			this.server.closeAllConnections();
		});
	}
}

function ipv6Available() {
	return new Promise(resolve => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.listen(0, "::1", () => probe.close(() => resolve(true)));
	});
}

// The shipped site with the gateway on authPort, under a minimal nginx.conf.
async function startNginx(dir, authPort) {
	let site = fs.readFileSync(path.join(PACKAGE_DIR, "beocreate.nginx"), "utf8");
	const remapped = site.replace("http://127.0.0.1:1089/", "http://127.0.0.1:" + authPort + "/");
	if (remapped === site) throw new Error("beocreate.nginx no longer names the gateway at 127.0.0.1:1089");
	site = remapped;
	if (!(await ipv6Available())) site = site.replace(/ listen \[::\]:8080;/, "");
	fs.writeFileSync(path.join(dir, "beocreate.conf"), site);
	const temp = ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map(t => t + "_temp_path " + path.join(dir, t) + ";").join(" ");
	fs.writeFileSync(path.join(dir, "nginx.conf"),
		(process.getuid && process.getuid() === 0 ? "user root;\n" : "") +
		"worker_processes 1;\npid " + path.join(dir, "nginx.pid") + ";\nerror_log " + path.join(dir, "error.log") + ";\n" +
		"events { worker_connections 64; }\n" +
		"http { access_log off; " + temp + " include " + path.join(dir, "beocreate.conf") + "; }\n");
	const proc = spawn(NGINX, ["-p", dir, "-c", path.join(dir, "nginx.conf"), "-g", "daemon off;"], {stdio: ["ignore", "inherit", "inherit"]});
	await waitFor(() => new Promise(resolve => {
		const socket = net.connect({host: "127.0.0.1", port: SERVER_PORT}, () => { socket.destroy(); resolve(true); });
		socket.on("error", () => resolve(false));
	}), "nginx on :" + SERVER_PORT, 10000);
	return proc;
}

// One HTTP request to nginx from address `from`; WebSocket upgrades resolve 101.
function request(from, options = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: "127.0.0.1",
			port: SERVER_PORT,
			path: options.path || "/",
			localAddress: from,
			headers: Object.assign({Host: (from === LAN) ? LAN_HOST : LOOPBACK_HOST}, options.headers || {})
		});
		req.on("upgrade", (res, socket) => { socket.destroy(); resolve({status: res.statusCode, headers: res.headers, body: ""}); });
		req.on("response", res => {
			let body = "";
			res.on("data", chunk => body += chunk);
			res.on("end", () => resolve({status: res.statusCode, headers: res.headers, body: body}));
		});
		req.on("error", reject);
		req.setTimeout(5000, () => req.destroy(new Error("timeout")));
		req.end();
	});
}

function upgrade(from, origin) {
	return request(from, {headers: {
		"Connection": "Upgrade",
		"Upgrade": "websocket",
		"Sec-WebSocket-Version": "13",
		"Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
		"Sec-WebSocket-Protocol": "beocreate",
		"Origin": origin
	}});
}

let env = null;
let auth = null;
let nginx = null;
let workDir = null;

test.beforeAll(async () => {
	auth = new AuthStub();
	await auth.start();
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "beo-nginx-"));
	nginx = await startNginx(workDir, auth.port);
	// After nginx: a server that listened on the public port would now fail.
	env = new BeoEnv({listenPort: 8081});
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
	if (nginx) {
		const proc = nginx;
		await new Promise(resolve => { proc.once("exit", resolve); proc.kill("SIGQUIT"); });
	}
	if (auth && auth.server.listening) await auth.stop();
	if (workDir) fs.rmSync(workDir, {recursive: true, force: true});
});

test("37. the gate: LAN by policy and manifest tier, loopback never asked", async () => {
	auth.policy = "risky";
	auth.log.length = 0;
	let res = await request(LAN);
	expect(res.status).toBe(200);
	expect(res.body).toContain('id="player-bar"');
	expect(auth.log).toEqual([{uri: "/api/beocreate/", method: "GET", session: false}]);
	expect((await upgrade(LAN, "http://" + LAN_HOST)).status).toBe(101);

	auth.policy = "all";
	res = await request(LAN);
	expect(res.status).toBe(302);
	expect(res.headers.location).toBe("http://beocreate.test/");
	expect((await request(LAN, {headers: {Cookie: "session=valid"}})).status).toBe(200);

	const asked = auth.log.length;
	expect((await request("127.0.0.1")).status).toBe(200);
	expect((await upgrade("127.0.0.1", "http://" + LOOPBACK_HOST)).status).toBe(101);
	expect(auth.log.length).toBe(asked);

	await auth.stop();
	try {
		expect((await request(LAN)).status).toBe(500);
		expect((await request("127.0.0.1")).status).toBe(200);
	} finally {
		await auth.start(); // Same port: the site names it.
	}
});

test("38. through nginx the WebSocket keeps its Origin check and the UI connects", async ({page}) => {
	expect((await upgrade("127.0.0.1", "http://evil.example")).status).toBe(403);
	expect((await upgrade("127.0.0.1", "http://" + LOOPBACK_HOST)).status).toBe(101);
	await openApp(page); // baseURL is :8080, i.e. nginx.
	await expect(page.locator("#track-string .title")).toHaveText("Mock Song Title", {timeout: 15000});
});

test("39. responses forbid cross-site framing", async () => {
	auth.policy = "all";
	for (const res of [await request("127.0.0.1"), await request(LAN)]) {
		expect([200, 302]).toContain(res.status);
		expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
		expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'self'");
	}
	auth.policy = "risky";
});

test("40. while beo-server is down the kiosk gets a page that reloads itself", async () => {
	await env.stopServer();
	const res = await request("127.0.0.1", {path: "/?dark"});
	expect(res.status).toBe(502);
	expect(res.headers["content-type"]).toContain("text/html");
	expect(res.body).toMatch(/<meta http-equiv="refresh" content="\d+">/);
	await env.startServer();
	expect((await request("127.0.0.1", {path: "/?dark"})).status).toBe(200);
});
