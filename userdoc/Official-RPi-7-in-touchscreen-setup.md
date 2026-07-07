# HifiBerryOS 64 with Official RPi 7" Touchscreen Setup

Complete step-by-step guide to properly configure the official Raspberry Pi 7" touchscreen with HifiBerryOS 64 on RPi4.

> **Note:** Images built from this repository now have Steps 1, 1a, 3 and 4
> baked in (`dtoverlay=vc4-kms-dsi-7inch` and `disable_splash=1` in
> config.txt, X11 Compose files, and the `COG_PLATFORM_WL_VIEW_FULLSCREEN`
> cog setting), and cmdline.txt already contains `video=DSI-1:800x480@60`.
> The boot logo is also sized to fit the 800x480 panel (it was 926 px wide
> and got cut off). Only the `panel_orientation=upside_down` part of Step 2
> still needs to be added manually if your screen is mounted upside down.
> All steps below remain necessary on stock HiFiBerryOS64 images.

## Step 1: Add dtoverlay to config.txt

Add the dtoverlay to the config.txt in the `[all]` section:

```bash
# If you're SSH'd to the Pi, remount /boot as writable:
mount -o remount,rw /boot
nano /boot/config.txt
```

Add this line in the `[all]` section:

```ini
[all]
# add the below dtoverlay for 7" RPi touchscreen
dtoverlay=vc4-kms-dsi-7inch
```

## Step 1a: Disable Rainbow Splash Screen (Optional)

If you want to get rid of the rainbow splash screen, add this to config.txt after any `gpu_mem_*` lines:

```ini
# Disable rainbow splash screen
disable_splash=1
```

## Step 2: Configure Screen Rotation in cmdline.txt

Add this to the end of the cmdline.txt file (on one line). Rotate the screen if required:

```
video=DSI-1:800x480@60,panel_orientation=upside_down
```

## Step 3: Fix cog Crashes - Download Compose Files

Stop cog from crashing by downloading the Compose file from Debian's libx11-data package (must be SSH'd into the RPi):

```bash
cd /tmp
wget http://deb.debian.org/debian/pool/main/libx/libx11/libx11-data_1.8.4-2+deb12u2_all.deb
```

## Step 3a: Extract the Package

Extract it:

```bash
ar x libx11-data_1.8.4-2+deb12u2_all.deb
tar xf data.tar.xz
```

## Step 3b: Create Directory Structure

Create the required directory structure:

```bash
mkdir -p /usr/share/X11/locale/en_US.UTF-8
mkdir -p /usr/share/X11/locale/C.UTF-8
mkdir -p /usr/share/X11/locale/C
```

## Step 3c: Copy Compose Files to System

Copy the Compose files to the system (from the /tmp directory):

```bash
cp -r usr/share/X11/locale/* /usr/share/X11/locale/
```

## Step 3d: Verify Installation

Verify the Compose files are in place:

```bash
ls -la /usr/share/X11/locale/en_US.UTF-8/Compose
ls -la /usr/share/X11/locale/C.UTF-8/Compose
```

## Step 3e: Clean Up

Clean up the temporary files:

```bash
cd /
rm -rf /tmp/libx11-data_1.8.4-2+deb12u2_all.deb /tmp/usr /tmp/data.tar.xz /tmp/control.tar.xz /tmp/debian-binary
```

## Step 4: Configure cog Service

Edit the cog systemd service file:

```bash
nano /usr/lib/systemd/system/cog.service
```

Find the line:

```
Environment=COG_PLATFORM_FDO_VIEW_FULLSCREEN=1
```

Replace it with:

```
Environment=COG_PLATFORM_WL_VIEW_FULLSCREEN=1
```

## Step 4a: Restart cog Service

Apply the changes:

```bash
systemctl daemon-reload
systemctl restart cog
systemctl status cog
```

---

## Summary

This configuration resolves three key issues:
1. **Graphics clipping** - cog display shows up correctly on official 7" RPi touchscreen
2. **Rotate Screen 180 deg** -Proper screen rotation withn touch alignment
3. **cog crashes** - Compose file configuration prevents input handling failures

Reboot after completing all steps to ensure all changes take effect properly.
