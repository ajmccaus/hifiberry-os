#!/usr/bin/env bash
# Start a real ACR (audiocontrol 0.25.0) on 127.0.0.1:1080, headless, no sound hardware.
#   ./run-acr.sh          start (idempotent: already-running parts are left alone)
#   ./run-acr.sh stop     stop ACR and the backing MPD
#   ./run-acr.sh status   show what is running
# Backing players (see run/acr/audiocontrol.json, regenerated on every start):
#   mpd   real MPD 0.23 on 127.0.0.1:6600, "null" audio output, 3 silent mp3s with tags + embedded cover
#   demo  ACR "generic" player, driven by POST /api/player/demo/update (no process behind it)
# Volume: ACR "dummy" control (50%), no ALSA.
# Needs: mpd, ffmpeg (first run only, to make the test files), and the built binary
#   acr/target/release/audiocontrol  (cd acr && cargo build --release)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$HERE/run"
BIN="${ACR_BIN:-$HERE/acr/target/release/audiocontrol}"
MPD_PORT=6600
ACR_PORT=1080

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

stop_all() {
  for f in "$RUN/acr.pid" "$RUN/mpd/mpd.pid"; do
    if pid_alive "$f"; then pid="$(cat "$f")"; kill "$pid" && echo "stopped $(basename "$f" .pid) ($pid)"; fi
    rm -f "$f"
  done
}

if [ "${1:-}" = "stop" ]; then stop_all; exit 0; fi
if [ "${1:-}" = "status" ]; then
  pid_alive "$RUN/mpd/mpd.pid" && echo "mpd: running ($(cat "$RUN/mpd/mpd.pid"))" || echo "mpd: stopped"
  pid_alive "$RUN/acr.pid" && echo "acr: running ($(cat "$RUN/acr.pid"))" || echo "acr: stopped"
  exit 0
fi

[ -x "$BIN" ] || { echo "missing $BIN - build it: (cd $HERE/acr && cargo build --release)" >&2; exit 1; }
mkdir -p "$RUN/mpd/playlists" "$RUN/acr/data/cache/images" "$RUN/acr/data/cache/artists" \
         "$RUN/acr/data/user/images" "$RUN/acr/data/db" "$RUN/music/Test Artist/Test Album"

# --- test media: 3 silent mp3s with tags and an embedded cover (first run only)
ALBUM="$RUN/music/Test Artist/Test Album"
if [ ! -f "$ALBUM/03 - Third Silence.mp3" ]; then
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x2a6fdb:s=600x600,drawbox=x=100:y=100:w=400:h=400:color=0xf2c14e:t=fill" \
    -frames:v 1 "$RUN/cover.png"
  i=1
  for t in "First Silence" "Second Silence" "Third Silence"; do
    ffmpeg -loglevel error -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -i "$RUN/cover.png" -t $((60*i)) \
      -map 0:a -map 1:v -c:a libmp3lame -b:a 64k -c:v mjpeg -id3v2_version 3 \
      -metadata title="$t" -metadata artist="Test Artist" -metadata album="Test Album" \
      -metadata track=$i -metadata date=2020 -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" \
      "$ALBUM/0$i - $t.mp3"
    i=$((i+1))
  done
fi

# --- MPD (null output, localhost only)
cat > "$RUN/mpd.conf" <<EOF
music_directory "$RUN/music"
playlist_directory "$RUN/mpd/playlists"
db_file "$RUN/mpd/db"
state_file "$RUN/mpd/state"
sticker_file "$RUN/mpd/sticker.sql"
pid_file "$RUN/mpd/mpd.pid"
log_file "$RUN/mpd/mpd.log"
bind_to_address "127.0.0.1"
port "$MPD_PORT"
audio_output {
  type "null"
  name "null"
  mixer_type "none"
}
EOF
if pid_alive "$RUN/mpd/mpd.pid"; then
  echo "mpd already running ($(cat "$RUN/mpd/mpd.pid"))"
