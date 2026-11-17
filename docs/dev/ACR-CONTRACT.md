# ACR (audiocontrol) 0.25.0 — API contract for a browser UI

Verified against source at `acr` commit 47f2b51 (`Cargo.toml:3` version = "0.25.0") **and** against a live instance
(real MPD 0.23.5 backing player, `run-acr.sh`). Payload examples marked (live) are captured responses; raw captures are in `ref/cap/`.
Paths below are relative to the daemon root; all REST routes are under `/api` (`crates/acr-types/src/lib.rs:30`).
File refs are relative to the acr clone. "doc ≠ src" marks a disagreement between `doc/*.md` and the code.

## 0. Deployment facts that shape the UI

| Fact | Detail |
|---|---|
| Listen address/port | `services.webserver.{enable,host,port}` in `audiocontrol.json`; defaults host `0.0.0.0`, port `1080` (`src/api/server.rs:312-319`). Shipped config binds `0.0.0.0` (`configs/audiocontrol.json`); bind `127.0.0.1` for a dev backend. Config file: `-c <path>` (`src/main.rs:798`). |
| Two daemons in production | Player daemon (1080): players, library, volume, imagecache, WebSocket, settings. Metadata daemon (1084): `/api/coverart/*`, `/api/favourites/*`, lastfm, audiodb, artist images. The shipped deb builds `audiocontrol` with `--no-default-features` (`debian/rules:83-84`) so **1080 alone does not serve favourites or coverart**. In a default `cargo build` (what `run-acr.sh` uses) the metadata routes are mounted in-process on 1080 as well. nginx maps both under `/api/audiocontrol/` (see `doc/api.md:116-130`). Write the UI against a configurable base URL and don't hard-code ports. |
| Behind nginx | `X-Forwarded-Prefix: /api/audiocontrol` is set; ACR then rewrites `song.cover_art_url` and `song.metadata.lyrics_url` (REST + WS) to carry the prefix (`crates/acr-types/src/urlprefix.rs`). Use returned paths verbatim; never prepend your own prefix. Direct (no header): paths come back as `/api/...`. |
| CORS | **None.** No `Access-Control-*` headers; `OPTIONS` returns 404 (live). Cross-origin fetch with a JSON `Content-Type` fails preflight. Serve the UI same-origin or dev-proxy (e.g. Vite `server.proxy` with `ws: true`). WebSocket has no Origin check. |
| Auth | None in ACR. nginx `auth.d/audiocontrol-auth.json` marks every route listed in this file as tier `ok`; anything else is `risky`. |
| Error body types | Player routes: JSON `{success:false,message}`. Malformed JSON body / bad param: Rocket HTML page (400/422/404). Volume POST failures: **HTTP 200** with `success:false`. Favourites failures: **HTTP 200** `{"Err":{...}}`. Handle all three. |

## 1. Now playing

### `GET /api/now-playing` (`src/api/players.rs:441`, struct :199)
Always 200. Built from the **active** player. No active player ⇒ `player.name:"none"`, `song:null`, `state:"unknown"`.

```jsonc
// (live) MPD playing track 1 of 3
{
  "player": { /* PlayerInfo, see §2 */ },
  "song": {
    "title": "First Silence", "artist": "Test Artist", "album": "Test Album",
    "track_number": 0,                       // MPD: this is the QUEUE POSITION (0-based), not the tag (mpd.rs:1600)
    "duration": 60.0,                        // seconds, float; absent for streams
    "cover_art_url": "/api/library/mpd/image/VGVzdCBBcnRpc3QvVGVzdCBBbGJ1bS8wMSAtIEZpcnN0IFNpbGVuY2UubXAz",
    "stream_url": "Test Artist/Test Album/01 - First Silence.mp3",   // MPD: a library-relative path, NOT a playable URL
    "source": "mpd",
    "metadata": { "lyrics_available": false }
  },
  "state": "playing",                        // lowercase, see enum below
  "shuffle": false,
  "loop_mode": "no",                         // "no" | "song" | "playlist"
  "position": 2.007,                         // seconds float | null — a SNAPSHOT (see gotchas)
  "stream_details": { "sample_rate": 44100, "bits_per_sample": 24, "channels": 2 }   // optional key; may also have codec, lossless, sample_type
}
```

