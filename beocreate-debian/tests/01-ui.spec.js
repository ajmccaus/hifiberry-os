// Criteria 1-5 of beocreate-debian/PORTING.md:
// 1. Server boots on :8080 with mocks; / serves the app shell.
// 2. UI loads in Chromium with no fatal JS errors; now-playing shows the
//    mock track's title/artist.
// 3. Transport: play/pause in the UI reaches the mock ACR as a player command.
// 4. Sources: the mock's players are listed; activating one sends the right
//    ACR call.
// 5. Volume: changing volume in the UI updates the mock ACR volume.

const {test, expect} = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showNowPlaying, showExtension, dragSlider, sliderValue} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv();
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

test("1. server boots on :8080 and / serves the app shell", async ({request}) => {
	const response = await request.get("/");
	expect(response.status()).toBe(200);
	const body = await response.text();
	expect(body).toContain('id="player-bar"'); // App shell markup.
	expect(body).toContain('id="now-playing"'); // Extensions were assembled in.
	expect(body).toContain('id="sources"');
	expect(body).toContain('id="screen"');
});

test("2. UI loads without fatal JS errors and shows mock now-playing metadata", async ({page, request}) => {
	const errors = [];
	await openApp(page, errors);

	// Now-playing metadata (rendered by the untouched Vue client code).
	await expect(page.locator("#track-string .title")).toHaveText("Mock Song Title", {timeout: 15000});
	await expect(page.locator("#artist-album-string .artist")).toHaveText("Mock Artist", {timeout: 15000});

	// Open the now-playing screen and screenshot it.
	await showNowPlaying(page);
	await expect(page.locator("#now-playing-container")).toBeVisible();
	fs.mkdirSync(path.join(__dirname, "screenshots"), {recursive: true});
	await page.waitForTimeout(1500); // Allow artwork + transitions to settle.
	await page.screenshot({path: path.join(__dirname, "screenshots", "now-playing.png")});

	// Cover art: the DOM must point at the Beocreate server's artwork proxy,
	// not at the localhost-only ACR address (remote browsers can't reach it).
	const artworkImg = page.locator("#artwork-area-wide .artwork-wrap:visible img.artwork-img");
	await expect(artworkImg).toHaveAttribute("src", env.serverURL + "/acr-artwork/coverart/mock.png", {timeout: 15000});

	// Fetching that URL through the Beocreate server returns the mock's image.
	const proxied = await request.get(env.serverURL + "/acr-artwork/coverart/mock.png");
	expect(proxied.status()).toBe(200);
	expect(proxied.headers()["content-type"]).toContain("image/png");
	const direct = await request.get(env.acrURL + "/coverart/mock.png");
	expect(Buffer.compare(await proxied.body(), await direct.body())).toBe(0);

	expect(errors, "fatal page errors: " + errors.join("; ")).toEqual([]);
});

test("3. play/pause in the UI reaches the mock ACR as a player command", async ({page}) => {
	await openApp(page);
	await showNowPlaying(page);
	await env.clearAcrRequests();

	// The play/pause button is the middle transport control.
	await page.locator("#now-playing .now-playing-transport .symbol.button").nth(1).click();

	const request = await waitFor(async () => {
		const requests = await env.acrRequests();
		// The UI's play/pause button maps to exactly 'playpause'.
		return requests.find(r => r.method === "POST" && r.path === "/api/player/active/send/playpause");
	}, "transport command at mock ACR");
	expect(request).toBeTruthy();

	// The mock toggled the active player; the UI should follow the pushed
	// state_changed event (spotify was playing, so it is now paused).
	await waitFor(async () => {
		const state = await env.acrState();
		return state.players.find(p => p.name === "spotify").state === "Paused";
	}, "mock player state change");
});

test("4. mock ACR players are listed as sources; activating one sends the right call", async ({page}) => {
	await openApp(page);

	// The sources data delivered to the UI derives from the mock's player
	// list: mpd (background service exposing "radio") and spotify must be
	// registered and enabled. Probe with the same protocol the client uses.
	const sourcesData = await page.evaluate(() => new Promise((resolve, reject) => {
		const ws = new WebSocket("ws://" + location.host, "beocreate");
		ws.onopen = () => ws.send(JSON.stringify({target: "sources", header: "getSources"}));
		ws.onmessage = event => {
			let data;
			try { data = JSON.parse(event.data); } catch (e) { return; }
			if (data.target === "sources" && data.header === "sources") {
				ws.close();
				resolve(data.content);
			}
		};
		setTimeout(() => reject(new Error("no sources data received")), 10000);
	}));
	expect(sourcesData.sources.mpd.enabled).toBe(true);
	expect(sourcesData.sources.spotify.enabled).toBe(true);

	// In the sources menu, spotify (the only mock player with its own source
	// menu panel) is listed under enabled sources.
	await showExtension(page, "sources");
	await expect(page.locator('#sources .enabled-sources .menu-item[data-extension-id="spotify"]')).toBeVisible();

	// Activate a source from the startable-sources prompt (real menu items).
	await env.clearAcrRequests();
	await page.evaluate(() => sources.showStartableSources());
	const spotifyItem = page.locator('#startable-sources-prompt .startable-sources .menu-item', {hasText: "Spotify"});
	await expect(spotifyItem).toBeVisible();
	await spotifyItem.click();

	const request = await waitFor(async () => {
		const requests = await env.acrRequests();
		return requests.find(r => r.method === "POST" && r.path === "/api/player/spotify/command/play");
	}, "player activation command at mock ACR");
	expect(request).toBeTruthy();

	// The mock set spotify to Playing again.
	await waitFor(async () => {
		const state = await env.acrState();
		const spotify = state.players.find(p => p.name === "spotify");
		return spotify.state === "Playing" && spotify.is_active;
	}, "spotify active at mock ACR");
});

test("5. changing volume in the UI updates the mock ACR volume", async ({page}) => {
	await openApp(page);
	await showNowPlaying(page);

	// The volume slider should reflect the mock's current volume first.
	const before = await sliderValue(page, "#now-playing-volume-slider");
	const stateBefore = await env.acrState();
	expect(Math.round(before)).toBe(Math.round(stateBefore.volume.percentage));

	await env.clearAcrRequests();
	await dragSlider(page, "#now-playing-volume-slider", 0.8);

	const uiValue = await sliderValue(page, "#now-playing-volume-slider");
	expect(uiValue).toBeGreaterThan(before); // The drag moved the slider up.

	// The mock must have received /api/volume/set and now hold the UI's value.
	await waitFor(async () => {
		const requests = await env.acrRequests();
		return requests.find(r => r.method === "POST" && r.path === "/api/volume/set");
	}, "volume set request at mock ACR");

	await waitFor(async () => {
		const state = await env.acrState();
		return Math.abs(state.volume.percentage - uiValue) <= 2;
	}, "mock ACR volume to match the UI slider");
});
