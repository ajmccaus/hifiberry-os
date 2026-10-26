# hifiberry-os (ajmccaus fork) — CLAUDE.md

## Stack & navigation
Two product lines in one repo:
- **Buildroot HiFiBerryOS 64** (legacy, maintenance): buildroot external tree — `buildroot/package/*`
  (.mk, Config.in, systemd units, shell), `configs/override.conf`, top-level build scripts.
  Build: `./get-buildroot && ./build-config 4 && ./compile 4` (hours; build host only).
- **Beocreate on Debian / hbosng** (direction): `beocreate-debian/` — Node 20 server, mock ACR,
  Playwright suite, .deb build. Its `PORTING.md` owns the port's contract and patch list.
Upstream: HiFiBerry `main` (Debian NG) is mirrored as branch `hbosng`; the old buildroot line is
upstream `hbos-buildroot`. `roadmap.md` owns plan and next steps.

Before every push, run what the change touches:
- shell scripts: `bash -n <file>`; Beocreate: `beocreate-debian/run-tests.sh` (all specs green);
- ADRs: `node scripts/adr-lint.mjs`.
File headers own each file's role + constraints.

## Sacred (do not break)
- Updater path (`hifiberry-updater/extract-update`, `update`, `partitions`) — a bug bricks or
  wipes devices. Never ship a change here without `extract-update --simulate` on a device.
- Beocreate client side (`*-client.js`, `.html`, `.css`) is the aesthetic = the product. Port
  server-side; a client edit needs a failing test proving it necessary.
- Nothing may listen on the LAN outside the hbosng nginx auth gateway (auth.d tiers).
- systemd units: no ordering cycles; never admin-down an interface another daemon owns.

## Conventions
- Watch for and cut **muda** — duplicated logic, dead packages/code, premature abstraction,
  drift, git-tellable backstory (git is the SSoT). Cite-or-silence; don't gold-plate.
- Poka-yoke: make the error impossible (bind localhost, Condition*=) over detecting it.
- Hardware facts (kernel, firmware, overlays, ACR behaviour) need a cited source at the pinned
  version; a mock or doc is not the device — list unverified device behaviour in PORTING.md.
- Do work while you wait — run non-blocked items in parallel rather than idling.

## Docs — one home per fact
Every fact has ONE home at the lowest altitude that owns it; higher docs reference, never restate.
Docs state the current truth, never narrate how it got there. Altitude ladder:
pdca-workflow's `doc-budgets.md`. Touch a source artifact -> update its header in the same change.

## Never
- ship without the touched suite green; never commit build outputs (.deb, node_modules)
- `git add -A` without reviewing `git status` (untracked build trees get swept in)
- ship a process-gating script without an executable test of its decision logic

## Shipping — PR
- PR: title = the change; body = Purpose / Changes / Testing / Deferred. Read review comments
  before merging. Three-dot (`master...branch`) previews.
- Deferred work gets an issue, not a TODO file — work-state in issues, decisions in ADRs.
- End every PR/issue Claude writes with a Claude disclosure line.

## Feedback = PDCA trigger
User feedback (bug report, feature ask, observation) triggers `/decide` — Plan (advise -> PM
decides -> ADR), Do, Check (tests + fresh-eyes gate), Act (ship + iterate). Never fix a judgment
call directly before planning it. A concern YOU raise is feedback too: fix, file, or task it in
the same turn. `/retrospect` before opening a PR on a session's work.

## Review panels (agent grading)
- Fresh eyes: each reviewer a new agent with only the artifact + a neutral task; never pass a
  prior grade or the answer you want.
- Verify before acting: reproduce every finding yourself — agents are confidently wrong.
- Inherit settled calls from `docs/decisions/` (panel: `docs/decisions/panel.md`); don't
  re-litigate.
