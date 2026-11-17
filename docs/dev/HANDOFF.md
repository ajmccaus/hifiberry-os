# Handoff — build state and how to resume

Working state for whoever (a Claude session or the owner) continues the build. Update the
"State" section at every pause; delete this file when the first image has passed its device test.

## Goal
A flashable SD image for a Raspberry Pi 4 (2 GB) + official 7" touchscreen + HiFiBerry Amp2:
upstream HiFiBerry NG audio stack on Raspberry Pi OS Lite (Debian 13), with our own minimal
B&O-style web UI as the front door. Done = CI publishes an image that passes `image/verify.sh`,
and the owner's device test (docs/device-test.md) passes.

## Where everything is
- `docs/dev/FACTS.md` — verified facts about the base image and upstream packages, the repo
  layout, engineering rules, and the interfaces between ui / helper / os / image. Source of truth.
- `docs/dev/ACR-CONTRACT.md` — the audio controller's API, verified against its source and a
  live instance. `docs/dev/LOOK.md` + `docs/dev/reference-shots/` — the visual reference.
- `docs/dev/brief-ui.md`, `docs/dev/brief-system.md` — the exact briefs given to the two builders.
- `docs/dev/tools/` — launchers written for the scratch area (they use paths relative to it):
  `run-acr.sh` (real ACR 0.25.0 + MPD on 127.0.0.1:1080), `run-legacy.sh` (legacy UI on :18080),
  `capture.js` (reference screenshots).

## Decisions (owner-confirmed, do not reopen)
- Buildroot is retired (branch `buildroot-legacy`). The legacy UI port is reference only.
- New UI (Vite + Preact + TypeScript) at `/`; upstream's UI stays as "Advanced settings".
- Product = flashable image built in GitHub Actions (`ubuntu-24.04-arm`), published as a release.
- Sources in the first image: Spotify Connect, AirPlay, Bluetooth, internet radio.
- No decision-record process. Old branches are deleted once nothing here needs them.
- Not in the first image: update button and Wi-Fi setup in the UI (no upstream API for either).

## State (2026-11-17 09:50 UTC — FLASHABLE IMAGE PUBLISHED: CI run 44055364215 green at 2caf8112 (checks, ui-e2e, image), prerelease `dev` holds `audio-os-0.1.0+git2caf811.img.xz` + `.sha256`, manager-verified against the run and the release. No builder running. Left: master fast-forward, old-branch deletion, owner's device test)
| Part | State |
|---|---|
| `helper/` | Done, reviewed, 32 tests green. |
| `ui/` | DONE and manager-verified (commit dc952ebc): typecheck clean, 26 unit tests, Playwright 56 passed / 12 skipped on Chromium + WebKit, screenshots compared with the reference. |
| `os/`, `image/`, workflow | DONE: green in CI after 5 rounds. Found and fixed on the way: first boot (machine-id uninitialized) enabled every unit without a preset (ssh, userconfig, nftables.service, systemd-networkd) — `10-audio-os.preset` now enables our four units and `disable *`; `verify.sh` asserts those units stay off, waits for systemd/user units/ACR before checking, and runs polkit checks as a real audio-os service process where a denial must be a real denial. Excused in the container only: volume-store, remount-fs, firstboot, rtkit (listed in device-test.md). `image` now needs `checks` and `ui-e2e`. Upstream audiocontrol.service still uses a /var/run PIDFile (harmless warning). |
| Docs | README, CLAUDE.md and docs/device-test.md written and committed (b6cb3c21). Still to reconcile with the final image: device-test.md commands that may not exist on the image (`vcgencmd`, `libinput`, `bluetoothctl`, `nmap`, `nqptp.service`), README journal/watchdog claims. README firewall list checked against `firewall.nft`: matches. |
| Branch cleanup | Not done: `claude/beocreate-debian`, `claude/hifiberry-buildroot-review-u7omrz`, `claude/touch-timeout-package`, `claude/adopt-one21tools`, `hbosng` still exist. Fast-forwarding `master` to the product branch is also pending. |

## Next steps, in order
0. (Resume point) Start ONE fresh system builder from `docs/dev/brief-system.md` + this State row: re-register arm64 binfmt, rebuild the .deb, get one complete local `image/build.sh` + `verify.sh` (a), then push and iterate on the CI `image` job. Step 1 below (UI) is finished.
1. Finish `ui/`: run typecheck/unit/e2e (Chromium + WebKit) against the real ACR and helper;
   compare screenshots with `docs/dev/reference-shots/`; review the code.
2. Finish `os/` + `image/`: review; one full local `image/build.sh` run (emulated, slow);
   `image/verify.sh` offline part.
3. Push; iterate on the CI run until the `image` job (build + nspawn boot test) is green and the
   prerelease `dev` carries the `.img.xz`.
