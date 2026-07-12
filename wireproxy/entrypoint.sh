#!/bin/sh
# Start wireproxy when /data/.wireproxy.conf exists.
# Poll every 3 s — restart if the config changes or the process dies.
set -u

CONF=/data/.wireproxy.conf
WP_PID=""
CONF_HASH=""

start() {
    [ -f "$CONF" ] || return 0
    # Basic sanity check before applying the config
    if ! grep -q '\[Interface\]' "$CONF" 2>/dev/null; then
        echo "[wireproxy] Config missing [Interface] section — skipping"
        return 1
    fi
    echo "[wireproxy] Starting..."
    wireproxy -c "$CONF" &
    WP_PID=$!
    echo "[wireproxy] PID=$WP_PID"
}

stop() {
    [ -z "$WP_PID" ] && return 0
    kill "$WP_PID" 2>/dev/null || true
    wait "$WP_PID" 2>/dev/null || true
    WP_PID=""
}

cleanup() {
    stop
    exit 0
}

trap cleanup TERM INT

start || true

while true; do
    # Run sleep in background so SIGTERM interrupts wait, not sleep
    sleep 3 &
    wait $!

    NEW_HASH=$(sha256sum "$CONF" 2>/dev/null | cut -d' ' -f1)

    if [ "$NEW_HASH" != "$CONF_HASH" ]; then
        stop
        CONF_HASH="$NEW_HASH"
        if [ -n "$CONF_HASH" ]; then
            start || true
        else
            echo "[wireproxy] Config removed — stopped"
        fi
    elif [ -n "$WP_PID" ] && ! kill -0 "$WP_PID" 2>/dev/null; then
        echo "[wireproxy] Process died — restarting"
        WP_PID=""
        start || true
    fi
done
