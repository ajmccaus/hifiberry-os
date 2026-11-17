# audio-os: facts and interfaces

Source of truth for upstream facts (base image, HiFiBerry packages, ports, paths) and for the
interfaces between `ui/`, `helper/`, `os/` and `image/`. Working rules are in `CLAUDE.md`; the
audio controller's API is in `ACR-CONTRACT.md`.

Product: a flashable SD image for a Raspberry Pi 4 (2 GB) with the official 7" DSI touchscreen
(800x480) and a HiFiBerry Amp2. The base is the official Raspberry Pi OS Lite image (Debian 13
"trixie", arm64), customized at build time, with HiFiBerry's upstream "NG" apt packages for the audio
stack, plus our one package `audio-os` (web UI, device helper, kiosk, firewall, system configuration, and the
`touch-timeout` screen dimmer built from a pinned commit). Working name everywhere: `audio-os`.

## Repo layout
```
ui/        TypeScript web UI (Vite + Preact). `npm run build` -> ui/dist/{index.html, ui/...assets}
helper/    audio_os_helper.py: Python 3 stdlib daemon (device API) + unittest tests
os/        the `audio-os` .deb: os/rootfs/ (files as installed), os/DEBIAN/, os/build-deb.sh
image/     build.sh (host side), provision.sh (runs in the image chroot), verify.sh (offline + boot test),
           boot/ (templates copied to the boot partition)
.github/workflows/image.yml   the only CI workflow
docs/      device-test.md (owner's on-device checklist); docs/dev/ (these notes, reference-shots/, tools/)
```

## Verified facts: base image
- Pinned base: https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-10-06/2026-10-06-raspios-trixie-arm64-lite.img.xz
  sha256 483db18a48da399b5b7022ffae9a07bc6d99daab30e593aedac09b69ff422843 (550 MB xz, 3.08 GB raw).
- MBR: p1 FAT32 start sector 16384, 1048576 sectors (512 MB) mounted /boot/firmware; p2 ext4 start
  1064960 (2.4 G, 298 MB free). fstab + cmdline use PARTUUID=27b94958-0N (the MBR disk id: keep it).
- cmdline.txt: `console=serial0,115200 console=tty1 root=PARTUUID=27b94958-02 rootfstype=ext4 fsck.repair=yes rootwait resize`
  (`resize` = first-boot root grow; keep it).
- config.txt (stock): has `dtparam=audio=on`, `camera_auto_detect=1`, `display_auto_detect=1`
  (loads the DSI panel overlay automatically), `auto_initramfs=1`, `dtoverlay=vc4-kms-v3d`,
  `max_framebuffers=2`, `disable_fw_kms_setup=1`, `arm_64bit=1`, `arm_boost=1`, then [cm4]/[cm5]/[pi5]/[all] sections.
- Boot partition also holds cloud-init seed files `user-data`, `network-config`, `meta-data`
  (all comments by default; instance_id `rpios-image`). cloud-init 25.2 is installed and is how
  first-boot user/SSH/Wi-Fi customization works on this image (Raspberry Pi Imager writes these files).
  See /etc/cloud/cloud.cfg.d/99_raspberry-pi.cfg in the image.
- Users: `pi` (uid 1000, shell nologin). `userconfig.service` (userconf-pi) is enabled and prompts on
  tty8 at first boot; `ssh` is disabled; `sshswitch.service` enables ssh if /boot/firmware/ssh exists.
- Installed: kernel linux-image-rpi-v8 6.18.50, NetworkManager 1.52, nftables 1.1.3, avahi-daemon,
  openssh-server, systemd 257, systemd-zram-generator + rpi-swap, raspi-config. 633 packages.
- udev already makes backlight writable by group `video`
  (/usr/lib/udev/rules.d/60-backlight.rules: chgrp video + chmod g+w on `brightness`).
- apt candidates (trixie arm64): cage 0.3.1 (Raspberry Pi repo), cog 0.18.4 (WPE WebKit browser),
  wlr-randr 0.4.1, nginx 1.26.3, unattended-upgrades 2.12.
