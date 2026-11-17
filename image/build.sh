#!/bin/bash
# Builds the audio-os SD image: pinned Raspberry Pi OS Lite, grown, provisioned in an arm64 chroot
# (native or qemu-user binfmt), shrunk, xz-compressed. Root only. Never mounts vfat: the boot
# partition is staged with mtools and written back file by file, so its filesystem stays the stock one.
# Usage: build.sh <audio-os.deb> <output.img.xz>
# Env: AUDIO_OS_CACHE_DIR (base image download cache), AUDIO_OS_APT_CACHE (optional .deb cache
# kept between builds), HTTPS_PROXY + AUDIO_OS_CA_BUNDLE (apt proxy during the build only).
set -euo pipefail

BASE_URL=https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-10-06/2026-10-06-raspios-trixie-arm64-lite.img.xz
BASE_SHA256=483db18a48da399b5b7022ffae9a07bc6d99daab30e593aedac09b69ff422843
GROW_MIB=2560
SLACK_MIB=200
SECTOR=512

die() { echo "build: $*" >&2; exit 1; }
step() { echo "=== build: $*"; }

[ $# -eq 2 ] || die "usage: $0 <audio-os.deb> <output.img.xz>"
[ "$(id -u)" = 0 ] || die "must run as root"
deb=$(realpath "$1")
out=$(realpath -m "$2")
[ -f "$deb" ] || die "$deb not found"
here=$(dirname "$(realpath "$0")")
cache=${AUDIO_OS_CACHE_DIR:-/var/cache/audio-os}
if [ "$(uname -m)" != aarch64 ] && ! grep -qs '^enabled' /proc/sys/fs/binfmt_misc/qemu-aarch64; then
    die "not on arm64 and no qemu-aarch64 binfmt handler registered (install qemu-user-static)"
fi

work=$(mktemp -d "${TMPDIR:-/var/tmp}/audio-os-build.XXXXXX")
img=$work/image.img
root=$work/root
loop=""

cleanup() {
    set +e
    if mountpoint -q "$root"; then umount -R "$root" || umount -lR "$root"; fi
    [ -n "$loop" ] && losetup -d "$loop"
    if grep -qF " $work/" /proc/self/mounts; then
        echo "build: leaving $work, something is still mounted under it" >&2
    else
        rm -rf --one-file-system "$work"
    fi
}
trap cleanup EXIT

step "base image"
mkdir -p "$cache"
base=$cache/${BASE_URL##*/}
if ! echo "$BASE_SHA256  $base" | sha256sum --check --status 2>/dev/null; then
    curl -fL --retry 3 -o "$base.part" "$BASE_URL"
    mv "$base.part" "$base"
fi
echo "$BASE_SHA256  $base" | sha256sum --check
xz -dc "$base" > "$img"

part_field() { sfdisk --json "$img" | jq -r ".partitiontable.partitions[$1].$2"; }
disk_id=$(sfdisk --disk-id "$img")
boot_off=$(( $(part_field 0 start) * SECTOR ))
root_start=$(part_field 1 start)

step "grow image and root partition by ${GROW_MIB} MiB"
truncate -s "+${GROW_MIB}M" "$img"
echo ', +' | sfdisk --no-reread --no-tell-kernel -N 2 "$img" >/dev/null
[ "$(sfdisk --disk-id "$img")" = "$disk_id" ] || die "MBR disk id changed"
root_off=$(( root_start * SECTOR ))
loop=$(losetup --find --show --offset "$root_off" --sizelimit $(( $(part_field 1 size) * SECTOR )) "$img")
e2fsck -fy "$loop" >/dev/null || [ $? -le 1 ] || die "e2fsck failed before grow"
resize2fs "$loop" >/dev/null

step "mount root, stage boot partition"
mkdir -p "$root" "$work/boot.orig" "$work/boot"
mount "$loop" "$root"
export MTOOLS_SKIP_CHECK=1
mcopy -s -p -m -i "$img@@$boot_off" '::/*' "$work/boot.orig/"
cp -a "$work/boot.orig/." "$work/boot/"
mount --bind "$work/boot" "$root/boot/firmware"
mount --bind /dev "$root/dev"
mount --bind /dev/pts "$root/dev/pts"
mount -t proc proc "$root/proc"
mount --bind /sys "$root/sys"
mount -t tmpfs tmpfs "$root/run"
if [ -n "${AUDIO_OS_APT_CACHE:-}" ]; then
    mkdir -p "$AUDIO_OS_APT_CACHE"
    mount --bind "$AUDIO_OS_APT_CACHE" "$root/var/cache/apt/archives"
fi

in=$root/run/audio-os-build
mkdir -p "$in"
cp "$deb" "$in/audio-os.deb"
cp "$here/provision.sh" "$here/hifiberry-archive-keyring.asc" "$in/"
cp -r "$here/boot" "$in/boot"
: > "$in/apt.conf"
if [ -n "${HTTPS_PROXY:-}" ]; then
    printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' "$HTTPS_PROXY" "$HTTPS_PROXY" >> "$in/apt.conf"
fi
if [ -n "${AUDIO_OS_CA_BUNDLE:-}" ]; then
    cp "$AUDIO_OS_CA_BUNDLE" "$in/ca.crt"
    printf 'Acquire::https::CAInfo "/run/audio-os-build/ca.crt";\n' >> "$in/apt.conf"
fi
cp -a "$root/etc/resolv.conf" "$work/resolv.conf.orig"
cp --remove-destination /etc/resolv.conf "$root/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$root/usr/sbin/policy-rc.d"
chmod 755 "$root/usr/sbin/policy-rc.d"

step "provision (chroot)"
chroot "$root" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root \
    APT_CONFIG=/run/audio-os-build/apt.conf /bin/bash /run/audio-os-build/provision.sh

rm -f "$root/usr/sbin/policy-rc.d"
cp -a "$work/resolv.conf.orig" "$root/etc/resolv.conf"

step "write boot partition back"
(
    cd "$work/boot.orig"
    find . -depth -type f -print0 | while IFS= read -r -d '' f; do
        [ -e "$work/boot/$f" ] || mdel -i "$img@@$boot_off" "::/${f#./}"
    done
    find . -depth -mindepth 1 -type d -print0 | while IFS= read -r -d '' d; do
        [ -d "$work/boot/$d" ] || mrd -i "$img@@$boot_off" "::/${d#./}"
    done
)
(
    cd "$work/boot"
    find . -mindepth 1 -type d -print0 | while IFS= read -r -d '' d; do
        [ -d "$work/boot.orig/$d" ] || mmd -i "$img@@$boot_off" "::/${d#./}"
    done
    find . -type f -print0 | while IFS= read -r -d '' f; do
        cmp -s "$f" "$work/boot.orig/$f" || mcopy -o -p -m -i "$img@@$boot_off" "$f" "::/${f#./}"
    done
)
boot_loop=$(losetup --find --show --read-only --offset "$boot_off" --sizelimit $(( $(part_field 0 size) * SECTOR )) "$img")
fsck.vfat -n "$boot_loop" >/dev/null || { losetup -d "$boot_loop"; die "boot partition fsck failed"; }
losetup -d "$boot_loop"

step "unmount, shrink root to minimum + ${SLACK_MIB} MiB"
umount -R "$root"
e2fsck -fy "$loop" >/dev/null || [ $? -le 1 ] || die "e2fsck failed after provisioning"
block_size=$(dumpe2fs -h "$loop" 2>/dev/null | awk -F: '/^Block size/ { print $2 + 0 }')
min_blocks=$(resize2fs -P "$loop" 2>/dev/null | awk -F: '/minimum size/ { print $2 + 0 }')
blocks=$(( min_blocks + SLACK_MIB * 1024 * 1024 / block_size ))
resize2fs "$loop" "$blocks" >/dev/null
e2fsck -fn "$loop" >/dev/null || die "e2fsck failed after shrink"
losetup -d "$loop"
loop=""
sectors=$(( blocks * block_size / SECTOR ))
echo "$root_start,$sectors" | sfdisk --no-reread --no-tell-kernel -N 2 "$img" >/dev/null
[ "$(sfdisk --disk-id "$img")" = "$disk_id" ] || die "MBR disk id changed"
truncate -s $(( (root_start + sectors) * SECTOR )) "$img"

step "compress"
mkdir -p "$(dirname "$out")"
xz -T0 -c "$img" > "$out"
(cd "$(dirname "$out")" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
echo "built $out ($(du -h "$out" | cut -f1))"
