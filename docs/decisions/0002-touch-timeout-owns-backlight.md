---
id: 0002
title: "touch-timeout owns the backlight; the Beocreate slider sets its -b"
status: proposed
summary: "Debian line ships touch-timeout (pinned) as its own .deb and sole backlight writer; the Beocreate slider sets its -b via an EnvironmentFile + restart; playback start wakes it by SIGUSR1."
---

# 0002 — touch-timeout owns the backlight; the Beocreate slider sets its -b

- Date: 2026-10-26
- Owner: PM
- Panel: embedded-linux-integrator (systemd, packaging), kiosk-ux-designer (brightness/idle), solo-maintainer (upkeep). upstream-alignment skipped: no backlight code upstream (`git grep -il backlight upstream/default` empty); package shape checked by PM.
- Context: two writers collide. `screen/index.js:88` writes sysfs per slide tick and at startup (`:129-135`); touch-timeout writes `-b` at start (`main.c:596`) and on every DIMMED/OFF wake (`state.c:53-55`), tracking only its own last write (`main.c:613`), so a slider level lasts until the first dim. `getBrightness` reads sysfs (`index.js:101-111`): the dim level when dimmed. The 5% floor (`index.js:43`) = 13 raw, under `-b`'s 15 minimum (`main.c:91`). Owner, asked: slider → "Set touch-timeout's level"; version → "v0.8 now, bump later"; wake → "Keep the FIFO for buildroot and use SIGUSR1 on Debian."

## Decision
Crux: whenever its unit is loaded, touch-timeout is the only backlight writer, and the slider reaches it only through a Beocreate-owned EnvironmentFile plus a restart, the one door DESIGN leaves (§15: no config file, D-Bus or FIFO command; §3.2: SIGHUP shuts down); **weakest assumption: the DSI backlight exists when the unit's Condition is evaluated at boot — if not, dimming silently does not run that boot.**

