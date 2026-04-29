FROM python:3.11-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    wget \
    ca-certificates \
    unzip \
    proxychains4 \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp (latest)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

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

# Deno (JS runtime for yt-dlp)
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