4. Write README, CLAUDE.md, `docs/device-test.md` (flash, first boot incl. the one automatic
   reboot for sound-card detection, what to check, how to report).
5. Delete the old branches; fast-forward `master`.

## Rebuilding the scratch area (the container is ephemeral)
Under a scratch dir `S`: `S/ref/acr` = github.com/hifiberry/acr @ 47f2b51 (`cargo build --release`,
needs libasound2-dev pkg-config libssl-dev; ~5 min); `S/ref/upstream-os` = hifiberry/hifiberry-os
main; `S/ref/{hbos-ui,configurator,hbos-bluetooth,pipewire-api}` = the hifiberry repos of those
names; `S/ref/touch-timeout` = ajmccaus/touch-timeout; `S/ref/beocreate-port` =
`git archive origin/claude/beocreate-debian beocreate-debian` (legacy UI + mocks; only while that
branch exists); `S/debs-web/x/<pkg>` = .debs from https://debianrepo.hifiberry.com extracted with
`dpkg-deb -x/-e`. Copy `docs/dev/tools/*` to `S/ref/`. Base image: see FACTS.
Container needs: qemu-user-static + binfmt registration for arm64 chroots, mtools (no vfat
module), apt in chroots via https mirrors + `$HTTPS_PROXY` + CA bundle.

## Notes that live nowhere else
- Scratch dir of the first session: /tmp/claude-0/-home-user-hifiberry-os/44bcaa47-cf01-555d-b7c0-a66b4b33ff65/scratchpad
  (`ref/`, `debs-web/`, `debs-base/`, `img/` = base image + mounted copy, `sys/`, `ui-work/`, `ui-shots/`).
- Builders started 03:14 UTC (same session only): UI `a612e44be54bb85e6`, system/image
  `a8d1aaa4ad66c0bad`. Both were briefed: "take over the unrun, unreviewed files in the tree" +
  their brief in this directory + the integration notes below. After a pause, start fresh ones the
  same way rather than resuming cold transcripts.
- Integration notes sent to the system builder but possibly never read:
  1. nginx `/api/device/` must `proxy_set_header Host $http_host;` — the helper refuses non-GET
     requests whose `Origin` host differs from the `Host` it sees.
  2. Every non-GET to the helper needs `Content-Type: application/json` (also body-less POSTs);
     verify.sh's bogus power action then returns 400 from loopback.
  3. The helper calls exactly: `systemctl try-restart touch-timeout.service`,
     `systemctl kill --signal=SIGUSR1 touch-timeout.service`, `systemctl reboot`, `systemctl poweroff`
     — the polkit rule must allow these four for user `audio-os` and nothing broader.
  4. touch-timeout (root) must be able to read /var/lib/audio-os/touch-timeout.env.
- Review standard: every builder claim is re-verified by the manager (run the tests, read the
  code, view the screenshots) before it is called done; UNVERIFIED lists go into device-test.md.
- Session compaction: the manager cannot trigger it; the owner can (`/compact`). Cheapest moment
  is while the cache is warm or right at a resume before any work. Everything needed is in docs/dev/.

## Pause / resume protocol (usage limit)
- The session's rate-limit state is readable: `get_session` (no id) ->
  `external_metadata.rate_limit_info` = `{status, resetsAt (epoch s), rateLimitType}`.
  `status: "allowed"` = fine; `"allowed_warning"` = past the warning threshold -> pause.
- While builders run in the background, a check-in is scheduled every 15 minutes. Each check-in
  and each builder hand-back reads the status first. On `allowed_warning`: stop the builders,
  commit + push everything (including this file's State section), schedule a resume one minute
  after `resetsAt`, and stop.
- Builders are briefed to work in small steps and keep their files on disk in the repo tree, so a
  stop loses at most the step in progress. Resume a stopped builder by messaging it; if its
  transcript is gone, start a new one from its brief in this directory plus the State table.
- The percentage the owner sees is not exposed, but the session's `usage.cost_usd` (same
  `get_session` call, includes builders) tracks it: calibrated 2026-11-17 03:41 UTC at about
  $0.48 per 1% (28% = $13.4 spent since the window began). Rule: at each check-in (every
  10 minutes) estimate `(cost_now - cost_at_window_start) / 0.48`; pause at >= 70% so the
  overshoot stays under the owner's 80% limit. Re-baseline when `resetsAt` changes. Other sessions
  on the account also count, so recalibrate whenever the owner quotes a percentage.

- Usage estimate lags: `cost_usd` only refreshes when a manager turn ends and under-reads builder spend (estimate said 50% when the owner saw ~65–70%). Window 2 baseline: cost_usd 67.29 at 08:12 UTC. Use $0.35 per 1% as the working rate, pause at an estimated 55% (cost_usd >= 86.5), and treat any owner-quoted percentage as the authority. Manager check-in turns themselves cost about 1% each: check every 15 minutes, not 10.