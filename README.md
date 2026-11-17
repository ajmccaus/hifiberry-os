# audio-os

audio-os is a music-player operating system for a Raspberry Pi 4 (2 GB) with the official 7-inch touchscreen and a HiFiBerry Amp2 amplifier board. You flash it to an SD card, plug in speakers, and control playback from the touchscreen or from a phone or computer on your network.

**Status: nothing has been tested on a real Raspberry Pi yet.** The image is built and checked automatically (unit tests, browser tests of the interface, offline checks of the image, and a boot test in a container), but no one has run it on the hardware. Expect problems and read `docs/device-test.md`, the checklist for the first real test.

## What it is

The system is Raspberry Pi OS Lite (64-bit, Debian 13 "trixie") customised at build time. It adds the HiFiBerry apt packages for the audio stack (the audio controller, called "ACR", plus Spotify Connect, AirPlay, Bluetooth and internet radio) and one package of our own, `audio-os`. That package contains a small touch and web interface in the style of Bang & Olufsen's Beocreate, a helper service for the screen and power, a full-screen kiosk session for the display, a firewall and some hardening.

Target hardware: Raspberry Pi 4 with 2 GB of memory, the official 7-inch DSI touchscreen (800x480), and a HiFiBerry Amp2.

## What you get

- Sources: Spotify Connect, AirPlay, Bluetooth and internet radio (stations searched through radio-browser.info and saved as favourites).
- The interface runs on the touchscreen and in any browser on your network, with the same look on both.
- Now Playing, Sources, Radio, Screen (brightness and screen-off timeout) and System (name, address, version, restart, shut down).
- HiFiBerry's own interface stays available at `/services` as "Advanced settings".
- The screen dims after a period without touch and wakes on touch or when playback starts.

## Get the image

Releases are on the repository's Releases page (https://github.com/ajmccaus/hifiberry-os/releases): a version tag such as `v0.1` publishes a release of that name, and every build of the working branch replaces the rolling prerelease `dev`. Download both assets: `audio-os-<version>.img.xz` and `audio-os-<version>.img.xz.sha256`. Check the download, then write it to an SD card:

```
sha256sum -c audio-os-*.img.xz.sha256
```

Either open the `.img.xz` in Raspberry Pi Imager (choose "Use custom") and write it, or on Linux, replacing `/dev/sdX` with your card (check with `lsblk`, the wrong device destroys its data):

```
xz -dc audio-os-*.img.xz | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress
```

## First boot

