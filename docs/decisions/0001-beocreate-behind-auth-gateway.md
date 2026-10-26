---
id: 0001
title: "Beocreate behind the nginx auth gateway (loopback backend, nginx :8080, tier ok)"
status: proposed
summary: "beo-server binds loopback only; nginx owns :8080 with its own auth_request (synthetic /api/beocreate prefix, whole UI tier ok by the owner's choice); loopback ungated for the kiosk; Origin check + dead REST POST deleted to keep the accepted risk LAN-only"
---

# 0001 — Beocreate behind the nginx auth gateway

- Date: 2026-10-26
- Owner: PM
- Panel: home-network-security (LAN bypass), upstream-alignment (gateway conventions), kiosk-ux-designer (keyboardless kiosk) — the three lenses the call splits on; the tier was the owner's, asked directly.
- Context: `beo-server.js:375` `listen(port)` (HTTPS twin `:373`) binds every interface — a door around the gateway (CLAUDE.md Sacred; upstream `docs/security-model.md:253-256`). Every command — reboot (`general-settings/index.js:37`), rename, DSP writes — rides one WS (dispatch `beo-server.js:979-1023`) opened at the root of `window.location.host` (`beo-comms.js:41,63`), so the gateway sees only the upgrade: one tier for all. Open: port, gating, tier, kiosk, policy-`all` path.

## Decision
Crux: the gateway can tier only the upgrade, so the owner traded a password on reboot/rename/DSP for frictionless LAN use — sound only while every device on the LAN is trusted, the weakest assumption below.

Owner, asked "Beocreate's commands all travel over one WebSocket, so the password gateway can give it only ONE tier for everything. Phones and laptops on your LAN: what should happen?", chose **"No password needed"** over "Password-protected (Recommended)".

1. **Backend loopback-only.** Both beo-server listeners bind loopback, hardcoded (`:373`, `:375`); new key `listenPort`, default 8081. `port` stays 8080 = the public port bonjour (`product-information/index.js:308`) and art URLs (`sources/index.js:558`) advertise.
2. **nginx owns :8080** — own server block (a :80 sub-path needs a client edit: the WS is hard-rooted). Own `auth_request` location → hifiberry-auth verify with `X-Original-URI /api/beocreate$request_uri`; ship `auth.d/beocreate.json`: `match_prefix /api/beocreate`, `default_tier ok`, no rules. `Host $http_host`; Upgrade/Connection map.
3. **Loopback ungated** (`satisfy any` + `allow` loopback v4/v6): the kiosk keeps `http://localhost:8080` and works under every policy.
4. **Policy `all`, LAN:** `error_page 401` → 302 `http://$host/` (hbos-ui, whose 401 handler opens sign-in: hbos-ui `src/stores/auth.ts:157-169`); its cookie (`path=/`, no domain: `server.py:95-96`) then covers :8080. User returns to :8080 by hand.
5. **Keep the accepted risk LAN-only:** the WS rejects an Origin whose host ≠ Host (`communication.js:107` accepts any); delete the REST POST route (`beo-server.js:410-451`).
6. **Package:** `Depends: nginx, hifiberry-auth` (as hbos-ui `debian/control:11`); site + manifest shipped as package files under /etc (the auth.d dpkg trigger fires only for those).

One change, before the port's first device install.

## Accepted risk (owner's, informed)
Under policies `unset`/`off`/`risky` (the default), any LAN device or guest can, with no password, reboot/shut down, rename, rewrite the DSP and change every Beocreate setting. Only `all` gates it. Upstream classes reboot/hostname `risky` (`security-model.md:78-79`); this deviates on purpose.

## Justification
- Closes the bypass at low effort; no URL moves (kiosk, bookmarks, bonjour, art stay on :8080).
- Own verify location, not upstream's `00-verify.conf` include: that forwards raw `$request_uri` (`00-verify.conf:9`), so Beocreate's root would need a `/` manifest — which owns every path (`manifests.py:69-74`) and turns the device-wide unmanifested→risky fail-safe into ok. Cost: a 6-line fork of upstream's verify location.
- Loopback exemption adds no exposure (the backend is loopback-reachable anyway); the kiosk is physically local, keyboardless, and the client has no sign-in path.
- Origin check + POST deletion: the owner accepted LAN devices, not every web page a LAN browser opens. Today a cross-site simple POST `/general-settings/restartProduct` reboots (`beo-server.js:447` emits any header) and any page can open the WS. The route is dead on hbosng (only caller: uploads, `beo-ui.js:2168`; no extension has `processUpload`, so they already 501) — delete beats gate.

