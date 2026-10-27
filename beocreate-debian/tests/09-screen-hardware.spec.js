// Criteria 23-26 of beocreate-debian/PORTING.md (ADR 0002): the screen
// extension's mode gate and mapping on hardware other than the default mock
// (one backlight, max_brightness 255, touch-timeout absent).
// 23. touch-timeout installed but not running (ActiveState inactive: stopped,
//     disabled, or its Condition failed), or systemctl itself failing: direct
//     mode. The slider writes the backlight, touch-timeout.env still mirrors
//     the level, and the daemon is never (re)started.
// 24. max_brightness 31 (Raspberry Pi Touch Display 2), daemon mode: the floor
//     is 49 % (-b 15); full scale is -b 31.
// 25. max_brightness 10 (any panel below 15; gpio-backlight is 1), direct
//     mode: the persisted level never exceeds 100 % and the raw write never
//     exceeds max_brightness.
// 26. Two backlight devices: the extension drives the first one in readdir
//     order, the one touch-timeout picks (main.c find_backlight_device).
// 36. touch-timeout running under an admin ExecStart override (`systemctl edit`)
//     that drops $BEO_SCREEN_ARGS: the slider is reported unavailable, and a
//     brightness message neither persists, writes the backlight, nor restarts
//     the daemon.
// 43. A screen settings message whose level is not a number changes nothing:
//     the level in memory, touch-timeout.env and screen.json keep the last
//     valid level.
// 44. A drag that starts while the extension's own try-restart is running
//     (the unit reads "activating") stays in daemon mode: the backlight is
//     never written, and the new level reaches the daemon with one more restart.
// 45. max_brightness 1023: 100 % is raw 255 (touch-timeout's -b ceiling) and the
//     whole slider stays live (50 % is raw 128), in direct and daemon mode.

const {test, expect} = require("@playwright/test");
const {execFileSync} = require("child_process");
const fs = require("fs");
const path = require("path");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showExtension, dragSlider, sliderValue} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

const SLIDER = "#screen-brightness-slider";
const STARTS = /^(re|try-re)?start touch-timeout\.service$/;

let env = null;

test.afterEach(async () => {
	if (env) await env.stop();
	env = null;
});

async function startEnv(options, beforeServer) {
	env = new BeoEnv(options);
	env.setup();
	if (beforeServer) beforeServer(env);
	await env.startAcr();
	await env.startServer();
}

async function openScreen(page) {
	await openApp(page);
	await showExtension(page, "screen");
	await expect(page.locator(SLIDER)).toBeVisible();
}

function envFor(raw) {
	return "BEO_SCREEN_ARGS=-b " + raw + "\n";
}

for (const [label, options] of [
	["touch-timeout inactive", {touchTimeout: "inactive"}],
	["systemctl failing", {touchTimeout: "active", systemctlExit: 1}]
]) {
	test("23. direct mode when " + label + ": the slider writes the backlight and never starts the daemon", async ({page}) => {
		await startEnv(options);
		await openScreen(page);
		await dragSlider(page, SLIDER, 0.6);
		const raw = Math.round(await sliderValue(page, SLIDER) * 255 / 100);
		await waitFor(async () => env.readBrightness() === raw, "backlight to be " + raw);
		await waitFor(async () => env.readTouchTimeoutEnv() === envFor(raw), "touch-timeout.env to mirror -b " + raw);
		await new Promise(r => setTimeout(r, 1500));
		expect(env.readSystemctlLog().filter(line => STARTS.test(line))).toEqual([]);
	});
}

test("24. max_brightness 31: floor 49 % maps to -b 15, full scale to -b 31", async ({page}) => {
	await startEnv({touchTimeout: "active", backlightMax: 31});
	await openScreen(page);
	await dragSlider(page, SLIDER, 0);
	await waitFor(async () => env.readTouchTimeoutEnv() === envFor(15), "touch-timeout.env to hold -b 15");
	await waitFor(async () => (env.readScreenSettings() || {}).brightness === 49, "screen.json to persist 49");
	await dragSlider(page, SLIDER, 1);
	await waitFor(async () => env.readTouchTimeoutEnv() === envFor(31), "touch-timeout.env to hold -b 31");
	expect(env.readScreenSettings().brightness).toBe(100);
});

test("25. max_brightness 10: at most 100 % persisted and at most raw 10 written", async ({page}) => {
	await startEnv({backlightMax: 10});
	// Startup clamps the default 75 % up to the floor, which is capped at 100 %.
	expect(env.readScreenSettings().brightness).toBe(100);
	expect(env.readBrightness()).toBe(10);
	await openScreen(page);
	expect(await sliderValue(page, SLIDER)).toBe(100);
	await dragSlider(page, SLIDER, 0);
	await new Promise(r => setTimeout(r, 1500));
	expect(env.readScreenSettings().brightness).toBe(100);
	expect(env.readBrightness()).toBe(10);
	expect(env.readTouchTimeoutEnv()).toBe(envFor(15)); // The daemon clamps -b to its max itself.
});

