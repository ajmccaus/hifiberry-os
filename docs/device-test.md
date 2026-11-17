# Device test checklist

Nothing in this image has run on a real Raspberry Pi yet. This is the first test. Work through the sections in order, tick each step, and when a step fails run its evidence command before changing anything. At the end, send back what is listed under "What to send back".

Terms: the **kiosk** is the full-screen interface on the touchscreen. **ACR** is HiFiBerry's audio controller. The **helper** is our small service for screen and power settings. The **boot partition** is the FAT partition of the SD card (`/boot/firmware` on the device).

Evidence note: the system journal is kept in RAM (`Storage=volatile`, at most 32 MB) and is lost at every reboot. Collect logs before rebooting.

## 1. Before you start

You need: the Pi 4 (2 GB) with the official 7-inch touchscreen attached, the HiFiBerry Amp2 fitted, speakers, the power supply(ies) your Pi and Amp2 need, an SD card, a computer with an SD reader, a phone on the same network, and a second computer for the port scan (`nmap`).

Prepare an SSH key so you can collect evidence. On your computer:

```
cat ~/.ssh/id_ed25519.pub
```

## 2. Flash

1. Download `audio-os-<version>.img.xz` and its `.sha256` from the repository's Releases page: the latest version release, or the `dev` prerelease for the newest build.
2. Verify it: `sha256sum -c audio-os-*.img.xz.sha256`. Expected: `OK`.
3. Write it to the card (see README). Expected: the write finishes without error.
4. Re-insert the card. Expected: a small FAT partition shows files `audio-os.conf`, `user-data`, `network-config`, `config.txt`, `cmdline.txt`.
5. Edit `user-data`: uncomment the `users:` block, put your public key in it, uncomment `enable_ssh: true`. If you use Wi-Fi, edit `network-config` too. Use spaces, not tabs.

If a step fails: note the exact message and the image file name.

## 3. First boot and the automatic reboot