**Song** (`crates/acr-types/src/song.rs:27`; every field except `metadata` is omitted when unset, so treat all as optional):
`title, artist, album, album_artist` string · `track_number, total_tracks, year` int · `duration` float seconds · `genre` string · `genres` string[] (omitted if empty) · `cover_art_url` string · `stream_url` string · `source` string ("mpd", "spotify", "radio"…) · `liked` bool · `composer` string · `metadata` object (omitted if empty; free-form; known keys `cover_art_source`, `lyrics_url`, `lyrics_available`, `coverart_url`/`logo_url` for radio).
There is **no `uri` field** (doc ≠ src: `doc/websocket.md` and `doc/generic_player_controller.md` show `uri`). `duration` and `position` are float seconds everywhere.

**`PlaybackState`** (`crates/acr-types/src/playback_state.rs:8`): `"playing" | "paused" | "stopped" | "killed" | "disconnected" | "unknown"` (always lowercase; doc ≠ src: `doc/api.md` shows `Playing|Paused|…`).
**`LoopMode`** (`src/data/loop_mode.rs:12`): wire values `"no" | "song" | "playlist"` (doc ≠ src: api.md shows `None|Track|Playlist`). Commands accept `none|no|off|track|song|playlist`.

### Cover art — where the bytes come from
`song.cover_art_url` is a **same-host path** (starts with `/`, host-relative) or an absolute external URL (last.fm, station logo, …). Fetch it as-is from the same origin as the API. Forms seen in source:

| Player | `cover_art_url` form | Served by | Notes |
|---|---|---|---|
| MPD | `/api/library/mpd/image/<urlsafe-b64(file path)>` (live) | player daemon :1080, `GET /library/<player>/image/<identifier>?size=N` (`src/api/library.rs:1544`) | Live: `200 image/jpeg`, ETag, `cache-control: public, max-age=86400`. Extracted from the file's embedded art via MPD `albumart`. Streams get no URL (radio uses `metadata.coverart_url` logo). |
| Library albums | `/api/library/<player>/image/album:<id>` (`albums[].cover_art`, live) | same | `immutable, max-age=31536000`. `?size=` ∈ `GET /api/capabilities` → `images.sizes` (live `[100,140,200,280,400,800]`); non-integer ⇒ 400 (live); `?size` only resizes `album:` ids on players that cache art (MPD yes). |
| Shairport/RAAT/Spotify | `/api/imagecache/<path>` (`src/players/shairport/shairport.rs:663`, tests `player_controller.rs:1255`) | player daemon, `crates/acr-web/src/imagecache.rs` | not exercised live |
| Artists | `/api/coverart/artist/<b64>/image` | **metadata daemon** | `artist:` ids on the library route answer `302` there. |

Late artwork: `song_information_update` (§5) can replace `cover_art_url` later; `metadata.cover_art_source == "station_logo"` means placeholder, anything else (or absent) means real art — don't enumerate values (`doc/websocket.md`, matches `Song::cover_art_is_replaceable`, `song.rs`).

### Other now-playing endpoints
- `GET /api/player` → `{"name":"mpd","id":"127.0.0.1:6600","state":"stopped","last_seen":null}` (live; `last_seen` RFC3339 or null; no active player ⇒ name/id `"none"`, state `"unknown"`) (`players.rs:240`).
- `GET /api/player/<name|active>/queue` → `{"player":"mpd","queue":[{"name":"First Silence","artist":"Test Artist","uri":"Test Artist/Test Album/01 - First Silence.mp3"}]}` (live; optional `id`, `disc_number`, `track_number`). 404 `{success:false,message}`.
- `GET /api/player/<name|active>/meta[/<key>]` → `{"player_name","metadata":{...}}`; 404 body is plain text `Player 'x' not found`.
- `GET /api/library/<player>` (counts, `is_loaded`), `/albums` → `{"player_name","count","albums":[{id,name,artists[],release_date,tracks_count,cover_art,uri,album_artist}]}` (live).

## 2. Players