- CI (`.github/workflows/image.yml`): job `checks` (shell lint, helper tests, UI typecheck, unit
  tests, build), job `ui-e2e` (Playwright against a real ACR + MPD and the real helper), then job
  `image` on `ubuntu-24.04-arm` (native arm64, loop devices, vfat), which needs both: builds the
  .deb, builds the image, runs `image/verify.sh` (offline assertions, then a systemd-nspawn boot
  test) and publishes. A `v*` tag publishes a release named after the tag, with the tag as the
  package version (`v0.1.0` -> `0.1.0`); a push to `master` publishes a prerelease
  `build-<date>-<short sha>`; a push to a `claude/**` branch updates the prerelease `dev` in place
  (the new image is uploaded, then the previous one is removed; the release notes name the built
  commit, and the `dev` tag stays where it was first created). Each release holds
  `audio-os-<version>.img.xz` and its `.sha256`. Pushes that only touch `docs/**` or `*.md` do not
  run it. Runs on one ref are serialized, so a later push builds only after the earlier run ends.
- The workflow's token and tags: `gh release create --target <commit>` was refused with HTTP 403
  "Resource not accessible by integration" in run #26, where a push during the build had changed
  the workflow file, and accepted in run #27 for a commit that was no longer the branch head but
  had the same workflow file as the head. GitHub does not document the rule (user reports:
  https://github.com/orgs/community/discussions/121022). The publish step therefore never deletes
  a release before its replacement is uploaded.

## Verified facts: upstream HiFiBerry NG (versions from the live repo, Nov 2026)
Read from the extracted .debs and from the source of hifiberry-os, acr, hbos-ui, configurator,
pipewire-api, hbos-bluetooth and touch-timeout.
- apt source: `deb [signed-by=/usr/share/keyrings/hifiberry-archive-keyring.gpg] http://debianrepo.hifiberry.com trixie main`
  (arm64 only; https also works). Key: dearmor of
  https://keys.openpgp.org/vks/v1/by-fingerprint/4192E989F186E770B273F98B7997FC464E443CFA
- Meta package `hbos-minimal` 0.14 = configurator 2.19.0, eeprom, dsp, dspprofiles, hifiberry-mpd,
  hifiberry-audiocontrol 0.25.0 (ACR), hifiberry-webui 0.28.0, hifiberry-pipewire-configs, pipewire*,
  wireplumber, bluez, libspa-0.2-bluetooth, i2c-tools, sox. Spotify Connect = `hifiberry-librespot`,
  AirPlay = `hifiberry-shairport` (bundles nqptp), Bluetooth agent = `hifiberry-bluetooth`; these
  three are NOT in the meta and must be installed explicitly. We do NOT install roomeq, vu-meter, raat.
- upstream `install-all` (we reproduce it offline in `image/provision.sh`; it refuses root and needs a live systemd):
  install hbos-minimal; `config-configtxt --default-config` (= `dtparam=audio=off`, append `,noaudio`
  to the `dtoverlay=vc4-kms-v3d` line, `force_eeprom_read=1`, `dtparam=spi=on`, `dtparam=i2c_arm=on`);
  write the audio user's name to /etc/hifiberry.user; add that user to groups
  audio video render input gpio i2c spi plugdev netdev (those that exist); enable linger for it;
  /etc/systemd/user.conf.d/journal.conf with DefaultStandardOutput=journal, DefaultStandardError=journal.
- Players (mpd, librespot, shairport), PipeWire, pipewire-api run as **user units** of the user named
  in /etc/hifiberry.user (needs linger so /run/user/UID exists with no login). /etc/hifiberry.user
  must exist BEFORE hifiberry-shairport is installed (its postinst writes a D-Bus policy for that user).
  System services: audiocontrol (user `audiocontrol`), config-server (root, 127.0.0.1:1081),
  hifiberry-auth (`_hifiauth`, 127.0.0.1:1089), nginx (:80).
- Sound card: `config-detect.service` (configurator) runs at boot: HAT EEPROM, then I2C probe; an
  Amp2 is identified as "DAC+/Amp2" -> `dtoverlay=hifiberry-dacplus-std`; it writes config.txt and
  **reboots once** when the overlay changes. Mixer control "Digital". Nothing to pin in the image.
- Upstream `audiocontrol.service` still uses a /var/run PIDFile; systemd logs a harmless warning about it.
- Postinsts are chroot-safe (guarded on /run/systemd/system) except hifiberry-bluetooth, which calls
  `systemctl daemon-reload/enable/start` unguarded under `set -e` — expect to need a policy-rc.d /
  systemctl shim during provisioning; verify.
- nginx front door (owned by hifiberry-webui; its postinst re-copies its site file on every
  configure, so never edit it): server block on :80 does
  `include /etc/nginx/hifiberry-auth.d/*.conf; include /etc/nginx/hifiberry-api.d/*.nginx; include /etc/nginx/hifiberry-webui.nginx;`
  Upstream's Vue UI is an SPA at `location /` (routes /now-playing, /services, /sound, /setup, ...).
  Other packages add bare `location` blocks via /etc/nginx/hifiberry-api.d/*.nginx.
- hifiberry-auth: server-level `auth_request /_auth/verify;` applies to EVERY location unless it says
  `auth_request off`. Manifests /etc/hifiberry/auth.d/*.json:
  `{"service":"x","match_prefix":"/api/x/v1","default_tier":"risky","rules":[{"tier":"ok","methods":["GET"],"paths":["/a","/b/*","/c/**"]}, ...]}`
  (longest prefix wins, first rule hit wins, `*` one segment, `**` rest). Policy default `unset`:
  ok-tier requests pass with no password; risky -> 401 with header `WWW-Authenticate-Hint: set-password`
  until someone POSTs /api/auth/set-password {"password"}; then a session cookie + `X-CSRF-Token`
  on non-GET is required for risky. Loopback is NOT special-cased by the auth service.
- API prefixes via nginx: /api/audiocontrol/ -> 127.0.0.1:1080/api/ (WebSocket upgrade proxied; ACR
  pings every 30 s); cover art etc. -> metadata daemon 127.0.0.1:1084; /api/config/ -> 127.0.0.1:1081/api/;
  /api/pipewire/ -> :2716; /api/auth/ -> :1089.
- Default NON-loopback listeners (closed by `image/provision.sh` and the `pipewire-api` drop-in):
  ACR 0.0.0.0:1080 (key `services.webserver.host` in conffile /etc/audiocontrol/audiocontrol.json; no drop-in dir);
  pipewire-api 0.0.0.0:2716 (user unit; has a `--localhost` flag: drop-in
  /usr/lib/systemd/user/pipewire-api.service.d/audio-os.conf with `ExecStart=` reset then
  `ExecStart=/usr/bin/pipewire-api --log-level info --localhost`, mirroring the real unit's ExecStart);
  mpd 0.0.0.0:6600 (start-mpd copies /usr/share/mpd/mpd.conf to ~/etc/mpd.conf if absent: pre-seed
  ~/etc/mpd.conf with `bind_to_address "127.0.0.1"`).
- LAN ports the product needs: 80/tcp (nginx), 5353/udp (mDNS), 22/tcp (only if the owner enables
  SSH), AirPlay: 7000/tcp + 5000/tcp, 319-320/udp (PTP), dynamic UDP/TCP in the ephemeral range;
  Spotify Connect: librespot zeroconf HTTP on an ephemeral TCP port. Our firewall
  (`/usr/share/audio-os/firewall.nft`, table `inet audio_os`, loaded by `audio-os-firewall.service`)
  drops all other inbound traffic: it accepts loopback, established/related, the ICMP and ICMPv6
  types IP needs, DHCP replies, 5353/udp, tcp 22/80/5000/7000, udp 319-320 and any tcp/udp
  destination port 32768-60999. `image/verify.sh` asserts that no LAN listener lies outside this list.
- Configurator API (under /api/config/v1): GET /systeminfo (ok tier; system.hostname,
  system.pretty_hostname, pi_model, soundcard ...), GET /network (ok), POST /hostname (risky),
  POST /system/reboot|shutdown (risky). No Wi-Fi-configure and no system-update endpoint exists.
- Kiosk upstream = getty autologin -> .bash_profile -> `cage -- cog --platform=wl --scale=N URL`,
  with `COG_PLATFORM_DRM_CURSOR=0`; upstream's script is not runnable offline; we use our own unit
  (see "Our design").
- touch-timeout (owner's own C daemon, https://github.com/ajmccaus/touch-timeout, pin commit
  2ad5769 = the v0.8.0 daemon source; the five commits after the tag only add docs, test scripts
  and an optional http-wake script we do not ship. A v0.9 design (doc/DESIGN.md at 27faa00, not
  implemented) keeps -b/-t and SIGUSR1, adds a wake FIFO /run/touch-timeout/wake, and makes
  out-of-range options exit 2; re-check the helper when the owner releases it): dims after idle, off after `-t` seconds, restores on touch; options
  `-b N` full brightness raw 15-255 (default 150), `-t N` off-timeout s 10-86400 (default 300),
  `-d N` dim at N% of timeout; SIGUSR1 wakes the display; auto-detects backlight (first entry of
  /sys/class/backlight) and touch input. `make` builds it; its unit is systemd/touch-timeout.service
  (runs as root, ProtectSystem=full). It has no runtime reconfiguration: changing -b/-t = restart.
  It crash-loops when there is no backlight, so our unit has `ConditionPathExistsGlob=/sys/class/backlight/*`.

## Our design (interfaces between the parts)
Accounts in the image: `player` (the audio user named in /etc/hifiberry.user; lingering, nologin
shell, created by `image/provision.sh`), `kiosk` (runs cage + cog; groups video, render, input) and
`audio-os` (system user for the helper; group video), both created by the package postinst. `pi`
stays locked and nologin. No account has a password; `image/verify.sh` asserts every password is
locked. SSH stays disabled unless the owner enables it through cloud-init `user-data` (key-only;
`/etc/ssh/sshd_config.d/00-audio-os.conf` sets PasswordAuthentication no).

Presets: `10-audio-os.preset` enables our four units (`audio-os-firewall`, `audio-os-helper`,
`touch-timeout`, `kiosk`) and ends with `disable *`, so the first boot (machine-id `uninitialized`,
when systemd applies presets) cannot enable units the build left off (ssh, userconfig, nftables,
systemd-networkd).

Web front door (file /etc/nginx/hifiberry-api.d/zz-audio-os.nginx, shipped by `audio-os`):
- `location = /` -> /usr/share/audio-os/ui/index.html (`auth_request off`, no-cache).
- `location ^~ /ui/` -> static assets /usr/share/audio-os/ui/ui/ (`auth_request off`; hashed
  filenames, long cache). The UI build emits index.html referencing only `/ui/...` URLs.
- `location /api/device/` -> proxy to helper 127.0.0.1:1090 (`proxy_set_header Host $http_host`, body
  limit 64k), with `satisfy any; allow 127.0.0.1; allow ::1; deny all;` so the local kiosk never
  needs a password while LAN clients go through the inherited auth_request.
- Every location that uses add_header must repeat the security headers (nginx drops inherited ones):
  X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy no-referrer, and for
  the UI document a Content-Security-Policy: default-src 'self'; img-src 'self' data: https: http:;
  connect-src 'self' https://*.api.radio-browser.info https://all.api.radio-browser.info;
  style-src 'self' 'unsafe-inline'; frame-ancestors 'self'. `/api/device/` sets none and inherits
  the server-level ones.
- Upstream's UI stays reachable at its own routes (e.g. /services, /sound) = "Advanced settings".
- Auth manifest /etc/hifiberry/auth.d/audio-os.json: match_prefix `/api/device/v1`, default risky;
  ok: GET `/**`, PUT `/screen`, PUT `/radio`, POST `/screen/wake`; risky: POST `/power`.

Device helper API (`audio_os_helper.py`, Python stdlib, 127.0.0.1:1090, runs as user `audio-os`,
installed as /usr/lib/audio-os/audio_os_helper.py):
- `GET  /api/device/v1/screen` -> `{"available":bool,"brightness":1-100,"timeout":seconds}`
  (`available:false` when no backlight exists; values are the persisted settings, never sysfs).
- `PUT  /api/device/v1/screen` body `{"brightness":1-100}` and/or `{"timeout":30-86400}` -> same shape.
- `POST /api/device/v1/screen/wake` -> 204.
- `GET  /api/device/v1/radio` -> `{"stations":[{"id","name","url","favicon"}]}` (favorite stations,
  shared by all browsers); `PUT /api/device/v1/radio` replaces the list (max 200 entries; url/favicon
  must be http(s), strings length-capped).
- `POST /api/device/v1/power` body `{"action":"restart"|"shutdown"}` -> 202 `{"status":"accepted"}`.
- `GET  /api/device/v1/info` -> `{"version":"<audio-os package version>"}` (read from
  /usr/share/audio-os/version; `"unknown"` if missing).
- Non-GET requests must carry `Content-Type: application/json` (also body-less POSTs) and, when an
  `Origin` header is present, it must match the request `Host` (blocks cross-site form posts); else 403.
- Errors: JSON `{"error":"..."}` with 400/403/404/405/413/500. Bodies capped at 64 KiB.
- State: /var/lib/audio-os/{screen.json,radio.json} (atomic writes). The helper renders
  /var/lib/audio-os/touch-timeout.env (`TOUCH_TIMEOUT_ARGS=-b <raw> -t <s>`; root must be able to
  read it), which our touch-timeout.service reads in the unit itself (`EnvironmentFile=-...`,
  `ExecStart=/usr/bin/touch-timeout $TOUCH_TIMEOUT_ARGS`; no drop-in), then
  `systemctl try-restart touch-timeout.service`. The restart happens only when the file's content
  changes. Brightness percent -> raw: `min(top, max(15, (pct*top + 50) // 100))` with
  top = min(max_brightness, 255).
- Wake on play: the helper polls ACR `GET http://127.0.0.1:1080/api/now-playing` every 2 s and, on
  a transition into playing, runs `systemctl kill --signal=SIGUSR1 touch-timeout.service`.
- The helper is unprivileged; a polkit rule shipped by `audio-os` (`50-audio-os.rules`) lets user
  `audio-os` do exactly: `try-restart` and `kill` of `touch-timeout.service` (not `restart` or
  `stop`), and reboot/power-off (including the `*-multiple-sessions` actions, because the kiosk
  holds a session). The helper's four systemctl calls are `try-restart touch-timeout.service`,
  `kill --signal=SIGUSR1 touch-timeout.service`, `reboot` and `poweroff`. All subprocess calls are
  argv lists (never a shell). Environment overrides, for tests only: `AUDIO_OS_SYSTEMCTL`,
  `AUDIO_OS_BACKLIGHT_DIR`, `AUDIO_OS_STATE_DIR`, `AUDIO_OS_ACR_URL`, `AUDIO_OS_PORT`,
  `AUDIO_OS_VERSION_FILE`, `AUDIO_OS_ACR_POLL_SECONDS`.
- `audio-os-helper.service` runs sandboxed (`ProtectSystem=strict`, no capabilities, network limited
  to loopback).

Kiosk: systemd unit `kiosk.service` (user `kiosk`, own logind session on tty1; `getty@tty1` is
masked) running `cage -- /usr/lib/audio-os/kiosk-session`, which waits until `http://localhost/`
answers and then execs `cog --platform=wl --scale=1 --webprocess-failure=restart http://localhost/`.
It starts only when a DRM connector is connected (`ExecCondition`) and always restarts. Optional
rotation from /boot/firmware/audio-os.conf (`SCREEN_ROTATE=0|90|180|270`), applied by
`/usr/lib/audio-os/kiosk-rotation`: a libinput calibration udev rule for touch, written as root
before cage starts (`touch`, run as `ExecStartPre`), and wlr-randr for the output inside cage
(`output`, run by `kiosk-session`). `image/provision.sh` makes the panel boot quiet: `console=tty3`
instead of `console=tty1`, plus `quiet loglevel=3 vt.global_cursor_default=0 logo.nologo` in
cmdline.txt and `disable_splash=1` in config.txt.

Other system configuration shipped by `audio-os`: journald keeps the journal in RAM (`Storage=volatile`,
32 MB); systemd is set to feed the hardware watchdog (`RuntimeWatchdogSec=15s`); unattended-upgrades installs Debian security
updates only, at about 04:00 local time, and never reboots (Raspberry Pi and HiFiBerry archives are
excluded). `image/provision.sh` seeds a first-boot volume of 20% through the configurator's
database, sets hostname `hifiberry` and leaves `/etc/machine-id` as `uninitialized`.
