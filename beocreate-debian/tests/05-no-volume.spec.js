// Criterion 11 of beocreate-debian/PORTING.md:
// When ACR reports no system volume control (GET /api/volume/info ->
// available:false), changing the volume from the UI must not crash the
// server; the UI is told there is no volume control (systemVolume with
// volumeControl false), same as the old amixer-less path.

const {test, expect} = require("@playwright/test");
const {BeoEnv} = require("./helpers/beo-env");
const {openApp, showNowPlaying, dragSlider} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv({acrEnv: {MOCK_ACR_VOLUME_AVAILABLE: "0"}});
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

test("11. volume changes without a system volume control do not crash the server", async ({page, request}) => {
	await openApp(page);
	await showNowPlaying(page);

	// Drag the volume slider; each slide tick sends sound.setVolume to the
	// server, which has no volume control to act on.
	await dragSlider(page, "#now-playing-volume-slider", 0.8);
	// The same message the slider sends, once more for determinism.
	await page.evaluate(() => beo.sendToProduct("sound", "setVolume", 42));
	await page.waitForTimeout(1000);

	// The server is still alive and serving.
	const response = await request.get("/");
	expect(response.status()).toBe(200);

	// The UI is told volume is unavailable: systemVolume with a falsy
	// volumeControl (the old amixer-less path reported the same way).
	const content = await page.evaluate(() => new Promise((resolve, reject) => {
		const ws = new WebSocket("ws://" + location.host, "beocreate");
		ws.onopen = () => ws.send(JSON.stringify({target: "sound", header: "getVolume"}));
		ws.onmessage = event => {
			let data;
			try { data = JSON.parse(event.data); } catch (e) { return; }
			if (data.target === "sound" && data.header === "systemVolume") {
				ws.close();
				resolve(data.content);
			}
		};
		setTimeout(() => reject(new Error("no systemVolume response received")), 10000);
	}));
	expect(content.volumeControl).toBeFalsy();
});
