#!/bin/sh
# Executable check of beocreate-classic-ui's maintainer scripts (nginx site
# lifecycle, purge) against a built .deb: runs its real postinst/postrm with
# /etc and /usr/share/beocreate redirected into a temp root and systemctl,
# deb-systemd-*, nginx stubbed out. Exits non-zero on the first wrong outcome.
# Usage: package/test-maintainer-scripts.sh [path/to/beocreate-classic-ui_*.deb]

set -e
DEB="${1:-$(ls -t "$(dirname "$0")"/beocreate-classic-ui_*_all.deb 2>/dev/null | head -1)}"
[ -f "$DEB" ] || { echo "no .deb given or found; run package/build.sh first" >&2; exit 2; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
R="$T/root"
mkdir -p "$T/bin" "$T/control"
for c in systemctl deb-systemd-helper deb-systemd-invoke nginx; do
    printf '#!/bin/sh\nexit 0\n' > "$T/bin/$c"
    chmod +x "$T/bin/$c"
done
dpkg-deb -e "$DEB" "$T/control"
for f in postinst postrm; do
    sed -e "s#/etc/#$R/etc/#g" -e "s#/usr/share/beocreate#$R/usr/share/beocreate#g" "$T/control/$f" > "$T/$f"
done

reset() {
    rm -rf "$R"
    mkdir -p "$R/etc/nginx/sites-available" "$R/etc/nginx/sites-enabled" "$R/usr/share/beocreate"
    echo site > "$R/etc/nginx/sites-available/beocreate"
    echo '{}' > "$R/usr/share/beocreate/system.json.default"
}
run() { PATH="$T/bin:$PATH" sh "$T/$1" "$2" "$3" > /dev/null; }
site() { if [ -L "$R/etc/nginx/sites-enabled/beocreate" ]; then echo enabled; else echo disabled; fi; }
expect() { # description, actual, wanted
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: $2, wanted $3"; exit 1; fi
}

reset; run postinst configure ""
expect "fresh install enables the site" "$(site)" enabled
run postinst configure 2.4.5
expect "an upgrade keeps it enabled" "$(site)" enabled
rm "$R/etc/nginx/sites-enabled/beocreate"; run postinst configure 2.4.5
expect "an upgrade keeps an admin-disabled site disabled" "$(site)" disabled

reset; run postinst configure ""; run postrm remove
expect "remove disables the site" "$(site)" disabled
run postinst configure 2.4.5
expect "reinstall after remove enables it again" "$(site)" enabled
expect "the reinstall clears the marker" "$([ -e "$R/etc/beocreate/.nginx-site-enabled" ] && echo present || echo gone)" gone

reset; run postinst configure ""; rm "$R/etc/nginx/sites-enabled/beocreate"; run postrm remove; run postinst configure 2.4.5
expect "reinstall keeps a site disabled before removal disabled" "$(site)" disabled
run postrm purge
expect "purge removes /etc/beocreate" "$([ -e "$R/etc/beocreate" ] && echo present || echo gone)" gone