## Assumptions
- [unverifiable] **Weakest: the household LAN is trusted** (the owner's premise); DNS-rebinding pages (Origin == Host after rebind) also pass — REOPEN-IF the device serves a shared/guest LAN, a LAN-side abuse or rebinding report lands, or the owner reverses.
- [verified] In-session e2e, nginx 1.24 + the gateway's real `TierMap`/`decide()` + a loopback stub on Beocreate's `websocket` lib: LAN GET/WS allowed under unset/off/risky; `all` without session → 302 `http://$host/`, with → 101; loopback allowed under `all` and with the auth backend down (LAN then 500: fails closed), with no subrequest; an idle WS lives 75 s (lib keepalive 20 s < nginx 60 s), so no timeout directive.
- [verified] With the manifest, `/api/beocreate/*` → ok; `/`, `/common/*`, unmanifested `/api/*` stay risky; a `/` manifest flips unmanifested paths to ok.
- [verified] aes67's `Host $host` drops `:8080` at the backend → Origin == Host fails; hence `$http_host`.
- [verified] A refused upgrade = 5 retries, then "can't be reached" (`beo-comms.js:98-130`, loaded by `index.html:31`): kiosk-ux's no-401-path claim holds; upstream-alignment's "client recovers via `/api/auth/login`" is refuted.
- [verified] `/api/beocreate` is inert on :80: hbos-ui's `location /api/` 404s with `auth_request off` (`hifiberry-webui.nginx:38-42`, hbos-ui@782fa58).
- [verified] The harness reaches the server on loopback (`tests/playwright.config.js:34`).
- [verified] The SigmaTCP drop-in binds localhost (`sigmatcp-enable-tcp.conf:9` `--localhost` → hifiberry-dsp@551c195 `sigmatcp.py:1384-1398`): no LAN door. Its overlap with `/api/dsptoolkit` is a separate call.
- [checkable] New spec: foreign-Origin WS refused, `POST /general-settings/restartProduct` 404, no listener on a non-loopback address; whole suite green — builder; result: verified — criteria 13-15 (`tests/06-exposure.spec.js`), whole suite green; 13 and 15 fail on the pre-change server; the shipped `package/beocreate.nginx` (ports remapped, IPv4 only) passes the e2e above against the real server, Chromium included.
- [unverifiable] On device: `ss -ltnp` shows node on loopback only, IPv6 `listen [::]:8080` + `allow ::1` work (untested: sandbox has no IPv6; mirrors hbos-ui's `listen [::]:80`), LAN :8080 302s under `all` — REOPEN-IF any fails (PORTING.md on-device item).
- [unverifiable] The per-request auth subrequest (LAN only; upstream exempts static) doesn't visibly slow a phone's load on a Pi — REOPEN-IF it does → `auth_request off` on the static prefixes.

## Rejected alternatives
- Keep all-interface :8080 — the bypass; Sacred.
- Beocreate on a :80 sub-path — WS hard-rooted (`beo-comms.js:63`); client edit (Sacred).
- WS tier `risky` (both security advisors) — owner declined; phones would sign in for volume.
- Include `00-verify.conf` + a `/` manifest — the fail-safe flip (above).
- Kiosk direct to the backend port — art URLs point at :8080 (`now-playing-client.js:404`), gated under `all`.
- Per-message auth in beo-server — backend auth breaks the gateway-only model, ~12 extensions' headers to classify, and the client cannot sign in.
- `no-https` flag — loopback-binding both listeners leaves no flag to lose.

## Revisit triggers
- Upstream changes the verify contract or adds a per-server prefix/tier → re-sync or adopt.
- The client gains a sign-in path, or risky commands leave the WS → per-command tiers.
- The owner changes the tier choice.
