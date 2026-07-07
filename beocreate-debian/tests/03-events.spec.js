// Criteria 7-9 of beocreate-debian/PORTING.md:
// The UI must follow events PUSHED over the ACR WebSocket stream — there is
// no polling fallback for these, so with the event stream disabled every
// test in this file fails (verified by temporarily disabling connectEvents()
// in beocreate_essentials/acr.js).
// 7. song_changed  -> now-playing title/artist update in the DOM.
// 8. volume_changed -> the client's volume slider follows.
// 9. state_changed -> the play/pause control flips.

const {test, expect} = require("@playwright/test");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showNowPlaying, sliderValue} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv();
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

test("7. pushed song_changed event updates now-playing metadata in the UI", async ({page}) => {
	await openApp(page);
	await expect(page.locator("#track-string .title")).toHaveText("Mock Song Title", {timeout: 15000});
	await expect(page.locator("#artist-album-string .artist")).toHaveText("Mock Artist", {timeout: 15000});

	const res = await env.acrHook("/__test/song", {title: "Pushed Song", artist: "Pushed Artist", album: "Pushed Album"});
	expect(res.status).toBe(200);

	await expect(page.locator("#track-string .title")).toHaveText("Pushed Song", {timeout: 10000});
	await expect(page.locator("#artist-album-string .artist")).toHaveText("Pushed Artist", {timeout: 10000});
});

test("8. pushed volume_changed event moves the client's volume slider", async ({page}) => {
	await openApp(page);
	await showNowPlaying(page);

	const before = await sliderValue(page, "#now-playing-volume-slider");
	const target = (Math.round(before) === 73) ? 27 : 73;

	const res = await env.acrHook("/__test/volume", {percentage: target});
	expect(res.status).toBe(200);

	await waitFor(async () => Math.round(await sliderValue(page, "#now-playing-volume-slider")) === target,
		"volume slider to follow the pushed volume_changed event");
});

test("9. pushed state_changed event flips the play/pause control", async ({page}) => {
	await openApp(page);
	await showNowPlaying(page);

	// spotify starts out Playing, so the middle transport button shows pause.
	const playButton = page.locator("#now-playing .now-playing-transport .symbol.button").nth(1);
	await expect(playButton).toHaveCSS("mask-image", /\/pause\.svg/, {timeout: 15000});

	let res = await env.acrHook("/__test/player-state", {player: "spotify", state: "Paused"});
	expect(res.status).toBe(200);
	await expect(playButton).toHaveCSS("mask-image", /\/play\.svg/, {timeout: 10000});

	res = await env.acrHook("/__test/player-state", {player: "spotify", state: "Playing", is_active: true});
	expect(res.status).toBe(200);
	await expect(playButton).toHaveCSS("mask-image", /\/pause\.svg/, {timeout: 10000});
});
