#!/bin/bash
# Sauvegarde ~/.mytube (configs WireGuard, IPTV, état VPN) dans une archive horodatée.

set -e

MYTUBE_DIR="${MYTUBE_DATA:-$HOME/.mytube}"
BACKUP_DIR="${BACKUP_DEST:-$HOME/mytube-backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE="$BACKUP_DIR/mytube_$TIMESTAMP.tar.gz"

if [ ! -d "$MYTUBE_DIR" ]; then
    echo "Error: $MYTUBE_DIR not found — nothing to backup." >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
tar -czf "$ARCHIVE" -C "$(dirname "$MYTUBE_DIR")" "$(basename "$MYTUBE_DIR")"

SIZE=$(du -sh "$ARCHIVE" | cut -f1)
echo "Backup created: $ARCHIVE ($SIZE)"

# Keep only the 10 most recent backups
ls -t "$BACKUP_DIR"/mytube_*.tar.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
REMAINING=$(ls "$BACKUP_DIR"/mytube_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
echo "Backups kept: $REMAINING"
