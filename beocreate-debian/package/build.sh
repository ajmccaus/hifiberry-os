#!/bin/bash
# Build the beocreate-classic-ui Debian package for HiFiBerryOS NG (hbosng).
#
# Follows the conventions of the hbosng packages/ tree: a self-contained
# build.sh that produces a .deb next to itself and copies it to $HOME/packages
# if that directory exists. Unlike the sbuild-based packages, this package is
# architecture-independent (JavaScript), so it is assembled with dpkg-deb
# directly from the vendored server in ../server.
#
# Options:
#   --clean       remove build artifacts
#
# Runtime dependencies on the device: nodejs (>= 20), and the hbosng stack
# (hifiberry-audiocontrol for ACR on :1080, hifiberry-dsp for sigmatcpserver).

set -e

PACKAGE="beocreate-classic-ui"
MYDIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$MYDIR/../server"
VERSION="$(node -e "console.log(require('$SERVER_DIR/package.json').version)" 2>/dev/null || echo "2.4.5-hbosng1")"
ARCH="all"
STAGING="$MYDIR/build/${PACKAGE}_${VERSION}_${ARCH}"
DEST_DIR="$HOME/packages"

if [[ "$1" == "--clean" ]]; then
    rm -rf "$MYDIR/build" "$MYDIR"/*.deb
    echo "Cleanup completed."
    exit 0
fi

echo "Building $PACKAGE $VERSION..."
rm -rf "$STAGING"
mkdir -p "$STAGING/DEBIAN" \
         "$STAGING/opt/beocreate" \
         "$STAGING/usr/lib/systemd/system" \
         "$STAGING/usr/lib/systemd/system/sigmatcpserver.service.d" \
         "$STAGING/usr/share/beocreate"

# 1: Server payload -> /opt/beocreate (without node_modules; installed below).
(cd "$SERVER_DIR" && tar --exclude=node_modules --exclude=package-lock.json -cf - .) | tar -xf - -C "$STAGING/opt/beocreate"

# 2: Production node modules. --omit=optional keeps out optional native
# prebuilds (bufferutil, utf-8-validate, ...): this is an Architecture: all
# package, so no platform-specific binaries may ship. The websocket module
# falls back to its pure-JS implementation without them.
echo "Installing production node modules..."
(cd "$STAGING/opt/beocreate" && npm install --omit=dev --omit=optional --no-audit --no-fund --loglevel=error)

# bufferutil and utf-8-validate are *hard* dependencies of the 'websocket'
# module (so --omit=optional does not exclude them) and ship prebuilt
# binaries for many platforms. Both fall back to their pure-JS
# implementations when no binary loads, so prune the prebuilds.
find "$STAGING/opt/beocreate/node_modules" -type d -name prebuilds -prune -exec rm -rf {} +

# Safety net: fail the build if any compiled binary slipped through anyway.
if find "$STAGING/opt/beocreate/node_modules" -name '*.node' | grep -q .; then
    echo "ERROR: platform-specific .node binaries found in an Architecture: all package:" >&2
    find "$STAGING/opt/beocreate/node_modules" -name '*.node' >&2
    exit 1
fi

# 3: systemd unit + sigmatcp TCP re-enable drop-in. Both go to the package-
# owned /usr/lib/systemd/system tree (not /etc/systemd/system, which belongs
# to the admin and would raise conffile questions on upgrade/removal).
install -m 644 "$MYDIR/beocreate2.service" "$STAGING/usr/lib/systemd/system/beocreate2.service"
install -m 644 "$MYDIR/sigmatcp-enable-tcp.conf" "$STAGING/usr/lib/systemd/system/sigmatcpserver.service.d/10-beocreate-enable-tcp.conf"

# 4: Default configuration. Installed to /usr/share and copied to
# /etc/beocreate by postinst only if no configuration exists yet, so user
# settings survive upgrades.
install -m 644 "$MYDIR/system.json" "$STAGING/usr/share/beocreate/system.json.default"

# 5: Package metadata.
INSTALLED_SIZE=$(du -sk "$STAGING" | cut -f1)
cat > "$STAGING/DEBIAN/control" <<EOF
Package: $PACKAGE
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Depends: nodejs (>= 20)
Recommends: hifiberry-audiocontrol, hifiberry-dsp
Installed-Size: $INSTALLED_SIZE
Maintainer: HiFiBerry <support@hifiberry.com>
Description: Beocreate 2 classic user interface for HiFiBerryOS NG
 The classic Beocreate/HiFiBerryOS web interface (Node.js), ported to the
 Debian-based HiFiBerryOS NG. Talks to the ACR audio controller on port 1080
 and to sigmatcpserver on TCP port 8086. Serves the UI on port 8080 for the
 kiosk (kiosk-mode.sh setup --url=http://localhost:8080).
EOF

# Maintainer scripts: prefer the Debian systemd helpers when present
# (deb-systemd-helper tracks enable state across remove/purge,
# deb-systemd-invoke honours policy-rc.d, e.g. in chroots/images), and fall
# back to plain systemctl on systems without the debhelper tooling.
cat > "$STAGING/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e

# Install the default configuration on first install only.
if [ ! -f /etc/beocreate/system.json ]; then
    mkdir -p /etc/beocreate
    cp /usr/share/beocreate/system.json.default /etc/beocreate/system.json
fi

if [ "$1" = "configure" ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    if command -v deb-systemd-helper >/dev/null 2>&1; then
        deb-systemd-helper unmask beocreate2.service >/dev/null || true
        deb-systemd-helper enable beocreate2.service >/dev/null || true
    else
        # Fallback: no debhelper tooling on this system.
        systemctl enable beocreate2.service || true
    fi
    if command -v deb-systemd-invoke >/dev/null 2>&1; then
        deb-systemd-invoke restart beocreate2.service >/dev/null || true
    else
        # Fallback: no debhelper tooling on this system.
        systemctl restart beocreate2.service || true
    fi
    # Apply the sigmatcp TCP re-enable drop-in if the service is present.
    if systemctl list-unit-files sigmatcpserver.service >/dev/null 2>&1; then
        if command -v deb-systemd-invoke >/dev/null 2>&1; then
            deb-systemd-invoke try-restart sigmatcpserver.service >/dev/null || true
        else
            systemctl try-restart sigmatcpserver.service || true
        fi
    fi
fi

exit 0
EOF
chmod 755 "$STAGING/DEBIAN/postinst"

cat > "$STAGING/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ]; then
    if command -v deb-systemd-invoke >/dev/null 2>&1; then
        deb-systemd-invoke stop beocreate2.service >/dev/null || true
    else
        # Fallback: no debhelper tooling on this system.
        systemctl stop beocreate2.service || true
    fi
fi
exit 0
EOF
chmod 755 "$STAGING/DEBIAN/prerm"

cat > "$STAGING/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
case "$1" in
    remove)
        systemctl daemon-reload >/dev/null 2>&1 || true
        if command -v deb-systemd-helper >/dev/null 2>&1; then
            deb-systemd-helper disable beocreate2.service >/dev/null || true
        else
            # Fallback: no debhelper tooling on this system.
            systemctl disable beocreate2.service >/dev/null 2>&1 || true
        fi
        ;;
    purge)
        # Remove the runtime configuration/settings written by the server
        # (system.json copied by postinst plus per-extension settings).
        rm -f /etc/beocreate/*.json
        rmdir /etc/beocreate 2>/dev/null || true
        if command -v deb-systemd-helper >/dev/null 2>&1; then
            deb-systemd-helper purge beocreate2.service >/dev/null || true
            deb-systemd-helper unmask beocreate2.service >/dev/null || true
        fi
        systemctl daemon-reload >/dev/null 2>&1 || true
        ;;
esac
exit 0
EOF
chmod 755 "$STAGING/DEBIAN/postrm"

# 6: Build the .deb.
dpkg-deb --build --root-owner-group "$STAGING" "$MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb"

echo "Built: $MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb"

# Copy to the shared package output directory if it exists (hbosng convention).
if [ -d "$DEST_DIR" ]; then
    cp "$MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb" "$DEST_DIR/"
    echo "Copied to $DEST_DIR/"
fi