1. **Package** `beocreate-debian/touch-timeout/` in upstream's C-package shape (`upstream/default:packages/squeezelite/build.sh`, `src/debian/rules:7-12`): sbuild, `Architecture: any`; rules clones `ajmccaus/touch-timeout` at the buildroot pin (`touch-timeout.mk:7`, 2ad5769), runs `make SYSTEMD_PKG=no all` and `make test`, installs `/usr/bin/touch-timeout`, the pinned repo's own unit (no fork copy; dh_installsystemd enables it) and `10-only-with-backlight.conf` (`claude/touch-timeout-package`) as a drop-in.
2. **Hook**, shipped by beocreate-classic-ui like its sigmatcp drop-in (`build.sh:63-67`): `touch-timeout.service.d/20-beocreate-brightness.conf` = `EnvironmentFile=-/etc/beocreate/touch-timeout.env`, `ExecStart=`, `ExecStart=/usr/bin/touch-timeout $BEO_SCREEN_ARGS`. A missing file yields zero args (daemon defaults), never `-b ''`. Control `Recommends: touch-timeout`; postinst `try-restart touch-timeout.service`; postrm purge deletes the env file (today only `*.json`, `build.sh:167`).
3. **Mode** = `systemctl show -p LoadState --value touch-timeout.service`, queried per use through a new `BEO_SYSTEMCTL` (default `systemctl`; the test seam). `loaded` → daemon mode: the extension never writes sysfs. Anything else or an error → direct mode (today's sysfs path).
4. **Slider**: each `setBrightness` clamps (direct mode also writes sysfs) and re-arms a 500 ms settle timer; on settle, persist `screen.json` once (today an SD write per tick, `index.js:95`) and, in daemon mode, atomically write `BEO_SCREEN_ARGS=-b <raw>` then `systemctl restart touch-timeout.service`. Settling detects release server-side: slide and stop send the same message (`screen-client.js:49,56`). No live preview in daemon mode.
5. **Floor** in raw units, one constant for both modes, replacing the 5%: `raw = max(15, min(255, round(pct × max_brightness / 100)))`; persisted floor pct `ceil(1500 / max_brightness)`. Below 15 the pin silently runs 150 (`main.c:394-398`); the spec'd rewrite exits 2 with no restart (DESIGN §4.5, §5.6).
6. **Startup**: daemon mode drops the restore (`index.js:129-135`) and rewrites the env file from `screen.json` only if it differs, restarting only then (first install: 75% default, `index.js:29`, vs daemon 150). Direct mode keeps the restore.
7. **Read**: `getBrightness` returns the persisted level, never sysfs. Delete the `setBrightness`/`getBrightness` exports (`index.js:178-182`; grep: no callers): an unfloored side door to sysfs.
8. **Wake on play**: on bus `sources`/`sourcesChanged` with `fromStandby` and a `currentSource` (`sources/index.js:797,823`), daemon mode runs `systemctl kill --signal=SIGUSR1 touch-timeout.service` (pin: `main.c:506-512,623-637`). Privilege: `beocreate2.service` has no `User=` (root), as `mpd/index.js:232` already relies on.
9. **Tests/docs**: mock systemctl (logs argv; LoadState from `MOCK_TOUCH_TIMEOUT`, default not-found); criterion 12 → raw 15; new 16 (daemon mode: backlight file untouched; env `-b` = mapped raw; one restart per settle; drag to 0 → `-b 15`; a dimmed file still reads the persisted level); new 17 (standby→playing logs the USR1 kill). PORTING.md: screen section, criteria, device items below.

## Justification
Owner preference settles slider and version; the rest follows from §15 leaving restart as the only way to change `-b`. The mode gate makes two writers impossible by construction (poka-yoke) instead of detecting them. Waking from Beocreate reuses the one subscriber that sees every ACR player (`sources/index.js:386`); no new daemon. Medium effort × low risk × high value.

## Assumptions
- [unverifiable] **The DSI backlight exists when `ConditionPathExistsGlob` is evaluated** (`After=multi-user.target`, `touch-timeout.service:3`); a miss skips dimming silently that boot (the first slider restart re-evaluates). — REOPEN-IF: after boot `systemctl status touch-timeout` shows the condition failed while `/sys/class/backlight/*` exists → start it from a udev `SYSTEMD_WANTS` rule.
- [verified] Unbraced `$VAR` "split at whitespace, resulting in zero or more arguments" — systemd man source, tag v257, `man/systemd.service.xml:1447-1449`.
- [verified] Pinned unit: `StartLimitIntervalSec=0`, no `RestartPreventExitStatus` (`touch-timeout.service:4,14`) — repeated restarts never lock it out.
- [checkable] Criteria 12, 16-17 green in `run-tests.sh`, 01-05 unchanged — owner: implementer; result: pending (specs unwritten).
- [checkable-doc] Fits the plan of record (`roadmap.md:78-79,124` on `claude/hifiberry-buildroot-review-u7omrz`) — verified; drift: absent on this branch, though `CLAUDE.md:11` names it.
- [unverifiable] Settle + restart changes the panel in under a second on the Pi (owner's option text). — REOPEN-IF: device release-to-change > 1 s.
- [unverifiable] systemd-backlight's boot restore runs before touch-timeout's start write. — REOPEN-IF: panel settles at a level other than `-b` after boot.
- [unverifiable] Lost-SIGUSR1 race on the pin (`DESIGN.md:59`, C1) can drop a play-start wake until the next touch; the bump fixes it. — REOPEN-IF: missed wakes seen before the bump.

## Rejected alternatives
- Slider read-only when the daemon is installed (solo-maintainer) — owner chose "Set touch-timeout's level".
- Generated `/etc/systemd/system` drop-in `ExecStart=… -b N` (integrator, kiosk) — `daemon-reload` per change; runtime writes in the admin's tree.
- Live preview while dragging (kiosk) — restart's stop path restores the old `-b` first (`main.c:670`): a visible flash.
- Client edit sending a distinct release message — Sacred client; the settle timer does it server-side.
- Ship the spec'd rewrite now (integrator) — unimplemented (`DESIGN.md:8`); owner chose the pin.
- FIFO wake on Debian — shairport is native; SIGUSR1 reaches the daemon (owner).
- Daemon inside the Beocreate .deb — arch-all; its build fails on compiled code (`package/build.sh:56-61`).
- Delete the direct path — devices without the daemon lose the owner's in-UI brightness; the gate already prevents two writers, and that code is tested (criteria 6, 12).

## Revisit triggers
- The touch-timeout rewrite lands → bump both pins in one PR; recheck that only `-b` is passed (`-d` changes meaning, DESIGN C5).
- Upstream hbosng ships its own dimming or backlight control → realign.
