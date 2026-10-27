// Criteria 27-29 of beocreate-debian/PORTING.md:
// 27. Shut Down runs `systemctl poweroff` (Debian has no buildroot
//     shutdown-system); when that fails the server exits non-zero, so
//     systemd (Restart=always) brings the UI back.
// 28. ACR starting after the server: once the event stream connects, the
//     sources ACR reports are enabled again and the playing one is current.
// 29. Transport capabilities come from GET /api/players: a player that does
//     not report `next` gets no next button, also after a pushed state change.
// 35. A failing ACR volume read or write (a read answers 503 while the control
//     is unavailable, a write 200 with success:false; src/api/volume.rs) keeps
//     the last known volume: the UI is never told 0.
// 42. An ACR {"type": "error"} event-stream frame (websocket.md) is logged; the
//     server keeps running.
// 46. Messages that ran buildroot-only scripts on NG (an MPD database update)
//     leave the server running.
// 47. The service is announced through avahi: `avahi-publish -s <name>
//     _beocreate._tcp <port> <txt>...` as argv, stopped at shutdown, and the
//     server itself holds no UDP socket (no mDNS responder of its own).

const {test, expect} = require("@playwright/test");
const {execFileSync} = require("child_process");
const {BeoEnv, waitFor, httpGet, SERVER_PORT} = require("./helpers/beo-env");
const {openApp, showNowPlaying} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env = null;

test.afterEach(async () => {
	if (env) await env.stop();
	env = null;
});

const SHUTDOWN = {target: "general-settings", header: "shutdownProduct"};

function getSources() {
	return env.wsSend([{target: "sources", header: "getSources"}],
		data => data.target === "sources" && data.header === "sources");
}

test("27. Shut Down powers off through systemctl; a failure exits the server", async () => {
	env = new BeoEnv();
	await env.start();
	await env.wsSend([SHUTDOWN]);
	await waitFor(async () => env.readSystemctlLog().includes("poweroff"), "systemctl poweroff");
	await env.stop();

	env = new BeoEnv({systemctlExit: 1});
	await env.start();
	await env.wsSend([SHUTDOWN]);
	const code = await Promise.race([env.serverExit, new Promise(r => setTimeout(() => r("still running"), 20000))]);
	expect(code).toBe(1);
});

test("28. sources come back once ACR, started after the server, connects", async () => {
	env = new BeoEnv();
	env.setup();
	await env.startServer(); // ACR unreachable: enablement falls back to systemd.
	expect((await getSources()).content.sources.spotify.enabled).toBe(false);

	await env.startAcr();
	await waitFor(async () => {
		const sources = (await getSources()).content;
		return sources.sources.spotify.enabled && sources.currentSource === "spotify";
	}, "spotify enabled and current after ACR connected", 45000, 1000);
});

test("29. a player without `next` in its capabilities shows no next button", async ({page}) => {
	env = new BeoEnv({acrEnv: {MOCK_ACR_SPOTIFY_CAPABILITIES: "play,pause,play_pause,stop"}});
	await env.start();
	await openApp(page);
	await showNowPlaying(page);
	const next = page.locator("#now-playing .now-playing-transport .symbol.button").nth(2);
	await expect(next).toHaveClass(/disabled/, {timeout: 10000});

	// A pushed state change does not bring back the default command set.
	await env.acrHook("/__test/player-state", {player: "spotify", state: "Paused"});
	await env.acrHook("/__test/player-state", {player: "spotify", state: "Playing", is_active: true});
	await page.waitForTimeout(1500);
	await expect(next).toHaveClass(/disabled/);
});

test("35. a failing ACR volume read or write keeps the last known volume", async () => {
	env = new BeoEnv();
	await env.start();
	const VOLUME = {target: "sound", header: "getVolume"};
	const isVolume = data => data.target === "sound" && data.header === "systemVolume";
	const known = (await env.wsSend([VOLUME], isVolume)).content.volume;
	expect(Math.round(known)).toBe(Math.round((await env.acrState()).volume.percentage));

	expect((await env.acrHook("/__test/volume-failure", {status: 503})).status).toBe(200);
	// Every systemVolume the UI is sent while ACR fails: a write, then a read.
	const told = [];
	await env.wsSend([{target: "sound", header: "setVolume", content: 70}], data => {
		if (isVolume(data)) told.push(data.content.volume);
		return false;
	}, 1500).catch(() => {});
	told.push((await env.wsSend([VOLUME], isVolume)).content.volume);
	expect(told.length).toBeGreaterThan(0);
	for (const volume of told) expect(volume).toBe(known);
});

async function expectServerRunning() {
	await new Promise(r => setTimeout(r, 1500));
	expect(env.serverProcess.exitCode).toBe(null);
	expect((await httpGet(env.serverURL + "/")).status).toBe(200);
}

test("42. an ACR error frame on the event stream does not stop the server", async () => {
	env = new BeoEnv();
	await env.start();
	expect((await env.acrHook("/__test/event", {type: "error", message: "subscription rejected"})).status).toBe(200);
	await expectServerRunning();
});

test("46. an MPD database update on NG does not stop the server", async () => {
	env = new BeoEnv();
	await env.start();
	await env.wsSend([{target: "mpd", header: "updateDatabase"}]);
	await expectServerRunning();
});

test("47. the service is announced through avahi, and the server opens no mDNS socket", async () => {
	env = new BeoEnv({serverEnv: {MOCK_HOSTNAMECTL_NAME: "Kitchen"}});
	await env.start();
	const start = await waitFor(async () => env.readAvahiLog().find(entry => entry.argv), "avahi-publish to be started");
	expect(start.argv.slice(0, 4)).toEqual(["-s", "Kitchen", "_beocreate._tcp", String(SERVER_PORT)]);
	expect(start.argv.slice(4).every(field => /^[a-z]+=/.test(field))).toBe(true);
	expect(start.argv.slice(4).map(field => field.split("=")[0])).toEqual(["type", "typeui", "id", "image", "status"]);
	// No UDP socket of the server's own (dnssd2 bound 0.0.0.0:5353).
	const udp = execFileSync("ss", ["-H", "-uanp"], {encoding: "utf8"});
	expect(udp).not.toContain("pid=" + env.serverProcess.pid + ",");
	await env.stopServer();
	await waitFor(async () => env.readAvahiLog().some(entry => entry.exit), "avahi-publish to be stopped");
});
