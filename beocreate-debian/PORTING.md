# Beocreate on the Debian foundation (hbosng) — port notes

Goal: run the classic Beocreate interface as the UI for HiFiBerryOS NG
(Debian 13 / hbosng), talking to the new backends: ACR (audio control,
port 1080), the Configurator (port 1081), and sigmatcpserver (DSP,
TCP 8086 re-enabled via systemd override). The kiosk shows it with
`kiosk-mode.sh setup --url=http://localhost:8080`.

## Layout

- `server/` — the Beocreate Node server (vendored lean from
  hifiberry/create@b86115b, MIT). Port target: Node >= 20.
- `mock-backend/` — mock ACR, mock backlight sysfs and mock `systemctl`
  for development and CI testing in a container. Mocks implement the
  documented ACR API (see references below), so tests exercise the
  documented contract —
  but parts of that contract are underdocumented and had to be
  invented for the mock (see "Contract notes / on-device verification
  items"); those parts are only as good as the assumptions listed
  there until verified against a real device.
- `tests/` — Playwright specs driving the real UI in Chromium against
  the server + mocks.
- `package/` — Debian packaging (`beocreate-classic-ui` .deb), systemd
  unit, sigmatcp TCP re-enable override, nginx site and auth-gateway
  manifest, following the conventions of the hbosng `packages/` tree
  (available in this repo as branch `hbosng`).
- `touch-timeout/` — Debian packaging (`touch-timeout` .deb,
  `Architecture: any`, sbuild like the hbosng C packages) of
  github.com/ajmccaus/touch-timeout at the buildroot package's pin; the
  backlight dimming daemon (ADR 0002).

## Backend mapping (from the portability assessment)

| Beocreate need | Old (buildroot) | New (hbosng) |
|---|---|---|
| player status/switch | audiocontrol2 REST :81 | ACR REST :1080 `/api/players`, `/api/player/active/command/<cmd>` |
| metadata push | ac2 HTTP POST to beocreate | ACR WebSocket `/api/events` (state_changed, song_changed, song_information_update, volume_changed) |
| now playing + art | ac2 `/api/track/metadata` | ACR `/api/now-playing`, cover art API |
| volume | ac2 `/api/volume` + amixer | ACR `/api/volume/info`, `/api/volume/set` |
| DSP | raw SigmaTCP :8086 + dsptoolkit CLI | same SigmaTCP :8086 (override removes `--disable-tcp`) |
| hostname/services | hostnamectl/systemctl | same on Debian (or Configurator REST) |

API references used to build the mock (fetched from upstream docs):
ACR REST `doc/api.md`, ACR WebSocket `doc/websocket.md` in
github.com/hifiberry/acr (event contract checked at 0.23.6, e8c45df);
`docs/backend-apis.md` on the hbosng branch.

## Config

`/etc/beocreate/system.json`: `port` 8080 is the public port (advertised
by bonjour, used in artwork URLs); on the device it belongs to nginx
(`package/beocreate.nginx`, behind the hifiberry-auth gateway, ADR 0001),
which proxies to the server on loopback `listenPort` (default 8081). Both
server listeners (HTTP and the optional HTTPS) bind 127.0.0.1 only.
Backend URLs configurable via `system.json` keys `acrAddress`
(default `http://127.0.0.1:1080`) and env overrides for testing.
`BEO_BACKLIGHT_DIR` overrides `/sys/class/backlight` and `BEO_SYSTEMCTL`
the `systemctl` binary for the screen extension (the tests point them at
the mock sysfs and `mock-backend/mock-systemctl.js`).

## New: screen extension (brightness)

Extension `screen` in `server/beo-extensions/screen/` (ADR 0002):
- Menu panel in the Beocreate UI (same look as sound settings) with a
  brightness slider.
- Backend detects the backlight device the pinned daemon would (see the
  device bullet below) for its `max_brightness` and maps percent to raw as
  `max(15, min(255, round(pct * max_brightness / 100)))`: 15-255 is
  touch-timeout's `-b` range (outside it the pinned daemon silently runs
  its default 150). The persisted floor is `min(100, ceil(1500 /
  max_brightness))` % (6 % at 255; 100 % below `max_brightness` 15), so a
  persisted 0 can never leave the kiosk dark; a persisted value below it is
  clamped up at startup. In direct mode the raw write is also capped at
  `max_brightness` (the kernel rejects a larger value).
