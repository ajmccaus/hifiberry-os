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
# Runtime dependencies on the device: nodejs (>= 20), nginx + hifiberry-auth
# (the public :8080 is an nginx site gated by the auth gateway, ADR 0001; the
# Node server listens on loopback :8081 only), and the hbosng stack
# (hifiberry-audiocontrol for ACR on :1080, hifiberry-dsp for sigmatcpserver).
# hifiberry-audiocontrol >= 0.22: the server's listen-only event subscription
# is kept alive by that release's pings (PORTING.md, "Contract notes").
# Recommends touch-timeout (built by ../touch-timeout/build.sh, arch-specific):
# when installed it owns the backlight and this package's drop-in hands it the
# slider level from /etc/beocreate/touch-timeout.env (ADR 0002).

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
         "$STAGING/usr/lib/systemd/system/touch-timeout.service.d" \
         "$STAGING/usr/share/beocreate" \
         "$STAGING/etc/nginx/sites-available" \
         "$STAGING/etc/nginx/sites-enabled" \
         "$STAGING/etc/hifiberry/auth.d"

# 1: Server payload -> /opt/beocreate (without node_modules; installed below).
# package-lock.json is kept (npm ci below pins to it) but the vendored server's
# own etc/ is dropped: nothing reads /opt/beocreate/etc (the server uses
# BEO_CONFIG_DIR or /etc/beocreate), and its stale system.json ("port": 80)
# would contradict the :8080/:8081 layout (ADR 0001).
(cd "$SERVER_DIR" && tar --exclude=node_modules --exclude=./etc -cf - .) | tar -xf - -C "$STAGING/opt/beocreate"

# 2: Production node modules, pinned to the tested lockfile (npm ci, not
# install: it installs exactly server/package-lock.json, the tree run-tests.sh
# ran against, and fails if package.json and the lock disagree). --omit=optional
# keeps out optional native prebuilds (bufferutil, utf-8-validate, ...): this is
# an Architecture: all package, so no platform-specific binaries may ship. The
# websocket module falls back to its pure-JS implementation without them.
echo "Installing production node modules..."
(cd "$STAGING/opt/beocreate" && npm ci --omit=dev --omit=optional --no-audit --no-fund --loglevel=error)

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

# 3: systemd unit, sigmatcp TCP re-enable drop-in and touch-timeout
# brightness drop-in. All go to the package-owned /usr/lib/systemd/system tree
# (not /etc/systemd/system, which belongs to the admin and would raise
# conffile questions on upgrade/removal). A drop-in for an absent unit is inert.
install -m 644 "$MYDIR/beocreate2.service" "$STAGING/usr/lib/systemd/system/beocreate2.service"
install -m 644 "$MYDIR/sigmatcp-enable-tcp.conf" "$STAGING/usr/lib/systemd/system/sigmatcpserver.service.d/10-beocreate-enable-tcp.conf"
install -m 644 "$MYDIR/touch-timeout-brightness.conf" "$STAGING/usr/lib/systemd/system/touch-timeout.service.d/20-beocreate-brightness.conf"

# 4: Default configuration. Installed to /usr/share and copied to
# /etc/beocreate by postinst only if no configuration exists yet, so user
# settings survive upgrades.
install -m 644 "$MYDIR/system.json" "$STAGING/usr/share/beocreate/system.json.default"

# 4b: Debian copyright file (Policy 12.5). Beocreate itself is MIT; the
# redistributed npm dependencies keep their own licence files in the tree.
install -d "$STAGING/usr/share/doc/$PACKAGE"
cat > "$STAGING/usr/share/doc/$PACKAGE/copyright" <<'EOF'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: beocreate
Source: https://github.com/hifiberry/create

Files: *
Copyright: 2018 Bang & Olufsen A/S
           2018-2024 HiFiBerry
License: Expat

