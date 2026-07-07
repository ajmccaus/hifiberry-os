# HiFiBerryOS 64 — Findings and Roadmap

## Platform facts

- Upstream `hifiberry/hifiberry-os` (buildroot, 32-bit and 64-bit) is unmaintained: last real development late 2023, EOL notice in the upstream README July 2025, issue tracker disabled. No active community forks.
- All upstream development is on the `hbosng` branch (formerly referenced as `hbfng`): Debian 13 (Trixie) on Raspberry Pi OS Lite, apt packages, PipeWire, Rust "ACR" audio-control backend, new Vue 3 web UI (`hifiberry/hbos-ui`). Active as of July 2026. 64-bit only (Pi 3/4/5).
- hbosng has a kiosk mode (getty → cage → cog) showing the new Vue UI. It does not include the Beocreate interface.
- This fork builds with buildroot 2023.02.3 (newest tag with a matching `buildroot/buildroot-<tag>.patch`), kernel 6.1, cog/WPE via upstream buildroot packages, Node 20 for the Beocreate server.

## Official RPi 7" touchscreen (64-bit) — root causes

- Full-KMS kernels do not let the firmware auto-initialize the DSI panel; `dtoverlay=vc4-kms-dsi-7inch` is required in config.txt.
- `lcd_rotate` does not work under KMS; rotation is `video=DSI-1:800x480@60,panel_orientation=<value>` in cmdline.txt. Touch follows the DRM panel-orientation property.
- cog/WPE crashes when `/usr/share/X11/locale/<locale>/Compose` is missing (libxkbcommon returns a NULL compose table).
- `COG_PLATFORM_FDO_VIEW_FULLSCREEN` was renamed to `COG_PLATFORM_WL_VIEW_FULLSCREEN` in cog 0.12; the old name is ignored by the cog versions buildroot ships.
- Backlight sysfs path is `rpi_backlight` on legacy kernels, `10-0045` on newer KMS kernels. touch-timeout ≥ 0.8.0 auto-detects the device by scanning `/sys/class/backlight`, so the rename does not affect it.
- Powering the display from an Amp's 5V header can brown-out the Pi at boot; power the display separately.

## Fixed in this tree

- Setup-hotspot teardown never worked (`tempap.service` oneshot without `RemainAfterExit`, `PartOf=` pointing at a renamed-away unit): hostapd + dnsmasq (DHCP 10.0.0.10–15, wildcard DNS `address=/#/10.0.0.1`) kept running until reboot once started — a rogue DHCP/DNS server. dnsmasq now also binds wlan0 only and excludes eth0.
- Touchscreen fixes baked into the image: DSI overlay in config.txt, `video=DSI-1:800x480@60` in both cmdline templates, X11 Compose files installed, cog fullscreen env var renamed. Only `panel_orientation` remains a manual (mounting-specific) step.
- Updater: `$F2FS`/`$FS2FS` typo, FSTYPE-aware mount/fsck, cmdline `root=` rewrite that survives `PARTUUID=`, `update` arg-loop `$1`→`$i`, non-numeric server-response guard, `Persistent=true` on updater.timer, `Wants=network-online.target`.
- Data safety: `/data` is no longer reformatted when fsck exit 1 means "errors corrected"; fstab dedup pattern fixed.
- `copy-overlays.mk` tested undefined make variables, so base-board dtbs were never shipped for OTA updates (kernel/device-tree mismatch risk); now tests `BR2_PACKAGE_PIVERSION_*` and uses the arm64 dts path on 64-bit builds. `build-config` now maps `02`→`0_2`, `0`→`0w` symbol names.
- Package fixes: squeezelite wrong-prefix variables (wrong version, dropped `-DLINKALL -DDSD`), powercontroller firmware download now fails the build on error, psplash dead download URL, `disable-samba` dependency typo, GNU tar selected for `backup-config`.
- Service fixes: mpd/usbmount ordering vs `mount-data.service`, extensions vs docker, raat referenced a nonexistent `.target`, duplicate `StandardOutput=` in reboot.service, `Descriptihortn` typo in psplash-start.service, stale Spotify AP IP pin removed from vollibrespot.service.
- Headless WiFi provisioning restored: `copy-config.service` is now installed and enabled (`Type=oneshort` typo fixed; copies instead of moving from the read-only /boot).

