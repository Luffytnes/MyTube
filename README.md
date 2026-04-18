<div align="center">

<img src="assets/logo2.png" alt="MyTube" />

**A privacy-focused YouTube frontend — no tracking, no ads, no Google.**

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## What is MyTube?

MyTube is a **self-hosted YouTube frontend** that lets you browse, search, and watch YouTube videos without Google ever knowing you're there. All requests are proxied through your own server — your browser never contacts Google directly.

> **Why?** Because your viewing habits are yours. No recommendation algorithm, no targeted ads, no watch history sent to Google.

---

## ✨ Features

### 📺 Video
- Browse **trending videos** by country and category
- **Search** with filters — Videos, Channels, Playlists
- Custom **HTML5 player** — no YouTube iframe, ever
- **Quality selector** — choose your resolution
- **Speed selector** — 0.25× to 2×
- **Download** in multiple formats (video+audio, video only, audio only)
- **Watch Later** and **History** stored locally
- **Resume playback** — pick up where you left off
- **"Continue watching"** section on the home page with progress bar

### ▶️ Player
- **Previous / Next buttons** in the player controls
- **Autoplay** — automatically plays the next related video with a 5-second countdown
- **Loop** — repeat the current video
- **Video chapters** — timestamps parsed from the description, shown as markers on the progress bar with the current chapter name displayed
- **Subtitles / CC** — manual and auto-generated tracks loaded on demand, proxied through your server
- **Picture-in-picture** support via browser native API

### 📋 Queue
- **Add any video to the queue** — button on every video card (hover) and on the watch page action bar
- Dedicated **Queue page** (`/queue`) — reorder, remove, play all
- Queue-aware navigation: Prev/Next buttons and autoplay follow the queue order

### 🎬 Playlists
- **Save YouTube playlists** locally — no account needed
- **Play a full playlist** via `?list=` — sidebar panel shows all videos, current one highlighted
- Prev/Next and autoplay navigate within the playlist
- Saved playlists page at `/playlists`

### 🔍 Search
- Results split into **Channels**, **Playlists**, and **Videos** sections
- Channel cards with round avatar and one-click subscribe
- Playlist cards with YouTube-style video-count stripe
- Filter pills with result counts

### 📡 Channels
- Full channel pages with **banner, avatar, subscriber count**
- Channel video list with **pagination**
- **Subscribe** to channels — stored locally, no account needed
- Subscriptions appear in the sidebar with avatar

### 🏠 Home
- Personalised feed based on **search history** and **subscribed channels**
- **"Continue watching"** strip for partially watched videos

### 📰 News
- Dedicated **News section** powered by Google News RSS — no tracking, proxied through your server
- **Country selector** — switch between any country independently of your global settings
- **10 categories** — General, Tech, Business, Entertainment, Sports, Science, Health, World, Nation, Politics
- Articles show **source**, **relative time**, and a short **description**
- Each article opens directly on the **original media site** (not Google)
- 15-minute server-side cache — routes through **WireGuard VPN** if active
- Fully translated in all **9 languages**

### 🎵 MyTube Music
- Dedicated music section powered by YouTube Music
- Browse trending **albums, artists, playlists**
- Full **search** with filters (songs, albums, artists, playlists, podcasts)
- Inline **audio player** with queue
- **Podcasts** — browse & play episodes, personalised by language and search history
- Follow/unfollow podcasts — stored locally in **My Podcasts**

### 🌍 Multilingual
- **9 languages**: 🇬🇧 English · 🇫🇷 French · 🇪🇸 Spanish · 🇩🇪 German · 🇧🇷 Portuguese · 🇮🇹 Italian · 🇯🇵 Japanese · 🇰🇷 Korean · 🇷🇺 Russian
- **Region selector** for country-specific trending content

### ⚙️ Settings
- **Theme** — Light / Dark / Auto
- **Language & Region** picker
- **Playback** — default quality, speed, volume, loop, autoplay next, resume position, hide watched videos
- **Grid density** — Compact / Normal / Comfortable
- **Default subtitles** — choose a language applied automatically on every video
- **History TTL** — keep watch history for 7, 30, 90 days, or forever
- **Data tab** — export all local data as JSON, import a backup, or clear individual sections (history, search, watch later, likes, queue, resume positions)
- **WireGuard VPN** — route all backend traffic through a personal VPN (e.g. ProtonVPN), no system impact

### ⌨️ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `←` `→` | Seek ±5 seconds |
| `↑` `↓` | Volume ±10% |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Python, FastAPI, yt-dlp, httpx |
| Music & Podcasts | ytmusicapi |
| VPN tunnel | wireproxy (WireGuard userspace) |
| Icons | Lucide React |
| Data | YouTube internal API + yt-dlp fallback |

---

## 🚀 Quick Start

Two installation methods are available: **local** (development) or **Docker** (recommended for home server / LAN access).

---

### 🐳 Docker (recommended)

The Docker setup runs MyTube on your local network — accessible from any device at `http://192.168.1.X` without any configuration.

#### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/install/)

#### Install & run

```bash
git clone https://github.com/Luffytnes/MyTube.git
cd MyTube
docker compose up --build
```

The first build takes a few minutes (downloads ffmpeg, yt-dlp, wireproxy, builds Next.js).

Once started, open **http://\<your-local-ip\>** from any device on your network — phone, tablet, TV, etc.

> **Find your local IP:** `ip route get 1` (Linux) or `ipconfig getifaddr en0` (macOS)

#### Useful commands

```bash
# Run in background
docker compose up --build -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Update (after a git pull)
docker compose up --build -d
```

#### Data persistence

