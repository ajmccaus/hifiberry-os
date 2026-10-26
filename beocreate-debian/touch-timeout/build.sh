#!/bin/bash
# Build the touch-timeout Debian package for HiFiBerryOS NG (hbosng).
#
# Same shape as the hbosng C packages (packages/squeezelite/build.sh on the
# hbosng branch): the version comes from src/debian/changelog, sbuild builds
# a copy of src/ in /tmp (debian/rules clones the pinned upstream, hence
# --enable-network), and the .deb lands next to this script. touch-timeout
# is Architecture: any, so it cannot ship inside the arch-all
# beocreate-classic-ui package (ADR 0002).
#
# Cross-compile: like every hbosng C package, this sources
# scripts/cross-compile-env.sh (when present in a full checkout), which puts
# upstream's sbuild wrapper first in PATH; the wrapper forces the
# <DIST>-<ARCH>-hifiberry chroot and --arch=<ARCH> (default arm64, the device
# target) regardless of the flags below. Without that wrapper (this port built
# standalone) the ARCH/DIST knobs below pick a <DIST>-<ARCH>-sbuild chroot,
# ARCH defaulting to arm64 so a plain build on an x86 host still targets the Pi.
#
# Options:
#   --clean       remove build artifacts
#
# Environment:
#   ARCH          target architecture (default arm64; the device is a Pi)
#   DIST          sbuild distribution (chroot <DIST>-<ARCH>-sbuild); default:
#                 sbuild's own default

set -e

PACKAGE="touch-timeout"
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
SRC_DIR="$SCRIPT_DIR/src"
BUILD_DIR="/tmp/${PACKAGE}-build"

# Enable cross-compile support if configured (upstream convention; the hook
# lives two levels up from a package dir in a full hbosng checkout).
_CC_ENV="$SCRIPT_DIR/../../scripts/cross-compile-env.sh"
if [ -f "$_CC_ENV" ]; then source "$_CC_ENV"; else echo "Not using cross-compilation (${_CC_ENV} does not exist)"; fi

ARCH="${ARCH:-arm64}"

if [[ "$1" == "--clean" ]]; then
    rm -f "$SCRIPT_DIR"/*.deb "$SCRIPT_DIR"/*.changes "$SCRIPT_DIR"/*.buildinfo
    rm -rf "$BUILD_DIR"
    echo "Cleanup completed."
    exit 0
fi

VERSION=$(grep -m1 "^${PACKAGE} " "$SRC_DIR/debian/changelog" | sed 's/.*(\([^)]*\)).*/\1/')
if [ -z "$VERSION" ]; then
    echo "ERROR: Could not parse version from debian/changelog" >&2
    exit 1
fi
echo "Building $PACKAGE $VERSION"

# When the cross-compile wrapper is on PATH it rewrites --arch/--chroot to the
# hifiberry chroot itself, so these are only the standalone fallback.
ARCH_ARG="--arch=$ARCH"
if [ -n "$DIST" ]; then
    DIST_ARG="--dist=$DIST"
    CHROOT_ARG="--chroot=${DIST}-${ARCH}-sbuild"
else
    DIST_ARG=""
    CHROOT_ARG=""
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -r "$SRC_DIR/"* "$BUILD_DIR/"
cd "$BUILD_DIR"

sbuild \
    --chroot-mode=unshare \
    --no-clean-source \
    --enable-network \
    $ARCH_ARG \
    $DIST_ARG \
    $CHROOT_ARG \
    --build-dir="$BUILD_DIR" \
    --verbose

mv "$BUILD_DIR"/*.deb "$SCRIPT_DIR/" 2>/dev/null || true
mv "$BUILD_DIR"/*.changes "$SCRIPT_DIR/" 2>/dev/null || true
mv "$BUILD_DIR"/*.buildinfo "$SCRIPT_DIR/" 2>/dev/null || true

echo "Built packages:"
ls -la "$SCRIPT_DIR"/*.deb 2>/dev/null || echo "No packages found"
