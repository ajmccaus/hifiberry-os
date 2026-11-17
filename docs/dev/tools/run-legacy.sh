#!/bin/bash
# Starts legacy Beocreate UI + mock ACR/backlight on http://127.0.0.1:18080 (ACR mock on 11080).
# Usage: run-legacy.sh start|stop   (default start; runs in background, state in $W)
H="$(cd "$(dirname "$0")" && pwd)"; R="$H/beocreate-port"; W=/tmp/beo-legacy-run
PORT=18080; ACR=11080
stop(){ [ -f $W/pids ] && kill $(cat $W/pids) 2>/dev/null; rm -rf $W; }
[ "$1" = stop ] && { stop; echo stopped; exit 0; }
stop; mkdir -p $W/config $W/backlight
cat > $W/config/system.json <<J
{"cardType":"Beocreate 4-Channel Amplifier","cardFeatures":["dsp","arm7"],"port":$PORT,"listenPort":$PORT,"acrAddress":"http://127.0.0.1:$ACR"}
J
node $R/mock-backend/mock-backlight.js $W/backlight mock-backlight >/dev/null
MOCK_ACR_PORT=$ACR node $R/mock-backend/mock-acr.js >$W/acr.log 2>&1 & echo $! > $W/pids
sleep 1
( cd $R/server && exec env BEO_CONFIG_DIR=$W/config BEO_ACR_ADDRESS=http://127.0.0.1:$ACR BEO_BACKLIGHT_DIR=$W/backlight \
 BEO_SYSTEMCTL=$R/mock-backend/mock-systemctl.js MOCK_SYSTEMCTL_LOG=$W/systemctl.log MOCK_TOUCH_TIMEOUT=inactive \
 BEO_HOSTNAMECTL=$R/mock-backend/mock-hostnamectl.js MOCK_HOSTNAMECTL_LOG=$W/hostnamectl.log MOCK_HOSTNAMECTL_NAME="Living Room" \
 BEO_AVAHI_PUBLISH=$R/mock-backend/mock-avahi-publish.js MOCK_AVAHI_LOG=$W/avahi.log \
 node beo-system/beo-server.js v >$W/server.log 2>&1 ) &
echo $! >> $W/pids
for i in $(seq 30); do curl -sf http://127.0.0.1:$PORT/ >/dev/null && break; sleep 0.5; done
sleep 2
echo "Legacy UI: http://127.0.0.1:$PORT/  (stop: $0 stop)"