Files: node_modules/*
Copyright: the respective upstream authors
License: various
 Redistributed Node.js dependencies. Each module keeps its own licence under
 /opt/beocreate/node_modules/<module>/ (LICENSE or the license field of its
 package.json).

License: Expat
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 .
 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.
 .
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
EOF
chmod 644 "$STAGING/usr/share/doc/$PACKAGE/copyright"

# 5: nginx site (public :8080 -> loopback :8081) and the auth gateway
# manifest. Shipped as package files (conffiles), not copied in postinst:
# hifiberry-auth's dpkg trigger on /etc/hifiberry/auth.d fires only for files
# a package ships, and it is what makes the gateway load the manifest.
install -m 644 "$MYDIR/beocreate.nginx" "$STAGING/etc/nginx/sites-available/beocreate"
ln -s ../sites-available/beocreate "$STAGING/etc/nginx/sites-enabled/beocreate"
install -m 644 "$MYDIR/beocreate-auth.json" "$STAGING/etc/hifiberry/auth.d/beocreate.json"
cat > "$STAGING/DEBIAN/conffiles" <<'EOF'
/etc/nginx/sites-available/beocreate
/etc/hifiberry/auth.d/beocreate.json
EOF

# 6: Package metadata.
INSTALLED_SIZE=$(du -sk "$STAGING" | cut -f1)
cat > "$STAGING/DEBIAN/control" <<EOF
Package: $PACKAGE
Version: $VERSION
Section: sound
Priority: optional
Architecture: $ARCH
Depends: nodejs (>= 20), nginx, hifiberry-auth
Recommends: hifiberry-audiocontrol (>= 0.22), hifiberry-dsp, touch-timeout
Installed-Size: $INSTALLED_SIZE
Maintainer: HiFiBerry <support@hifiberry.com>
Description: Beocreate 2 classic user interface for HiFiBerryOS NG
 The classic Beocreate/HiFiBerryOS web interface (Node.js), ported to the
 Debian-based HiFiBerryOS NG. Talks to the ACR audio controller on port 1080
 and to sigmatcpserver on TCP port 8086. The UI is served on port 8080 by an
 nginx site behind the hifiberry-auth gateway (the Node server listens on
 loopback port 8081 only); loopback clients such as the kiosk
 (kiosk-mode.sh setup --url=http://localhost:8080) are not gated.
EOF

# Maintainer scripts: prefer the Debian systemd helpers when present
# (deb-systemd-helper tracks enable state across remove/purge,
# deb-systemd-invoke honours policy-rc.d, e.g. in chroots/images), and fall
# back to plain systemctl on systems without the debhelper tooling.
#
# reload_nginx is shared by postinst (configure) and postrm (remove). It is
# guarded so a missing or stopped nginx, or a config that fails nginx -t,
# never fails the package operation.
NGINX_RELOAD='reload_nginx() {
    command -v nginx >/dev/null 2>&1 || return 0
    if ! nginx -t >/dev/null 2>&1; then
        echo "beocreate-classic-ui: nginx -t failed, not reloading nginx" >&2
        return 0
    fi
    if [ -d /run/systemd/system ] && systemctl is-active --quiet nginx 2>/dev/null; then
        systemctl reload nginx || true
    fi
}'
maint_header() { printf '#!/bin/sh\nset -e\n\n%s\n\n' "$NGINX_RELOAD"; }

{ maint_header; cat <<'EOF'
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
    # Apply the touch-timeout brightness drop-in if the daemon is installed.
    if systemctl list-unit-files touch-timeout.service >/dev/null 2>&1; then
        if command -v deb-systemd-invoke >/dev/null 2>&1; then
            deb-systemd-invoke try-restart touch-timeout.service >/dev/null || true
        else
            systemctl try-restart touch-timeout.service || true
        fi
    fi
    # After the restart above: an upgraded server only now frees :8080 for nginx.
    reload_nginx
fi

exit 0
EOF
} > "$STAGING/DEBIAN/postinst"
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

{ maint_header; cat <<'EOF'
case "$1" in
    remove)
        systemctl daemon-reload >/dev/null 2>&1 || true
        if command -v deb-systemd-helper >/dev/null 2>&1; then
            deb-systemd-helper disable beocreate2.service >/dev/null || true
        else
            # Fallback: no debhelper tooling on this system.
            systemctl disable beocreate2.service >/dev/null 2>&1 || true
        fi
        # The package's drop-ins are gone after daemon-reload: try-restart the
        # affected daemons so sigmatcpserver drops raw SigmaTCP again and
        # touch-timeout stops running at the slider's -b (both no-ops if absent).
        restart_dropin_units() {
            for unit in sigmatcpserver.service touch-timeout.service; do
                systemctl list-unit-files "$unit" >/dev/null 2>&1 || continue
                if command -v deb-systemd-invoke >/dev/null 2>&1; then
                    deb-systemd-invoke try-restart "$unit" >/dev/null || true
                else
                    systemctl try-restart "$unit" || true
                fi
            done
        }
        restart_dropin_units
        # The sites-enabled symlink is gone: drop the :8080 server block.
        reload_nginx
        ;;
    purge)
        # Remove the runtime configuration/settings this package's server wrote.
        # /etc/beocreate is wholly this package's data directory (system.json
        # copied by postinst, per-extension settings, touch-timeout.env, and the
        # beo-extensions/beo-dsp-programs/... subdirectories the server creates),
        # so remove the tree rather than only its top-level *.json.
        rm -rf /etc/beocreate
        if command -v deb-systemd-helper >/dev/null 2>&1; then
            deb-systemd-helper purge beocreate2.service >/dev/null || true
            deb-systemd-helper unmask beocreate2.service >/dev/null || true
        fi
        systemctl daemon-reload >/dev/null 2>&1 || true
        ;;
esac
exit 0
EOF
} > "$STAGING/DEBIAN/postrm"
chmod 755 "$STAGING/DEBIAN/postrm"

# 7: Build the .deb.
dpkg-deb --build --root-owner-group "$STAGING" "$MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb"

echo "Built: $MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb"

# Copy to the shared package output directory if it exists (hbosng convention).
if [ -d "$DEST_DIR" ]; then
    cp "$MYDIR/${PACKAGE}_${VERSION}_${ARCH}.deb" "$DEST_DIR/"
    echo "Copied to $DEST_DIR/"
fi
