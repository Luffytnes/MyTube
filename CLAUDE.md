# MyTube — Claude Code

## Projet

Lecteur multimédia auto-hébergé : YouTube (via yt-dlp + ffmpeg HLS), IPTV/Xtream, radio.
Stack : FastAPI (Python 3.11) + Next.js 14 (TypeScript) + nginx + WireProxy (WireGuard userspace).
Déployé via Docker Compose.

## Structure

```
backend/          FastAPI — api/, core/, services/, tests/
frontend/         Next.js — app/, components/, lib/
wireproxy/        Image Docker Alpine (WireGuard userspace)
nginx/            Reverse proxy + auth HTTP Basic
```

## Conventions backend

- Python 3.11, FastAPI, httpx[socks], yt-dlp, uvicorn
- Linting : `ruff check backend/ --select E,F,W --ignore E501,E701`
- Tests : `pytest tests/ -v` depuis `backend/`
- Pas de commentaires évidents ; un commentaire = un WHY non-évident
- Écriture atomique pour les fichiers critiques (`os.replace`)
- Pas de `shell=True` dans les subprocesses

## Conventions frontend

- Next.js 14 App Router, TypeScript strict, Tailwind CSS
- Vérification types : `npm run type-check` depuis `frontend/`
- Lint : `npm run lint` depuis `frontend/`
- Composants dans `frontend/components/`, pages dans `frontend/app/`
- Pas de dépendances npm inutiles

## Conventions générales

- Commits : `type(scope): message` (fix, feat, refactor, test, docs)
- Co-auteur : `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Toujours lancer les tests et le lint avant de committer
- Ne pas modifier ce qui n'est pas dans le scope de la tâche
- Préférer les modifications minimales cohérentes avec l'existant

## Contraintes d'architecture

- Backend lancé en **single-worker** uvicorn — l'état en mémoire (caches, sessions VPN, sessions HLS) est partagé dans le process. Ne pas passer à `--workers N > 1` sans migrer vers un état partagé externe (Redis, etc.).

## Agents disponibles

- **backend** : API, services, logique métier, tests backend
- **frontend** : composants, pages, appels API côté client
