#!/bin/bash
# Generate nginx/.htpasswd for MyTube basic authentication.
# Run this once before the first `docker compose up`.

set -e

HTPASSWD="$(cd "$(dirname "$0")" && pwd)/nginx/.htpasswd"

command -v openssl >/dev/null 2>&1 || { echo "Error: openssl is required"; exit 1; }

echo "MyTube — authentication setup"
echo ""

read -rp "Username [mytube]: " USERNAME
USERNAME="${USERNAME:-mytube}"

while true; do
    read -rsp "Password: " PASSWORD
    echo ""
    read -rsp "Confirm password: " PASSWORD2
    echo ""
    [ "$PASSWORD" = "$PASSWORD2" ] && break
    echo "Passwords do not match, try again."
done

mkdir -p "$(dirname "$HTPASSWD")"
HASH=$(openssl passwd -apr1 "$PASSWORD")
printf '%s:%s\n' "$USERNAME" "$HASH" > "$HTPASSWD"
chmod 600 "$HTPASSWD"

echo ""
echo "Created $HTPASSWD"
echo "You can now run: docker compose up -d"
