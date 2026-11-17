# Handoff: working state

Working state for whoever continues the project (a developer, a coding agent or the owner). Update
"State" at every pause; delete this file when the first image has passed its device test.

## Goal
A flashable SD image for a Raspberry Pi 4 (2 GB) + official 7" touchscreen + HiFiBerry Amp2: the
upstream HiFiBerry NG audio stack on Raspberry Pi OS Lite (Debian 13), with our own minimal touch
web UI as the front door. Done = CI publishes an image that passes `image/verify.sh`, and the
owner's device test (`docs/device-test.md`) passes.

## Where everything is
- `docs/dev/FACTS.md`: verified facts about the base image and upstream packages, the repo layout,
  CI and releases, and the interfaces between ui / helper / os / image. Source of truth.
- `docs/dev/ACR-CONTRACT.md`: the audio controller's API, verified against its source and a live
  instance. `docs/dev/LOOK.md` + `docs/dev/reference-shots/`: the visual reference.
- `docs/dev/tools/run-acr.sh` starts a real ACR 0.25.0 + MPD on 127.0.0.1:1080; it expects the
  ACR source (commit 47f2b51) built with `cargo build --release` in `docs/dev/tools/acr` (needs
  libasound2-dev, libdbus-1-dev and pkg-config). The end-to-end tests and CI's `ui-e2e` job use it.

## Decisions (owner-confirmed, do not reopen)
- Buildroot is retired (branch `buildroot-legacy`). The legacy UI port is reference only.
- New UI (Vite + Preact + TypeScript) at `/`; upstream's UI stays as "Advanced settings".
- Product = flashable image built in GitHub Actions (`ubuntu-24.04-arm`), published as a release.
- Sources in the first image: Spotify Connect, AirPlay, Bluetooth, internet radio.
- Not in the first image: update button and Wi-Fi setup in the UI (no upstream API for either).

## State (2026-11-17 13:15 UTC)
A flashable image is published: every green build of the working branch replaces the prerelease
`dev` (`audio-os-0.1.0+git<commit>.img.xz` + `.sha256`). Nothing has run on a real Pi yet.

- Pull request #4 (working branch to `master`) is v0.1.0: the tag-release path, American English
  throughout, the documentation cleanup and the fix below. Merge it once CI is green on its head.
- The workflow also runs for `v*` tags, builds with the tag as the version and publishes a release
  named after the tag. That path has not run yet. This session's git access cannot push tags or
  delete branches; the owner does both.
- The intermittent `ui-e2e` failure (runs #23 and #25, kiosk-webkit `radio.spec.ts`, one HTTP 500
  on `player/mpd/command/play`) is explained: the test station was an unreachable URL, and MPD's
  `play` on such a stream returns an error now and then (1 in 150 in a local reproduction; the decoder's connection error
  races the command), which ACR reports as 500. The station is now a real stream served by the test
  stubs, and the error path has its own test. On a device the same 500 is the correct answer for a
  dead station; the UI shows "<name> could not be started."

| Part | State |
|---|---|
| `helper/` | Complete; 32 unit tests pass. |
| `ui/` | Complete; typecheck, unit tests and the Playwright suite (Chromium and WebKit, real helper) pass; screenshots match the reference. |
| `os/`, `image/`, workflow | Complete; green in CI. `image` needs `checks` and `ui-e2e`. `verify.sh` lists the units excused in the container (no hardware or no root device there). |
| Docs | README, `CLAUDE.md`, `docs/device-test.md` and `docs/dev/` match the code; `verify.sh` asserts that every command the device test names exists in the image and that the third-party notice is installed. |
| Branches | Only `master`, `buildroot-legacy` and the working branch exist. |

## Next steps, in order
1. Merge pull request #4 once CI is green on its head.
2. Owner flashes the `dev` image and runs `docs/device-test.md` on the hardware.
3. Fix what the device test finds; each fix goes through CI before the next image.
4. After the device test passes, the owner creates tag `v0.1.0` on `master` (GitHub: Releases →
   Draft a new release → tag `v0.1.0`, target `master`). It is the first run of the tag path: check
   that the release gets `audio-os-0.1.0.img.xz` and its `.sha256`.
5. When touch-timeout v0.9 is released: move the pin, switch the helper's wake to the FIFO, drop one polkit permission.

## Notes that live nowhere else
- `ui/tests/stack.sh` starts ACR with `docs/dev/tools/run-acr.sh`; `$ACR_SCRIPT` names another launcher.
- The built JavaScript is about 20 kB gzip against the 60 kB limit; no check enforces the limit.