- The level persists in `/etc/beocreate/screen.json`, written once per
  drag when the slider has settled (500 ms without a message; slide and
  release send the same message). The UI always shows this level, never
  sysfs (which holds the dim level while the screen is dimmed).
- Backlight device: chosen as the pinned daemon chooses it
  (`main.c find_backlight_device`), the first entry in `readdir` order whose
  name does not start with `.` or contain `..` — `fs.opendirSync` (unsorted),
  not `fs.readdirSync` (sorted), and no brightness/max_brightness check. With
  two backlights both pick the same one.
- `max_brightness` below 15: the percentage floor is capped at 100 %, so the
  panel is held at full brightness rather than persisting > 100 %; direct mode
  also caps the raw write at `max_brightness` (the kernel rejects a larger
  value), and the daemon caps `-b` to it itself (`main.c:577-582`).
- Mode, queried once per drag (and at startup / on wake) with
  `systemctl is-active touch-timeout.service` — whether the daemon is actually
  **running**, so an admin-stopped, disabled or crash-looping unit (all still
  "loaded") is not treated as the backlight writer:
  - **daemon mode** (`active`): touch-timeout is the only backlight
    writer; the extension never writes sysfs and there is no live
    preview. On settle it atomically writes `BEO_SCREEN_ARGS=-b <raw>` to
    `/etc/beocreate/touch-timeout.env` and `try-restart`s
    `touch-timeout.service` (never *starts* a unit the admin stopped), whose
    drop-in (`package/touch-timeout-brightness.conf`) runs
    `/usr/bin/touch-timeout $BEO_SCREEN_ARGS` (unbraced: no file, no
    arguments, the daemon's defaults). At startup the env file is
    rewritten from `screen.json`, restarting the daemon only if it
    changed. Playback starting from standby (bus `sourcesChanged` with
    `fromStandby` and a `currentSource`) wakes the screen with
    `systemctl kill --signal=SIGUSR1 touch-timeout.service`.
  - **direct mode** (not running, or `systemctl` fails — then no daemon is
    writing, so there is no second writer): every slider message writes
    `brightness` in sysfs; startup restores the level.
- Both modes mirror the persisted level into `touch-timeout.env`, so whenever
  the daemon next starts (installed or `systemctl start` while the server runs)
  it comes up at the slider's `-b` rather than its default.
- Dimming is turned off with `systemctl mask` (or `disable --now` plus leaving
  it stopped): `is-active` then reports not-running and the extension drives
  the backlight directly.

## Test criteria (Playwright, all must pass)

1. Server boots on :8080 with mocks; `/` serves the app shell.
2. UI loads in Chromium with no fatal JS errors; now-playing shows the
   mock track's title/artist.
3. Transport: play/pause in the UI reaches the mock ACR as a player
   command.
4. Sources: the mock's players are listed; activating one sends the
   right ACR call.
5. Volume: changing volume in the UI updates the mock ACR volume.
   The play/pause transport command is asserted to be exactly
   `playpause`.
6. Screen (direct mode): brightness slider writes the expected scaled
   value to the mock backlight file; value persists across a server
   restart.
7. Events (push): a `song_changed` event pushed over the mock's
   WebSocket updates the now-playing title/artist in the DOM.
8. Events (push): a pushed volume change moves the client's volume
   slider.
9. Events (push): a pushed player-state change flips the play/pause
   control.
   Criteria 7-9 have no polling fallback; with `connectEvents()`
   disabled in `beocreate_essentials/acr.js` all three fail (verified).
10. Player naming: with the mock's Spotify player named `librespot`,
    the UI still shows the source as "Spotify" and activation posts to
    `/api/player/librespot/command/play` (not the `spotify` alias).
11. No volume control: with the mock reporting
    `/api/volume/info -> available:false`, volume changes from the UI
    don't crash the server, and the UI is told `volumeControl` is
    unavailable.
12. Brightness floor: the UI can neither apply less than raw 15 nor
    persist less than 6 %; a persisted lower value is clamped up at
    startup.
13. WebSocket Origin check: a handshake with Origin `http://evil.example`
    or `null` is refused (403); a same-origin one (raw and from Chromium)
    and one without Origin are accepted.
14. No REST POST route: `POST /general-settings/restartProduct` is 404.
15. Loopback only: a TCP connect to the machine's first non-internal
    IPv4 address on the server port is refused (skipped if there is none).
16. touch-timeout daemon mode (mock `systemctl` reports it `loaded`): the
    slider never writes the backlight file; each settled drag writes the
    mapped `-b` to `touch-timeout.env` and restarts the daemon exactly
    once; a drag to 0 gives `-b 15`; with a dim value in the backlight
    file the slider still shows the saved level; at startup a deleted env
    file is rewritten with one restart, an unchanged one causes none.
17. Wake on play (daemon mode): a pushed state change from nothing
    playing to playing logs exactly one
    `systemctl kill --signal=SIGUSR1 touch-timeout.service`; a second
    push while already playing logs none.
18. Late enrichment: after a pushed `song_changed` without artwork, a
    `song_information_update` carrying only `cover_art_url` (title/artist
    matching) makes the DOM artwork the proxied image; title, artist and
    album stay as they were.
19. Stale `song_information_update`s (different title, different artist, or
    neither) never reach the client: no WebSocket frame the page receives
    carries them. The barrier after them is a lookup the mock applies as ACR
    does (artwork over an art-less song), and a second lookup for a song that
    already has artwork is not applied.
20. A rename reaches hostnamectl as argv (no shell): the pretty name is one
    argument exactly as typed (quotes, `$`, `&`, `;` included); the static
    name keeps only `[a-z0-9-]`.
21. The settings channel is not reachable over the WebSocket: a
    `settings/saveSettings` message writes no file.
22. The artwork proxy relays only ACR's image routes; any other ACR path,
    including one reached through `..`, is 404 and never reaches ACR.
23. touch-timeout installed but not running (stopped/disabled/Condition
    failed), or `systemctl` failing: direct mode — the slider writes the
    backlight, `touch-timeout.env` still mirrors the level, and the daemon is
    never started.
24. `max_brightness` 31 (Touch Display 2), daemon mode: the floor is 49 %
    (`-b 15`); full scale is `-b 31`.
25. `max_brightness` 10 (any panel below 15): persisted level never exceeds
    100 % and the raw write never exceeds `max_brightness`.
26. Two backlights: the extension drives the first in `readdir` order (the one
    touch-timeout picks).
27. Shut Down runs `systemctl poweroff`; when it fails the server exits
    non-zero so systemd restarts the UI.
28. ACR started after the server: once the event stream connects, the sources
    ACR reports are enabled again and the playing one is current.
29. Transport capabilities come from `GET /api/players`: a player ACR reports
    without `next` gets no next button, even after a pushed state change.

Cover art (criterion 2) is additionally asserted to be served through
the Beocreate server's artwork proxy (below), with the proxied bytes
matching the mock's image.

## Status

All twenty-nine Playwright criteria above pass (see "Running the tests").

## Patches applied to the vendored server

Kept as small as possible; the client-side code (`*-client.js`, `.html`,
`.css`) is untouched except for one new entry in the default view's
`manifest.json` navigation list (for the new screen extension).

- `beo-system/beo-server.js` — data directory `/etc/beocreate` is now
  `process.env.BEO_CONFIG_DIR || "/etc/beocreate"` so tests can point the
  server at a temp dir. The HTTP server listens on `listenPort` (new
  key, default 8081) and the HTTPS server on `httpsPort`, both on
  127.0.0.1 only. The REST endpoint `POST /:extension/:header/:extra*?`
  and its `express.json()` body parser are deleted (ADR 0001).
- `beocreate_essentials/acr.js` — **new** shared module wrapping the
  documented ACR REST API and the `/api/events` WebSocket stream (single
  subscription, reconnect with backoff, events re-emitted on a local
  EventEmitter). Base URL: `system.json` key `acrAddress`, overridable
  with `BEO_ACR_ADDRESS`. Also exposes `fetchRaw()` for streaming
  non-JSON resources (cover art) from ACR. `sendActiveCommand` posts to
  `/api/player/active/command/<cmd>` (0.23.6 serves no `.../send/` route).
  While connected it re-sends the subscription every few minutes
  (`BEO_ACR_KEEPALIVE_MS`): against ACR < 0.22 nothing else refreshes the
  server's prune timer (see "Contract notes"); from 0.22 the ping/pong does,
  so it is a cheap safety net that works regardless of the installed version.
- `beo-extensions/sources/index.js` — backend half rewritten from
  audiocontrol2 REST (127.0.1.1:81) to ACR:
  - `audioControlGet("status"/"metadata")` now fetch `/api/players` and
    `/api/now-playing` and translate to the old audiocontrol2 shapes, so
    `processAudioControlStatus`/`processAudioControlMetadata` and
    everything downstream (including all client code) stay unchanged.
  - `audioControl()` transport commands →
    `POST /api/player/active/command/<cmd>` (`playPause` → `playpause`);
    source activation → `POST /api/player/<name>/command/play`;
    love/unlove report failure (`loveSupported` is false).
  - Activation/per-player commands use the player name ACR *actually*
    reported: `matchAudioControlSourceToExtension` records it as
    `acrPlayerName` on the matched source whenever the player list or
    metadata is processed, and `startSource` prefers it over the first
    `aka` alias (a real device may call the Spotify player
    `librespot`; addressing it as `spotify` would 404).
  - **Cover art proxy**: ACR is localhost-only, so its artwork URLs
    (`http://127.0.0.1:1080/...`) don't work for remote browsers. The
    server registers `GET /acr-artwork/<path>` on the Beocreate Express
    server, which streams the image from the ACR base URL server-side
    (content type passed through) **only for ACR's image routes**
    (`/api/imagecache/`, `/api/library/<player>/image/`,
    `/api/coverart/artist/<id>/image`), resolving dot segments first; any
    other path is 404, so the proxy cannot relay ACR's non-image GETs (e.g.
    a Spotify OAuth token) at Beocreate's gateway tier. Metadata sent to the
    client carries
    `picture` as the relative path `acr-artwork/<path>` with
    `picturePort` set to the Beocreate server's own port, which the
    untouched now-playing client resolves as
    `<protocol>//<hostname>:<picturePort>/acr-artwork/<path>`. Truly
    external artwork URLs (not on the ACR base) pass through
    unchanged.
  - ACR WebSocket events `state_changed`, `song_changed`,
    `song_information_update` (merged, see "Contract notes"),
    `capabilities_changed` are translated onto the same processing
    functions (replaces audiocontrol2's HTTP pushes). On `connected`
    (every reconnect) it re-runs `checkEnabled` before the status/metadata
    resync, so sources ACR reports are re-derived from `/api/players` instead
    of being left at whatever the systemd fallback decided while ACR was down.
  - Transport capabilities: `translatePlayersToStatus` reads each player's
    `capabilities` from `GET /api/players` (0.23.6, snake_case) into
    `supported_commands`; `capabilities_changed` events update them too. The
    default set is used only for a player that reports none.
  - `processAudioControlMetadata` gained a guard for players whose
    extension isn't installed (the old code defaulted to `bluetooth`,
    which is dropped).
  - `stopAllSources()` uses `POST /api/players/pause-all` instead of
    `/opt/hifiberry/bin/pause-all`.
