# HiFiBerryOS 64 — Findings and Roadmap

## Platform facts

- Upstream `hifiberry/hifiberry-os` (buildroot, 32-bit and 64-bit) is unmaintained: last real development late 2023, EOL notice in the upstream README July 2025, issue tracker disabled. No active community forks.
- All upstream development is on the `hbosng` branch (formerly referenced as `hbfng`): Debian 13 (Trixie) on Raspberry Pi OS Lite, apt packages, PipeWire, Rust "ACR" audio-control backend, new Vue 3 web UI (`hifiberry/hbos-ui`). Active as of July 2026. 64-bit only (Pi 3/4/5). No stable public release yet (upstream TODO still has PipeWire start ordering and Bluetooth-via-PipeWire open).
- This fork carries a mirror of upstream `hbosng` as its own `hbosng` branch (refresh: `git fetch https://github.com/hifiberry/hifiberry-os hbosng && git push origin FETCH_HEAD:hbosng`).
- hbosng has a kiosk mode (getty → cage → cog — the same WPE browser stack as buildroot) showing the new Vue UI. It does not include the Beocreate interface. `kiosk-mode.sh setup` accepts `--url=` , so pointing the touchscreen at any local web UI is configuration, not code.
- hbosng ships BLE WiFi provisioning (`python-bless` + configurator) as the official setup path, replacing hotspot-based setup.
- Recent hbosng development adds analog/vinyl features unavailable on buildroot: analog-recognition (SongRec track ID for analog input), a RIAA phono input processor in PipeWire, analoginput, autorec, freqresp measurement, and an `acr-webmcp` package exposing the audio controller over MCP.
- This fork builds with buildroot 2023.02.3 (newest tag with a matching `buildroot/buildroot-<tag>.patch`), kernel 6.1, cog/WPE via upstream buildroot packages, Node 20 for the Beocreate server.

## Official RPi 7" touchscreen (64-bit) — root causes

- Full-KMS kernels do not let the firmware auto-initialize the DSI panel; `dtoverlay=vc4-kms-dsi-7inch` is required in config.txt.
- `lcd_rotate` does not work under KMS; rotation is `video=DSI-1:800x480@60,panel_orientation=<value>` in cmdline.txt. Touch follows the DRM panel-orientation property.
- cog/WPE crashes when `/usr/share/X11/locale/<locale>/Compose` is missing (libxkbcommon returns a NULL compose table).
- `COG_PLATFORM_FDO_VIEW_FULLSCREEN` was renamed to `COG_PLATFORM_WL_VIEW_FULLSCREEN` in cog 0.12; the old name is ignored by the cog versions buildroot ships.
- Backlight sysfs path is `rpi_backlight` on legacy kernels, `10-0045` on newer KMS kernels. touch-timeout ≥ 0.8.0 auto-detects the device by scanning `/sys/class/backlight`, so the rename does not affect it.
- Powering the display from an Amp's 5V header can brown-out the Pi at boot; power the display separately.

## Fixed in this tree

