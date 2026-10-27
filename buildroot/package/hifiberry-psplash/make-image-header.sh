#!/bin/sh

set -e

# psplash blits images at native pixel size (no runtime scaling), so the
# logo is sized for the smallest supported screen: <= 640 px wide fits
# the official RPi 7" touchscreen (800x480) with margins and is simply
# centered on anything larger. Requires gdk-pixbuf-csource and
# gdk-pixbuf-thumbnailer (Debian/Ubuntu: libgdk-pixbuf2.0-bin).

MAXWIDTH=640

imageh=psplash-poky-img.h
pic=hifiberryos-logo-black.png
name=POKY_IMG
gdk-pixbuf-thumbnailer -s $MAXWIDTH $pic $pic.resized.png
gdk-pixbuf-csource --macros $pic.resized.png > $imageh.tmp
sed -e "s/MY_PIXBUF/${name}/g" -e "s/guint8/uint8/g" $imageh.tmp > $imageh && rm $imageh.tmp $pic.resized.png

imageh=psplash-bar-img.h
pic=black.png
name=BAR_IMG
gdk-pixbuf-csource --macros $pic > $imageh.tmp
sed -e "s/MY_PIXBUF/${name}/g" -e "s/guint8/uint8/g" $imageh.tmp > $imageh && rm $imageh.tmp