- `beo-extensions/sound/index.js` — volume backend rewritten from
  amixer/audiocontrol2 to the ACR volume API: availability from
  `GET /api/volume/info`, reads from `GET /api/volume/state`, writes via
  `POST /api/volume/set {percentage}`, external changes from the
  `volume_changed` event. Volume mapping/range, mute logic, interact
  triggers and all UI messages (`systemVolume`) unchanged.
  `checkCurrentMixerAndReconfigure` is a no-op (ACR owns the pipeline).
  When no volume control is available (`/api/volume/info` reports
  `available:false`), `setVolume`/`getVolume` now guard their optional
  callback (the UI's `setVolume` message arrives without one — calling
  `callback(null)` unguarded would crash the server) and report
  `systemVolume` with a falsy `volumeControl` to the UI, like the old
  amixer-less path.
- `beo-extensions/mpd/index.js` — `getMPDStatus` asks ACR for an `mpd`
  player (fallback: systemd). Everything else untouched; the direct MPD
  socket connection still works when `/var/run/mpd/socket` exists.
- `beo-extensions/spotify/index.js` — `getspotifyStatus` asks ACR for a
  spotify/librespot player (fallback: systemd); `aka` extended to
  `["spotify", "librespot", "spotifyd", "vollibrespot"]` so ACR player
  names map to this source; removed the vollibrespot.conf-based
  auto-disable (enablement now comes from ACR).
