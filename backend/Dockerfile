FROM python:3.11-slim

# System dependencies: curl (healthcheck), wget + xz (downloads below)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    xz-utils \
    ca-certificates \
    proxychains4 \
    && rm -rf /var/lib/apt/lists/*

# FFmpeg 9.0 (BtbN shared build) instead of Debian's 7.1: the HTTP
# -request_size option (FFmpeg 8.1+) is what keeps googlevideo from throttling
# long reads. A dynamically linked build is required so proxychains (LD_PRELOAD)
# can route it through the VPN — static binaries would bypass it.
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
        amd64) FF_ARCH="linux64" ;; \
        arm64) FF_ARCH="linuxarm64" ;; \
        *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
    && wget -qO /tmp/ffmpeg.tar.xz \
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-${FF_ARCH}-gpl-shared-9.0.tar.xz" \
    && mkdir -p /opt/ffmpeg \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
    && ln -s /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg \
    && ln -s /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg.tar.xz /opt/ffmpeg/doc /opt/ffmpeg/include /opt/ffmpeg/lib/pkgconfig \
    && ffmpeg -hide_banner -h protocol=http | grep -q -- "-request_size"

# yt-dlp (pinned via requirements.txt — installed below, with Deno and the EJS
# challenge solver: without them YouTube throttles stream URLs and hides formats)
# wireproxy (WireGuard userspace)
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
        amd64) WP_ARCH="linux_amd64" ;; \
        arm64) WP_ARCH="linux_arm64" ;; \
        *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
    && wget -qO /tmp/wireproxy.tar.gz \
        "https://github.com/pufferffish/wireproxy/releases/latest/download/wireproxy_${WP_ARCH}.tar.gz" \
    && tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin wireproxy \
    && chmod +x /usr/local/bin/wireproxy \
    && rm /tmp/wireproxy.tar.gz

# Non-root user
RUN useradd --create-home --shell /bin/bash mytube

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=mytube:mytube . .

# Data directory writable by non-root user
RUN mkdir -p /home/mytube/.mytube && chown mytube:mytube /home/mytube/.mytube

USER mytube

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
