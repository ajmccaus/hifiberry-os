// Criteria 6 and 12 of beocreate-debian/PORTING.md, in direct mode (no
// touch-timeout; the mock systemctl reports it not-found):
// 6. Screen: the brightness slider writes the expected scaled value to the
//    mock backlight file; the value persists across a server restart.
// 12. Brightness floor: the UI can never apply less than raw 15 (touch-timeout's
//    -b minimum) or persist less than 6 % (ceil(1500 / max_brightness 255)),
//    and a persisted value below the floor is clamped up at startup.
// 32. Direct mode never signals or (re)starts touch-timeout: after a drag and a
//    playback start from standby the systemctl log holds no kill, restart,
//    try-restart or start.

const {test, expect} = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showExtension, showNowPlaying, dragSlider, sliderValue} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv();
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

test("6. brightness slider writes scaled value to the backlight and persists across restart", async ({page}) => {
	await openApp(page);
	await showExtension(page, "screen");
	await expect(page.locator("#screen-brightness-slider")).toBeVisible();

	// Screenshot of the screen-brightness settings panel.
	fs.mkdirSync(path.join(__dirname, "test-results", "screenshots"), {recursive: true}); // Untracked (.gitignore).
	await page.screenshot({path: path.join(__dirname, "test-results", "screenshots", "screen-brightness.png")});

	// Move the slider and check the sysfs write: percent scaled to 0-255.
	await dragSlider(page, "#screen-brightness-slider", 0.6);
	const uiValue = await sliderValue(page, "#screen-brightness-slider");
	expect(uiValue).toBeGreaterThan(0);

	await waitFor(async () => env.readBrightness() === Math.round(uiValue / 100 * 255),
		"backlight brightness file to be " + Math.round(uiValue / 100 * 255));

	// The chosen level is persisted in screen.json once the slider has settled
	// (500 ms without a message), so poll for it.
	await waitFor(async () => {
		const settings = env.readScreenSettings();
		return settings && Math.round(settings.brightness) === Math.round(uiValue);
	}, "screen.json to persist the brightness");

	// Sabotage the brightness file, then restart the server: startup must
	// restore the persisted level.
	env.writeBrightness(1);
	await env.restartServer();

	expect(env.readBrightness()).toBe(Math.round(uiValue / 100 * 255));

	// The UI reflects the persisted value after a reload.
	await openApp(page);
	await showExtension(page, "screen");
	const restored = await sliderValue(page, "#screen-brightness-slider");
	expect(Math.round(restored)).toBe(Math.round(uiValue));
});

test("12. brightness has a raw 15 / 6 % floor: UI can neither apply nor persist black", async ({page}) => {
	const FLOOR_PERCENT = 6;
	const FLOOR_RAW = 15;

	await openApp(page);
	await showExtension(page, "screen");
	await expect(page.locator("#screen-brightness-slider")).toBeVisible();

	// Drag the slider all the way down: the applied and persisted level must
	// clamp at the floor instead of going dark.
	await dragSlider(page, "#screen-brightness-slider", 0);
	await waitFor(async () => env.readBrightness() === FLOOR_RAW,
		"backlight brightness to clamp at raw " + FLOOR_RAW);
	await waitFor(async () => {
		const settings = env.readScreenSettings();
		return settings && settings.brightness === FLOOR_PERCENT;
	}, "screen.json to persist the floor value, not 0");

	// A persisted value below the floor (older version, hand-edited file) is
	// clamped up at startup so the screen never restores to black.
	env.writeScreenSettings({brightness: 0});
	env.writeBrightness(0);
	await env.restartServer();

	expect(env.readBrightness()).toBe(FLOOR_RAW);
	expect(env.readScreenSettings().brightness).toBe(FLOOR_PERCENT);
});

test("32. direct mode never signals or restarts touch-timeout", async ({page}) => {
	const mark = env.readSystemctlLog().length;
	await openApp(page);
	await showExtension(page, "screen");
	await dragSlider(page, "#screen-brightness-slider", 0.5);
	const raw = Math.round(await sliderValue(page, "#screen-brightness-slider") * 255 / 100);
	await waitFor(async () => env.readBrightness() === raw, "backlight brightness to be " + raw);

	// Playback from standby: spotify starts out Playing, so pause it first.
	await showNowPlaying(page);
	const playButton = page.locator("#now-playing .now-playing-transport .symbol.button").nth(1);
	await env.acrHook("/__test/player-state", {player: "spotify", state: "Paused"});
	await expect(playButton).toHaveCSS("mask-image", /\/play\.svg/, {timeout: 10000});
	await env.acrHook("/__test/player-state", {player: "spotify", state: "Playing", is_active: true});
	await expect(playButton).toHaveCSS("mask-image", /\/pause\.svg/, {timeout: 10000});
	await new Promise(r => setTimeout(r, 1500));

	const calls = env.readSystemctlLog().slice(mark);
	expect(calls.length).toBeGreaterThan(0); // The mode was queried ...
	expect(calls.filter(line => /^(kill|restart|try-restart|start) /.test(line))).toEqual([]); // ... and nothing else.
});