### `GET /api/players` (`players.rs:275`, `PlayerInfo` :176)
```json
{"players":[
 {"name":"mpd","id":"127.0.0.1:6600","state":"playing","is_active":true,"has_library":true,
  "supports_api_events":false,"last_seen":"2026-11-17T00:22:08.501408753+00:00",
  "shuffle":false,"loop_mode":"no","position":2.053,
  "capabilities":["play","pause","play_pause","stop","next","seek","shuffle","loop","queue","killable"]},
 {"name":"demo","id":"demo","state":"stopped","is_active":false,"has_library":false,
  "supports_api_events":true,"last_seen":"…","shuffle":false,"loop_mode":"no","position":null,
  "capabilities":["play","pause","stop","next","previous","seek","shuffle","loop"]}]}
```
(live). Doc shows only name/id/state/is_active/has_library/last_seen — the rest exist (doc ≠ src).
`name` is the stable handle used in URLs; `id` varies by backend (`host:port` for MPD, `demo` for generic) — don't use it for URLs. Empty daemon ⇒ `{"players":[]}`.

**Capabilities** (`src/data/capabilities.rs:12`, serde snake_case): `play, pause, play_pause, stop, next, previous, seek, position, length, volume, mute, shuffle, loop, playlists, queue, metadata, album_art, search, browse, favorites, db_update, killable, receives_updates`. Note `play_pause` (underscore) on the wire (doc says `playpause`, which is only the *command* name).
**Capabilities are dynamic per player state** (live MPD): stopped ⇒ `[play,pause,play_pause,shuffle,loop,queue,killable]`; playing track 1 ⇒ adds `stop,next,seek` but **no `previous`**; playing track 2 ⇒ adds `previous`. They change with `capabilities_changed` events. The doc's static support matrix is wrong for MPD (no `position/length/volume/mute/metadata/album_art` reported).

### Which player is active; how to change it
**There is no endpoint to set the active player** (`set_active_controller`, `src/audiocontrol/audiocontrol.rs:328`, is called only by the `active-monitor` plugin, `src/plugins/action_plugins/active_monitor.rs:61`). The active player is whichever last entered `state: playing`; at that moment ACR sends `Stop` to every other player. To "switch source": `POST /api/player/<name>/command/play` on the target (live: demo `update`→playing made `demo` active and MPD went `stopped`). If `active-monitor` is disabled in config, active never changes. `is_active` on `/players` is authoritative; `active_player_changed` is **never emitted** (§5).
`POST /api/players/pause-all?except=<name|id|alias>` and `/stop-all?except=` → `{"success":bool,"message":"Paused or stopped N players"}` (`players.rs:86,122`).

## 3. Transport commands (`players.rs:355-434`, parser :776)

`POST /api/player/<player>/command/<command>` — `<player>` is the player **name** (exact match, case-sensitive) or the literal `active` (case-insensitive). No body needed (a JSON body is only read for `add_track`/`add_tracks`).
Commands: `play`, `pause`, `playpause`, `stop`, `next`, `previous`, `kill`, `clear_queue` ; `seek:<seconds float>` ; `set_loop:none|track|song|playlist` ; `set_random:true|false|on|off|1|0` ; `remove_track:<n>` ; `play_queue_index:<n>` ; `add_track` body `{"uri":"…","metadata":{…}?}` ; `add_tracks` body `{"uris":[…],"insert_at_beginning":false,"metadata":[{…}|null]?}`.

```
POST /api/player/active/command/pause     → 200 {"success":true,"message":"Command 'pause' sent successfully to player with name: mpd"}
POST /api/player/mpd/command/seek:20.5    → 200 …  (live; position then reads ~22 s)
POST /api/player/bogus/command/play       → 404 {"success":false,"message":"No player found with name: bogus"}
POST /api/player/active/command/frobnicate→ 400 {"success":false,"message":"Invalid command: frobnicate - Unknown command format: frobnicate"}
POST /api/player/active/command/seek:abc  → 400 {"success":false,"message":"Invalid command: seek:abc - Invalid seek position: abc"}
(backend refuses/fails)                   → 500 {"success":false,"message":"Failed to send command '…' to player with name: …"}
no active player & `active`               → 404 {"success":false,"message":"No active player found"}
```
doc ≠ src: **`/api/player/active/send/<command>` documented in `doc/api.md:422-470` does not exist** (no such route; `grep '/send/'` in src finds nothing). Use `/command/`. Success only means the command was *delivered*; confirm via events. The colon in `seek:20.5` is a literal path character.
Unsupported-by-capability commands are not rejected centrally (the backend decides, 500 if it fails) — gate buttons on `capabilities`.

