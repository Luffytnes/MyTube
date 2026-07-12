<div align="center">

<img src="assets/logo2.png" alt="MyTube" />

**A privacy-focused YouTube + IPTV frontend — no tracking, no ads, no Google.**

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## What is MyTube?

MyTube is a **self-hosted YouTube + IPTV frontend** that lets you browse, search, and watch YouTube videos without Google ever knowing you're there. All requests are proxied through your own server — your browser never contacts Google directly.

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
- **Liked videos** — like any video, stored locally, accessible at `/likes`
- **Resume playback** — pick up where you left off
- **"Continue watching"** section on the home page with progress bar

### ▶️ Player
- **Previous / Next buttons** in the player controls
- **Autoplay** — automatically plays the next related video with a 5-second countdown
- **Loop** — repeat the current video
- **Video chapters** — timestamps parsed from the description, shown as markers on the progress bar with the current chapter name displayed
- **Subtitles / CC** — manual and auto-generated tracks loaded on demand, proxied through your server
- **Picture-in-picture** support via browser native API

### 📱 Shorts
- Dedicated **Shorts section** at `/shorts` — vertical video feed with TikTok-style navigation
- **Category filters** — All, Entertainment, Gaming, Music, Food, Sports
- **Swipe** (mobile) or **↑ / ↓ arrow keys** (desktop) to navigate between Shorts
- Sound off by default (browser autoplay policy) — click the mute button to enable audio
- **Prefetch** — next Short is loaded in the background for instant transition

### 🔴 Live Streams
- Dedicated **Live section** at `/live` — YouTube live streams by category
- **Category filters** — All, News, Music, Gaming, Sports
- Live streams open in the standard player with HLS playback

### 👶 MyTube Kids
- Dedicated **Kids section** at `/kids` — safe content filtered by category
- **Category filters** — All, Cartoons, Education, Music, Stories, Science
- Same privacy guarantees as the rest of MyTube

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
- Channel **Shorts** and **Live** tabs
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
- Full **search** with filters (songs, albums, artists, playlists, podcasts, **radio**)
- Inline **audio player** with queue, shuffle, repeat
- **Full-screen player** — blurred album art background, queue panel, next track preview
- **Podcasts** — browse & play episodes, personalised by language and search history
- Follow/unfollow podcasts — stored locally in **My Podcasts**
- Personalised suggestions on the home page (tracks, albums, artists, podcasts, radio)

