# audio-os

A music-player OS for a Raspberry Pi 4 (2 GB) with the official 7" touchscreen and a HiFiBerry Amp2: Raspberry Pi OS Lite arm64 (Debian 13) plus HiFiBerry's upstream apt packages plus our own `audio-os` package (web UI, device helper, kiosk, firewall, hardening). CI builds and boot-tests the SD image and publishes it: the rolling prerelease `dev` from a `claude/**` branch, a prerelease named `build-<date>-<commit>` from `master`, and a release named after the tag for a `v*` tag (`v0.1.0` publishes `audio-os-0.1.0.img.xz`).

## Layout

- `ui/` web UI (TypeScript, Vite, Preact); `npm run build` emits `ui/dist/`.
- `helper/` `audio_os_helper.py` (Python stdlib only, 127.0.0.1:1090) and its unittest tests.
- `os/` the `audio-os` .deb: `os/rootfs/` (files as installed), `os/DEBIAN/`, `os/build-deb.sh`.
- `image/` `build.sh` (host side), `provision.sh` (runs in the image chroot), `verify.sh`, `boot/` (templates copied to the boot partition).
- `.github/workflows/image.yml` the only CI workflow.
- `docs/dev/` developer notes (`FACTS.md`, `HANDOFF.md`, `ACR-CONTRACT.md`, `LOOK.md`), reference screenshots and dev tools. `docs/device-test.md` is the owner's on-device checklist.

## Checks (these are what CI runs)

Shell lint, from the repo root:

```
mapfile -t b < <(git ls-files 'os/*.sh' 'image/*.sh' 'ui/*.sh' 'helper/*.sh' os/rootfs/usr/lib/audio-os/kiosk-rotation os/rootfs/usr/lib/audio-os/kiosk-session)
s=(os/DEBIAN/postinst os/DEBIAN/prerm os/DEBIAN/postrm)
for f in "${b[@]}"; do bash -n "$f"; done; for f in "${s[@]}"; do sh -n "$f"; done
shellcheck "${b[@]}" "${s[@]}"
```

Helper tests, from the repo root:

```
python3 -m unittest discover -s helper -v
```

UI, in `ui/` (Node 22). The end-to-end tests need `npx playwright install --with-deps chromium webkit` once, plus `mpd`, `mpc`, `ffmpeg`, and a built ACR checkout in `docs/dev/tools/acr`, which `docs/dev/tools/run-acr.sh` starts (`ACR_SCRIPT` names another launcher) (the `ui-e2e` job in the workflow shows the steps):

```
npm ci
npm run typecheck
npm run test:unit      # node --test tests/unit/*.test.ts
npm run test:e2e       # Playwright, Chromium and WebKit, against the real helper
npm run build
```

`npm test` runs unit then e2e. Package and image, from the repo root (root and an arm64 host or qemu binfmt needed for the image steps):

```
os/build-deb.sh ui/dist out
sudo image/build.sh out/audio-os_<version>_arm64.deb out/audio-os-<version>.img.xz
sudo image/verify.sh out/audio-os-<version>.img.xz
```

## Working rules

- `docs/dev/FACTS.md` is the source of truth for upstream facts (base image, HiFiBerry packages, ports, paths). Verify against the real artifact; when you find it wrong, correct it in the same change.
- Never weaken a test, assertion or check to get green. Fix the cause, or report the failure with its output.
- No default credentials or secrets in the image. Every account stays locked; SSH stays off unless the owner enables it through cloud-init `user-data`, key-only.
- The image is built and boot-tested in CI on `ubuntu-24.04-arm`, not locally under emulation.
- Keep the UI dependency-light: the runtime dependencies are `preact` and `@preact/signals` only, and the built JavaScript stays at or under 60 kB gzip.
- Shell scripts: `#!/bin/bash`, `set -euo pipefail`, shellcheck clean. Each file starts with a short header stating what it is and the one constraint not to break.
- Daemons bind loopback; nginx on port 80 is the only web entry. Subprocess calls use argument lists, never a shell.
- Do not use Bang & Olufsen or "Beo" names in identifiers or the UI; the third-party notices stay in `ui/THIRD-PARTY.md`.
- Nothing has been tested on a real Pi. Do not claim hardware behavior in docs; list it in `docs/device-test.md` under "Not verified before hardware".