- Setup-hotspot teardown never worked (`tempap.service` oneshot without `RemainAfterExit`, `PartOf=` pointing at a renamed-away unit): hostapd + dnsmasq (DHCP 10.0.0.10–15, wildcard DNS `address=/#/10.0.0.1`) kept running until reboot once started — a rogue DHCP/DNS server. Fixed (after an adversarial review caught an ordering cycle in the first attempt): children are `PartOf=tempap.service`, no `After=` back-edge, and teardown clears the AP address while leaving wlan0 up (an admin-down would strand wpa_supplicant in INTERFACE_DISABLED). dnsmasq also binds wlan0 only and excludes eth0.
- Touchscreen fixes baked into the image: `display_auto_detect=1` in config.txt (the firmware adds `vc4-kms-dsi-7inch` only when the panel is detected — adding the overlay unconditionally leaves panel-less devices with no `/dev/dri` and a black HDMI screen), `video=DSI-1:800x480@60` in both cmdline templates, X11 Compose files installed, cog fullscreen env var renamed. Only `panel_orientation` remains a manual (mounting-specific) step.
- Updater: `$F2FS`/`$FS2FS` typo, FSTYPE-aware mount/fsck, cmdline `root=` rewrite that survives `PARTUUID=`, `update` arg-loop `$1`→`$i`, non-numeric server-response guard, `Persistent=true` on updater.timer, `Wants=network-online.target`.
- Data safety: `/data` is no longer reformatted when fsck exit 1 means "errors corrected"; fstab dedup pattern fixed.
- `copy-overlays.mk` tested undefined make variables, so base-board dtbs were never shipped for OTA updates (kernel/device-tree mismatch risk); now tests `BR2_PACKAGE_PIVERSION_*` and uses the arm64 dts path on 64-bit builds. `build-config` now maps `02`→`0_2`, `0`→`0w` symbol names.
- Package fixes: squeezelite wrong-prefix variables (wrong version, dropped `-DLINKALL -DDSD`), powercontroller firmware download now fails the build on error, psplash dead download URL, `disable-samba` dependency typo, GNU tar selected for `backup-config`.
- Service fixes: mpd/usbmount ordering vs `mount-data.service`, extensions vs docker, raat referenced a nonexistent `.target`, duplicate `StandardOutput=` in reboot.service, `Descriptihortn` typo in psplash-start.service, stale Spotify AP IP pin removed from vollibrespot.service.
- Headless WiFi provisioning restored: `copy-config.service` is now installed and enabled (`Type=oneshort` typo fixed; copies instead of moving from the read-only /boot).

## Removed (dead code cut)

- Orphaned packages (in no build: not selected by `hifiberry-all`, the localbrowser, or any other package): spotifyd (7 32-bit blobs), librespot, all 11 mopidy packages, alsa-eq (depended on nonexistent caps), hifiberry-watchdog (broken .mk), hifiberry-gmrender + hifiberry-gstreamer (vendored typelib blobs), mpd-mpris, hifiberry-postgres, hifiberry-analytics.
- 18 python packages whose only consumers were the packages above (verified against both Kconfig `select` and make-level `_DEPENDENCIES`); python-zopeevent kept (python-gevent selects it), python-usagedata kept (hifiberry-tools selects it).
- Stale saved configs (config0w/2/3/4, hifiberryos-gui, hifiberryos-nogui, testimage, devpackages, remove-slowpi) — the build flow uses upstream defconfigs + override.conf/override-test.conf only.
- Buildroot patches for 2019–2021 releases and buildroot-dev.patch; only 2023.02.3 is buildable.
- Dead code in kept packages: stale vendored audiocontrol2/src (never installed), ympd-bin blob (install commented out), `HIFIBERRY_UPDATER_INSTALL_ALL_OVERLAYS` (never hooked, contained a stray `sleep 10`), SysV S30copy-wifi-config (superseded by copy-config.service), /etc/network/interfaces.bak install, black-1x1.png.
- The kernel pin was moved to the current rpi-6.1.y head (previous pin kept commented). Kernels newer than 6.1 require buildroot ≥ 2024.02 (linux-headers options) — that is the "port the buildroot patch" milestone below.

## Known issues, deliberately not changed

- `hifiberry-test` ships 32-bit armhf binaries that cannot run on aarch64 (test-image only).
- `partitions`, `resize-partitions`, `mount-data` hardcode `/dev/mmcblk0` (SD-boot only; no USB/NVMe boot).
- cog.service `WAYLAND_DISPLAY=wayland-1` pairing with weston is unusual but confirmed working on hardware.
- aarch64 kernel is installed to /boot under the name `zImage` (boots correctly; naming only).
- vollibrespot and the rest of the player stack are unmaintained upstream; a Spotify API change cannot be fixed on this branch.

## Next steps

