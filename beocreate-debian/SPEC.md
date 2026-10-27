# Beocreate on HiFiBerryOS NG: design spec for the remaining work

This spec covers what is left after PR #2 (the port itself, ADRs 0001-0002):
getting the port onto a device, then modernizing the code without changing the
product. It owns the requirements (R1-R23 below) and the design; `PORTING.md`
owns the port's contract, patch list and test criteria (referenced here by
number, not restated), and the ADRs own the decisions already taken.

## Goal and the owner's criteria

The owner's words: "the most efficient, most error-proof way. There needs to be
requirements documented to check against and test, so that each feature can be
tested and fixed before shipping. The installation has to be streamlined as
well so I can test it on real hardware easily and quickly, maximum automation,
and you can get feedback to fix issues in the most efficient way." End state:
a modern toolchain (TypeScript, modules, pinned libraries), reached in stages,
keeping the interface's look exactly ("I like the look of the interface").

## Decisions this spec builds on

| Decision | Source |
|---|---|
| The DSP screens become an optional add-on package, frozen (safety fixes only); the core modernization skips them | owner, 26 Oct |
| Device feedback runs through Claude Code on the owner's computer, which reaches the Pi over SSH | owner |
| The owner's Pi runs buildroot; NG is tested on a spare SD card | owner |
| Kiosk baseline: the buildroot look, landscape 800x480 CSS px (cog at scale 1) | owner, 27 Oct |
| Kiosk appearance: light | owner, 27 Oct |
| No Spotify account is linked on the spare SD (ACR serves its token unauthenticated on the LAN, see Risks) | owner, 27 Oct |
| Staged path: cleanup, then typed server, then type-checked client; no client rewrite | PM call, owner delegated |
| Trust model: the owner reviews and merges every PR; CI and the device script supply the evidence; no signed reports, approval environments or test-change guards | Claude's call after three blocked review rounds of heavier designs; reversible, see Open questions |

## Requirements

Each requirement names how it is checked: a Playwright criterion in
`PORTING.md` (C<n>), a check still to be written (new), a device check run by
the deploy script (device), or something only the owner can judge (owner).
A requirement without a working check is not done.

### What the product does

- **R1 Look.** Every screen looks as it does today. Checked by pixel-exact
  baseline screenshots (Stage 0) at kiosk 800x480 light, phone 390x844 and
  desktop 1280x800; owner on the panel.