## 4. Volume (system-wide, not per player)
Mounted at `/api/volume` (`src/api/server.rs:269`). Control comes from `services.volume` (`type: "alsa"` or `"dummy"`; absent type ⇒ `dummy`, `src/helpers/global_volume.rs:52`).

`GET /api/volume/info` (`src/api/volume.rs:105`) — always 200:
```json
{"available":true,
 "control_info":{"internal_name":"dummy","display_name":"Master Volume",
                 "decibel_range":{"min_db":-120.0,"max_db":0.0},"volume_scale":"raw"},
 "current_state":{"percentage":50.0,"decibels":-60.0,"raw_value":50},
 "supports_change_monitoring":false}
```
(live, dummy control). `decibel_range`, `decibels`, `raw_value` may each be `null`. `volume_scale`: `"perceptual"` (real ALSA controls with dB data; cube-root curve) or `"raw"` (linear; dummy; treat missing as raw). `percentage` is always 0–100 in that scale. Unavailable: `{"available":false,"control_info":null,"current_state":null,"supports_change_monitoring":false}` (live).
`GET /api/volume/state` → `{"percentage":50.0,"decibels":-60.0,"raw_value":50}`; unavailable → **503** `{"success":false,"message":"Volume control not available","new_state":null}` (live).
`POST /api/volume/set` JSON body, exactly one of `{"percentage":65}` (0–100) | `{"decibels":-30}` | `{"raw_value":80}` (precedence in that order):
```json
{"success":true,"message":"Volume set successfully","new_state":{"percentage":65.0,"decibels":-42.0,"raw_value":65}}
```
Failures are **HTTP 200** with `success:false, new_state:null`: `"Volume percentage 150 is out of range (0-100)"`, `"No volume value provided (percentage, decibels, or raw_value required)"`, `"Volume control not available"`, `"Failed to set volume"` (live). Non-JSON body ⇒ Rocket HTML 400.
`POST /api/volume/increase?amount=N` / `/decrease?amount=N` (default 5 percentage points) → same shape, message `"Volume increased to 90.0%"`.
`POST /api/volume/mute` — **toggle**, no explicit mute/unmute, and **no `muted` field anywhere**. Muting saves the level and sets 0%; unmuting restores the saved level (live: 65 → 0 → 65; doc ≠ src: `doc/api.md:1545` says unmute goes to 50%). Message `"Volume muted at 0.0%"` / `"Volume unmuted at 65.0%"`. Muting at 0% is a no-op ("nothing to mute"). Clients must infer mute from `percentage == 0`.
Event: `volume_changed` (§5). With `supports_change_monitoring:false` the event only fires for changes made through this API; external ALSA changes are only seen when it is `true`.
Players also list `volume`/`mute` capabilities but there is **no per-player volume endpoint** in the router.

## 5. WebSocket event stream
**URL** `ws://<host>:1080/api/events` (all players) or `/api/events/<player_name>` (pre-filtered to one player name) (`src/api/events.rs:875,933`). Behind nginx: `ws://<device>/api/audiocontrol/events`.
**No handshake needed**: a new connection is already subscribed to everything. Sending a subscription is optional and replaces the filter; a message is JSON `{"players":[names]|null,"event_types":[types]|null}` (`null`/omitted = no filter; `"*"` is a player wildcard). **`players` filters on player *name*, not id** (`events.rs:331-336`; doc ≠ src: doc says ids). Unknown players/types are silently accepted (no error, no events). On `/events/<name>`, omitting `players` keeps the connection on that player (`events.rs:781`). `volume_changed` has no player so it counts as player `"system"`: a name-filtered subscription never receives it unless `"system"` is listed.
Server frames to the client:
```json
{"type":"welcome","client_id":1,"message":"Connected to ACR WebSocket API"}                       // (live) doc text differs, no client_id in doc
{"type":"subscription_updated","message":"Subscription updated successfully"}                     // (live) doc says "Subscription updated"
{"type":"error","message":"Invalid message format: expected ident at line 1 column 2. Expected EventSubscription."}  // (live) NO "code" field; doc's 1001/1002/1003 codes do not exist
```
**Keep-alive**: server sends a WebSocket *ping frame* every 30 s (`events.rs:50`; seen live at t=30.0 s); the browser answers automatically. Idle clients (no inbound frame, pongs count) are dropped after 3600 s, silently (`:23`). Nothing needed from JS. On daemon shutdown: Close code 1001. Reconnect on every close; **events during a gap are not replayed** — re-read `/api/now-playing` + `/api/players` after (re)connect. Server keeps events 30 s only for already-connected clients.

