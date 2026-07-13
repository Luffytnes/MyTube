FROM python:3.11-slim

# System dependencies: ffmpeg, curl (for yt-dlp), wget (for wireproxy)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    wget \
    ca-certificates \
    proxychains4 \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp (pinned via requirements.txt — installed below)
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
    CMD curl -f http://localhost:8000/api/trending?region=US&lang=en || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
