# MyTube — Architecture

## Vue d'ensemble

MyTube est un frontend YouTube auto-hébergé et respectueux de la vie privée. Il se compose de trois services Docker orchestrés par `docker-compose.yml`.

```
Browser
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│  nginx:alpine  — port 54321                                  │
│  nginx/nginx.conf                                            │
│  auth_basic (htpasswd) — toutes les routes protégées         │
└─────────────┬────────────────────────┬───────────────────────┘
              │ /api/*                 │ /*
              ▼                        ▼
┌─────────────────────┐   ┌──────────────────────────┐
│  backend:8000        │   │  frontend:3000            │
│  FastAPI + yt-dlp   │   │  Next.js 14 (standalone)  │
│  Python 3.11        │   │  App Router + TypeScript   │
└─────────────────────┘   └──────────────────────────┘
              │
     wireproxy (WireGuard userspace)
     SOCKS5 proxy optionnel — chargé à la demande
```

---

## Services Docker

| Service    | Image / Build    | Port interne | Port exposé |
|------------|-----------------|-------------|-------------|
| `backend`  | `./backend`     | 8000        | non exposé  |
| `frontend` | `./frontend`    | 3000        | non exposé  |
| `nginx`    | `nginx:alpine`  | 80          | **54321**   |

Seul nginx est exposé à l'extérieur. Backend et frontend ne sont accessibles qu'au sein du réseau Docker interne.

---

## Backend — FastAPI (`backend/`)

### Structure

```
backend/
├── main.py              # Entrypoint : assemble les routers, lance les tâches de fond
├── core/
│   ├── config.py        # Constantes, chemins, chargement des configs (Xtream, VPN…)
│   ├── cache.py         # Caches TTL en mémoire (trending, thumbnails, streams, live)
│   └── security.py      # Protection SSRF : validate_proxy_url(), ssrf_redirect_hook()
├── api/                 # Routers FastAPI par domaine fonctionnel
│   ├── health.py        # GET /api/health
│   ├── youtube.py       # YouTube : trending, search, vidéo, HLS, DASH, live, shorts…
│   ├── music.py         # YouTube Music + radio (RadioBrowser)
│   ├── iptv.py          # IPTV Xtream Codes : live, VOD, séries, proxy HLS/TS
│   ├── news.py          # Flux RSS actualités
│   ├── podcasts.py      # Podcast Index : recherche, épisodes, proxy audio
│   ├── tmdb.py          # Films/séries via TMDB API
│   └── vpn.py           # Gestion wireproxy (WireGuard) : start/stop/status/failover
├── services/
│   ├── innertube.py     # Client YouTube InnerTube, httpx_client(), extract_video_card()
│   ├── ffmpeg.py        # Transcodage VOD, téléchargement en cache, pipe streaming
│   ├── vpn.py           # État wireproxy, watchdog, failover automatique
│   └── tmdb.py          # Helpers TMDB
└── tests/
    ├── test_security.py # 32 tests SSRF
    ├── test_cache.py    # 15 tests caches TTL
    └── test_health.py   # 8 tests /api/health
```

### Flux de données — vidéo YouTube

```
GET /api/video/{id}
  └─► yt-dlp extract_info()  ─► formats + métadonnées
  └─► retourne JSON {streams, related, subtitles…}

GET /api/hls/{id}/{itag}/stream.m3u8
  └─► yt-dlp → URL directe CDN YouTube
  └─► génère manifest HLS  →  segments via /api/hls/{id}/segment/

GET /api/thumbnail/{id}
  └─► httpx → i.ytimg.com  →  cache en mémoire (1h)
```

### Caches en mémoire

| Cache               | TTL     | Clé                        |
|--------------------|---------|----------------------------|
| Trending / search   | 5 min   | string arbitraire          |
| Thumbnails vidéo    | 1 h     | `video_id`                 |
| Channel thumbnails  | 1 h     | `channel_id`               |
| Live HLS URL        | 3 min   | `video_id`                 |
| Stream URL directe  | 3 h     | `stream:{video_id}:{itag}` |

### Protection SSRF

Toutes les URLs fournies par l'utilisateur passent par `validate_proxy_url()` avant tout fetch :
- Schéme autorisé (http/https uniquement)
- IP littérale privée rejetée (`is_private`, `is_loopback`, `is_link_local`…)
- DNS fail-closed : résolution échouée = HTTP 400
- `ssrf_redirect_hook` (async) : valide chaque `Location` de redirection HTTP

### VPN / WireGuard

`wireproxy` (WireGuard userspace) tourne dans le même container backend. Il expose un proxy SOCKS5 local sur le port 25344. Quand actif, `httpx_client()` et `yt-dlp` routent leurs requêtes via ce proxy. Un watchdog redémarre wireproxy en cas d'idle prolongé (5 min sans requête). En mode failover automatique, le backend essaie les `.conf` disponibles jusqu'à trouver un tunnel fonctionnel.

Configurations stockées dans `~/.mytube/wg/`.

---

## Frontend — Next.js 14 (`frontend/`)

### Structure

```
frontend/
├── app/
│   ├── page.tsx            # Accueil : tendances
│   ├── search/             # Recherche YouTube
│   ├── watch/[id]/         # Lecteur vidéo
│   ├── shorts/             # Shorts
│   ├── channel/[id]/       # Page chaîne
│   ├── playlist/[id]/      # Playlist
│   ├── hashtag/[tag]/      # Hashtag
│   ├── music/              # YouTube Music
│   ├── tv/                 # IPTV + TMDB
│   ├── iptv/               # IPTV Xtream
│   └── api/yt/             # Route handlers Next.js (proxy vers backend)
├── components/
│   └── video/VideoPlayer.tsx  # HLS.js / Shaka Player, A/V sync
└── lib/
    ├── api.ts              # Client fetch vers /api/*
    └── innertube.ts        # Client YouTube.js côté serveur
```

### Routage API

Le frontend n'appelle jamais YouTube directement. Toutes les requêtes passent soit par :
- les **Route Handlers** Next.js (`app/api/yt/…`) qui utilisent `youtubei.js` côté serveur
- le **backend FastAPI** (`/api/…`) via `NEXT_PUBLIC_API_URL` (relatif en production, nginx proxifie)

---

## Données persistantes (`~/.mytube/`)

```
~/.mytube/
├── wg/          # Fichiers de configuration WireGuard (.conf)
├── xtream.json  # Credentials IPTV Xtream Codes
└── vpn_state.json  # Dernier profil VPN actif (restauré au démarrage)
```

En Docker, ce répertoire est monté via le volume `mytube-data` sur `/home/mytube/.mytube`.

---

## CI / GitHub Actions (`.github/workflows/ci.yml`)

| Job        | Étapes                                                      |
|------------|-------------------------------------------------------------|
| `backend`  | pip-audit · ruff lint · import check · pytest (55 tests)   |
| `frontend` | npm audit · tsc --noEmit · next lint · next build           |
| `docker`   | docker compose config · build backend · build frontend      |

---

## Démarrage

**Développement (sans Docker) :**
```bash
./start.sh
```

**Production (Docker) :**
```bash
./setup-auth.sh        # une seule fois — génère nginx/.htpasswd
docker compose up -d
# http://localhost:54321
```