- `beocreate_essentials/dsp.js` — default SigmaTCP address `127.0.1.1` →
  `127.0.0.1` (sigmatcpserver runs with `--localhost` on hbosng),
  overridable with `BEO_DSP_ADDRESS`. `flashEEPROM` runs `dsptoolkit
  install-profile` with the program path as an argv element (`execFile`), not
  concatenated into a shell command.
- `beocreate_essentials/pi_system_tools.js` — `setHostname` passes the name to
  `hostnamectl` as argv (`execFile`), never through a shell, and the static
  name keeps only `[a-z0-9-]`; `BEO_HOSTNAMECTL` is the binary (test seam).
  `power("shutdown")` runs `systemctl poweroff` (Debian has no buildroot
  `shutdown-system`); a failed power command `process.exit(1)`s so systemd
  (`Restart=always`) brings the UI back rather than leaving it with no listener.
- `beo-system/beo-server.js` — the client-reachable `settings` bus target is
  inert in the WebSocket dispatch (ADR 0001): no client sends to it, and it
  writes any extension's file (system.json, with its `runAtStart` exec,
  included). Server-side `beo.saveSettings` is unaffected.
- `beo-extensions/general-settings/index.js` — defines `var debug = beo.debug`
  (it referenced `debug` undefined, so Settings > Shut Down/Restart threw
  before emitting the request).
