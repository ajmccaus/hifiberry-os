# Advisor panel

The `/decide` PM picks 2-3 of these per call. Edit this roster to tune the panel; each advisor's
prompt lives in `.claude/agents/<name>.md`.

## Correctness experts — "is it right + useful"

| Advisor | Lens | Why this project needs it |
|---------|------|---------------------------|
| `embedded-linux-integrator` | boot, systemd, overlays, buildroot/Debian packaging | The costliest bugs here were systemd ordering cycles and device-tree overlay behaviour that read fine and failed on hardware. |
| `audio-systems-engineer` | player/transport/volume/metadata truth, PipeWire, DSP control | The product is an audio streamer; a wrong volume mapping or DSP write is a user-audible (or speaker-damaging) failure. |
| `home-network-security` | LAN exposure, auth-gateway bypass, DHCP/DNS/AP | Appliance runs privileged services on household LANs; past defects included a rogue DHCP/DNS server and an auth side door. |
| `kiosk-ux-designer` | Beocreate aesthetic, touchscreen usability, brightness/idle | Keeping the Beocreate look on a 7" kiosk is the reason this fork exists. |

## Decision axes

| Advisor | Lens | Why this project needs it |
|---------|------|---------------------------|
| `solo-maintainer` | effort, scope, upkeep | One maintainer, spare-time hardware testing. |
| `upstream-alignment` | divergence vs HiFiBerry upstream `main` | Upstream hbosng moves fast; forking its conventions costs every rebase. |
