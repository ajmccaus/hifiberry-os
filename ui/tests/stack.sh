#!/bin/bash
# E2E stack for the UI: real ACR 0.25 + MPD (via $ACR_SCRIPT), the real device helper with a fake
# backlight/systemctl, the configurator+auth+radio-stream stub, and two vite-preview gateways (nginx layout):
#   kiosk http://127.0.0.1:5180/   LAN client http://127.0.0.2:5180/
# Usage: stack.sh start|stop|status|acr-down|acr-up   Constraint: idempotent; binds loopback only.
set -euo pipefail

UI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$UI/.." && pwd)"
RUN="$UI/tests/.stack"
# run-acr.sh builds the MPD fixture and starts ACR on 127.0.0.1:1080 (it needs a built ACR in docs/dev/tools/acr).
ACR_SCRIPT="${ACR_SCRIPT:-$REPO/docs/dev/tools/run-acr.sh}"
ACR_PID="$(dirname "$ACR_SCRIPT")/run/acr.pid"

alive() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

wait_http() {
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 0.2
  done
  echo "not reachable: $1 (logs in $RUN)" >&2
  return 1
}

spawn() {
  local name="$1"
  shift
  if alive "$name"; then return 0; fi
  nohup "$@" > "$RUN/$name.log" 2>&1 &
  echo $! > "$RUN/$name.pid"
}

stop_one() {
  if alive "$1"; then kill "$(cat "$RUN/$1.pid")"; fi
  rm -f "$RUN/$1.pid"
}

start() {
  [ -x "$ACR_SCRIPT" ] || { echo "ACR_SCRIPT not found: $ACR_SCRIPT" >&2; exit 1; }
  [ -f "$UI/dist/index.html" ] || { echo "build the UI first: npm run build" >&2; exit 1; }
  mkdir -p "$RUN/state" "$RUN/backlight/10-0045"
  echo 255 > "$RUN/backlight/10-0045/max_brightness"
  echo 150 > "$RUN/backlight/10-0045/brightness"
  echo "0.1.0-test" > "$RUN/version"
  touch "$RUN/systemctl.log"
  # A radio station MPD can really open: an unreachable URL makes MPD's "play" fail or succeed by timing.
  [ -s "$RUN/radio.mp3" ] || ffmpeg -loglevel error -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 120 \
    -c:a libmp3lame -b:a 64k "$RUN/radio.mp3"

  "$ACR_SCRIPT" start > "$RUN/acr-start.log"

  spawn helper env AUDIO_OS_STATE_DIR="$RUN/state" AUDIO_OS_BACKLIGHT_DIR="$RUN/backlight" \
    AUDIO_OS_SYSTEMCTL="$UI/tests/stack/fake-systemctl" FAKE_SYSTEMCTL_LOG="$RUN/systemctl.log" \
    AUDIO_OS_ACR_URL=http://127.0.0.1:1080 AUDIO_OS_PORT=1190 AUDIO_OS_VERSION_FILE="$RUN/version" \
    python3 "$REPO/helper/audio_os_helper.py"
  spawn stubs env STUBS_STREAM_FILE="$RUN/radio.mp3" node "$UI/tests/stack/stubs.mjs"
  wait_http http://127.0.0.1:1190/api/device/v1/info
  wait_http http://127.0.0.1:1191/api/v1/network

  # Gateways serve dist/ as built now: always restart them.
  for role in kiosk lan; do
    stop_one "gateway-$role"
    # node directly (not npx): the recorded pid must be the server itself, or stop leaves it running.
    (cd "$UI" && spawn "gateway-$role" env GATEWAY_ROLE="$role" node node_modules/vite/bin/vite.js preview --config tests/stack/gateway.config.ts)
  done
  wait_http http://127.0.0.1:5180/
  wait_http http://127.0.0.2:5180/
  echo "stack up: kiosk http://127.0.0.1:5180/  lan http://127.0.0.2:5180/"
}

case "${1:-}" in
  start) start ;;
  stop)
    for p in gateway-kiosk gateway-lan stubs helper; do stop_one "$p"; done
    "$ACR_SCRIPT" stop > /dev/null
    ;;
  status)
    for p in helper stubs gateway-kiosk gateway-lan; do
      if alive "$p"; then echo "$p: running"; else echo "$p: stopped"; fi
    done
    "$ACR_SCRIPT" status
    ;;
  acr-down)
    if [ -f "$ACR_PID" ] && kill -0 "$(cat "$ACR_PID")" 2>/dev/null; then kill "$(cat "$ACR_PID")"; fi
    rm -f "$ACR_PID"
    ;;
  acr-up) "$ACR_SCRIPT" start > "$RUN/acr-start.log" ;;
  *)
    echo "usage: $0 start|stop|status|acr-down|acr-up" >&2
    exit 2
    ;;
esac