- `beocreate_essentials/communication.js` — `startBonjour` wrapped in
  try/catch so unavailable mDNS (containers) can't crash the server. The
  WebSocket refuses (403) a handshake whose `Origin` is present but does
  not parse as a URL (e.g. `null`) or whose host differs from the `Host`
  header (case-insensitive); a handshake without `Origin` (non-browser
  client) is accepted (ADR 0001).
- `beo-views/default/manifest.json` — added `screen` to the `full`
  navigation set.
- `server/package.json` — **new**; declares the runtime dependencies
  (express, websocket, eventemitter3, underscore, xml-js, node-fetch@2,
  mpd-api, dnssd2, aplay).

New extension: `beo-extensions/screen/` (backend + `menu.html` +
`screen-client.js` + symbols). The brightness slider copies the sound
extension's `slider-wrap` markup/behaviour 1:1.

## Contract notes / on-device verification items

Documented by ACR (`doc/websocket.md`, `doc/api.md` at 0.23.6) and
mirrored by the mock:

- **Event identity**: the port reads each event's top-level
  `player_name`, never `source.*` (`source.player_id` is documented as
  wrong for every player but MPD; the mock reproduces it).
- **`metadata_changed` never existed.** Late enrichment (cover art,
  lookups) arrives as `song_information_update`, a *partial* update:
  `title`/`artist` only identify the song, and an absent field means
  unchanged, never cleared. It can arrive after the next `song_changed`,
  so the port applies it only when each `title`/`artist` it carries matches
  the song held for that player (ACR's own rule, `apply_song_information`,
  `player_controller.rs:759`); then a present `album`, `uri` or
  `cover_art_url` (proxied like `song_changed` artwork) is merged in. ACR
  itself merges only `cover_art_url`, `liked` and `metadata`, never `album`
  or `uri`, and publishes the full stored song only when the merge changed it
  (`api.md:624`); the port's extra `album`/`uri` merge is harmless against the
  full-song event but is not ACR's rule. The mock mirrors ACR: it broadcasts
  the merged full song, only on a change, and never replaces artwork a song
  already has (`song.rs cover_art_is_replaceable`). `/__test/event` carries a
  raw partial for the stale/mismatched cases ACR never actually sends as a
  full-song event.