else
  mpd "$RUN/mpd.conf" >/dev/null 2>&1
  for _ in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/$MPD_PORT) 2>/dev/null && break; sleep 0.2; done
  mpc -h 127.0.0.1 -p $MPD_PORT update --wait >/dev/null
  mpc -h 127.0.0.1 -p $MPD_PORT clear >/dev/null
  mpc -h 127.0.0.1 -p $MPD_PORT add / >/dev/null
  echo "mpd started ($(cat "$RUN/mpd/mpd.pid")), $(mpc -h 127.0.0.1 -p $MPD_PORT playlist | wc -l) tracks queued"
fi

# --- ACR config (absolute paths under run/)
cat > "$RUN/acr/audiocontrol.json" <<EOF
{
  "action_plugins": [
    { "active-monitor": { "enabled": true } },
    { "event-logger": { "enabled": true, "event_types": ["state","song","position","state_changed","song_information_update"], "log_level": "info", "only_active": false } }
  ],
  "players": [
    { "mpd": { "host": "127.0.0.1", "port": $MPD_PORT, "load_mpd_library": true, "enhance_metadata": false, "music_directory": "$RUN/music" } },
    { "generic": { "name": "demo", "display_name": "Demo Player", "enable": true, "supports_api_events": true,
        "capabilities": ["play","pause","stop","next","previous","seek","shuffle","loop"], "initial_state": "stopped" } }
  ],
  "inputs": { "keyboard": { "enable": false } },
  "services": {
    "webserver": { "enable": true, "host": "127.0.0.1", "port": $ACR_PORT },
    "datastore": {
      "attribute_cache": { "dbfile": "$RUN/acr/data/cache/attributes.db", "memory_cache_records": 1000 },
      "image_cache_path": "$RUN/acr/data/cache/images",
      "user_image_path": "$RUN/acr/data/user/images",
      "artist_store": { "cache_dir": "$RUN/acr/data/cache/artists", "enable_custom_images": true, "auto_download": false }
    },
    "settingsdb": { "path": "$RUN/acr/data/db" },
    "security_store": { "path": "$RUN/acr/data/security_store.json" },
    "volume": { "enable": true, "type": "dummy", "display_name": "Master Volume", "initial_percent": 50.0 },
    "musicbrainz": { "enable": false }, "theaudiodb": { "enable": false }, "fanarttv": { "enable": false },
    "lastfm": { "enable": false }, "spotify": { "enable": false }, "external_coverart": { "enable": false }
  }
}
EOF

# --- ACR
if pid_alive "$RUN/acr.pid"; then
  echo "acr already running ($(cat "$RUN/acr.pid"))"
else
  cd "$RUN/acr"
  nohup "$BIN" -c "$RUN/acr/audiocontrol.json" --log-config "$HERE/acr/configs/logging.json" > "$RUN/acr.log" 2>&1 &
  echo $! > "$RUN/acr.pid"
  cd "$HERE"
  for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$ACR_PORT/api/version" >/dev/null 2>&1 && break; sleep 0.3; done
  curl -fsS "http://127.0.0.1:$ACR_PORT/api/version" >/dev/null || { echo "ACR did not come up; see $RUN/acr.log" >&2; exit 1; }
  echo "acr started ($(cat "$RUN/acr.pid")) - $(curl -s http://127.0.0.1:$ACR_PORT/api/version)"
fi

cat <<EOF

ACR:  http://127.0.0.1:$ACR_PORT/api/   (WebSocket ws://127.0.0.1:$ACR_PORT/api/events)
Log:  $RUN/acr.log     MPD log: $RUN/mpd/mpd.log
Try:  curl -s http://127.0.0.1:$ACR_PORT/api/players
      curl -s -X POST http://127.0.0.1:$ACR_PORT/api/player/mpd/command/play
Stop: $HERE/run-acr.sh stop
EOF
