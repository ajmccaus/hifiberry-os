# Changing the boot logo

The boot screen (after the kernel starts) is drawn by **psplash**. The
image is not a file on the SD card — it is compiled into the psplash
binary — so changing it means regenerating one header file and
rebuilding the image.

## The simple way

1. **Replace the PNG** with your own artwork:

   ```
   buildroot/package/hifiberry-psplash/hifiberryos-logo-black.png
   ```

   Any size is fine — the next step downscales it to at most 640 px
   wide, which fits the smallest supported screen (the official 7"
   touchscreen, 800x480) with margins and is centered on anything
   larger. Design on a **black background** (or use transparency):
   psplash fills the whole screen with black behind it
   (`PSPLASH_BACKGROUND_COLOR` in `psplash-colors.h`), so a black
   canvas blends seamlessly at any screen size.

2. **Regenerate the header** (needs `gdk-pixbuf-csource` and
   `gdk-pixbuf-thumbnailer`; on Debian/Ubuntu:
   `sudo apt install libgdk-pixbuf2.0-bin`):

   ```bash
   cd buildroot/package/hifiberry-psplash
   ./make-image-header.sh
   ```

   This rewrites `psplash-poky-img.h` from the PNG. Commit both files.

3. **Rebuild the image**, forcing psplash to pick up the new header:

   ```bash
   ./clean-package hifiberry-psplash
   ./compile 4          # or your Pi version
   ```

That's it — flash or update as usual.

## Notes

- psplash draws the image **centered** at native pixel size; it cannot
  scale at runtime. That's why the header is generated at ≤ 640 px:
  one asset looks right on every screen. If you only ever use one
  screen and want the logo bigger, raise `MAXWIDTH` in
  `make-image-header.sh` (keep it below your screen width) and rerun
  step 2.
- Background, text and progress-bar colors are in
  `buildroot/package/hifiberry-psplash/psplash-colors.h` (currently
  all black — the progress bar is intentionally invisible).
- The rainbow square shown before the kernel starts is the GPU
  firmware's splash, not psplash; images from this repository disable
  it (`disable_splash=1` in config.txt).
- To hide the boot screen entirely on a device, create the file
  `/boot/nosplash` (checked by `psplash-start.service`).
