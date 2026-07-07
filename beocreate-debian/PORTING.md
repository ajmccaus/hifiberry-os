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

## Deliberately deferred (recoverable from the `create` source repo)

networking UI (nmcli show/change), bluetooth (`/api/btaudio/`), music
library UI (beocreate-music), player toggles beyond mpd/spotify, DSP
program upload testing against real hardware, asset pruning of unused
B&O product images (do only with tests green before/after).