- **R2 Kiosk.** The touchscreen shows Beocreate full screen at 800x480, light,
  starting on Now Playing. Checked by a start-screen test (new; it fails today:
  the client's `restoreState` has no caller) and a device probe of the
  kiosk's viewport, touch support and colour scheme (device).
- **R3 Now Playing.** Title, artist, album, artwork and play state follow ACR
  live, artwork also on phones. C2, C7, C9, C18-19, C33-34; artwork from the
  metadata daemon (device).
- **R4 Transport.** Play/pause/next/previous reach the active player; buttons
  match what the player supports. C3, C29.
- **R5 Sources.** ACR's players are listed and can be activated; Spotify and
  MPD show when they play, also when ACR starts after Beocreate. C4, C10, C28.
- **R6 Volume.** UI and hardware volume stay in sync; a failure never shows 0;
  a system without volume control works. C5, C8, C11, C35.
- **R7 Brightness.** The slider sets the level; with touch-timeout running it
  sets touch-timeout's level and never fights it; it never goes black; it works
  on the 7" display (max 255), Touch Display 2 (31), large ranges (1023) and
  with no panel. C6, C12, C16, C23-26, C32, C36, C43-45; release-to-change under
  a second (device).
- **R8 Wake on play.** Playback starting from standby wakes a dimmed screen,
  for any player. C17; device.
- **R9 System.** Rename, restart and shut down work; a failed shut-down
  brings the UI back. C20, C27.
- **R10 DSP add-on.** Installing `beocreate-dsp` adds the equaliser, Beosonic,
  DSP programs and volume limit; without it the core works and shows no DSP
  entries; the add-on's settings survive a restart. Add-on contract test
  (new, Stage 1); DSP hardware itself is untested by choice (owner).

### Security

- **R11** Nothing listens on the LAN outside the nginx gateway on :8080
  (CLAUDE.md Sacred). C15, C30-31, C37; `ss -lntup` (device). Open: dnssd2's
  UDP 5353 responder (Open questions).
- **R12** The gateway's password policy applies; the local kiosk is never
  asked for one. C37, C40.
- **R13** No other web page can control the device: Origin check, no POST
  route, no framing. C13-14, C38-39.
- **R14** No text from the UI reaches a shell; the artwork proxy relays only
  images. C20-22, C41.
- **R15** Bad input or a missing buildroot helper never stops the server.
  C42, C46; a content-less frame for every client message (new, Stage 1).

### Installation and feedback

- **R16** One command on the owner's computer installs a build on the Pi
  (copy, install, restart the kiosk); one command rolls back. Checked on the
  spare SD (device).
- **R17** One command runs the device checks and prints a report the cloud
  session can act on, so a device failure becomes an automated repro before it
  is fixed (device).
- **R18** Packages: correct dependencies; upgrades keep the admin's choices;
  purge leaves nothing; built from the lockfile, no native code in the
  arch-all package. `package/test-maintainer-scripts.sh`; CI install test
  (new, Stage 0).

### Engineering

- **R19** Every R-row has a check, and a change ships only with the whole
  suite green (CLAUDE.md Never).
- **R20** Cleanup and refactoring steps change nothing observable: screenshots
  and message transcripts identical, or each difference named in the PR for
  the owner.
- **R21** Server: TypeScript `strict`, ES modules, no implicit globals;
  dependencies pinned by lockfile and `npm audit` clean, exceptions listed.
- **R22** Client: the same files, type-checked (`tsc --checkJs`), libraries
  pinned through npm; no framework rewrite and no bundler.
- **R23** One toolchain (Node, `tsc`); CI runs every check on every PR.

## Design

### Stage 0: baseline before any modernization

1. **CI** (GitHub Actions on the fork, read-only token, no secrets): on every
   PR and on `master`, run `run-tests.sh` inside a network namespace with a
   veth LAN address (so C15 and C31 run), `adr-lint`, `bash -n`, build both
   packages (touch-timeout for arm64) and run `test-maintainer-scripts.sh`;
   an install job boots trixie arm64 with `systemd-nspawn --boot`, installs the
   debs on upstream NG's packages and checks the units start and that only
   nginx listens on the LAN. Artifacts: the debs and `SHA256SUMS`.
2. **Test hardening** (cheap, one line each): Playwright `forbidOnly` (a stray
   `test.only` fails CI instead of silently skipping the rest) and one worker
   process per spec file, so no spec can patch another's helpers.
3. **Screenshot baseline**: a separate Playwright run in `tests/golden/`
   records every shared screen state at the three viewports above, light, in
   pinned Chromium with a hermetic `fonts.conf`, and compares decoded RGBA
   exactly (pixelmatch's threshold skips anti-aliased pixels: a 1 px border
   change passed at `threshold: 0`). The kiosk states also run in WebKit
   (cog's engine family) when its download is allowed (Open questions). The
   determinism was measured: identical PNGs across fresh runs.
4. **Transcripts**: per scripted scenario, the WebSocket frames, the requests
   to ACR, the child-process argv and the data directory's end state,
   normalized for time; a diff is a behaviour change.
5. **Real ACR**: the suite also runs against ACR built from its tag (it builds
   and runs headless in the cloud container), so a mock that drifts from ACR
   fails.
6. **Start on Now Playing** (R2): the one product fix in Stage 0, behind its
   failing test.
7. **First device run** (Stage D below) gates PR #2's merge.

### Stage 1: cleanup, no behaviour change (R20)

One concern per PR, each proven by the unchanged baseline:

- **S1** lock all dependencies; `npm ci` everywhere; lockfile-only
  `npm audit fix`.
- **S2 DSP add-on** (R10): `beocreate-dsp`, an arch-all package holding the
  four extensions, `dsp.js`, their data and the SigmaTCP drop-in, in the
  core's layout; `Depends: beocreate-classic-ui`, the core `Suggests` it. The
  add-on's contract with the core is written down and tested: the `beo.*` host
  names it uses (generated by a script from the add-on's code, today
  `bus, dataDirectory, debug, extensions, saveSettings, selectedExtension,
  sendToUI, setup, systemConfiguration, systemDirectory, underscore, volume`)
  and the bus channels it emits and listens on (`settings`, `general`, `dsp`,
  `ui`, `daisy-chain`, `speaker-preset`, `now-playing`, `setup`, plus its own
  four). The contract test loads the add-on as its package lays it out and
  checks: every DSP screen loads and answers; each extension's settings
  survive a server restart (crossover, volume limit); no "Error loading
  extension". The core's DSP couplings in `sound` move behind the contract.
  Then the add-on is frozen.
- **S3** delete code nothing references (grepping upstream NG too, since some
  upstream scripts call into Beocreate).
- **S4** replace dependencies one per PR; `ws` for `websocket` keeps the
  Origin check and pings within nginx's 60 s idle cut.

### Stage 2: typed server (R21)

TypeScript `strict`, ES modules, built by `tsc` for trixie's Node. The host
(`beo-server.js`) first: it loads each extension with `import()` before
listening. Then one extension per PR, shared modules last; a module touched
for any other reason is converted first. The typed host object stays global
for the frozen add-on.

### Stage 3: type-checked client (R22)

The same files, DOM and CSS; `tsc --checkJs` with one `globals.d.ts`, file by
file (the include list only grows). In order:
- **C1 (security first):** menu builders escape server text where it enters
  HTML.
- **C2:** checkJs.
- **C3:** Modernizr reduced to its touch test.
- **C4:** jQuery 4 with jQuery UI 1.14 together. Two known visible
  differences, both to be named in that PR:
  - `.text(null)` shows "" instead of "null";
  - slider widths become fractional, so some drags land one unit apart.
- **C5:** drop FastClick if the panel has no tap delay.
- **C6:** Vue 2.7's production build.

C4 and C5 go to the device before the owner relies on them: touch feel is the
weakest assumption of the whole plan, and only the owner can judge it.

### Stage D: device delivery and feedback (R16-R17)

Modelled on touch-timeout's `make deploy`: one SSH connection, staging in
tmpfs, an atomic install, verify commands printed.

- **The tool.** `beocreate-debian/deploy/device`, run by the owner's local
  Claude session.
  - **Subcommands:** `bootstrap`, `install <build>`, `check`, `rollback`.
  - **Inputs:** the device is the SSH alias `hbosng-dev`, and builds are CI
    artifacts named by commit. Nothing typed into it reaches a shell.
- **Bootstrap**, once per spare SD:
  - the owner images Pi OS Lite 64-bit (trixie) with key-only SSH;
  - `bootstrap` installs upstream NG's packages, our debs, and the kiosk (`kiosk-mode.sh setup --url=http://localhost:8080 --scale=1`; upstream's default 1.3 zoom gives the compact layout), and checks the kiosk comes up light although the script appends `?dark`.
- **A round:**
  - `install` puts the PR's CI build on the Pi and restarts the kiosk;
  - `check` runs the device rows (listeners, units, ACR responses, the kiosk probe, a screenshot of the panel);
  - the owner does the owner rows: touch feel, sound, the panel versus the baseline PNGs;
  - the report goes on the PR as one comment;
  - `rollback` reinstalls the previous build; the buildroot SD is the full fallback.
- **Owner effort per round:** swap the SD, ask the local session to run the round, judge the owner rows.

### Cloud development environment

What the cloud session can run, all checked in this container:
- Chromium (Playwright) and WebKitGTK renders of the UI;
- the real ACR, built from source and run headless;
- an isolated network namespace per test run;
- a booted systemd container (`systemd-nspawn`).

It cannot reach the owner's LAN, so device rounds go through the owner's computer.

## Risks

- **Touch feel** after C4/C5 (jQuery 4 + UI 1.14, FastClick): only the owner
  on the panel can judge it. Mitigation: those PRs go to the device first.
- **The emulated kiosk is not the panel**: 800x480 at scale 1, touch on, is
  what cog should show; the first device probe confirms it or re-baselines.
- **Upstream ACR on the LAN**: ACR binds 0.0.0.0:1080 and serves
  `GET /api/spotify/access_token` without auth (acr `configs/audiocontrol.json:46`,
  `src/api/spotify.rs:431-432`); MPD's control port is 0.0.0.0:6600. Not ours
  to fix; a report upstream needs the owner's approval of its text. Until then
  no Spotify account on the test SD.
- **DSP hardware untested**: the add-on is frozen and labelled untested by
  choice; a DSP owner's report reopens it.

## Open questions for the owner

1. The trust model above (you review and merge; no signed reports or approval
   environments): confirm, or ask for the heavier design.
2. Enable GitHub Actions on the fork (Stage 0 needs it).
3. Allowlist `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`
   in the cloud environment's network settings for the WebKit baseline.
4. Deploy user on the spare SD: a dedicated user with passwordless sudo
   (recommended) or key-only root SSH.
5. dnssd2's UDP 5353 mDNS responder outside the gateway: keep as a named
   exception, or publish through avahi.
6. Report ACR's LAN exposure upstream (Claude drafts, you approve the text).

## Order

1. Stage D's tool and bootstrap, as the first PR on top of PR #2; then a
   device round of PR #2's head on the spare SD.
2. PR #3 (one21tools), then PR #2, merge.
3. Stage 0, then Stages 1, 2 and 3, each a stack of small PRs, with a device
   round wherever a device row's behaviour changes.
