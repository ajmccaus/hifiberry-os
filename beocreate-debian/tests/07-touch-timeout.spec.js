// Criteria 16-17 of beocreate-debian/PORTING.md (ADR 0002), in daemon mode:
// the mock systemctl reports touch-timeout.service "loaded".
// 16. The slider never writes the backlight; each settled drag writes the
//     mapped `-b` to touch-timeout.env and restarts the daemon exactly once;
//     a drag to 0 gives `-b 15`; a dimmed backlight file does not change the
//     level the UI shows; at startup a missing env file is rewritten from
//     screen.json with one restart, an unchanged one causes none.
// 17. Playback starting from standby sends touch-timeout exactly one SIGUSR1;
//     a push while already playing sends none.

const {test, expect} = require("@playwright/test");
const fs = require("fs");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showExtension, showNowPlaying, dragSlider, sliderValue} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

const RESTART = "restart touch-timeout.service";
const WAKE = "kill --signal=SIGUSR1 touch-timeout.service";
const SLIDER = "#screen-brightness-slider";

let env;

test.beforeAll(async () => {
	env = new BeoEnv({touchTimeout: "loaded"});
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

// How many times `entry` was logged by the mock systemctl since log index `mark`.
function callsSince(mark, entry) {
	return env.readSystemctlLog().slice(mark).filter(line => line === entry).length;
}

function envFor(raw) {
	return "BEO_SCREEN_ARGS=-b " + raw + "\n";
}

// Drags the slider and waits for the settled level to reach touch-timeout:
// the env file holds `-b <raw>` and exactly one restart follows (none later).
async function dragAndSettle(page, fraction, expectRaw) {
	const mark = env.readSystemctlLog().length;
	await dragSlider(page, SLIDER, fraction);
	const uiValue = await sliderValue(page, SLIDER);
	const raw = expectRaw(uiValue);
	await waitFor(async () => env.readTouchTimeoutEnv() === envFor(raw), "touch-timeout.env to hold -b " + raw);
	await waitFor(async () => callsSince(mark, RESTART) >= 1, "touch-timeout restart");
	await new Promise(r => setTimeout(r, 1500));
	expect(callsSince(mark, RESTART)).toBe(1);
	return uiValue;
}

test("16. the slider sets touch-timeout's -b and never writes the backlight", async ({page}) => {
	const backlight = env.readBrightness();

	await openApp(page);
	await showExtension(page, "screen");
	await expect(page.locator(SLIDER)).toBeVisible();

	const uiValue = await dragAndSettle(page, 0.6, value => Math.round(value * 255 / 100));
	expect(Math.round(env.readScreenSettings().brightness)).toBe(Math.round(uiValue));
	expect(env.readBrightness()).toBe(backlight);

	// All the way down: the floor, raw 15 (touch-timeout's minimum) = 6 %.
	await dragAndSettle(page, 0, () => 15);
	expect(env.readScreenSettings().brightness).toBe(6);
	expect(env.readBrightness()).toBe(backlight);

	// touch-timeout dims the screen: the backlight file now holds the dim
	// level, but the UI still shows the saved one.
	env.writeBrightness(1);
	await openApp(page);
	await showExtension(page, "screen");
	expect(Math.round(await sliderValue(page, SLIDER))).toBe(6);

	// Startup rewrites a missing env file from screen.json and restarts once,
	// without touching the backlight.
	fs.rmSync(env.touchTimeoutEnvFile);
	let mark = env.readSystemctlLog().length;
	await env.restartServer();
	await waitFor(async () => env.readTouchTimeoutEnv() === envFor(15), "startup to rewrite touch-timeout.env");
	expect(callsSince(mark, RESTART)).toBe(1);
	expect(env.readBrightness()).toBe(1);

	// An env file that already matches: no restart.
	mark = env.readSystemctlLog().length;
	await env.restartServer();
	expect(callsSince(mark, RESTART)).toBe(0);
});

test("17. playback from standby wakes touch-timeout with one SIGUSR1", async ({page}) => {
	await openApp(page);
	await showNowPlaying(page);
	const playButton = page.locator("#now-playing .now-playing-transport .symbol.button").nth(1);

	// spotify starts out Playing; pausing it leaves nothing playing (standby).
	let res = await env.acrHook("/__test/player-state", {player: "spotify", state: "Paused"});
	expect(res.status).toBe(200);
	await expect(playButton).toHaveCSS("mask-image", /\/play\.svg/, {timeout: 10000});

	let mark = env.readSystemctlLog().length;
	res = await env.acrHook("/__test/player-state", {player: "spotify", state: "Playing", is_active: true});
	expect(res.status).toBe(200);
	await expect(playButton).toHaveCSS("mask-image", /\/pause\.svg/, {timeout: 10000});
	await waitFor(async () => callsSince(mark, WAKE) >= 1, "SIGUSR1 to touch-timeout");
	await new Promise(r => setTimeout(r, 1500));
	expect(callsSince(mark, WAKE)).toBe(1);

	// Already playing: no wake.
	mark = env.readSystemctlLog().length;
	res = await env.acrHook("/__test/player-state", {player: "spotify", state: "Playing", is_active: true});
	expect(res.status).toBe(200);
	await new Promise(r => setTimeout(r, 2000));
	expect(callsSince(mark, WAKE)).toBe(0);
});