1. Insert the card, power on, and note the time.
2. Expected: the panel shows no boot text (quiet boot), then eventually the interface. The Pi may reboot once by itself (HiFiBerry's `config-detect.service` identifying the Amp2 and rewriting `config.txt`). Write down whether it rebooted, and after how long the interface appeared.
3. From your computer: `ssh <your-user>@hifiberry.local`. Expected: a login with your key, no password prompt.
4. Run:

```
hostname
cat /proc/device-tree/model
grep -E 'dtoverlay|dtparam' /boot/firmware/config.txt
cat /etc/cloud/cloud.cfg.d/*raspberry* 2>/dev/null | head -20
```

Expected: hostname `hifiberry`; `config.txt` contains a `dtoverlay=hifiberry-dacplus-std` line (the overlay for the Amp2 according to the upstream notes, not yet seen on hardware) and `dtparam=audio=off`.

Evidence if it fails (over SSH, or on the card's boot partition if SSH does not work):

```
systemctl status config-detect.service cloud-init.service cloud-init-local.service ssh.service --no-pager
journalctl -b -u config-detect.service -u cloud-init -u cloud-init-local -u cloud-config -u cloud-final --no-pager
ip -br addr
sudo -u player env XDG_RUNTIME_DIR=/run/user/$(id -u player) systemctl --user status pipewire.service mpd.service pipewire-api.service --no-pager
```

## 4. Display

1. Kiosk comes up. Expected: the interface fills the 800x480 panel, no mouse cursor, no browser error page. Evidence:

```
systemctl status kiosk.service nginx.service --no-pager
journalctl -b -u kiosk.service --no-pager
grep -x connected /sys/class/drm/card*-*/status
```

2. Rotation. Mount the card on a computer, set `SCREEN_ROTATE=180` in `audio-os.conf`, put it back, boot. Expected: picture upside down relative to before, and a touch on a button lands on that button. Repeat for 90 and 270 if you wish; set it back to your preferred value. Evidence: `journalctl -b -u kiosk.service` and `cat /run/udev/rules.d/90-audio-os-touch-rotation.rules`.
3. Touch. Tap the tab bar and the sources, drag the volume slider. Expected: every tap registers where you touch, with no ghost touches. Evidence: the kiosk journal, and `grep -A4 -i -E 'ft5|touch' /proc/bus/input/devices` (the image has no `libinput` command-line tool).
4. Dim and blank. On the Screen page set the off-timeout to 1 min. Expected: the screen dims, then turns off after about a minute without touch, and a touch brings it back. Also expected: starting playback from a phone wakes it. Change brightness; expected: the panel changes. Evidence:

```
systemctl status touch-timeout.service --no-pager
journalctl -b -u touch-timeout.service -u audio-os-helper.service --no-pager
cat /var/lib/audio-os/touch-timeout.env /var/lib/audio-os/screen.json
ls /sys/class/backlight/
```

## 5. Sound

Start with the volume low. The first-boot volume is preset to 20 percent but speakers on an amplifier can be loud.

1. Amp2 detected. Expected: the System page names a sound card, and `aplay -l` lists a HiFiBerry card.

```
aplay -l
amixer -c 0 scontrols
curl -s http://localhost/api/config/v1/systeminfo
journalctl -b -u volume-restore.service -u audiocontrol.service --no-pager
```

2. Volume. Drag the slider on the kiosk, then on the phone. Expected: sound level follows, the slider on the other device follows, and the value never jumps to 0 by itself. Mixer control should be named "Digital".
3. Internet radio. On the phone, open Radio, search a station, add it as a favourite; on the kiosk, tap it. Expected: it plays, and the favourite appears on both. Evidence: `journalctl -b -u audiocontrol.service --no-pager` and `sudo -u player env XDG_RUNTIME_DIR=/run/user/$(id -u player) systemctl --user status mpd.service --no-pager`.
4. Spotify Connect. Open the Spotify app on the phone, pick the speaker from the device list, play. Expected: sound, and title, artist and artwork on the kiosk. Evidence: `journalctl -b _UID=$(id -u player) | grep -i librespot`.
5. AirPlay. From an iPhone or Mac pick the speaker and play. Expected: sound, metadata on the kiosk. Evidence: `journalctl -b _UID=$(id -u player) | grep -i -E 'shairport|nqptp'`; `sudo -u player env XDG_RUNTIME_DIR=/run/user/$(id -u player) systemctl --user status shairport.service --no-pager`; `pgrep -a nqptp` (AirPlay 2 timing needs an nqptp process; how the image starts it is not verified).
6. Bluetooth. On the phone, pair with the speaker, play. Expected: pairing succeeds, sound plays, metadata shows. Also note: is the speaker visible in a phone's Bluetooth scan at all times, even when nobody is pairing? Evidence: `systemctl status bluetooth.service hifiberry-bluetooth.service --no-pager`, `journalctl -b -u bluetooth -u hifiberry-bluetooth --no-pager`, `bluetoothctl show`.
7. Switching between sources. Expected: the Sources list marks the playing one and the Now Playing page follows.

## 6. Interface from a phone

1. Open `http://hifiberry.local/` and, if that fails, `http://<ip-address>/` (the System page on the kiosk shows it). Expected: the same interface in the phone layout.
2. Use Now Playing, Sources, Radio, Screen, System. Expected: each works; a screen that fails (for example Screen) should not break the others.
3. Open `/services` ("Advanced settings"). Expected: HiFiBerry's own interface.

Evidence: `systemctl status nginx.service audio-os-helper.service hifiberry-auth.service audiocontrol.service config-server.service --no-pager`; `journalctl -b -u nginx --no-pager`.

## 7. Settings that need authorisation

1. On the phone, on the System page, tap Restart. Expected: a confirm dialog, then, if no password is set yet, a prompt to set one. Set one, then the restart goes ahead and the interface returns after the reboot.
2. Reload the page, try Shut down. Expected: it works with the session you have; after a long idle time or in a fresh private window it asks you to sign in.
3. On the kiosk, tap Restart. Expected: no password prompt (loopback is trusted). Decline at the confirm dialog if you do not want to restart.
4. Before step 1, from your computer with no cookie: `curl -si -X POST -H 'Content-Type: application/json' -d '{"action":"restart"}' http://hifiberry.local/api/device/v1/power`. Expected: HTTP 401 with a `WWW-Authenticate-Hint: set-password` header (the device is not restarted).

Evidence: `journalctl -b -u hifiberry-auth.service -u audio-os-helper.service --no-pager`; `journalctl -b -u polkit.service --no-pager`.

## 8. Security spot-checks

1. From another machine: `nmap -sS -sU -p 22,80,1080,1081,1089,1090,2716,6600,5000,7000,319,320,5353 hifiberry.local` (UDP needs root). Expected: only 80 open (and 22 only if you enabled SSH); 5000, 7000, 319-320 and 5353 may show as open or filtered by design. 1080, 1081, 1089, 1090, 2716 and 6600 must not be reachable.
2. On the device: `ss -Hlntu`. Expected: apart from the product's own ports, only loopback addresses listen. Save the output.
3. `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no <user>@hifiberry.local`. Expected: refused.
4. `sudo passwd -S -a | awk '$2 != "L"'`. Expected: no output (every account, including the one you created in `user-data`, has a locked password).
5. `sudo nft list table inet audio_os` and `systemctl status audio-os-firewall.service --no-pager`. Expected: the table exists, input policy `drop`.
6. `systemctl status nftables.service --no-pager`. Expected: disabled.
7. `ls /etc/ssh/ssh_host_*`. Expected: host keys exist (generated on first boot).

## 9. Power loss and reboot

1. While music plays, pull the power. Power on again. Expected: the Pi boots to the interface without a manual fsck prompt; radio favourites are still there.
2. `sudo reboot` over SSH, and Restart from the interface. Expected: the Pi comes back, the kiosk shows "Connecting..." and then the interface, and the volume is the last set one.
3. Shut down from the interface. Expected: the Pi powers off cleanly (activity light stops).

Evidence (after power loss): `journalctl -b -p warning --no-pager`, `systemctl --failed`, `dmesg | grep -i -E 'ext4|mmcblk|under-voltage'`, `findmnt /`.

## 10. Memory and CPU

Run each while idle (screen on, nothing playing, 5 minutes after boot) and while playing (Spotify or radio, screen on):

```
free -m
uptime
top -b -n 1 -o %MEM | head -20
systemctl status --no-pager | head -5
cat /sys/class/thermal/thermal_zone0/temp
```

The target is comfortable operation in 2 GB: record `available` memory from `free -m`, the largest processes (expected candidates: the browser (`cog` and its web process), PipeWire, ACR), swap use, and whether the load average stays low. Playback must not glitch while you tap through the interface. Play for 30 minutes and take `free -m` again to see if memory grows.

## Known issues going in

- `touch-timeout` is pinned to commit 2ad5769 (its v0.8.0 daemon). It can occasionally miss a wake signal, and it spins at 100 percent CPU if the touch input device disappears. If the screen stays dark, a second touch or a playback start should wake it; if CPU is pinned, check `top` for `touch-timeout`. Restarting `touch-timeout.service` is the first thing to try.
- The Metropolis typeface licence is recorded as Unlicense from Fontsource metadata and is not confirmed at the source repository.
- No update button in the interface; no Wi-Fi setup in the interface (use `network-config` before first boot); changing the hostname is not in the templates.
- Bluetooth discoverability is not confirmed: check section 5, step 6.

## Not verified before hardware

Everything below could not be proved by the build, the offline checks, or the container boot test.

- That `systemctl --failed` is empty on the Pi. In the container boot test `volume-store.service`, `systemd-remount-fs.service`, `systemd-firstboot.service` and `rtkit-daemon.service` fail and are excused as limits of the container (no sound card, no root block device, no console); on the Pi none of them may fail.
- That `enable_ssh: true` in `user-data` still turns SSH on. The image stops first boot from enabling any unit by itself (`10-audio-os.preset`), and the boot test only proves SSH stays off without `user-data`.
- That the Amp2 is detected and `dtoverlay=hifiberry-dacplus-std` is written, and that `config-detect.service` reboots the Pi exactly once and then settles. The container boot test masks `config-detect.service`.
- That the first-boot volume of 20 percent is applied to the real mixer control "Digital" and that the Amp2 output is safe.
- Real ALSA volume behaviour and the mixer control name.
- Spotify Connect, AirPlay and Bluetooth: pairing, sound, metadata and artwork. The container boot test only asserts the `player` user's `pipewire`, `mpd` and `pipewire-api` units; the Spotify, AirPlay and Bluetooth services are not asserted.
- Whether Bluetooth is discoverable all the time.
- The touchscreen: touch feel, and that touch coordinates follow every rotation (the rotation uses a libinput calibration matrix computed to match the output transform; wlroots behaviour on the real panel is not verified).
- That the kiosk (`cage` + `cog`, WPE WebKit) starts on the real panel, renders the interface smoothly on a Pi 4, and has no visible cursor. The browser tests ran on Chromium and desktop WebKit, not WPE.
- That the display's `connected` status is reported in `/sys/class/drm` at the time `kiosk.service` evaluates it.
- That `touch-timeout` finds the real backlight and touch device, dims and blanks correctly, and wakes on touch and on the helper's wake signal.
- Memory and CPU use in 2 GB, thermal behaviour and boot time.
- The polkit rule on the real system: that the helper may restart and signal only `touch-timeout.service` and reboot or power off, from the unprivileged `audio-os` user.
- Raspberry Pi Imager's OS customisation (hostname, user, Wi-Fi) with this image: not tried; only hand-edited `user-data` and `network-config` are described.
- Wi-Fi with the supplied `network-config` template, and that cloud-init applies `user-data` without touching the `player` user.
- That watchdog settings (`RuntimeWatchdogSec=15s`) work on the Pi's hardware watchdog.
- AirPlay and Spotify Connect reachability through the firewall (ports 5000, 7000, 319-320 and 32768-60999) on a real network.
- Behaviour after unattended security upgrades (the 04:00 timers).

## What to send back

- Pass or fail for each numbered step, with the time the interface first appeared and whether the Pi rebooted by itself.
- For each failure, the evidence command output for that step.
- `ss -Hlntu` output and the `nmap` result.
- `free -m`, `top` output and temperature, idle and while playing.
- `systemctl --failed` and `journalctl -b -p warning --no-pager` from a normal boot (before rebooting).
- Photos or a short video of any display, rotation or touch problem.
- The image file name and version, and what speakers and power supply you used.
