# Beocreate on the Debian foundation (hbosng) — port notes

Goal: run the classic Beocreate interface as the UI for HiFiBerryOS NG
(Debian 13 / hbosng), talking to the new backends: ACR (audio control,
port 1080), the Configurator (port 1081), and sigmatcpserver (DSP,
TCP 8086 re-enabled via systemd override). The kiosk shows it with
`kiosk-mode.sh setup --url=http://localhost:8080`.

## Layout

- `server/` — the Beocreate Node server (vendored lean from
  hifiberry/create@b86115b, MIT). Port target: Node >= 20.
- `mock-backend/` — mock ACR + mock backlight sysfs for development and
  CI testing in a container. Mocks implement the documented ACR API
  (see references below) so tests exercise the same contract the
  device exposes.
- `tests/` — Playwright specs driving the real UI in Chromium against
  the server + mocks.
- `package/` — Debian packaging (`beocreate-classic-ui` .deb), systemd
  unit, sigmatcp TCP re-enable override, following the conventions of
  the hbosng `packages/` tree (available in this repo as branch
  `hbosng`).

## Backend mapping (from the portability assessment)

| Beocreate need | Old (buildroot) | New (hbosng) |
|---|---|---|
| player status/switch | audiocontrol2 REST :81 | ACR REST :1080 `/api/players`, `/api/player/active/send/<cmd>` |
| metadata push | ac2 HTTP POST to beocreate | ACR WebSocket `/api/events` (state_changed, song_changed, volume) |
| now playing + art | ac2 `/api/track/metadata` | ACR `/api/now-playing`, cover art API |
| volume | ac2 `/api/volume` + amixer | ACR `/api/volume/info`, `/api/volume/set` |
| DSP | raw SigmaTCP :8086 + dsptoolkit CLI | same SigmaTCP :8086 (override removes `--disable-tcp`) |
| hostname/services | hostnamectl/systemctl | same on Debian (or Configurator REST) |

API references used to build the mock (fetched from upstream docs):
ACR REST `doc/api.md`, ACR WebSocket `doc/websocket.md` in
github.com/hifiberry/acr; `docs/backend-apis.md` on the hbosng branch.

## Config

`/etc/beocreate/system.json`: port 8080 (nginx owns 80 on hbosng).
Backend URLs configurable via `system.json` keys `acrAddress`
(default `http://127.0.0.1:1080`) and env overrides for testing.
`BEO_BACKLIGHT_DIR` overrides `/sys/class/backlight` for the screen
extension (points at the mock sysfs in tests).

## New: screen extension (brightness)

Extension `screen` in `server/beo-extensions/screen/`:
- Menu panel in the Beocreate UI (same look as sound settings) with a
  brightness slider.
- Backend scans the backlight directory (first entry, same auto-detect
  approach as touch-timeout), scales percent to `max_brightness`, and
  writes `brightness`.
- Persists the chosen level in `/etc/beocreate/screen.json` and
  restores it on startup.

## Test criteria (Playwright, all must pass)

1. Server boots on :8080 with mocks; `/` serves the app shell.
2. UI loads in Chromium with no fatal JS errors; now-playing shows the
   mock track's title/artist.
3. Transport: play/pause in the UI reaches the mock ACR as a player
   command.
4. Sources: the mock's players are listed; activating one sends the
   right ACR call.
5. Volume: changing volume in the UI updates the mock ACR volume.
6. Screen: brightness slider writes the expected scaled value to the
   mock backlight file; value persists across a server restart.

## Status

All six Playwright criteria above pass (see "Running the tests").

## Patches applied to the vendored server

Kept as small as possible; the client-side code (`*-client.js`, `.html`,
`.css`) is untouched except for one new entry in the default view's
`manifest.json` navigation list (for the new screen extension).

- `beo-system/beo-server.js` — data directory `/etc/beocreate` is now
  `process.env.BEO_CONFIG_DIR || "/etc/beocreate"` so tests can point the
  server at a temp dir. No other changes.
- `beocreate_essentials/acr.js` — **new** shared module wrapping the
  documented ACR REST API and the `/api/events` WebSocket stream (single
  subscription, reconnect with backoff, events re-emitted on a local
  EventEmitter). Base URL: `system.json` key `acrAddress`, overridable
  with `BEO_ACR_ADDRESS`.