**Common envelope** (every player event; `convert_to_websocket_message`, `events.rs:470`): top-level `type`, `player_name`, `player_id`, plus `source:{player_name,player_id}`. **Ignore `source.player_id`** — it is `"<name>:6600"` for every player (hard-coded, `events.rs:477`; live `"mpd:6600"` while the real id is `"127.0.0.1:6600"`). Key order in frames is alphabetical, irrelevant.

| `type` | extra fields | live sample / notes |
|---|---|---|
| `state_changed` | `state` (PlaybackState string) | `{"type":"state_changed","player_name":"mpd","player_id":"127.0.0.1:6600","state":"playing"}`. **Duplicates are common** (two `playing` on start; one per seek). Be idempotent. |
| `song_changed` | `song` Song \| `null` | full Song object as in now-playing; fires on track change and on `play` from stopped. |
| `song_information_update` | `song` (partial) | Late enrichment. `title`/`artist` only identify the song; **absent field = unchanged**; apply only if they still match the shown song. Only fires when a metadata/lastfm/external-cover provider is enabled (not in the local setup). |
| `position_changed` | `position` float seconds | **MPD never emits it** (no emitter in `mpd.rs`). Emitted by librespot, raat, bluetooth, lms, generic (live: `{"position":42.5}` after a push). Duration is not included. |
| `loop_mode_changed` | `mode` `"no"\|"song"\|"playlist"` | live `{"mode":"playlist"}`. Field is `mode`, not `loop_mode`. |
| `shuffle_changed` | `shuffle` bool, `enabled` bool (dup) | live. Subscription alias `random_changed` also accepted. |
| `capabilities_changed` | `capabilities` string[] | live; fires on every transport-relevant change (see §2). |
| `queue_changed` | – | re-fetch `/player/<n>/queue`. Not all backends emit it. |
| `library_changed` | `library_version`, `library_generation` (string\|null) | doorbell; re-GET `/api/library/<p>`. |
| `database_updating` | `artist, album, song, percentage` (all nullable) | during library scan |
| `active_player_changed` | `new_player_id` | **Never emitted**: `notify_active_player_changed` (`player_controller.rs:614`) has no caller. After a `state_changed → playing` re-GET `/api/players` or `/api/player` to learn the active one (live: no event when `demo` took over from `mpd`). |
| `volume_changed` | `control_name, display_name, percentage, decibels\|null, raw_value\|null` | **No `player_name`/`player_id` at top level**; `source:{"player_name":null,"player_id":"system:6600"}`. Live: `{"type":"volume_changed","control_name":"dummy","display_name":"Master Volume","percentage":65.0,"decibels":-42.0,"raw_value":65}`. |

