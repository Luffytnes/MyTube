FROM alpine:3.21

RUN apk add --no-cache wget ca-certificates

RUN ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64)  WP_ARCH="linux_amd64" ;; \
        aarch64) WP_ARCH="linux_arm64" ;; \
        *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
    && wget -qO /tmp/wireproxy.tar.gz \
        "https://github.com/pufferffish/wireproxy/releases/latest/download/wireproxy_${WP_ARCH}.tar.gz" \
    && tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin wireproxy \
    && chmod +x /usr/local/bin/wireproxy \
    && rm /tmp/wireproxy.tar.gz

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 25344

ENTRYPOINT ["/entrypoint.sh"]