- `beo-extensions/sources/index.js` — backend half rewritten from
  audiocontrol2 REST (127.0.1.1:81) to ACR:
  - `audioControlGet("status"/"metadata")` now fetch `/api/players` and
    `/api/now-playing` and translate to the old audiocontrol2 shapes, so
    `processAudioControlStatus`/`processAudioControlMetadata` and
    everything downstream (including all client code) stay unchanged.
  - `audioControl()` transport commands →
    `POST /api/player/active/send/<cmd>` (`playPause` → `playpause`);
    source activation → `POST /api/player/<name>/command/play`;
    love/unlove report failure (`loveSupported` is false).
  - ACR WebSocket events `state_changed`, `song_changed`,
    `metadata_changed`, `capabilities_changed` are translated onto the
    same processing functions (replaces audiocontrol2's HTTP pushes).
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
  overridable with `BEO_DSP_ADDRESS`.
- `beocreate_essentials/communication.js` — `startBonjour` wrapped in
  try/catch so unavailable mDNS (containers) can't crash the server.
- `beo-views/default/manifest.json` — added `screen` to the `full`
  navigation set.
- `server/package.json` — **new**; declares the runtime dependencies
  (express, websocket, eventemitter3, underscore, xml-js, node-fetch@2,
  mpd-api, dnssd2, aplay).

New extension: `beo-extensions/screen/` (backend + `menu.html` +
`screen-client.js` + symbols). The brightness slider copies the sound
extension's `slider-wrap` markup/behaviour 1:1.

## Contract notes / uncertainties vs. the real ACR

- The upstream `websocket.md` does **not** document volume events. The
  mock (and the sound extension) assume
  `{"type": "volume_changed", "percentage": ...}`; the sound extension
  also accepts `volume.percentage`/`current_state.percentage` and always
  re-reads `/api/volume/state` on demand, so a missing or different
  volume event only costs push updates, not correctness.
- `/api/now-playing`'s `song` shape is only loosely documented ("title,
  artist, album, etc."). The port reads artwork from `coverart_url`,
  `artwork_url` or `cover_art_url` (mock uses `artwork_url`, the key
  documented for the `song_changed` WS event) and title from
  `title`/`name`. Relative artwork URLs are absolutised against the ACR
  base URL.
- `GET /api/players` does not include supported commands. Transport
  capabilities come from `capabilities_changed` WS events when seen,
  otherwise a default of play/pause/playpause/stop/next/previous is
  assumed (the UI only surfaces play/pause/next/previous).
- Source activation is implemented as `POST /api/player/<name>/command/play`
  (there is no dedicated "activate" endpoint in the ACR docs).

## Running the tests

```
beocreate-debian/run-tests.sh
```

Installs npm dependencies for `server/`, `mock-backend/` and `tests/`,
then runs Playwright (Chromium; honours `PLAYWRIGHT_BROWSERS_PATH`, falls
back to the newest `chromium-*` build found there). Each spec file starts
its own mock ACR (:1080), mock backlight directory and beo-server (:8080)
and tears them down; port 8080/1080 must be free. Screenshots of the
now-playing screen and the screen-brightness panel are written to
`tests/screenshots/`.

## Installing on an hbosng device

1. Build the package (needs `node`, `npm`, `dpkg-deb`; architecture-
   independent):
   `beocreate-debian/package/build.sh` → `beocreate-classic-ui_<v>_all.deb`
2. `apt install ./beocreate-classic-ui_<v>_all.deb` (or `dpkg -i` +
   `apt -f install`). Requires `nodejs >= 20`; recommends
   `hifiberry-audiocontrol` and `hifiberry-dsp`.
3. postinst installs `/etc/beocreate/system.json` (first install only),
   enables+starts `beocreate2.service` (port 8080) and try-restarts
   `sigmatcpserver.service` so the packaged drop-in
   (`/etc/systemd/system/sigmatcpserver.service.d/10-beocreate-enable-tcp.conf`,
   which removes `--disable-tcp`) takes effect.
4. Point the kiosk at it: `kiosk-mode.sh setup --url=http://localhost:8080`.

Note: the .deb was built and inspected in the development container
(`dpkg-deb -I`/`-c` verified); it has not been installed on a real hbosng
device yet, so postinst/systemd behaviour on-device is untested.

## Deliberately deferred (recoverable from the `create` source repo)

networking UI (nmcli show/change), bluetooth (`/api/btaudio/`), music
library UI (beocreate-music, so the `radio`/`music` child sources of mpd
have no UI panels), player toggles beyond mpd/spotify (the mpd/spotify
enable *switches* still call systemctl with buildroot-era unit names:
`mpd-mpris`, `ympd`, `spotify.service`), the "love track" feature (ACR
`/api/favourites` exists but is not wired), DSP program upload testing
against real hardware, asset pruning of unused B&O product images (do
only with tests green before/after).