No `metadata_changed` event exists. No dedicated "players list changed" event exists (hot-plug isn't modelled; re-fetch `/api/players` on reconnect and on `state_changed`).
Events from *inactive* players are delivered too (unless filtered) — filter on `player_name === active.name` in the UI.

## 6. Favourites / radio
**Favourites** (metadata daemon; mounted `/api/favourites`, `crates/audiocontrol-metadata/src/api/mod.rs:57`; **not on the player daemon in production builds**). Keyed by `artist`+`title` strings, not by id. Results are serde `Result` wrappers and **HTTP status is 200 even for `Err`** (doc ≠ src: `doc/api.md:2690-2770` promises 400):
```
GET    /api/favourites/providers → {"enabled_count":1,"enabled_providers":["settingsdb"],"providers":[{"name":"settingsdb","display_name":"User settings","enabled":true,"active":true,"favourite_count":0},{"name":"lastfm",…,"enabled":false},{"name":"spotify",…}],"total_providers":3}
GET    /api/favourites/is_favourite?artist=A&title=T → {"Ok":{"is_favourite":false,"providers":[]}}    (live; providers are display names)
POST   /api/favourites/add    {"artist":"A","title":"T"} → {"Ok":{"success":true,"message":"Added 'T' by 'A' to favourites","providers":["settingsdb"],"updated_providers":["settingsdb"]}}
DELETE /api/favourites/remove {"artist":"A","title":"T"} → {"Ok":{…"Removed…"}}
empty artist/title → 200 {"Err":{"error":"Invalid song: Artist cannot be empty"}} ; missing field/param → Rocket HTML 422
```
`song.liked` is set only by the Last.fm worker (`lastfm_worker.rs:812`); a local favourite never appears in `song.liked`. The UI must call `is_favourite` itself per song. Spotify provider is read-only.
**Radio / webradio**: no radio API. A radio station is just an MPD queue item whose URI is an `http(s)://` stream (`POST …/command/add_track {"uri":"http://…"}` then `play_queue_index:<n>`). Songs from streams have `stream_url` = the URL, no `duration`, title/artist split from the ICY title (`GET/POST /api/player/<n>/splitter/<b64 station>` tunes the split order), and `cover_art_url` = station logo with `metadata.cover_art_source:"station_logo"` until a lookup replaces it. No station list/browse/search endpoint exists (`browse`/`search` capabilities exist, but no REST route uses them). LMS/Spotify/“radio” backends are the only other radio-ish paths.

## 7. Version / config keys
- Version: `GET /api/version` → `{"version":"0.25.0"}`; `GET /api/capabilities` → `{"version":"0.25.0","images":{"sizes":[100,140,200,280,400,800]}}` (a daemon lacking it returns 404 ⇒ no resizing).
- Config (`audiocontrol.json`): `services.webserver.{enable,host,port}`; `players[]` entries `{"<type>":{…}}` (`mpd|generic|null|lms|librespot|raat|shairport|bluetooth|mpris`, `src/players/player_factory.rs:57-216`), plus `players.d/*.json` includes next to the config (`src/config.rs:12`); `services.volume.{enable,type,display_name,initial_percent}`; `services.datastore.*`; `action_plugins[]` (`active-monitor` needed for active-player switching).

## 8. Doc-vs-source disagreements (all verified)
1. `POST /api/player/active/send/<cmd>` documented (`doc/api.md:422-470`), route does not exist.
2. State/loop casing: docs show `Playing|Paused|Stopped`, `None|Track|Playlist`; wire is `playing|paused|stopped`, `no|song|playlist`.
3. `/api/players` and `/api/now-playing.player` carry more fields than documented (`supports_api_events, shuffle, loop_mode, position, capabilities`).
4. Capability wire name is `play_pause`, docs say `playpause`; MPD matrix in `doc/api.md:1204-1240` doesn't match live (capabilities are state-dependent, no `position/length/volume/mute/metadata/album_art`).
5. `song.uri` in `doc/websocket.md` / generic-player docs: field is `stream_url` (no `uri`).
6. WebSocket: welcome includes `client_id` and different text; `subscription_updated` text differs; error frames have no `code` (1001–1003 don't exist); `players` filter matches names not ids; example comment "players: null for active player" is wrong (null = all). `doc/websocket.md` `active_player_changed` is documented but never emitted; `position_changed` is never emitted by MPD.
7. `volume/mute`: docs say unmute → 50%; source restores the previous level.
8. Favourites errors: docs say HTTP 400; source returns 200 `{"Err":…}`.
9. `doc/api.md:116-130` says port 1080 alone doesn't serve metadata routes; true for the shipped deb, false for a default `cargo build` (metadata linked in-process).
10. `POST /api/player/<n>/update` request format: `doc/api.md` shows a Librespot-specific shape (`event`, `NAME`…); the generic player takes `{"type":"state_changed|song_changed|position_changed|shuffle_changed|loop_mode_changed|queue_changed|stream_info",…}` (`generic_controller.rs:203-224`). (An older duplicate handler `update_player_state`, `players.rs:707`, is not mounted.)

## 9. UI gotchas (short list)
- Seed state with REST, then apply events; re-seed after every reconnect. There is no active-player-change event.
- Interpolate position locally from `position` + `state` (MPD emits no `position_changed`); re-sync on `state_changed` and after seek.
- Filter events by `player_name` (active player) yourself; use top-level `player_name`, never `source.*`.
- Percentages depend on `volume_scale`; mute is only visible as 0%.
- Commands answer success before the state changes; wait for the event, not the HTTP reply.