test("26. two backlights: the first in readdir order is driven", async ({page}) => {
	await startEnv({}, e => e.addBacklight("z-panel"));
	// `ls -f` lists in readdir order, as touch-timeout's readdir loop sees it.
	const order = execFileSync("ls", ["-f", env.backlightDir], {encoding: "utf8"})
		.split("\n").filter(name => name && name.charAt(0) != ".");
	const [first, other] = order;
	const read = name => parseInt(fs.readFileSync(path.join(env.backlightDir, name, "brightness"), "utf8"));
	const untouched = read(other);
	await openScreen(page);
	await dragSlider(page, SLIDER, 0.6);
	const raw = Math.round(await sliderValue(page, SLIDER) * 255 / 100);
	await waitFor(async () => read(first) === raw, first + " brightness to be " + raw);
	expect(read(other)).toBe(untouched);
});

test("36. an admin ExecStart override takes the slider out instead of faking a level", async ({page}) => {
	await startEnv({touchTimeout: "active", touchTimeoutExecStart:
		"{ path=/usr/bin/touch-timeout ; argv[]=/usr/bin/touch-timeout -b 200 -t 600 ; ignore_errors=no }"});
	const backlight = env.readBrightness();
	const isBrightness = data => data.target === "screen" && data.header === "brightness";
	expect((await env.wsSend([{target: "screen", header: "getBrightness"}], isBrightness)).content.available).toBe(false);
	await openApp(page);
	await showExtension(page, "screen");
	await expect(page.locator("#screen-brightness-slider-wrap")).toHaveClass(/disabled/);

	const mark = env.readSystemctlLog().length;
	const reply = await env.wsSend([{target: "screen", header: "setBrightness", content: 30}], isBrightness);
	expect(reply.content.available).toBe(false);
	await new Promise(r => setTimeout(r, 1500));
	expect(env.readSystemctlLog().slice(mark).filter(line => STARTS.test(line))).toEqual([]);
	expect((env.readScreenSettings() || {}).brightness).not.toBe(30);
	expect(env.readBrightness()).toBe(backlight);
});

const RESTART = "try-restart touch-timeout.service";
const settle = () => new Promise(r => setTimeout(r, 1200)); // > SETTLE_MS (500) + systemctl.

function setLevel(level) {
	return env.wsSend([{target: "screen", header: "setBrightness", content: level}]);
}

test("43. a settings message with a non-number level changes nothing", async () => {
	await startEnv({touchTimeout: "active"});
	await setLevel(50);
	await settle();
	await env.wsSend([{target: "screen", header: "settings", content: {settings: {brightness: "abc"}}}]);
	// The level in memory is what the next settle or startup writes to the env file.
	const isBrightness = data => data.target === "screen" && data.header === "brightness";
	expect((await env.wsSend([{target: "screen", header: "getBrightness"}], isBrightness)).content.brightness).toBe(50);
	expect(env.readTouchTimeoutEnv()).toBe(envFor(128));
	expect(env.readScreenSettings().brightness).toBe(50);
});

test("44. a drag during the extension's own restart stays in daemon mode", async () => {
	await startEnv({touchTimeout: "active", serverEnv: {MOCK_TRY_RESTART_MS: "2000"}});
	const backlight = env.readBrightness();
	const mark = env.readSystemctlLog().length;
	await setLevel(40);
	await new Promise(r => setTimeout(r, 1000)); // Settled at 500 ms; the restart runs until about 2.5 s.
	await setLevel(60);
	await waitFor(async () => env.readTouchTimeoutEnv() === envFor(153), "touch-timeout.env to reach -b 153");
	await waitFor(async () => env.readSystemctlLog().slice(mark).filter(line => line === RESTART).length === 2, "a second restart");
	expect(env.readBrightness()).toBe(backlight);
});

for (const mode of ["inactive", "active"]) {
	test("45. max_brightness 1023, touch-timeout " + mode + ": 100 % is raw 255 and 50 % is raw 128", async () => {
		await startEnv({touchTimeout: mode, backlightMax: 1023});
		for (const [level, raw] of [[50, 128], [100, 255]]) {
			await setLevel(level);
			await settle();
			expect(env.readTouchTimeoutEnv()).toBe(envFor(raw));
			if (mode == "inactive") expect(env.readBrightness()).toBe(raw);
		}
	});
}