### Buildroot (PR #1)
- [ ] Build an image and flash a spare SD; verify: display comes up via
  `display_auto_detect=1`, cog fullscreen, touch works, boot logo fits,
  no rainbow
- [ ] Verify the hotspot lifecycle on-device: `systemctl start tempap`
  (AP + DHCP up) → `systemctl stop tempap` (hostapd/dnsmasq stopped,
  wlan0 up with no 10.0.0.1 address), then WiFi setup end-to-end
- [ ] With Ethernet connected, confirm no "HiFiBerry Setup" AP after boot
- [ ] `extract-update --simulate` on a reflashable device
- [ ] Merge PR #1
- [ ] Merge the touch-timeout package branch (includes the
  no-backlight crash-loop guard)

### Beocreate on Debian (PR #2)
- [ ] Land the adversarial-review remediation: WebSocket-event test
  coverage, cover-art proxying for remote browsers, no-volume-control
  crash guard, activation via the ACR-reported player name, brightness
  floor (no persisted 0), packaging polish
- [ ] Build the .deb; install on an hbosng SD (Pi 4); browse :8080 from
  phone and laptop; `kiosk-mode.sh setup --url=http://localhost:8080`
- [ ] Resolve the documented ACR contract uncertainties on-device:
  player activation endpoint variant, volume event shape, artwork URL
  keys, actual player naming (spotify vs librespot)
- [ ] Merge PR #2 once device-verified

### Later
- [ ] touch-timeout: merge its upstream security/ppoll branch, bump the
  package pin; coordinate brightness levels with the screen extension
- [ ] Port deferred Beocreate extensions as needed: network
  (nmcli show/change), bluetooth (`/api/btaudio/`), music library;
  wire love-track to ACR favourites
- [ ] Prune unused B&O product-image assets (tests green before/after)
- [ ] If staying on buildroot long-term: port the buildroot patch to
  ≥ 2024.02 to unlock kernels newer than 6.1

## Beocreate interface portability (measured, not estimated)

- Client side (~17k lines JS/HTML/CSS + assets) talks only to the Beocreate Node server; no OS coupling. The aesthetic survives any base-OS change if the Node server is kept.
- Server side: 40 extensions; ~10 need backend rework for hbosng (~2.5–3.5k lines): `sources`, `sound` (audiocontrol2 REST → ACR REST/WebSocket), `networking` (→ nmcli), bluetooth (→ `/api/btaudio/`), software-update (→ apt), player toggles (constants).
- The `networking` port shrinks further: hbosng's official setup path is BLE provisioning, so Beocreate's hotspot/tempap setup flow is dropped, not ported — only show/change-network needs nmcli rewiring.
- DSP stack (equaliser, beosonic, channels, speaker presets, ~4.3k lines) runs unmodified if sigmatcp's raw TCP port 8086 is re-enabled on hbosng — its service merely passes `--disable-tcp`; the code path still exists (re-verified against current hbosng: the dsptoolkit package builds straight from hifiberry-dsp with that flag intact).
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
- [ ] `networking` extension → nmcli (show/change network only; setup flow is replaced by hbosng's BLE provisioning)
- [ ] Player toggles (unit names/config paths)
- [ ] Stub or drop software-update, analytics, tempap

### Phase 3 — Cutover
- [ ] Package as `beocreate-classic-ui` .deb
- [ ] Point hbosng kiosk mode at the Beocreate UI: `kiosk-mode.sh setup --url=http://localhost:8080` (configuration only)
- [ ] Port touch-timeout (plain C daemon; runs on Debian unchanged)
- [ ] Keep the buildroot SD as fallback; retire it when confident

### Decision triggers (move from Phase 0/1 to Phase 2 when any fires)
- Spotify/player breakage on buildroot (unfixable there)
- New hardware needs (Pi 5, Touch Display 2, new HATs) beyond kernel 6.1
- WPE/cog security concern or UI bit-rot
- hbosng ships a stable public release with frozen APIs (port gets cheaper)
