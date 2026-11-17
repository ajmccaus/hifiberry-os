#!/bin/bash
# Builds the audio-os arm64 .deb: os/rootfs + UI dist + helper + touch-timeout (built from the pinned
# commit, natively on arm64 or with aarch64-linux-gnu-gcc elsewhere). Usage: build-deb.sh <ui-dist> <out-dir>
# Version: $AUDIO_OS_VERSION, else 0.1.0+git<short HEAD>; it also lands in /usr/share/audio-os/version.
set -euo pipefail

TOUCH_TIMEOUT_URL=https://github.com/ajmccaus/touch-timeout
TOUCH_TIMEOUT_COMMIT=2ad57698f9b219c3fb42e1085bf0e6080a5e9e10

die() { echo "build-deb: $*" >&2; exit 1; }

[ $# -eq 2 ] || die "usage: $0 <ui-dist-dir> <out-dir>"
ui_dist=$(realpath "$1")
out_dir=$2
here=$(dirname "$(realpath "$0")")
repo=$(dirname "$here")
helper=$repo/helper/audio_os_helper.py

[ -f "$ui_dist/index.html" ] || die "$ui_dist/index.html missing (run 'npm run build' in ui/)"
[ -d "$ui_dist/ui" ] || die "$ui_dist/ui/ missing (the UI build emits its assets under /ui/)"
[ -f "$helper" ] || die "$helper missing"

version=${AUDIO_OS_VERSION:-0.1.0+git$(git -C "$repo" rev-parse --short HEAD)}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stage=$work/stage

cp -a "$here/rootfs" "$stage"
mkdir -p "$stage/DEBIAN" "$stage/usr/share/audio-os/ui" "$stage/usr/lib/audio-os" "$stage/usr/bin" \
    "$stage/usr/share/doc/audio-os"
cp -a "$here/DEBIAN/postinst" "$here/DEBIAN/prerm" "$here/DEBIAN/postrm" "$stage/DEBIAN/"
sed "s/@VERSION@/$version/" "$here/DEBIAN/control" > "$stage/DEBIAN/control"
cp -a "$ui_dist/." "$stage/usr/share/audio-os/ui/"
install -m 0644 "$helper" "$stage/usr/lib/audio-os/audio_os_helper.py"
echo "$version" > "$stage/usr/share/audio-os/version"

git clone --quiet "$TOUCH_TIMEOUT_URL" "$work/touch-timeout"
git -C "$work/touch-timeout" checkout --quiet --detach "$TOUCH_TIMEOUT_COMMIT"
[ "$(git -C "$work/touch-timeout" rev-parse HEAD)" = "$TOUCH_TIMEOUT_COMMIT" ] || die "touch-timeout commit mismatch"
if [ "$(uname -m)" = aarch64 ]; then cc=gcc; else cc=aarch64-linux-gnu-gcc; fi
make -C "$work/touch-timeout" --quiet SYSTEMD_PKG=no CC="$cc" LDFLAGS=-static TARGET=build/touch-timeout all
install -m 0755 "$work/touch-timeout/build/touch-timeout" "$stage/usr/bin/touch-timeout"
install -m 0644 "$work/touch-timeout/LICENSE" "$stage/usr/share/doc/audio-os/touch-timeout.LICENSE"

(cd "$stage" && find etc -type f | sed 's|^|/|' | sort) > "$stage/DEBIAN/conffiles"

mkdir -p "$out_dir"
deb=$out_dir/audio-os_${version}_arm64.deb
dpkg-deb --root-owner-group -Zxz --build "$stage" "$deb" >/dev/null
echo "$deb"