## Known issues, deliberately not changed

- `spotifyd`, `hifiberry-test`, and `ympd-bin` ship 32-bit armhf binaries that cannot run on aarch64 (packages inactive in default builds).
- `partitions`, `resize-partitions`, `mount-data` hardcode `/dev/mmcblk0` (SD-boot only; no USB/NVMe boot).
- `hifiberry-gstreamer` vendors pre-compiled `.typelib` blobs instead of generating them at build time.
- `hifiberry-watchdog` and `alsa-eq` fail to build if enabled (missing files / commented-out dependency).
- cog.service `WAYLAND_DISPLAY=wayland-1` pairing with weston is unusual but confirmed working on hardware.
- aarch64 kernel is installed to /boot under the name `zImage` (boots correctly; naming only).
- vollibrespot and the rest of the player stack are unmaintained upstream; a Spotify API change cannot be fixed on this branch.

## Beocreate interface portability (measured, not estimated)

- Client side (~17k lines JS/HTML/CSS + assets) talks only to the Beocreate Node server; no OS coupling. The aesthetic survives any base-OS change if the Node server is kept.
- Server side: 40 extensions; ~10 need backend rework for hbosng (~2.5–3.5k lines): `sources`, `sound` (audiocontrol2 REST → ACR REST/WebSocket), `networking` (→ nmcli), bluetooth (→ `/api/btaudio/`), software-update (→ apt), player toggles (constants).
- DSP stack (equaliser, beosonic, channels, speaker presets, ~4.3k lines) runs unmodified if sigmatcp's raw TCP port 8086 is re-enabled on hbosng — its service merely passes `--disable-tcp`; the code path still exists.
- Node compatibility: buildroot ships Node 20.9, Debian Trixie ships Node 20.19.

## Milestone plan

### Phase 0 — Stabilize buildroot (now)
- [x] Fix rogue DHCP/DNS hotspot
- [x] Bake touchscreen support into the image
- [x] Fix updater, data-partition, build-system, and service bugs
- [ ] Build image from this branch and validate on hardware: display up without manual edits, cog fullscreen, no setup AP after boot, touch works
- [ ] `extract-update --simulate` on a reflashable device before trusting OTA
- [ ] Merge to master
- [ ] Add touch-timeout as a buildroot package with its systemd unit

Buildroot then enters maintenance mode: fix breakage only, no base upgrades.

### Phase 1 — hbosng spike (one weekend, separate SD card)
- [ ] Install RPi OS Lite + hbosng on a spare SD
- [ ] systemd override removing `--disable-tcp` from sigmatcpserver; confirm port 8086 + `dsptoolkit` work
- [ ] Run the Beocreate Node server on :8080; confirm the UI serves with dead backends
- [ ] Exercise ACR REST + WebSocket APIs by hand; confirm docs match reality

### Phase 2 — Port the core (iterative; each step ships something usable)
- [ ] `sources` + `sound` extensions against ACR (functional now-playing/control UI) — this step calibrates the effort for everything after it
- [ ] DSP extensions over re-enabled TCP
- [ ] `networking` extension → nmcli
- [ ] Player toggles (unit names/config paths)
- [ ] Stub or drop software-update, analytics, tempap

### Phase 3 — Cutover
- [ ] Package as `beocreate-classic-ui` .deb
- [ ] Point hbosng kiosk mode (cage + cog) at the Beocreate UI on the touchscreen
- [ ] Port touch-timeout (plain C daemon; runs on Debian unchanged)
- [ ] Keep the buildroot SD as fallback; retire it when confident

### Decision triggers (move from Phase 0/1 to Phase 2 when any fires)
- Spotify/player breakage on buildroot (unfixable there)
- New hardware needs (Pi 5, Touch Display 2, new HATs) beyond kernel 6.1
- WPE/cog security concern or UI bit-rot
- hbosng ships a stable public release with frozen APIs (port gets cheaper)
