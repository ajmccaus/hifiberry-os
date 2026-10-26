// Criteria 18-19 of beocreate-debian/PORTING.md: late enrichment of the
// current song over the ACR WebSocket. websocket.md (0.23.6) documents
// `song_information_update` as a PARTIAL update (title/artist only identify
// the song, an absent field means unchanged); the daemon itself publishes the
// merged full song, and only when a lookup changed it (api.md "song
// information": only cover_art_url, liked and metadata merge). The port must
// handle both.
// 18. song_changed without artwork, then the documented partial carrying only
//     cover_art_url (title/artist matching): the DOM artwork becomes the
//     proxied image while title, artist and album stay as they were.
// 19. Updates that do not identify the song shown (different title, different
//     artist, or neither field; late lookups, websocket.md "An update can also
//     arrive after the song_changed for the next song") are ignored: no frame
//     the page receives carries them. The barrier after them is a lookup the
//     mock applies as ACR does (one ACR socket, one Beocreate socket).
// 34. The stream URL is ACR's Song.stream_url, and an update merges only what it
//     carries: after a song_changed with artwork and a stream_url, a matching
//     update with only album and stream_url changes the album and the source's
//     stream URL and keeps the shown artwork (absent means unchanged).

const {test, expect} = require("@playwright/test");
const {BeoEnv, waitFor} = require("./helpers/beo-env");
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

// A lookup's answer, applied by the mock as ACR applies it.
async function pushLookup(update) {
	const res = await env.acrHook("/__test/song-information", update);
	expect(res.status).toBe(200);
	return JSON.parse(res.body).applied;
}

// A song_information_update as websocket.md documents it, broadcast as-is.
async function pushRawUpdate(song) {
	const player = (await env.acrState()).players.find(p => p.is_active);
	const res = await env.acrHook("/__test/event", {
		type: "song_information_update",
		player_name: player.name,
		player_id: player.id,
		source: {player_name: player.name, player_id: player.name + ":6600"},
		song: song
	});
	expect(res.status).toBe(200);
}

test("18. a late song_information_update with only cover_art_url updates the artwork, not the titles", async ({page}) => {
	const song = {title: "Late Art Song", artist: "Late Art Artist", album: "Late Art Album"};
	await openApp(page);
	await showNowPlaying(page);
	await pushSongWithoutArtwork(page, song);

	await pushRawUpdate({title: song.title, artist: song.artist, cover_art_url: "/api/imagecache/late.png"});

	await expect(shownArtwork(page)).toHaveAttribute("src", env.serverURL + "/acr-artwork/api/imagecache/late.png", {timeout: 10000});
	// Shown artwork has loaded, so the message that carried it was rendered.
	await expectSettledStrings(page, song.title, song.artist + " — " + song.album);
});

test("19. a song_information_update for a different title/artist is ignored", async ({page}) => {
	const song = {title: "Next Song", artist: "Next Artist", album: "Next Album"};
	const frames = [];
	page.on("websocket", ws => ws.on("framereceived", frame => frames.push(String(frame.payload))));
	await openApp(page);
	await showNowPlaying(page);
	await pushSongWithoutArtwork(page, song);
	const mark = frames.length;

	// Late answers for the previous song (the lookup outlived it), and one
	// that identifies no song at all.
	await pushRawUpdate({title: "Previous Song", artist: "Previous Artist", album: "Stale Album", cover_art_url: "/api/imagecache/stale-1.png"});
	await pushRawUpdate({title: song.title, artist: "Other Artist", album: "Stale Album", cover_art_url: "/api/imagecache/stale-2.png"});
	await pushRawUpdate({title: "Other Song", artist: song.artist, album: "Stale Album", cover_art_url: "/api/imagecache/stale-3.png"});
	await pushRawUpdate({album: "Stale Album", cover_art_url: "/api/imagecache/stale-4.png"});
	// Barrier: a lookup for the song shown, delivered after the four above. The
	// song has no artwork, so ACR takes it and publishes the merged song.
	expect(await pushLookup({title: song.title, artist: song.artist, cover_art_url: "/api/imagecache/fresh.png"})).toBe(true);

	await expect(shownArtwork(page)).toHaveAttribute("src", env.serverURL + "/acr-artwork/api/imagecache/fresh.png", {timeout: 10000});
	await expectSettledStrings(page, song.title, song.artist + " — " + song.album);
	const received = frames.slice(mark);
	expect(received.some(frame => frame.includes("fresh.png"))).toBe(true);
	expect(received.filter(frame => /stale/i.test(frame))).toEqual([]);

	// ACR never replaces artwork that belongs to the song: a second lookup is
	// not applied and publishes nothing.
	expect(await pushLookup({title: song.title, artist: song.artist, cover_art_url: "/api/imagecache/later.png"})).toBe(false);
});

test("34. an update keeps the artwork it does not carry and merges the stream URL", async ({page}) => {
	const song = {title: "Kept Art Song", artist: "Kept Art Artist", album: "Kept Art Album"};
	const spotifyMetadata = async () => (await env.wsSend([{target: "sources", header: "getSources"}],
		data => data.target === "sources" && data.header === "sources")).content.sources.spotify.metadata;
	await openApp(page);
	await showNowPlaying(page);
	const res = await env.acrHook("/__test/song", Object.assign({cover_art_url: "/api/imagecache/kept.png",
		stream_url: "http://radio.example/one"}, song));
	expect(res.status).toBe(200);
	await expect(title(page)).toHaveText(song.title, {timeout: 10000});
	await expect(shownArtwork(page)).toHaveAttribute("src", env.serverURL + "/acr-artwork/api/imagecache/kept.png", {timeout: 10000});
	expect((await spotifyMetadata()).uri).toBe("http://radio.example/one");

	await pushRawUpdate({title: song.title, artist: song.artist, album: "Enriched Album", stream_url: "http://radio.example/two"});
	await expect(artistAlbum(page)).toHaveText(song.artist + " — Enriched Album", {timeout: 10000});
	await expectSettledStrings(page, song.title, song.artist + " — Enriched Album");
	await expect(shownArtwork(page)).toHaveAttribute("src", env.serverURL + "/acr-artwork/api/imagecache/kept.png");
	await waitFor(async () => (await spotifyMetadata()).uri === "http://radio.example/two", "the merged stream URL");
});
