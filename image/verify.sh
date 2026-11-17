#!/bin/bash
# Verifies an audio-os image: (a) offline assertions on the root and boot filesystems, (b) a
# systemd-nspawn boot with live checks. (b) needs root, systemd-nspawn and a native arm64 host;
# elsewhere it is skipped with a loud notice. Any failed assertion makes the script exit non-zero.
# Usage: verify.sh <image.img.xz | rootfs-dir>   (a rootfs dir is checked with its boot/firmware)
set -euo pipefail

MACHINE=audio-os-verify
PLAYER=player
# Units that fail in a container because the hardware they serve is absent there.
NO_HARDWARE_UNITS="rpi-eeprom-update.service volume-restore.service volume-store.service hifiberry-bluetooth.service ble-provisioning.service bluetooth.service NetworkManager-wait-online.service systemd-growfs-root.service"
# Units that fail only because of the container itself: no root block device (remount-fs), no
# /dev/console with --console=pipe (firstboot's prompts; it has nothing to ask on this image), and
# rtkit's RLIMIT_NPROC, which counts every process of its uid on the shared host kernel.
CONTAINER_ONLY_UNITS="systemd-remount-fs.service systemd-firstboot.service rtkit-daemon.service"

die() { echo "verify: $*" >&2; exit 1; }
failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; failures=$((failures + 1)); }
check() { local what=$1; shift; if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; fi; }

