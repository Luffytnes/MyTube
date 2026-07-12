#!/bin/bash
# Generate nginx/.htpasswd for MyTube basic authentication.
# Run this once before the first `docker compose up`.
# Uses bcrypt (htpasswd -B) when apache2-utils is installed, APR1-MD5 otherwise.

set -e

HTPASSWD="$(cd "$(dirname "$0")" && pwd)/nginx/.htpasswd"

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

if command -v htpasswd >/dev/null 2>&1; then
    # bcrypt via apache2-utils / httpd — strongest option
    HASH=$(htpasswd -bnB "$USERNAME" "$PASSWORD" | cut -d: -f2)
    ALGO="bcrypt"
else
    # Fallback: APR1-MD5 (nginx-compatible, no extra dependency)
    # Install apache2-utils (Debian/Ubuntu) or httpd-tools (RHEL/Fedora) for bcrypt.
    HASH=$(openssl passwd -apr1 "$PASSWORD")
    ALGO="APR1-MD5 (install apache2-utils for bcrypt)"
fi

printf '%s:%s\n' "$USERNAME" "$HASH" > "$HTPASSWD"
chmod 600 "$HTPASSWD"

echo ""
echo "Created $HTPASSWD (algorithm: $ALGO)"
echo "You can now run: docker compose up -d"
