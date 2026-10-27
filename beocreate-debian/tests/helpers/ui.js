// Shared UI helpers for the Beocreate Playwright tests.

async function openApp(page, errors) {
	if (errors) {
		page.on("pageerror", error => errors.push(error.message));
	}
	await page.goto("/");
	// Wait until the client WebSocket is connected and initial data arrived.
	await page.waitForFunction(() => window.beo && document.body.classList.contains("connected"), null, {timeout: 20000})
		.catch(() => {}); // Some builds use a different marker; fall back to a fixed wait below.
	await page.waitForTimeout(1500);
}

async function showNowPlaying(page) {
	await page.evaluate(() => now_playing.showNowPlaying());
	await page.waitForTimeout(500);
}

async function showExtension(page, extension) {
	await page.evaluate(name => beo.showExtension(name), extension);
	await page.waitForTimeout(500);
}

// Drag a jQuery UI slider to approximately the given fraction (0..1) by
// grabbing its handle (the track itself is only a couple of pixels tall).
async function dragSlider(page, selector, fraction) {
	const slider = page.locator(selector);
	const track = await slider.boundingBox();
	if (!track) throw new Error("Slider " + selector + " is not visible");
	const handle = await slider.locator(".ui-slider-handle").boundingBox();
	if (!handle) throw new Error("Slider handle for " + selector + " is not visible");
	const y = handle.y + handle.height / 2;
	const targetX = track.x + Math.max(2, Math.min(track.width - 2, track.width * fraction));
	await page.mouse.move(handle.x + handle.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(targetX, y, {steps: 10});
	await page.mouse.up();
	await page.waitForTimeout(300);
}

async function sliderValue(page, selector) {
	return page.evaluate(sel => window.$(sel).slider("value"), selector);
}

module.exports = {openApp, showNowPlaying, showExtension, dragSlider, sliderValue};