[ $# -eq 1 ] || die "usage: $0 <image.img.xz | rootfs-dir>"
work=$(mktemp -d "${TMPDIR:-/var/tmp}/audio-os-verify.XXXXXX")
root="" boot="" img="" loop="" nspawn_pid=""

cleanup() {
    set +e
    if [ -n "$nspawn_pid" ] && kill -0 "$nspawn_pid" 2>/dev/null; then
        machinectl terminate "$MACHINE" 2>/dev/null || kill "$nspawn_pid"
        wait "$nspawn_pid"
    fi
    if [ -n "$loop" ]; then umount "$root"; losetup -d "$loop"; fi
    if grep -qF " $work/" /proc/self/mounts; then
        echo "verify: leaving $work, something is still mounted under it" >&2
    else
        rm -rf --one-file-system "$work"
    fi
}
trap cleanup EXIT

if [ -d "$1" ]; then
    root=$(realpath "$1")
    boot=$root/boot/firmware
else
    [ "$(id -u)" = 0 ] || die "reading an image needs root (loop mount)"
    img=$work/image.img
    xz -dc "$1" > "$img"
    sector_start() { sfdisk --json "$img" | jq -r ".partitiontable.partitions[$1].start"; }
    root=$work/root
    boot=$work/boot
    mkdir -p "$root" "$boot"
    loop=$(losetup --find --show --offset $(( $(sector_start 1) * 512 )) "$img")
    mount "$loop" "$root"
    MTOOLS_SKIP_CHECK=1 mcopy -s -p -m -i "$img@@$(( $(sector_start 0) * 512 ))" '::/*' "$boot/"
fi
[ -f "$boot/config.txt" ] || die "no boot partition content at $boot"

# ---------------------------------------------------------------------------------------------
echo "=== (a) offline assertions"

has_line() { grep -qxF -- "$2" "$1"; }
enabled() { compgen -G "$root/etc/systemd/system/*.wants/$1" >/dev/null; }
user_enabled() { compgen -G "$root/etc/systemd/user/*.wants/$1" >/dev/null; }
all_locked() { awk -F: '$2 !~ /^[!*]/ { print $1; bad = 1 } END { exit bad }' "$root/etc/shadow"; }

check "every account password is locked" all_locked
for u in player kiosk audio-os; do check "user $u exists" grep -q "^$u:" "$root/etc/passwd"; done
check "ssh.service not enabled" bash -c "! compgen -G '$root/etc/systemd/system/*.wants/ssh.service'"
check "ssh.socket not enabled" bash -c "! compgen -G '$root/etc/systemd/system/*.wants/ssh.socket'"
check "no ssh host keys baked in" bash -c "! compgen -G '$root/etc/ssh/ssh_host_*'"
check "sshd: password login off" has_line "$root/etc/ssh/sshd_config.d/00-audio-os.conf" "PasswordAuthentication no"
for unit in audio-os-firewall.service audio-os-helper.service kiosk.service touch-timeout.service \
        nginx.service hifiberry-auth.service audiocontrol.service config-server.service config-detect.service \
        volume-restore.service; do
    check "$unit enabled" enabled "$unit"
done
for unit in userconfig.service nftables.service man-db.timer; do
    check "$unit not enabled" bash -c "! compgen -G '$root/etc/systemd/system/*.wants/$unit'"
done
check "getty@tty1 masked (kiosk owns tty1)" test "$(readlink "$root/etc/systemd/system/getty@tty1.service")" = /dev/null
check "default target is multi-user" test "$(readlink "$root/etc/systemd/system/default.target")" = /usr/lib/systemd/system/multi-user.target
for unit in pipewire.service mpd.service pipewire-api.service shairport.service librespot.service; do
    check "user unit $unit enabled" user_enabled "$unit"
done
check "/etc/hifiberry.user names $PLAYER" test "$(cat "$root/etc/hifiberry.user")" = "$PLAYER"
check "$PLAYER lingers" test -e "$root/var/lib/systemd/linger/$PLAYER"
check "machine-id uninitialized (first boot)" test "$(cat "$root/etc/machine-id")" = uninitialized
check "hostname hifiberry" test "$(cat "$root/etc/hostname")" = hifiberry

for line in dtparam=audio=off dtoverlay=vc4-kms-v3d,noaudio force_eeprom_read=1 dtparam=spi=on \
        dtparam=i2c_arm=on disable_splash=1 display_auto_detect=1; do
    check "config.txt: $line" has_line "$boot/config.txt" "$line"
done
cmdline=$(cat "$boot/cmdline.txt")
check "cmdline.txt is one line" test "$(wc -l < "$boot/cmdline.txt")" = 1
for arg in console=serial0,115200 console=tty3 quiet loglevel=3 vt.global_cursor_default=0 logo.nologo resize; do
    check "cmdline: $arg" grep -qw -- "$arg" <<< "$cmdline"
done
check "cmdline: no console=tty1" bash -c "! grep -qw console=tty1 <<< '$cmdline'"
for f in audio-os.conf user-data network-config; do check "boot: $f present" test -f "$boot/$f"; done

check "no apt proxy left" bash -c "! grep -rqsE 'Acquire::https?::(Proxy|CAInfo)' '$root/etc/apt'"
check "no policy-rc.d left" test ! -e "$root/usr/sbin/policy-rc.d"
check "no proxy in /etc/environment" bash -c "! grep -qsi proxy '$root/etc/environment'"
check "ACR bound to loopback" python3 -c "import json,sys; sys.exit(json.load(open('$root/etc/audiocontrol/audiocontrol.json'))['services']['webserver']['host'] != '127.0.0.1')"
check "mpd.conf bound to loopback" grep -qE '^bind_to_address[[:space:]]+"127.0.0.1"' "$root/home/$PLAYER/etc/mpd.conf"
check "pipewire-api drop-in uses --localhost" grep -qx 'ExecStart=/usr/bin/pipewire-api --log-level info --localhost' \
    "$root/usr/lib/systemd/user/pipewire-api.service.d/audio-os.conf"
check "pipewire-api unit still matches the drop-in's base command" grep -qx 'ExecStart=/usr/bin/pipewire-api --log-level info' \
    "$root/usr/lib/systemd/user/pipewire-api.service"
check "first-boot volume seeded" python3 -c "import sqlite3,sys; v=sqlite3.connect('file:$root/var/hifiberry/config.sqlite?mode=ro', uri=True).execute(\"select value from config where key='system.volume'\").fetchone(); sys.exit(v is None or int(v[0]) > 30)"

check "UI document present" grep -q '<meta name="audio-os-ui"' "$root/usr/share/audio-os/ui/index.html"
for f in /usr/lib/audio-os/audio_os_helper.py /usr/bin/touch-timeout /usr/share/audio-os/version \
        /etc/nginx/hifiberry-api.d/zz-audio-os.nginx /etc/hifiberry/auth.d/audio-os.json \
        /usr/share/polkit-1/rules.d/50-audio-os.rules /usr/share/audio-os/firewall.nft \
        /usr/lib/systemd/system-preset/10-audio-os.preset; do
    check "file $f" test -s "$root$f"
done

if [ -n "$img" ]; then
    disk_id=$(sfdisk --disk-id "$img" | sed 's/^0x//')
    check "fstab boot PARTUUID matches MBR" grep -q "^PARTUUID=$disk_id-01[[:space:]]" "$root/etc/fstab"
    check "fstab root PARTUUID matches MBR" grep -q "^PARTUUID=$disk_id-02[[:space:]]" "$root/etc/fstab"
    check "cmdline root PARTUUID matches MBR" grep -qw -- "root=PARTUUID=$disk_id-02" <<< "$cmdline"
else
    echo "  skip  PARTUUID consistency (needs an image, not a directory)"
fi

[ "$failures" = 0 ] || die "(a) $failures offline assertion(s) failed"

# ---------------------------------------------------------------------------------------------
echo "=== (b) boot test"
skip_b() {
    echo "##############################################################################"
    echo "## (b) BOOT TEST SKIPPED: $1"
    echo "##############################################################################"
    exit 0
}
[ "$(uname -m)" = aarch64 ] || skip_b "host is $(uname -m), the boot test needs native arm64"
[ "$(id -u)" = 0 ] || skip_b "needs root"
command -v systemd-nspawn >/dev/null || skip_b "systemd-nspawn not installed (systemd-container)"
command -v machinectl >/dev/null || skip_b "machinectl not installed (systemd-container)"

# Test-only unit overrides, highest-priority unit path, never written into the image.
control=$work/system.control
mkdir -p "$control"
ln -s /dev/null "$control/config-detect.service"   # would rewrite config.txt and reboot
if [ ! -e /proc/asound/cards ]; then
    echo "  note  host has no ALSA: audiocontrol's ConditionPathExists=/proc/asound/cards is reset for this test"
    mkdir -p "$control/audiocontrol.service.d"
    printf '[Unit]\nConditionPathExists=\n' > "$control/audiocontrol.service.d/verify.conf"
fi
cp -a "$boot" "$work/boot-rw"

systemd-nspawn --boot --quiet --directory="$root" --volatile=overlay --private-network \
    --machine="$MACHINE" --bind="$work/boot-rw:/boot/firmware" \
    --bind-ro="$control:/etc/systemd/system.control" --console=pipe > "$work/console.log" 2>&1 &
nspawn_pid=$!

for _ in $(seq 120); do
    leader=$(machinectl show "$MACHINE" --property=Leader --value 2>/dev/null || true)
    [ -n "$leader" ] && [ "$leader" != 0 ] && break
    kill -0 "$nspawn_pid" 2>/dev/null || { cat "$work/console.log"; die "container exited during boot"; }
    sleep 1
done
[ -n "$leader" ] || die "container did not register with machined"
in_box() {
    nsenter --target "$leader" --mount --uts --ipc --net --pid -- \
        env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C.UTF-8 "$@"
}
as_user() { local user=$1; shift; in_box setpriv --reuid="$user" --regid="$user" --init-groups -- "$@"; }
player_uid=$(awk -F: -v u="$PLAYER" '$1 == u { print $3 }' "$root/etc/passwd")
player_systemctl() { as_user "$PLAYER" env XDG_RUNTIME_DIR="/run/user/$player_uid" systemctl --user "$@"; }

# The leader registers before systemd has started inside; is-system-running answers "offline"
# until /run/systemd/system exists, so wait for that first.
for _ in $(seq 120); do in_box test -d /run/systemd/system && break; sleep 1; done
state=$(in_box timeout 600 systemctl is-system-running --wait || true)
echo "  system state: $state"

for unit in nginx hifiberry-auth audiocontrol config-server audio-os-helper audio-os-firewall; do
    check "$unit active" in_box systemctl is-active --quiet "$unit.service"
done

check "nginx -t" in_box nginx -t

user_units=(pipewire.service mpd.service pipewire-api.service)
# is-active with several units succeeds when any one is active, so wait on each in turn.
for unit in "${user_units[@]}"; do
    for _ in $(seq 60); do
        player_systemctl is-active --quiet "$unit" 2>/dev/null && break
        sleep 2
    done
done
for unit in "${user_units[@]}"; do
    check "$PLAYER user unit $unit active" player_systemctl is-active --quiet "$unit"
done
echo "  info  other $PLAYER user units (need audio hardware, not asserted):"
player_systemctl --no-pager --plain --no-legend list-units 'shairport*' 'librespot*' 'wireplumber*' || true

http_status() { in_box curl -s -o /dev/null -w '%{http_code}' "$@"; }
players_json() { in_box curl -fsS http://localhost/api/audiocontrol/players | python3 -m json.tool; }
# ACR reports active before its web server listens; give it a bounded time to come up.
for _ in $(seq 60); do players_json >/dev/null 2>&1 && break; sleep 2; done
screen_unavailable() {
    in_box curl -fsS http://localhost/api/device/v1/screen |
        python3 -c 'import json, sys; sys.exit(json.load(sys.stdin)["available"] is not False)'
}
upstream_ui() { in_box sh -c 'curl -fsS http://localhost/services | cmp -s - /usr/share/hifiberry/webui/index.html'; }
# Polkit subjects as the helper really is: a process of user audio-os in a system service, outside
# any login session. pkcheck runs as root (only root may pass --detail) against that process.
in_box systemd-run --quiet --unit=verify-pk-subject --uid=audio-os --gid=audio-os -- sleep 900 || true
pk_pid=$(in_box systemctl show --property=MainPID --value verify-pk-subject.service || true)
as_helper() { in_box systemd-run --quiet --wait --pipe --collect --uid=audio-os --gid=audio-os -- "$@"; }
# pk_allowed <action-id> [<detail-key> <detail-value>]...: 0 only when authorized.
pk_allowed() {
    local action=$1; shift
    local details=()
    while [ $# -ge 2 ]; do details+=(--detail "$1" "$2"); shift 2; done
    in_box pkcheck --action-id "$action" --process "$pk_pid" "${details[@]}"
}
# pk_denied: pkcheck said "not authorized" (1) or "needs authentication" (2); errors (127) do not count.
pk_denied() { local rc=0; pk_allowed "$@" || rc=$?; [ "$rc" = 1 ] || [ "$rc" = 2 ]; }
manage() { pk_allowed org.freedesktop.systemd1.manage-units unit "$1" verb "$2"; }
manage_denied() { pk_denied org.freedesktop.systemd1.manage-units unit "$1" verb "$2"; }
not() { ! "$@"; }
# systemctl refused by polkit (not failing for some other reason).
systemctl_denied() { as_helper systemctl "$@" 2>&1 | grep -qiE 'access denied|authentication required'; }

index=$(in_box curl -fsS http://localhost/ || true)
check "/ serves the audio-os UI" grep -q '<meta name="audio-os-ui"' <<< "$index"
assets=$(grep -oE '(src|href)="/ui/[^"]+"' <<< "$index" | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
[ -n "$assets" ] || fail "UI document references no /ui/ assets"
for asset in $assets; do check "asset $asset 200" test "$(http_status "http://localhost$asset")" = 200; done
check "/api/audiocontrol/players 200 JSON" players_json
check "/api/device/v1/screen reports available:false" screen_unavailable
power=$(http_status -X POST -H 'Content-Type: application/json' -d '{"action":"bogus"}' http://localhost/api/device/v1/power)
check "loopback POST /power with a bogus action reaches the helper (400, got $power)" test "$power" = 400
check "/services still serves upstream's UI" upstream_ui

check "polkit subject process running" test -n "$pk_pid" -a "$pk_pid" != 0
check "polkit: audio-os may try-restart touch-timeout" as_helper systemctl try-restart touch-timeout.service
check "polkit: audio-os may not try-restart nginx" systemctl_denied try-restart nginx.service
check "polkit: audio-os may kill touch-timeout" manage touch-timeout.service kill
check "polkit: audio-os may not restart touch-timeout" manage_denied touch-timeout.service restart
check "polkit: audio-os may not stop touch-timeout" manage_denied touch-timeout.service stop
check "polkit: audio-os may not kill nginx" manage_denied nginx.service kill
for action in org.freedesktop.login1.reboot org.freedesktop.login1.power-off-multiple-sessions; do
    check "polkit: audio-os has $action" pk_allowed "$action"
done
check "polkit: audio-os lacks org.freedesktop.login1.set-wall-message" pk_denied org.freedesktop.login1.set-wall-message
in_box systemctl stop verify-pk-subject.service || true

# First boot applies unit presets (machine-id "uninitialized"); nothing off at build time may come on.
for unit in ssh.service ssh.socket userconfig.service nftables.service systemd-networkd.service \
        systemd-networkd-wait-online.service systemd-resolved.service; do
    check "$unit not enabled after first boot" not in_box systemctl is-enabled --quiet "$unit"
    check "$unit not active after first boot" not in_box systemctl is-active --quiet "$unit"
done

listeners=$(in_box ss -Hlntu)
unexpected=$(awk '
    { split($5, a, ":"); port = a[length(a)]; addr = substr($5, 1, length($5) - length(port) - 1)
      if (addr ~ /^(127\.|\[::1\]|\[::ffff:127\.)/ || addr ~ /%lo$/) next
      if ($1 == "tcp" && (port == 80 || port == 5000 || port == 7000)) next
      if ($1 == "udp" && (port == 5353 || port == 319 || port == 320 || port == 68 || port == 546)) next
      if (port >= 32768 && port <= 60999) next
      print }' <<< "$listeners")
if [ -z "$unexpected" ]; then pass "no LAN listener outside the allowlist"; else
    fail "LAN listeners outside the allowlist:"; echo "$unexpected" >&2; echo "full table:" >&2; echo "$listeners" >&2; fi

check "firewall table loaded" in_box nft list table inet audio_os
check "firewall file parses" in_box nft -c -f /usr/share/audio-os/firewall.nft
# verify also loads every unit ours reference and warns about those; keep only lines about ours.
analyze=$(in_box systemd-analyze verify audio-os-helper.service audio-os-firewall.service kiosk.service touch-timeout.service 2>&1 |
    grep -E 'audio-os-helper|audio-os-firewall|kiosk|touch-timeout' || true)
if [ -z "$analyze" ]; then pass "systemd-analyze verify: our units clean"; else fail "systemd-analyze verify:"; echo "$analyze" >&2; fi

failed=$(in_box systemctl list-units --failed --plain --no-legend | awk '{ print $1 }')
for unit in $failed; do
    if grep -qw -- "$unit" <<< "$NO_HARDWARE_UNITS"; then
        echo "  note  $unit failed (needs hardware absent in a container)"
    elif grep -qw -- "$unit" <<< "$CONTAINER_ONLY_UNITS"; then
        echo "  note  $unit failed (a limit of the container, not of the image)"
    else
        fail "unit $unit failed"
        in_box systemctl status --no-pager --lines=20 "$unit" >&2 || true
    fi
done

[ "$failures" = 0 ] || { echo "--- container console (tail)" >&2; tail -n 50 "$work/console.log" >&2; die "(b) $failures boot assertion(s) failed"; }
echo "verify: all checks passed"