- **`volume_changed`** is `{type, control_name, display_name, percentage,
  decibels?, raw_value?}` with no player source; the sound extension
  reads `percentage`, which is in the domain of the REST volume
  endpoints, so the event and REST paths agree. Since ACR 0.21.0 that
  domain defaults to perceptual for controls with usable dB data
  (before: the raw mixer position), so a percentage stored against an
  older daemon — `volumeControlRange` in `/etc/beocreate/sound.json` —
  now maps to a different level (api.md's example: 78 % is -22.8 dB raw,
  -6.3 dB perceptual); the port stores no scale with it.
- **Keep-alive**: the event subscription only listens. ACR >= 0.22.0
  pings every client every 30 s and the `websocket` client pongs on its
  own; an older ACR silently prunes a client that sent nothing for an
  hour. `Recommends: hifiberry-audiocontrol (>= 0.22)` is advisory and the
  `dpkg -i` + `apt -f install` path ignores it, so `acr.js` also re-sends the
  subscription every few minutes while connected (`websocket.md:502-524`): one
  frame, answered with `subscription_updated`, that refreshes the prune timer
  against any ACR version and costs nothing against a current one. It
  reconnects on every close, clean or not (0.22.0 sends close code 1001 on
  shutdown), and re-reads state.

The mock had to *invent* semantics where the upstream docs are silent.
Each of the following is an assumption baked into the mock (and thus
into the green test suite) and must be verified against a real hbosng
device before the port can be called contract-proven:

- **`play` command activates a player and pauses the others**: the
  mock's `POST /api/player/<name>/command/play` marks that player
  active and pauses all other playing players. Whether real ACR
  performs this exclusive-activation is undocumented; if it doesn't,
  source switching may leave two players playing.
- **Player naming**: the mock names its players `mpd` and `spotify`
  (override: `MOCK_ACR_SPOTIFY_NAME`, exercised with `librespot` in
  criterion 10). Real devices may use yet other names; the port
  records whatever name ACR reports and uses it for per-player
  commands, but the `aka` alias lists in the mpd/spotify extensions
  must cover the real names for the sources to be *enabled* at all.
