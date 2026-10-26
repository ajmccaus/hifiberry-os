// Criteria 18-19 of beocreate-debian/PORTING.md: late enrichment of the
// current song over the ACR WebSocket. `song_information_update` (acr
// doc/websocket.md at 0.23.6) is a PARTIAL update: title/artist only identify
// the song it is for, and an absent field means unchanged, never cleared.
// 18. song_changed without artwork, then an update carrying only
//     cover_art_url (title/artist matching): the DOM artwork becomes the
//     proxied image while title, artist and album stay as they were.
// 19. Updates that do not identify the song shown (different title, different
//     artist, or neither field) are ignored; a matching one sent after them
//     is the ordering barrier (one ACR socket, one Beocreate socket).

const {test, expect} = require("@playwright/test");
const {BeoEnv} = require("./helpers/beo-env");
const {openApp, showNowPlaying} = require("./helpers/ui");

test.describe.configure({mode: "serial"});

let env;

test.beforeAll(async () => {
	env = new BeoEnv();
	await env.start();
});

test.afterAll(async () => {
	if (env) await env.stop();
});

const title = page => page.locator("#track-string .title");
const artistAlbum = page => page.locator("#artist-album-string");
const shownArtwork = page => page.locator("#artwork-area-wide .artwork-wrap:visible img.artwork-img");

// The strings fade out-in: a string being replaced stays in the DOM until its
// fade has ended. Call once the change was rendered; the texts are then final.
async function expectSettledStrings(page, titleText, artistAlbumText) {
	const fading = ["#track-string", "#artist-album-string"].map(id =>
		id + " .now-playing-fade-leave-active, " + id + " .now-playing-fade-enter-active").join(", ");
	await expect(page.locator(fading)).toHaveCount(0, {timeout: 10000});
	await expect(title(page)).toHaveText(titleText);
	await expect(artistAlbum(page)).toHaveText(artistAlbumText);
}

// Pushes song_changed for a song without artwork (null drops the mock's
// cover_art_url, as ACR omits an absent field) and waits until the UI shows it.
async function pushSongWithoutArtwork(page, song) {
	const res = await env.acrHook("/__test/song", Object.assign({cover_art_url: null}, song));
	expect(res.status).toBe(200);
	await expect(title(page)).toHaveText(song.title, {timeout: 10000});
	await expect(artistAlbum(page)).toHaveText(song.artist + " — " + song.album, {timeout: 10000});
	await expect(shownArtwork(page)).toHaveCount(0, {timeout: 10000});
}

async function pushSongInformation(update) {
	const res = await env.acrHook("/__test/song-information", update);
	expect(res.status).toBe(200);
}

test("18. a late song_information_update with only cover_art_url updates the artwork, not the titles", async ({page}) => {
	const song = {title: "Late Art Song", artist: "Late Art Artist", album: "Late Art Album"};
	await openApp(page);
	await showNowPlaying(page);
	await pushSongWithoutArtwork(page, song);

	await pushSongInformation({title: song.title, artist: song.artist, cover_art_url: "/coverart/late.png"});

	await expect(shownArtwork(page)).toHaveAttribute("src", env.serverURL + "/acr-artwork/coverart/late.png", {timeout: 10000});
	// Shown artwork has loaded, so the message that carried it was rendered.
	await expectSettledStrings(page, song.title, song.artist + " — " + song.album);
});

test("19. a song_information_update for a different title/artist is ignored", async ({page}) => {
	const song = {title: "Next Song", artist: "Next Artist", album: "Next Album"};
	await openApp(page);
	await showNowPlaying(page);
	await pushSongWithoutArtwork(page, song);

	// Late answers for the previous song (the lookup outlived it), and one
	// that identifies no song at all.
	await pushSongInformation({title: "Previous Song", artist: "Previous Artist", album: "Stale Album", cover_art_url: "/coverart/stale-1.png"});
	await pushSongInformation({title: song.title, artist: "Other Artist", album: "Stale Album", cover_art_url: "/coverart/stale-2.png"});
	await pushSongInformation({title: "Other Song", artist: song.artist, album: "Stale Album", cover_art_url: "/coverart/stale-3.png"});
	await pushSongInformation({album: "Stale Album", cover_art_url: "/coverart/stale-4.png"});
	// Barrier: a matching album-only update, delivered after the four above.
	await pushSongInformation({title: song.title, artist: song.artist, album: "Enriched Album"});

	await expect(artistAlbum(page)).toHaveText(song.artist + " — Enriched Album", {timeout: 10000});
	await expectSettledStrings(page, song.title, song.artist + " — Enriched Album");
	// Vue renders a message's artwork src before a later message's album.
	await expect(page.locator("#artwork-area-wide img.artwork-img[src*='stale']")).toHaveCount(0);
	await expect(shownArtwork(page)).toHaveCount(0);
});
