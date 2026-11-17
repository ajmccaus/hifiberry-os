#!/bin/bash
# Customizes Raspberry Pi OS into audio-os; runs inside the image chroot (started by build.sh) with
# its inputs in /run/audio-os-build. Order matters: /etc/hifiberry.user and the player user must
# exist before hifiberry-shairport is installed; nothing here may rely on a running systemd.
set -euo pipefail

IN=/run/audio-os-build
HIFIBERRY_KEY_FPR=4192E989F186E770B273F98B7997FC464E443CFA
PLAYER=player
PLAYER_GROUPS="audio video render input gpio i2c spi plugdev netdev"
FIRST_BOOT_VOLUME=20
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 GNUPGHOME=$IN/gnupg
# systemctl treats live-only verbs (daemon-reload, start) as no-ops; hifiberry-bluetooth's postinst
# calls them unguarded, and chroot detection alone is not reliable under qemu-user.
export SYSTEMD_OFFLINE=1

step() { echo "=== provision: $*"; }
die() { echo "provision: $*" >&2; exit 1; }

step "apt sources over https, HiFiBerry repository"
install -d -m 0700 "$GNUPGHOME"
sed -i 's|http://|https://|' /etc/apt/sources.list.d/*.sources
fpr=$(gpg --show-keys --with-colons "$IN/hifiberry-archive-keyring.asc" | awk -F: '/^fpr:/ { print $10; exit }')
[ "$fpr" = "$HIFIBERRY_KEY_FPR" ] || die "HiFiBerry key fingerprint is '$fpr', expected $HIFIBERRY_KEY_FPR"
gpg --dearmor < "$IN/hifiberry-archive-keyring.asc" > /usr/share/keyrings/hifiberry-archive-keyring.gpg
cat > /etc/apt/sources.list.d/hifiberry.sources <<'EOF'
Types: deb
URIs: https://debianrepo.hifiberry.com/
Suites: trixie
Components: main
Signed-By: /usr/share/keyrings/hifiberry-archive-keyring.gpg
EOF

step "full-upgrade"
apt-get update
apt-get -y -o Dpkg::Options::=--force-confold full-upgrade

step "audio user '$PLAYER' (upstream install-all, done offline)"
if ! getent passwd "$PLAYER" >/dev/null; then
    useradd --create-home --shell /usr/sbin/nologin "$PLAYER"
fi
for group in $PLAYER_GROUPS; do
    if getent group "$group" >/dev/null; then usermod -a -G "$group" "$PLAYER"; fi
done
echo "$PLAYER" > /etc/hifiberry.user
mkdir -p /var/lib/systemd/linger
touch "/var/lib/systemd/linger/$PLAYER"
mkdir -p /etc/systemd/user.conf.d
cat > /etc/systemd/user.conf.d/journal.conf <<'EOF'
[Manager]
DefaultStandardOutput=journal
DefaultStandardError=journal
EOF

step "HiFiBerry packages and audio-os"
apt-get -y -o Dpkg::Options::=--force-confold install \
    hbos-minimal hifiberry-librespot hifiberry-shairport hifiberry-bluetooth
apt-get -y -o Dpkg::Options::=--force-confold install "$IN/audio-os.deb"

step "config.txt defaults (upstream config-configtxt) and quiet panel boot"
config-configtxt --default-config
rm -f /boot/firmware/config.txt.backup
grep -qx 'disable_splash=1' /boot/firmware/config.txt || printf 'disable_splash=1\n' >> /boot/firmware/config.txt
cmdline=$(tr -d '\n' < /boot/firmware/cmdline.txt)
cmdline=${cmdline/console=tty1/console=tty3}
for arg in quiet loglevel=3 vt.global_cursor_default=0 logo.nologo; do
    case " $cmdline " in *" $arg "*) ;; *) cmdline="$cmdline $arg" ;; esac
done
printf '%s\n' "$cmdline" > /boot/firmware/cmdline.txt

step "loopback-only daemons: ACR and MPD"
python3 - <<'EOF'
import json
path = "/etc/audiocontrol/audiocontrol.json"
with open(path) as f:
    config = json.load(f)
config["services"]["webserver"]["host"] = "127.0.0.1"
with open(path, "w") as f:
    json.dump(config, f, indent=4)
    f.write("\n")
EOF
player_home=$(getent passwd "$PLAYER" | cut -d: -f6)
install -d -o "$PLAYER" -g "$PLAYER" "$player_home/etc"
sed -e 's/^bind_to_address[[:space:]].*/bind_to_address\t\t"127.0.0.1"/' \
    -e 's/^zeroconf_enabled[[:space:]].*/zeroconf_enabled\t"no"/' \
    /usr/share/mpd/mpd.conf > "$player_home/etc/mpd.conf"
grep -q '^bind_to_address[[:space:]]*"127.0.0.1"' "$player_home/etc/mpd.conf" || die "mpd.conf: bind_to_address not set"
grep -q '^zeroconf_enabled[[:space:]]*"no"' "$player_home/etc/mpd.conf" || die "mpd.conf: zeroconf_enabled not set"
chown "$PLAYER:$PLAYER" "$player_home/etc/mpd.conf"

step "first-boot volume ${FIRST_BOOT_VOLUME}% (restored by volume-restore.service)"
python3 - "$FIRST_BOOT_VOLUME" <<'EOF'
import sys
from configurator.configdb import ConfigDB
from configurator.volume import VOLUME_DB_KEY, VOLUME_CARD_DB_KEY, VOLUME_CONTROL_DB_KEY
db = ConfigDB()
ok = db.set(VOLUME_DB_KEY, sys.argv[1]) and db.set(VOLUME_CARD_DB_KEY, "0") and db.set(VOLUME_CONTROL_DB_KEY, "Digital")
sys.exit(0 if ok and db.get(VOLUME_DB_KEY) == sys.argv[1] else 1)
EOF

step "services: kiosk owns tty1, no first-boot user wizard, no unused work"
systemctl set-default multi-user.target
systemctl disable userconfig.service man-db.timer nftables.service
# cancel-rename (run when cloud-init creates the first user) enables and starts getty@tty1, which
# Conflicts= with kiosk.service and would take the panel away; masked, those calls fail harmlessly.
systemctl mask getty@tty1.service
rm -f /etc/ssh/sshd_config.d/rename_user.conf

step "accounts locked, hostname"
for user in root pi "$PLAYER" kiosk audio-os; do passwd --lock "$user" >/dev/null; done
echo hifiberry > /etc/hostname
sed -i 's/^127\.0\.1\.1[[:space:]].*/127.0.1.1\t\thifiberry/' /etc/hosts
echo 'PRETTY_HOSTNAME=HiFiBerry' > /etc/machine-info

step "boot partition: settings file and cloud-init templates"
install -m 0644 "$IN/boot/audio-os.conf" "$IN/boot/user-data" "$IN/boot/network-config" /boot/firmware/

step "first-boot state as the stock image expects it"
rm -f /var/cache/apt/*.bin
mountpoint -q /var/cache/apt/archives || apt-get clean   # a bound .deb cache stays with the build host
rm -rf /var/lib/apt/lists/* /var/cache/debconf/*-old /var/lib/dpkg/*-old
rm -f /var/log/apt/* /var/log/dpkg.log /var/log/alternatives.log /etc/ssh/ssh_host_* /etc/uuid
printf 'uninitialized\n' > /etc/machine-id
rm -f /var/lib/dbus/machine-id
