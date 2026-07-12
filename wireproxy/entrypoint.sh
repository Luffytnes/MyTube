#!/bin/sh
# Start wireproxy when /data/.wireproxy.conf exists.
# Poll every 3 seconds — restart if the config changes or the process dies.

CONF=/data/.wireproxy.conf
WP_PID=""
CONF_HASH=""

start() {
    [ -f "$CONF" ] || return
    echo "[wireproxy] Starting..."
    wireproxy -c "$CONF" &
    WP_PID=$!
    echo "[wireproxy] PID=$WP_PID"
}

stop() {
    [ -z "$WP_PID" ] && return
    kill "$WP_PID" 2>/dev/null
    wait "$WP_PID" 2>/dev/null
    WP_PID=""
}

start

while true; do
    sleep 3

    NEW_HASH=$(md5sum "$CONF" 2>/dev/null | cut -d' ' -f1)

    if [ "$NEW_HASH" != "$CONF_HASH" ]; then
        # Config appeared, changed, or was removed
        stop
        CONF_HASH="$NEW_HASH"
        if [ -n "$CONF_HASH" ]; then
            start
        else
            echo "[wireproxy] Config removed — stopped"
        fi
    elif [ -n "$WP_PID" ] && ! kill -0 "$WP_PID" 2>/dev/null; then
        echo "[wireproxy] Process died — restarting"
        WP_PID=""
        start
    fi
done
