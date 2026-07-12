ARG WIREPROXY_VERSION=1.1.2

# ── Stage 1: Download and verify ─────────────────────────────────────────────
FROM alpine:3.21 AS downloader

ARG WIREPROXY_VERSION
RUN apk add --no-cache wget ca-certificates

RUN set -eu \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64)  WP_ARCH="linux_amd64"  ;; \
        aarch64) WP_ARCH="linux_arm64"  ;; \
        *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
    && BASE="https://github.com/pufferffish/wireproxy/releases/download/v${WIREPROXY_VERSION}" \
    && wget -qO /tmp/wireproxy.tar.gz  "${BASE}/wireproxy_${WP_ARCH}.tar.gz" \
    && wget -qO /tmp/checksums.txt     "${BASE}/checksums.txt" \
    && grep "wireproxy_${WP_ARCH}.tar.gz" /tmp/checksums.txt | sha256sum -c - \
    && tar -xzf /tmp/wireproxy.tar.gz -C /tmp wireproxy \
    && chmod +x /tmp/wireproxy

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.21

RUN adduser -D -H -s /sbin/nologin wireproxy

COPY --from=downloader /tmp/wireproxy /usr/local/bin/wireproxy
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 25344

USER wireproxy
ENTRYPOINT ["/entrypoint.sh"]
