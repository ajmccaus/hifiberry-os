// Criterion 10 of beocreate-debian/PORTING.md:
// ACR may report the Spotify player under a different name (e.g. 'librespot'
// on real devices). The UI must still show the source as "Spotify", and
// activation/per-player commands must use the ACTUAL ACR player name, not
// the first alias ('spotify'), which would 404.

const {test, expect} = require("@playwright/test");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
const {openApp, showExtension} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv({acrEnv: {MOCK_ACR_SPOTIFY_NAME: "librespot"}});
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

test("10. player named 'librespot' maps to the Spotify source; activation posts to /api/player/librespot", async ({page}) => {
	await openApp(page);

	// The librespot player enables the spotify source.
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
	expect(sourcesData.sources.spotify.enabled).toBe(true);

	// The UI still shows the source as Spotify.
	await showExtension(page, "sources");
	await expect(page.locator('#sources .enabled-sources .menu-item[data-extension-id="spotify"]')).toBeVisible();

	// Activating it uses the ACR player's real name.
	await env.clearAcrRequests();
	await page.evaluate(() => sources.showStartableSources());
	const spotifyItem = page.locator('#startable-sources-prompt .startable-sources .menu-item', {hasText: "Spotify"});
	await expect(spotifyItem).toBeVisible();
	await spotifyItem.click();

	const request = await waitFor(async () => {
		const requests = await env.acrRequests();
		return requests.find(r => r.method === "POST" && r.path === "/api/player/librespot/command/play");
	}, "librespot activation command at mock ACR");
	expect(request).toBeTruthy();

	// No attempt to address the player by its alias (would 404 on-device).
	const aliasRequest = (await env.acrRequests()).find(r => r.path === "/api/player/spotify/command/play");
	expect(aliasRequest).toBeFalsy();
});