1. Connect the screen, the Amp2, the speakers and Ethernet (or set up Wi-Fi first, see below), then power on.
2. The first boot grows the root partition to fill the card. The image runs HiFiBerry's `config-detect.service` at boot; it identifies the Amp2 and, when the sound-card setting in `config.txt` has to change, rewrites it and reboots the Pi once by itself. Do not unplug it during this. Before and during the reboot the screen may show "Connecting..." instead of music.
3. The kiosk then shows the interface on the touchscreen. The first-boot volume is preset to 20 percent.
4. From a phone or computer on the same network, open `http://hifiberry.local/` (the default hostname is `hifiberry`; the System screen also shows the device's IP address).

## Settings you can change before first boot

After flashing, the small FAT partition of the card (the boot partition, `/boot/firmware` on the device) can be edited on any computer. The image ships three commented templates there:

- `audio-os.conf`: `SCREEN_ROTATE=0`, `90`, `180` or `270` turns the picture and the touch input together.
- `network-config`: Wi-Fi, in netplan format (the network-configuration format used by cloud-init, the first-boot tool). Remove the leading `# ` from the example, then set your network name, password and two-letter country code. Wired Ethernet needs nothing.
- `user-data`: cloud-init settings. The example creates a login user with your SSH public key and sets `enable_ssh: true`. SSH is key-only.

Edit these files with spaces for indentation, never tabs. They are applied once, on the first boot. The templates do not set a hostname; it is `hifiberry` (pretty name "HiFiBerry").

## Security model

- No account has a password: `root`, `pi`, `player`, `kiosk` and `audio-os` are all locked.
- SSH is off by default. It is only enabled if you add a user and `enable_ssh: true` in `user-data`, and then it accepts keys only, with no root login.
- A firewall (nftables) drops all inbound traffic except what the player needs: ping and IPv6 essentials, DHCP, mDNS (the `.local` names), ports 80, 22, 5000 and 7000, UDP 319-320, and ports 32768-60999 (AirPlay and Spotify Connect negotiate ports there).
- The audio controller, MPD and the PipeWire API listen on the loopback address only; nginx on port 80 is the single web entry point.
- Services run under their own users (`player` for audio, `kiosk` for the display, `audio-os` for the helper), not root. The helper may only restart the screen daemon, send it a wake signal, and reboot or power off, enforced by a polkit rule.
- Everyday actions (play, volume, radio favourites, screen settings) need no password. Risky actions (restart, shut down from a browser, changes in HiFiBerry's settings) are refused until a password is set, which the interface offers on first use, and then need a login. The touchscreen itself is trusted for restart and shut down.
- Debian security updates install automatically around 04:00 and the device never reboots by itself for them.

## Known gaps

- No update button in the interface. Updating means flashing a newer image (or running apt over SSH).
- No Wi-Fi setup in the interface; use `network-config` before first boot.
- Changing the hostname is not offered by the templates.
- Bluetooth may stay discoverable all the time; this is not yet confirmed (see `docs/device-test.md`).
- The touch-timeout daemon has known limits, listed in `docs/device-test.md`.
- The Metropolis font licence is not confirmed at its source (see Credits).

## Build from source

CI (`.github/workflows/image.yml`) runs on every push to `master` and `claude/**` branches. In order:

```
python3 -m unittest discover -s helper -v          # helper tests
cd ui && npm ci && npm run typecheck && npm test && npm run build
os/build-deb.sh ui/dist out                        # the audio-os .deb
sudo image/build.sh out/audio-os_<version>_arm64.deb out/audio-os-<version>.img.xz
sudo image/verify.sh out/audio-os-<version>.img.xz
```

The shell scripts are also checked with `bash -n` and `shellcheck`. The image job runs on an arm64 GitHub runner, downloads the pinned Raspberry Pi OS Lite base image (checking its sha256), provisions it in a chroot, shrinks and compresses it, boot-tests it, and publishes it as a prerelease (`dev` from `claude/**` branches, `build-<date>-<commit>` from `master`).

## Repository layout

| Path | Contents |
|---|---|
| `ui/` | The web interface (TypeScript, Vite, Preact) and its tests |
| `helper/` | `audio_os_helper.py`, the device helper (Python standard library) and its tests |
| `os/` | The `audio-os` .deb: files as installed, maintainer scripts, `build-deb.sh` |
| `image/` | `build.sh`, `provision.sh`, `verify.sh` and the boot-partition templates in `image/boot/` |
| `.github/workflows/` | The CI workflow |
| `docs/` | `device-test.md` (the on-device checklist) and `docs/dev/` (developer notes) |

## Credits and licences

- The audio stack is HiFiBerry's: the NG apt packages from debianrepo.hifiberry.com, including the audio controller (ACR), the configurator, the PipeWire configuration, Spotify Connect, AirPlay and Bluetooth packages. See each package for its licence.
- The look of the interface follows Bang & Olufsen's Beocreate 2 client (MIT licence, copyright 2017 Bang & Olufsen). Its layout values and symbol icons are reused; no logos or product names are. The notice is in `ui/THIRD-PARTY.md`.
- The Metropolis typeface (Chris Simpson). Its licence is recorded as Unlicense from Fontsource metadata and has not yet been confirmed at the source repository.
- `touch-timeout`, the screen dimmer, is by the repository owner (https://github.com/ajmccaus/touch-timeout), built from a pinned commit.
- This repository is under the MIT licence (see `LICENSE`).
