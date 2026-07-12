#!/bin/bash
# Restaure ~/.mytube depuis une archive de sauvegarde.
# Usage: ./restore.sh [archive.tar.gz]
# Sans argument, propose la sauvegarde la plus récente.

set -e

MYTUBE_DIR="${MYTUBE_DATA:-$HOME/.mytube}"
BACKUP_DIR="${BACKUP_DEST:-$HOME/mytube-backups}"

# Resolve archive to restore
if [ -n "$1" ]; then
    ARCHIVE="$1"
else
    ARCHIVE=$(find "$BACKUP_DIR" -maxdepth 1 -name 'mytube_*.tar.gz' 2>/dev/null | sort -r | head -1)
    if [ -z "$ARCHIVE" ]; then
        echo "Error: no backup found in $BACKUP_DIR" >&2
        exit 1
    fi
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "Error: archive not found: $ARCHIVE" >&2
    exit 1
fi

echo "Archive : $ARCHIVE"
echo "Target  : $MYTUBE_DIR"
echo ""
read -rp "Restore? This will overwrite $MYTUBE_DIR. [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
fi

# Backup current state before overwriting
if [ -d "$MYTUBE_DIR" ]; then
    PRE="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).tar.gz"
    mkdir -p "$BACKUP_DIR"
    tar -czf "$PRE" -C "$(dirname "$MYTUBE_DIR")" "$(basename "$MYTUBE_DIR")" 2>/dev/null || true
    echo "Current state saved to: $PRE"
    rm -rf "$MYTUBE_DIR"
fi

mkdir -p "$(dirname "$MYTUBE_DIR")"
tar -xzf "$ARCHIVE" -C "$(dirname "$MYTUBE_DIR")"
echo "Restored to $MYTUBE_DIR"
echo "Restart MyTube to apply: ./start.sh  (or docker compose restart backend)"