### 📻 Radio
- Dedicated **Radio page** (`/music/radio`) — live stations filtered by your country
- **Genre filter** — Pop, Rock, Jazz, Classical, Electronic, Hip-Hop, News, Sport, Country, Soul, Metal
- **Search** for any station worldwide by name in the music search page
- **Radio suggestions** on the Music home page based on your region
- Stations stream through your server (no direct connection to third-party CDNs)
- Powered by the [Radio Browser API](https://www.radio-browser.info/) — free, no key required

### 📡 MyTube TV (IPTV)

- Dedicated **TV section** at `/tv` — separate from YouTube, its own sidebar and layout
- **Live channels** — browse by category, watch with HLS via hls.js
- **Films (VOD)** — browse by category, click any jacket to reach the film detail page (TMDB poster, synopsis, cast, rating) before playing
- **Series** — season/episode navigation, play any episode directly
- **Real-time transcoding** — ffmpeg re-encodes on the fly to H.264 fMP4, so MKV/HEVC/AC3 content plays natively in every browser
  - VideoToolbox hardware encoder (macOS) with libx264 software fallback
  - Audio downmixed to stereo AAC — avoids Apple AudioToolbox multi-channel rejection in Firefox/Safari
  - Reconnecting HTTP downloader — transparently resumes with `Range: bytes=N-` when the provider closes the connection
- **VOD seeking** — 4-strategy cascade: direct HTTP Range seek, byte-offset pipe (MP4 only), full-pipe fallback, VideoToolbox fallback
- **Search** — unified search across live channels, films, and series
- **Favorites** — star any channel, film, or series; pinned in the sidebar and on the Favorites page
- **Continue watching** — position saved immediately on exit; "Continuer · Xmin (X%)" button with progress bar
- **Audio track selection** — switch between all audio tracks in a multi-audio file
- **Subtitle support** — load embedded subtitle tracks from the source file
- **Provider configuration** — enter Xtream Codes server URL, username, and password in Settings

#### 🎬 TMDB integration

- Enter your [TMDB](https://www.themoviedb.org/) API key in **Settings → MyTube TV** — key is persisted across restarts
- **TV home page** shows four discovery rows: popular films, popular series, top-rated films, top-rated series — powered by TMDB, works in any language
- Clicking a card opens a detail modal (backdrop, poster, synopsis, rating, year); the **Watch / See episodes** button is active if the title is found in your catalog
- **Smart jacket images** — each card first tries the IPTV provider icon, then falls back to the TMDB poster automatically
- **Title cleaning** follows the Jellyfin/Plex convention: strip language prefixes (`FR |`, `VF |`…) and quality tags (`[1080p]`, `[MULTI]`…), extract year
- **Catalog matching** uses `difflib.SequenceMatcher` (≥ 60 % similarity threshold) — prevents false positives on short titles
- **Fully translated** in all 9 languages

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
- **Data tab** — export all local data as JSON (including Music playlists, search history, podcast subscriptions), import a backup, or clear individual sections
- **WireGuard VPN** — route all backend traffic through a personal VPN (e.g. ProtonVPN), no system impact

### ⌨️ Keyboard Shortcuts

#### Video Player
| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `←` `→` | Seek ±5 seconds |
| `↑` `↓` | Volume ±10% |

#### Shorts
| Key | Action |
|-----|--------|
| `↑` | Previous Short |
| `↓` | Next Short |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| YouTube data | youtubei.js (InnerTube API) — channel info, Shorts, Live, Kids |
| Backend | Python, FastAPI, yt-dlp, httpx |
| HLS streaming | hls.js — YouTube video player + IPTV live channels |
| IPTV VOD player | Shaka Player — MSE-based adaptive streaming |
| Music & Podcasts | ytmusicapi, Podcast Index API |
| Radio | Radio Browser API (free, no key required) |
| IPTV transcoding | ffmpeg (VideoToolbox / libx264) |
| VPN tunnel | wireproxy (WireGuard userspace) |
| Icons | Lucide React |

---

## 🚀 Quick Start

Two installation methods: **local** (development) or **Docker** (recommended for home server / LAN access).

---

### 🐳 Docker (recommended)

The Docker setup runs MyTube on your local network — accessible from any device at `http://192.168.1.X:54321`.

#### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/install/)

#### Install & run

```bash
git clone https://github.com/Luffytnes/MyTube.git
cd MyTube

# 1. Create login credentials (required — nginx protects the entire interface)
chmod +x setup-auth.sh
./setup-auth.sh          # prompts for username + password

# 2. Start the stack
docker compose up --build -d
```

The first build takes a few minutes (downloads ffmpeg, yt-dlp, wireproxy, builds Next.js).

Once started, open **http://\<your-local-ip\>:54321** from any device on your network — phone, tablet, TV, etc.

> **Find your local IP:** `ip route get 1` (Linux) or `ipconfig getifaddr en0` (macOS)

> **WireGuard VPN** — wireproxy runs as a dedicated container, no manual installation needed. Upload your `.conf` directly from Settings → WireGuard.

#### Useful commands

```bash
# Stop
docker compose down

# View logs
docker compose logs -f

# Update (after a git pull)
docker compose up --build -d

# Check stack health
curl -u <user>:<pass> http://localhost:54321/api/health
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

MyTube can route all its backend traffic (API calls to YouTube/Google) through a personal WireGuard VPN such as **ProtonVPN**, without affecting the rest of your system. This is done via **[wireproxy](https://github.com/pufferffish/wireproxy)** — a fully userspace WireGuard implementation (no TUN interface, no root access required).

### Docker mode — no installation needed

wireproxy runs as a dedicated container. Simply upload your `.conf` from the UI:

1. Open **Settings → WireGuard**
2. Click **Import .conf file** → select your ProtonVPN `.conf`
3. Click **Connect** — status turns green

That's it. No host changes, no system impact.

### Local mode — install wireproxy manually

**macOS (Apple Silicon)**
```bash
curl -L https://github.com/pufferffish/wireproxy/releases/download/v1.1.2/wireproxy_darwin_arm64.tar.gz | tar -xz -C /tmp
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy
```

**macOS (Intel)**
```bash
curl -L https://github.com/pufferffish/wireproxy/releases/download/v1.1.2/wireproxy_darwin_amd64.tar.gz | tar -xz -C /tmp
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy
```

**Linux (amd64)**
```bash
curl -L https://github.com/pufferffish/wireproxy/releases/download/v1.1.2/wireproxy_linux_amd64.tar.gz | tar -xz -C /tmp
sudo mv /tmp/wireproxy /usr/local/bin/wireproxy
```

Then import your `.conf` from **Settings → WireGuard** exactly as above.

### Get a WireGuard config from ProtonVPN

1. Log in to [protonvpn.com](https://protonvpn.com) → Downloads → WireGuard
2. Platform: **GNU/Linux** — choose a server and download the `.conf`

### Verify it works

```bash
# Check current IP as seen by external servers (routes through VPN if active)
curl -u <user>:<pass> http://localhost:54321/api/vpn/myip
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
| Search & trending | YouTube InnerTube API via your server |
| Shorts / Live / Kids | YouTube InnerTube API via your server |
| Music & Podcasts | ytmusicapi via your server |
| Podcast artwork | Proxied through your server |
| Radio streams & favicons | Proxied through your server |
| Channel avatars & banners | Fetched server-side |
| Watch history | `localStorage` only — never leaves your browser |
| Subscriptions | `localStorage` only — never leaves your browser |
| Likes / Queue / Playlists | `localStorage` only — never leaves your browser |
| IPTV streams & icons | Transcoded / proxied through your server |
| IPTV credentials | Stored server-side only, never sent to the browser |
| VPN (optional) | wireproxy — userspace WireGuard, no system impact |
| Analytics | ❌ None |

---

## 📡 API Reference

### YouTube

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

### Music & Radio

| Endpoint | Description |
|----------|-------------|
| `GET /api/music/search?q=...&lang=fr` | Music search |
| `GET /api/podcasts/search?q=...` | Podcast search |
| `GET /api/podcasts/{id}` | Podcast detail + episodes |
| `GET /api/podcasts/image/proxy?url=...` | Proxy podcast/radio artwork |
| `GET /api/radio/stations?country=FR&tag=pop` | Radio stations by country/genre |
| `GET /api/radio/stream/proxy?url=...` | Proxy radio stream |

### News

| Endpoint | Description |
|----------|-------------|
| `GET /api/news?region=FR&category=technology` | News articles (Google News RSS) |

### IPTV / TV

| Endpoint | Description |
|----------|-------------|
| `GET /api/iptv/channels?category_id=1` | Live IPTV channels |
| `GET /api/iptv/stream/{id}` | Live channel stream (HLS proxy) |
| `GET /api/iptv/vod?category_id=1` | VOD film list |
| `GET /api/iptv/vod_stream/{id}?ext=mkv&media=movie` | VOD stream URL + duration via ffprobe |
| `GET /api/iptv/vod_proxy/{id}?ext=mkv` | Real-time ffmpeg transcode → fMP4 stream |
| `GET /api/iptv/vod_tracks/{id}` | Audio & subtitle track list |
| `GET /api/iptv/series` | Series list |
| `GET /api/iptv/series_info/{id}` | Series info + episode list |
| `GET /api/iptv/search?q=...&type=vod` | Search live / VOD / series |
| `GET /api/iptv/search_catalog?q=...&type=movie\|tv` | Catalog search with similarity matching |
| `GET /api/iptv/icon?url=...` | Channel/content icon proxy |
| `POST /api/iptv/config` | Save Xtream Codes credentials |

### TMDB

| Endpoint | Description |
|----------|-------------|
| `GET /api/tmdb/discover?type=movie\|tv&list=popular\|top_rated` | Discovery lists (30 min cache) |
| `GET /api/tmdb/details?name=...&type=movie\|tv` | Metadata + credits by title |
| `GET /api/tmdb/poster?name=...&type=movie\|tv` | Poster image by title (proxied) |
| `GET /api/tmdb/image?path=/w500/xyz.jpg` | Image proxy by path |
| `GET /api/tmdb/key` | Read TMDB API key |
| `POST /api/tmdb/key` | Save TMDB API key |

### VPN

| Endpoint | Description |
|----------|-------------|
| `GET /api/vpn/status` | VPN status + active config name |
| `GET /api/vpn/configs` | List saved `.conf` files |
| `POST /api/vpn/upload` | Upload a WireGuard `.conf` |
| `POST /api/vpn/select` | Switch active config (VPN must be stopped) |
| `DELETE /api/vpn/configs/{name}` | Delete a saved config |
| `POST /api/vpn/start` | Start VPN tunnel |
| `POST /api/vpn/stop` | Stop VPN tunnel |
| `POST /api/vpn/auto` | Enable / disable auto-failover between configs |
| `POST /api/vpn/reset_failover` | Reset failover state (retry all configs) |
| `GET /api/vpn/myip` | Public IP as seen by external servers |

### Health

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Stack status — ffmpeg, VPN, cache, uptime |

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