VPN configs, Podcast Index keys and other settings are stored in a Docker volume (`mytube-data`) — they survive restarts and updates.

---

### 💻 Local (development)

#### Prerequisites
- **Python** 3.9+
- **Node.js** 18+
- **npm**

#### One command

```bash
git clone https://github.com/Luffytnes/MyTube.git
cd MyTube
chmod +x start.sh
./start.sh
```

Open **http://localhost:3000** 🎉

#### Manual setup

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

---

## 🔒 VPN WireGuard (optional)

MyTube can route all its backend traffic (API calls to YouTube/Google) through a personal WireGuard VPN such as **ProtonVPN**, without affecting the rest of your system. This is done via **wireproxy** — a userspace WireGuard implementation that exposes a local SOCKS5 proxy. No root access required.

### 1. Install wireproxy

**macOS (Apple Silicon M1/M2/M3)**
```bash
curl -L https://github.com/windtf/wireproxy/releases/download/v1.1.2/wireproxy_darwin_arm64.tar.gz -o /tmp/wireproxy.tar.gz && \
tar -xzf /tmp/wireproxy.tar.gz -C /tmp && \
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy && \
sudo chmod +x /usr/local/bin/wireproxy && \
wireproxy --version
```

**macOS (Intel x86_64)**
```bash
curl -L https://github.com/windtf/wireproxy/releases/download/v1.1.2/wireproxy_darwin_amd64.tar.gz -o /tmp/wireproxy.tar.gz && \
tar -xzf /tmp/wireproxy.tar.gz -C /tmp && \
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy && \
sudo chmod +x /usr/local/bin/wireproxy && \
wireproxy --version
```

**Linux**
```bash
# Replace amd64 with arm64 if needed
curl -L https://github.com/windtf/wireproxy/releases/download/v1.1.2/wireproxy_linux_amd64.tar.gz -o /tmp/wireproxy.tar.gz && \
tar -xzf /tmp/wireproxy.tar.gz -C /tmp && \
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy && \
sudo chmod +x /usr/local/bin/wireproxy
```

### 2. Get a WireGuard config from ProtonVPN

1. Log in to [protonvpn.com](https://protonvpn.com) → Downloads → WireGuard
2. Select platform: **GNU/Linux**
3. Choose a server and download the `.conf` file

### 3. Activate from MyTube Settings

1. Start MyTube (`./start.sh`)
2. Click the **⚙️ Settings** button (top right)
3. Under **Wireproxy** → click **Import .conf file** → select your ProtonVPN file
4. Click **Connect** — status turns green (Connected)

All MyTube traffic to YouTube/Google now goes through ProtonVPN. Your other apps are unaffected.

### Verify it works

```bash
# With VPN connected in MyTube — should show a ProtonVPN IP
curl --socks5 127.0.0.1:25344 https://ipinfo.io

# Without VPN — your real IP
curl https://ipinfo.io
```

---

## ⚙️ Configuration

To use a remote backend, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://your-server:8000
```

---

## 🔒 Privacy

Every request your browser makes goes through **your own backend**, never directly to Google.

| What | How |
|------|-----|
| Video streams | Proxied through your server |
| Thumbnails | Fetched server-side |
| Subtitles / CC | Proxied through your server |
| Search & trending | YouTube internal API via your server |
| Music & Podcasts | ytmusicapi via your server |
| Channel avatars & banners | Fetched server-side |
| Watch history | `localStorage` only — never leaves your browser |
| Subscriptions | `localStorage` only — never leaves your browser |
| Queue / Playlists / Likes | `localStorage` only — never leaves your browser |
| VPN (optional) | wireproxy — userspace WireGuard, no system impact |
| Analytics | ❌ None |

---

## 📡 API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/trending?region=FR&category=all` | Trending videos |
| `GET /api/search?q=...&page=1` | Search videos, channels and playlists |
| `GET /api/video/{id}` | Video metadata + formats |
| `GET /api/stream/{id}?itag=...` | Proxy video stream |
| `GET /api/stream/{id}/audio` | Proxy audio-only stream |
| `GET /api/download/{id}?itag=...` | Download video |
| `GET /api/playlist/{id}` | Playlist metadata + video list |
| `GET /api/subtitles/{id}` | List available subtitle tracks |
| `GET /api/subtitles/{id}/{lang}` | Proxy subtitle VTT file |
| `GET /api/channel/{id}` | Channel info |
| `GET /api/channel/{id}/videos` | Channel videos |
| `GET /api/channel_thumbnail/{id}` | Channel avatar |
| `GET /api/channel_banner/{id}` | Channel banner |
| `GET /api/music/search?q=...&lang=fr` | Music search |
| `GET /api/music/podcasts/search?q=...&lang=fr` | Podcast search |
| `GET /api/music/podcast/{id}?lang=fr` | Podcast detail + episodes |
| `GET /api/news?region=FR&category=technology` | News articles (Google News RSS) |
| `GET /api/vpn/status` | VPN status |
| `POST /api/vpn/upload` | Upload WireGuard .conf |
| `POST /api/vpn/start` | Start VPN tunnel |
| `POST /api/vpn/stop` | Stop VPN tunnel |

Interactive docs → **http://localhost:8000/docs**

---

## ⚠️ Notes

- Age-restricted content requires YouTube authentication (not supported)
- Bot detection by YouTube may occasionally limit quality — the built-in VPN feature helps
- Your server's IP is used for requests to YouTube (or your VPN's IP if enabled)

---

## 📄 License

MIT — do whatever you want with it.

---

<div align="center">
Made with ☕ &nbsp;—&nbsp; <a href="https://github.com/Luffytnes/MyTube">github.com/Luffytnes/MyTube</a>
</div>