- `/api/now-playing`'s `song` shape is only loosely documented ("title,
  artist, album, etc."). The port reads artwork from `coverart_url`,
  `artwork_url` or `cover_art_url` (the mock uses `cover_art_url`, the
  key documented for both now-playing and the song events) and title from
  `title`/`name`; relative artwork URLs go through the artwork proxy. The
  stream URL (mpd's radio/music child-source choice) is read from `uri`,
  as in websocket.md's `song_changed` example, but ACR's `Song` type
  (`crates/acr-types/src/song.rs` at 0.23.6) names it `stream_url`.
- Transport capabilities: `GET /api/players` carries each player's
  `capabilities` (`players.rs:300-311`, `PlayerCapability` serialised
  snake_case), and `capabilities_changed` updates them; the port maps them to
  `supported_commands` and falls back to play/pause/playpause/stop/next/
  previous only for a player that reports none (the UI surfaces
  play/pause/next/previous). The mock's players carry the field; whether a
  given backend reports a reduced set on a real device is unverified.
- Source activation is implemented as `POST /api/player/<name>/command/play`
  (there is no dedicated "activate" endpoint in the ACR docs).

## Running the tests

```
beocreate-debian/run-tests.sh
```

Installs npm dependencies for `server/`, `mock-backend/` and `tests/`,
then runs Playwright (Chromium; honours `PLAYWRIGHT_BROWSERS_PATH`, falls
back to the newest `chromium-*` build found there). Each spec file starts
its own mock ACR (:1080), mock backlight directory and beo-server (its
`systemctl` is the logging mock) and tears them down; port 8080/1080 must
be free. There is no nginx in the suite: the server listens directly on
:8080 (`listenPort` = `port`).
The ten spec files cover the twenty-nine criteria: `01-ui` (1-5),
`02-screen` (6, 12), `03-events` (7-9, pushed WebSocket events),
`04-player-naming` (10, mock started with
`MOCK_ACR_SPOTIFY_NAME=librespot`), `05-no-volume` (11, mock started
with `MOCK_ACR_VOLUME_AVAILABLE=0`), `06-exposure` (13-15, 20-22),
`07-touch-timeout` (16-17, mock `systemctl` reporting touch-timeout
`active`), `08-acr-enrichment` (18-19, pushed `song_information_update`),
`09-screen-hardware` (23-26, the mode gate and mapping on other hardware:
`MOCK_BACKLIGHT_MAX`, a non-active or failing `systemctl`, a second
backlight) and `10-system` (27-29, shutdown, ACR up after the server, and
`/api/players` capabilities via `MOCK_ACR_SPOTIFY_CAPABILITIES`). Screenshots
of the now-playing screen and the screen-brightness panel are written to
`tests/screenshots/`.

## Installing on an hbosng device

1. Build the package (needs `node`, `npm`, `dpkg-deb`; architecture-
   independent):
   `beocreate-debian/package/build.sh` → `beocreate-classic-ui_<v>_all.deb`.
   For screen dimming also build touch-timeout (needs sbuild, like the
   hbosng C packages). It is `Architecture: any`, so it must be built for the
   device: in a full hbosng checkout it sources `scripts/cross-compile-env.sh`
   and cross-builds via the sbuild wrapper (arm64); standalone it honours
   `ARCH` (default `arm64`) and `DIST` to pick the `<DIST>-<ARCH>-sbuild`
   chroot — an x86 host still targets the Pi unless `ARCH=amd64` is set:
   `beocreate-debian/touch-timeout/build.sh` → `touch-timeout_<v>_<arch>.deb`.
2. `apt install ./beocreate-classic-ui_<v>_all.deb ./touch-timeout_<v>_<arch>.deb`
   (or `dpkg -i` + `apt -f install`). Requires `nodejs >= 20`, `nginx` and
   `hifiberry-auth`; recommends `hifiberry-audiocontrol (>= 0.22)`,
   `hifiberry-dsp` and `touch-timeout`. touch-timeout's own scripts
   (dh_installsystemd) enable and start its unit, which only starts when
   `/sys/class/backlight/*` exists. beocreate-classic-ui ships, as
   conffiles, the nginx site
   `/etc/nginx/sites-available/beocreate` (enabled by the packaged
   symlink in `sites-enabled/`) and the gateway manifest
   `/etc/hifiberry/auth.d/beocreate.json` (prefix `/api/beocreate`, tier
   `ok`); hifiberry-auth's dpkg trigger on `auth.d` restarts the gateway
   so it loads the manifest.
3. postinst installs `/etc/beocreate/system.json` (first install only),
   enables+starts `beocreate2.service` (loopback port 8081) and
   try-restarts `sigmatcpserver.service` so the packaged drop-in
   (`/usr/lib/systemd/system/sigmatcpserver.service.d/10-beocreate-enable-tcp.conf`,
   which removes `--disable-tcp`) takes effect, likewise
   `touch-timeout.service` for its brightness drop-in
   (`touch-timeout.service.d/20-beocreate-brightness.conf`), then runs
   `nginx -t` and reloads nginx if it is running (postrm `remove` does
   the same once the site symlink is gone). The unit and the
   drop-ins live in the package-owned `/usr/lib/systemd/system` tree
   (not `/etc/systemd/system`, which belongs to the admin). The
   maintainer scripts use `deb-systemd-helper`/`deb-systemd-invoke`
   when available (falling back to plain `systemctl`); `postrm remove`
   also try-restarts `sigmatcpserver`/`touch-timeout` so their drop-in
   effects stop, and `postrm purge` removes the whole `/etc/beocreate`
   tree (the server creates subdirectories there, so an `*.json`-only
   purge left leftovers). The package is `Architecture: all`: `npm ci`
   installs the tested `server/package-lock.json` (not a fresh resolve) with
   `--omit=optional`, and the multi-platform prebuilds of
   `bufferutil`/`utf-8-validate` (hard dependencies of `websocket`, with
   pure-JS fallbacks) are pruned; the build fails if any `.node` binary
   remains. It ships `/usr/share/doc/<pkg>/copyright` (Policy 12.5).
4. Point the kiosk at it: `kiosk-mode.sh setup --url=http://localhost:8080`.

Note: the .deb was built and inspected in the development container
(`dpkg-deb -I`/`-c` verified); it has not been installed on a real hbosng
device yet, so postinst/systemd behaviour on-device is untested. The
touch-timeout .deb was built with `dpkg-buildpackage -b` (Ubuntu 24.04
amd64, debhelper 13.14; no sbuild or arm64 build), its unit and drop-ins
pass `systemd-analyze verify`, and it was inspected the same way.

On-device checks for the auth gateway (ADR 0001; the nginx site was
exercised in the container against nginx 1.24 and the gateway's real
decision code, IPv4 only):
- `ss -ltnp` shows node listening on 127.0.0.1 only and nginx on :8080.
- `listen [::]:8080` and `allow ::1` work (the container has no IPv6;
  nginx refuses the whole configuration where IPv6 is unavailable).
- Policy `all`: a LAN browser on :8080 without a session gets a 302 to
  `http://<host>/`, signs in there, and :8080 then loads.
- The manifest is picked up after install (`/api/beocreate/*` → `ok`)
  without restarting hifiberry-auth by hand.
- The per-request auth subrequest does not visibly slow a phone's page
  load on a Pi.

On-device checks for touch-timeout (ADR 0002; the daemon itself was not run
in the container):
- After boot `systemctl status touch-timeout` shows it running, not a
  failed `ConditionPathExistsGlob`, while `/sys/class/backlight/*` exists
  (the Condition is evaluated once at boot; a miss means no dimming that
  boot).
- Releasing the slider changes the panel in under a second (500 ms settle
  plus a restart).
- The panel's real `max_brightness`: the mapping caps raw at 255 in both
  modes, so a larger maximum never reaches full brightness. Where it is
  *small*, the `-b` floor of 15 becomes a large share of the range: on the
  Touch Display 2 (`max_brightness` 31, `rpi-panel-v2-regulator.c`) the floor
  is 49 % and the panel cannot go below ~48 %; below 15 the floor is 100 %
  (full brightness only). In daemon mode this floor is the pin's absolute
  `-b` minimum (`main.c:91`); confirm the lowest usable level on the device.
- systemd-backlight's boot restore runs before touch-timeout's start
  write (otherwise the panel settles at a level other than `-b`). The unit's
  `After=systemd-backlight@.service` is inert (it names the template, not the
  real `systemd-backlight@backlight:<dev>` instance); the ordering that holds
  comes only from default dependencies via `sysinit.target`, so a backlight
  whose driver probes after `sysinit.target` is not ordered against the start
  write and may sit at the restored level until the first dim/wake.
- On the pin, a SIGUSR1 wake can occasionally be lost (a play start then
  wakes the screen only at the next touch) until touch-timeout is bumped.

## Deliberately deferred (recoverable from the `create` source repo)

networking UI (nmcli show/change), bluetooth (`/api/btaudio/`), music
library UI (beocreate-music, so the `radio`/`music` child sources of mpd
have no UI panels), player toggles beyond mpd/spotify (the mpd/spotify
enable *switches* still call systemctl with buildroot-era unit names:
`mpd-mpris`, `ympd`, `spotify.service`), the "love track" feature (ACR
`/api/favourites` exists but is not wired), DSP program upload testing
against real hardware, asset pruning of unused B&O product images (do
only with tests green before/after).
