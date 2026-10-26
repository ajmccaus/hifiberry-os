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
# Options:
#   --clean       remove build artifacts
#
# Environment:
#   DIST          sbuild distribution (chroot <DIST>-amd64-sbuild); default:
#                 sbuild's own default

set -e

PACKAGE="touch-timeout"
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
SRC_DIR="$SCRIPT_DIR/src"
BUILD_DIR="/tmp/${PACKAGE}-build"

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

if [ -n "$DIST" ]; then
    DIST_ARG="--dist=$DIST"
    CHROOT_ARG="--chroot=${DIST}-amd64-sbuild"
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
    $DIST_ARG \
    $CHROOT_ARG \
    --build-dir="$BUILD_DIR" \
    --verbose

mv "$BUILD_DIR"/*.deb "$SCRIPT_DIR/" 2>/dev/null || true
mv "$BUILD_DIR"/*.changes "$SCRIPT_DIR/" 2>/dev/null || true
mv "$BUILD_DIR"/*.buildinfo "$SCRIPT_DIR/" 2>/dev/null || true

echo "Built packages:"
ls -la "$SCRIPT_DIR"/*.deb 2>/dev/null || echo "No packages found"
