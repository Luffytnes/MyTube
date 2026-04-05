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
- **Search** with pagination
- Custom **HTML5 player** — no YouTube iframe, ever
- **Quality selector** — choose your resolution
- **Download** in multiple formats (video+audio, video only, audio only)
- **Watch Later** and **History** stored locally

### 🎵 MyTube Music
- Dedicated music section powered by YouTube Music
- Browse trending **albums, artists, playlists**
- Full **search** with filters (songs, albums, artists, playlists)
- Inline **audio player** with queue

### 📡 Channels
- Full channel pages with **banner, avatar, subscriber count**
- Channel video list with **pagination**
- **Subscribe** to channels — stored locally, no account needed

### 🌍 Multilingual
- **9 languages**: 🇬🇧 English · 🇫🇷 French · 🇪🇸 Spanish · 🇩🇪 German · 🇧🇷 Portuguese · 🇮🇹 Italian · 🇯🇵 Japanese · 🇰🇷 Korean · 🇷🇺 Russian
- **Region selector** for country-specific trending content

### ⌨️ Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `←` `→` | Seek ±5 seconds |
| `↑` `↓` | Volume |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Python, FastAPI, yt-dlp, httpx |
| Music | ytmusicapi |
| Icons | Lucide React |
| Data | YouTube internal API + Invidious fallback + yt-dlp fallback |

---

## 🚀 Quick Start

### Prerequisites
- **Python** 3.9+
- **Node.js** 18+
- **npm**

### One command

```bash
git clone https://github.com/Luffytnes/MyTube.git
cd MyTube
chmod +x start.sh
./start.sh
```

Open **http://localhost:3000** 🎉

---

### Manual setup

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
| Search & trending | YouTube internal API via your server |
| Channel avatars & banners | Fetched server-side |
| Watch history | `localStorage` only — never leaves your browser |
| Subscriptions | `localStorage` only — never leaves your browser |
| Analytics | ❌ None |

---

## 📡 API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/trending?region=FR&category=all` | Trending videos |
| `GET /api/search?q=...&page=1` | Search videos |
| `GET /api/video/{id}` | Video metadata + formats |
| `GET /api/stream/{id}?itag=...` | Proxy video stream |
| `GET /api/stream/{id}/audio` | Proxy audio-only stream |
| `GET /api/download/{id}?itag=...` | Download video |
| `GET /api/channel/{id}` | Channel info |
| `GET /api/channel/{id}/videos` | Channel videos |
| `GET /api/channel_thumbnail/{id}` | Channel avatar |
| `GET /api/channel_banner/{id}` | Channel banner |

Interactive docs → **http://localhost:8000/docs**

---

## ⚠️ Notes

- Age-restricted content requires YouTube authentication (not supported)
- Bot detection by YouTube may occasionally limit quality — a VPN helps
- Your server's IP is used for requests to YouTube

---

## 📄 License

MIT — do whatever you want with it.

---

<div align="center">
Made with ☕ &nbsp;—&nbsp; <a href="https://github.com/Luffytnes/MyTube">github.com/Luffytnes/MyTube</a>
</div>
