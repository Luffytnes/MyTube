# Fiche de route — Correctifs sécurité, fiabilité et failover VPN

> Document destiné à un agent IA de développement. Issu d'un audit complet du code
> (juillet 2026). Chaque tâche indique les fichiers, les instructions et les critères
> d'acceptation. Traiter les lots **dans l'ordre** ; chaque tâche = un commit.

## Règles générales (à respecter sur toutes les tâches)

- Lire `CLAUDE.md` avant de commencer. Conventions de commit : `type(scope): message`.
- Avant chaque commit : `ruff check backend/ --select E,F,W --ignore E501,E701`
  et `pytest tests/ -v` depuis `backend/`. Pour le frontend : `npm run type-check`
  et `npm run lint` depuis `frontend/`.
- Toute correction de sécurité (Lot 1) doit être accompagnée d'un test de régression
  dans `backend/tests/test_security.py` (suivre le style des tests existants).
- Modifications minimales : ne pas refactorer au passage ce qui n'est pas dans la tâche.
- Le backend tourne en **single-worker** uvicorn : l'état en mémoire est partagé dans
  le process, ne rien introduire qui suppose plusieurs workers.

---

## Lot 1 — Sécurité (priorité maximale)

### 1.1 — SSRF : valider les URLs des proxys podcast et radio

**Fichiers** : `backend/api/podcasts.py`, `backend/api/music.py`, `backend/core/security.py`

Trois endpoints fetchent une URL arbitraire fournie par le client sans aucune
validation SSRF, contrairement aux proxys HLS/IPTV qui appellent `validate_proxy_url` :

- `GET /api/podcasts/audio/proxy?url=...` (`podcasts.py`, ~ligne 224)
- `GET /api/podcasts/image/proxy?url=...` (`podcasts.py`, ~ligne 115)
- `GET /api/radio/stream/proxy?url=...` (`music.py`, ~ligne 370)

**À faire** :
1. Dans chacun des trois handlers, valider l'URL **avant** tout fetch :
   `await asyncio.to_thread(validate_proxy_url, url)` (la validation fait une
   résolution DNS bloquante — voir tâche 3.6 — donc toujours l'appeler via
   `to_thread` dans un contexte async).
2. Pour `podcast_image_proxy`, en cas d'URL invalide, conserver le comportement
   actuel de repli (retourner le GIF 1×1 transparent) plutôt que propager un 400 :
   attraper la `HTTPException` levée par `validate_proxy_url`.
3. Pour les deux proxys audio (podcast, radio), laisser remonter le 400.

**Critères d'acceptation** :
- Un test par endpoint vérifiant qu'une URL vers `127.0.0.1`, `10.0.0.1`,
  `169.254.169.254` et un schéma non-http (`file://`) est rejetée (400 ou GIF vide
  selon l'endpoint).
- Une URL publique valide continue de fonctionner (mocker httpx, ne pas faire de
  vrai réseau dans les tests).

### 1.2 — Fuite des identifiants Xtream dans les logs

**Fichier** : `backend/services/ffmpeg.py` (fonction `_download_reconnecting_inner`, ~ligne 529)

`print(f"[downloader] start url={url[-40:]} ...")` : l'URL Xtream est de la forme
`{server}/{media}/{username}/{password}/{stream_id}.{ext}` — les 40 derniers
caractères contiennent presque toujours le mot de passe IPTV.

**À faire** :
1. Créer un petit helper `_redact_url(url: str) -> str` dans `ffmpeg.py` (ou
   `core/security.py`) qui ne conserve que `scheme://host/…/{dernier segment}`
   (masquer tous les segments de chemin intermédiaires).
2. Passer en revue **tous** les `print` de `ffmpeg.py` et `iptv.py` qui incluent
   une URL ou un chemin dérivé d'URL et appliquer le helper.

**Critères d'acceptation** :
- Test unitaire : `_redact_url("http://srv.com/movie/user/s3cret/123.mkv")` ne
  contient ni `user` ni `s3cret` mais contient `123.mkv`.
- `grep -rn "url\[-" backend/` ne renvoie plus rien.

### 1.3 — Whitelist des paramètres `ext` et `media` (traversal + injection d'URL)

**Fichiers** : `backend/api/iptv.py`, `backend/api/youtube.py` (routes `vod_hls2`),
`backend/services/ffmpeg.py`

Les paramètres de query `ext` et `media` sont injectés sans filtre :
- dans l'URL Xtream `f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"` (injection de chemin) ;
- dans le chemin du cache disque `os.path.join(gettempdir(), f"mytube_{stream_id}.{ext}")`
  via `_ensure_vod_download` → **path traversal** possible avec
  `ext=mp4/../../home/mytube/x`.

**À faire** :
1. Dans `backend/api/iptv.py`, ajouter en tête de module :
   - `_ALLOWED_EXT = {"mp4", "mkv", "avi", "ts", "m2ts", "mts", "webm", "mov", "flv", "m3u8"}`
   - `_ALLOWED_MEDIA = {"movie", "series"}`
   - un helper `_check_vod_params(ext: str, media: str)` qui lève un 400 si
     `ext.lower()` ou `media` n'est pas dans la whitelist.
2. Appeler ce helper au début de **toutes** les routes qui reçoivent `ext`/`media` :
   `vod_tracks`, `vod_subtitle`, `vod_stream`, `vod_hls`, `vod_proxy` (iptv.py)
   et `iptv_vod_hls2_playlist`, `iptv_vod_hls2_segment` (youtube.py — l'importer
   depuis `api.iptv`).
3. Défense en profondeur : dans `_ensure_vod_download` (`services/ffmpeg.py`),
   rejeter (raise `ValueError`) toute `cache_key` contenant `/`, `\` ou `..`.
4. Valider aussi `stream_id` : `re.fullmatch(r"[A-Za-z0-9_-]+", stream_id)` sinon 400.

**Critères d'acceptation** :
- Tests : `ext=mp4%2F..%2F..%2Fetc%2Fx` → 400 ; `media=admin` → 400 ;
  `stream_id=../x` → 400 ou 404 ; les valeurs légitimes passent.
- Test unitaire sur `_ensure_vod_download` avec une clé piégée → `ValueError`.

### 1.4 — Valider l'URL de `/api/invidious/select`

**Fichier** : `backend/api/youtube.py` (~ligne 124)

L'endpoint accepte n'importe quelle URL comme instance Invidious « préférée »,
utilisée ensuite pour des fetchs côté serveur (recherche, avatars `{instance}/ggpht/…`).

**À faire** : dans `select_invidious_instance`, si `url` est non vide :
`await asyncio.to_thread(validate_proxy_url, url, ("https",))` — schéma https
obligatoire (toutes les instances de la liste sont en https). Laisser passer la
chaîne vide (= désélection).

**Critères d'acceptation** : test rejetant `http://192.168.1.1` et `file:///etc/passwd`,
acceptant `https://yewtu.be` et `""` (mocker la résolution DNS).

### 1.5 — Masquer la clé Podcast Index dans `GET /api/podcasts/config`

**Fichier** : `backend/api/podcasts.py` (~ligne 78)

Le GET renvoie la clé API en clair (`"key": _pi_effective_key()`) alors que le
secret est masqué et que la clé TMDB a déjà été masquée dans un correctif précédent.

**À faire** : renvoyer `{"key": "set" si configurée sinon "", "secret": "set" si
configuré sinon ""}` — même convention que le secret actuel. Vérifier dans
`frontend/components/layout/SettingsPanel.tsx` que l'UI ne dépend pas de la valeur
réelle de la clé (si elle pré-remplit un champ, remplacer par un placeholder
« configurée » comme fait pour TMDB).

**Critères d'acceptation** : test vérifiant que la vraie clé n'apparaît jamais dans
la réponse ; `npm run type-check` OK si le frontend est touché.

### 1.6 — Permissions restrictives sur les fichiers de secrets

**Fichiers** : `backend/core/config.py` (`_xtream_save`), `backend/services/tmdb.py`
(`_tmdb_save`), `backend/api/podcasts.py` (`_podcast_config_save`),
`backend/services/vpn.py` (`_vpn_state_save`, écriture des `.conf` dans
`backend/api/vpn.py::vpn_upload_conf`, `_start_wireproxy_sync` mode conteneur)

Ces fichiers contiennent identifiants IPTV, clés API et **clés privées WireGuard**,
écrits avec l'umask par défaut.

**À faire** :
1. Créer un helper partagé `write_secret_file(path: str, content: str)` dans
   `backend/core/config.py` (ou un nouveau `core/files.py`) qui :
   - écrit dans `path + ".tmp"`, `os.chmod(tmp, 0o600)`, puis `os.replace(tmp, path)`
     (règle ainsi aussi la tâche 4.1 pour ces fichiers) ;
   - nettoie le `.tmp` en cas d'échec.
2. L'utiliser dans les cinq points d'écriture listés ci-dessus.
3. `os.makedirs(..., mode=0o700)` pour `~/.mytube` et `~/.mytube/vpn_configs`.

**Critères d'acceptation** : test qui écrit via le helper et vérifie
`stat.S_IMODE(os.stat(path).st_mode) == 0o600`, et qu'un crash simulé pendant
l'écriture ne laisse pas de fichier corrompu (l'ancien contenu est préservé).

---

## Lot 2 — Brancher les erreurs yt-dlp sur le failover VPN

**Contexte** : le mécanisme d'auto-failover (`services/vpn.py` :
`record_youtube_error` / `reset_youtube_errors` / `_vpn_failover`) n'est alimenté
que par les appels httpx InnerTube (`services/innertube.py`). Les erreurs yt-dlp —
notamment le blocage anti-bot « Sign in to confirm you're not a bot », fortement lié
à l'IP de sortie — ne déclenchent **jamais** de rotation de conf WireGuard, alors que
c'est le chemin le plus sollicité (video, stream, HLS, download, subtitles…).

### 2.1 — Créer un wrapper central d'extraction yt-dlp

**Fichier** : `backend/services/innertube.py`

**À faire** :
1. Ajouter une fonction async :
   ```python
   async def ydl_extract(url: str, opts: dict) -> Optional[dict]:
       """Run yt_dlp.extract_info in a thread; feed VPN failover on blocking errors."""
   ```
   Comportement :
   - exécute `yt_dlp.YoutubeDL(opts).extract_info(url, download=False)` via
     `loop.run_in_executor` ;
   - **succès** → `reset_youtube_errors()` puis retourne l'info dict ;
   - **exception** → inspecter `str(exc).lower()` ; si elle matche un des motifs
     de blocage, appeler `record_youtube_error(403)` puis re-lever l'exception.
   - Motifs de blocage (constante module `_YT_BLOCK_PATTERNS`) :
     `"sign in to confirm"`, `"not a bot"`, `"http error 403"`, `"http error 429"`,
     `"429 too many requests"`, `"unable to download api page"`.
   - Les erreurs « vidéo indisponible / privée / géobloquée » ne doivent **pas**
     compter comme erreur VPN (elles ne dépendent pas de l'IP de la même façon) :
     ne pas matcher `"private video"`, `"has been removed"`, `"not available"`.

   ⚠️ **Point d'implémentation critique** : `record_youtube_error` appelle
   `asyncio.create_task`, qui exige la boucle courante. Il doit donc être appelé
   **depuis la coroutine `ydl_extract`** (après le `await run_in_executor`), jamais
   depuis le thread executor.

2. Le comptage/threshold existant (`_vpn_failover_threshold`) et les guards
   (`_vpn_auto_mode`, `is_wireproxy_active`) sont déjà dans `record_youtube_error` —
   ne pas les dupliquer.

### 2.2 — Migrer les appels `extract_info` existants vers le wrapper

**Fichiers** : `backend/api/youtube.py`, `backend/core/cache.py`, `backend/services/ffmpeg.py`

Tous les patterns actuels de la forme :
```python
def _fetch():
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)
info = await loop.run_in_executor(None, _fetch)
```
deviennent `info = await ydl_extract(url, opts)`.

Points d'appel à migrer (liste exhaustive au moment de l'audit — re-vérifier par
`grep -rn "extract_info" backend/`) :
- `api/youtube.py` : `get_trending` (fallback yt-dlp), `search_videos`,
  `get_video` (x2, avec la recherche related), `live_hls_master`, `stream_audio`,
  `stream_video`, `stream_trailer`, `get_dash_mpd`, `get_playlist`,
  `list_subtitles`, `get_subtitle_vtt`, `debug_channel_thumbnails`,
  `download_video`, `get_channel`, `get_channel_videos`.
- `core/cache.py` : `_get_channel_thumbnails`.
- `services/ffmpeg.py` : `_get_video_and_audio_urls`.

**Attention** : certains `_fetch` font plus que l'extraction (post-traitement des
formats dans le même thread, ex. `_get_video_and_audio_urls`). Dans ce cas, garder
le post-traitement mais remplacer uniquement l'appel d'extraction : soit sortir le
post-traitement du thread (préférable, c'est du CPU léger), soit passer par le
wrapper puis traiter l'info dict retourné. Le gestionnaire d'erreurs existant de
chaque route (messages 404/500) doit rester inchangé : le wrapper re-lève
l'exception d'origine.

**Critères d'acceptation** :
- `grep -rn "extract_info" backend/` ne montre plus que le wrapper.
- Nouveaux tests dans `backend/tests/test_vpn.py` (suivre le style existant, mocker
  yt-dlp) :
  - une exception « Sign in to confirm you're not a bot » → `record_youtube_error`
    appelé avec 403 (vérifier via l'état `_vpn_error_count` ou un monkeypatch) ;
  - une exception « Private video » → compteur inchangé ;
  - une extraction réussie → compteur remis à zéro ;
  - l'exception d'origine est bien re-levée dans tous les cas d'erreur.

---

## Lot 3 — Fiabilité et fuites de ressources

### 3.1 — HEALTHCHECK du Dockerfile backend cassé

**Fichier** : `backend/Dockerfile` (~ligne 43)

`CMD curl -f http://localhost:8000/api/trending?region=US&lang=en || exit 1` :
le `&` non quoté met curl en arrière-plan ; `lang=en || exit 1` réussit toujours →
le healthcheck de l'image passe **même backend mort** (le compose le surcharge,
mais l'image seule ment).

**À faire** : remplacer par
`CMD curl -sf http://localhost:8000/api/health || exit 1`
(aligné sur le healthcheck compose ; `/api/trending` frapperait YouTube toutes les
30 s, ce qui aggrave le problème anti-bot).

**Critère** : `docker build` OK ; contrôler avec `docker inspect` que le test est correct.

### 3.2 — Références sur les tâches de fond du lifespan

**Fichier** : `backend/main.py` (~ligne 27)

`asyncio.create_task(...)` sans référence conservée : Python peut garbage-collecter
une task non référencée → le watchdog VPN ou le cleanup VOD peut mourir en silence.

**À faire** :
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(_vpn_watchdog()),
        asyncio.create_task(_vod_cache_cleanup_loop()),
        asyncio.create_task(_hls_idle_cleanup_loop()),  # créée en 3.3
    ]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
```

**Critère** : test d'app-startup/shutdown (TestClient en context manager) sans warning
« Task was destroyed but it is pending ».

### 3.3 — Nettoyage par inactivité des sessions HLS ffmpeg

**Fichiers** : `backend/services/ffmpeg.py`, `backend/api/youtube.py`, `backend/main.py`

`_hls_sessions` et `_iptv_vod_hls_sessions` ne sont tuées que si un nouveau start
arrive pour la même clé ou si le client appelle DELETE. Onglet fermé = process
ffmpeg qui transcode jusqu'au bout + segments accumulés dans `/tmp` pour toujours
(`-hls_list_size 0` ne supprime jamais les segments).

**À faire** :
1. Ajouter un champ `"last_access": time()` à chaque session (les deux dicts), mis
   à jour dans les handlers de playlist **et** de segment (`hls_playlist`,
   `hls_segment`, `iptv_vod_hls2_playlist`, `iptv_vod_hls2_segment`).
2. Nouvelle coroutine `_hls_idle_cleanup_loop()` dans `services/ffmpeg.py` :
   toutes les 60 s, sous les locks respectifs, tuer et supprimer (process kill +
   `shutil.rmtree` + pop) toute session dont `last_access` date de plus de
   `HLS_IDLE_TTL = 120` secondes. Réutiliser `_kill_vod_session` pour les sessions
   VOD (gère pipe_task/stdin).
3. Enregistrer la boucle dans le lifespan (cf. 3.2).

**Critères d'acceptation** : test asyncio avec une fausse session (process mocké,
tmpdir réel) : non accédée pendant > TTL → tuée et dossier supprimé ; accédée
récemment → conservée.

### 3.4 — Borner tous les caches en mémoire

**Fichiers** : `backend/core/cache.py`, `backend/services/innertube.py`,
`backend/services/tmdb.py`, `backend/api/news.py`, `backend/services/vpn.py` (`_ytm_cache`)

Restent des dicts non bornés qui grossissent indéfiniment (risque OOM avec
`mem_limit: 1g`) :

| Structure | Fichier | Remplacement |
|---|---|---|
| `_live_url_cache` | core/cache.py | `TTLCache(maxsize=200, ttl=180)` |
| `_stream_url_cache` | core/cache.py | `TTLCache(maxsize=1000, ttl=10800)` |
| `_search_continuations` | services/innertube.py | `TTLCache(maxsize=500, ttl=3600)` |
| `_channel_continuations` | services/innertube.py | `TTLCache(maxsize=500, ttl=3600)` |
| `_tmdb_cache` | services/tmdb.py | `TTLCache(maxsize=2000, ttl=3600)` |
| `_news_cache` | api/news.py | `TTLCache(maxsize=100, ttl=900)` |
| `_ytm_cache` | services/vpn.py | `TTLCache(maxsize=20, ttl=86400)` (garder `.clear()` existants) |

**À faire** : migrer vers `cachetools.TTLCache` en conservant les API d'accès
existantes. Pour `_stream_url_cache`, conserver `stream_url_cache_invalidate`
(itération sur les clés : `list(cache.keys())` avant suppression). Les checks
manuels de timestamp (`if _time() - ts < TTL`) deviennent inutiles — les retirer
avec la migration, mais **garder la structure des valeurs** là où le timestamp est
utilisé ailleurs. `_vod_dl_cache` est un cas particulier (entrées liées à des
fichiers disque et des tasks) : ne pas le migrer, il a sa boucle de cleanup.

**Critères** : tests existants de `test_cache.py` verts ; ajouter un test vérifiant
qu'insérer maxsize+1 entrées n'en garde que maxsize.

### 3.5 — Utiliser `_FFMPEG` partout

**Fichiers** : `backend/services/ffmpeg.py` (`_start_hls_session`, ~ligne 163),
`backend/api/youtube.py` (`download_video` → `ffmpeg_merge_generator`, ~ligne 1543),
`backend/services/ffmpeg.py` (`_probe_vod_duration` utilise `"ffprobe"`, ~ligne 237)

Trois appels utilisent `"ffmpeg"`/`"ffprobe"` nus au lieu des constantes
`_FFMPEG`/`_FFPROBE` de `core/config.py` (fallback `/opt/homebrew/bin`). Sur une
machine où ffmpeg n'est pas dans le PATH, ces chemins échouent.

**À faire** : remplacer par les constantes. Cas particulier `_start_hls_session` :
quand `_proxychains_prefix` est actif, la commande est
`proxychains4 … ffmpeg …` — utiliser `_FFMPEG` là aussi (chemin absolu accepté).

**Critère** : `grep -n '"ffmpeg"\|"ffprobe"' backend/` ne renvoie plus d'appel de
subprocess (les occurrences dans des messages/chaînes de log sont OK).

### 3.6 — Ne plus bloquer l'event loop dans `validate_proxy_url`

**Fichiers** : `backend/core/security.py`, points d'appel dans `backend/api/youtube.py`
(`hls_proxy`), `backend/api/iptv.py` (`iptv_hls_proxy`, `iptv_icon_proxy`)

La résolution DNS (`socket.getaddrinfo`) est synchrone ; appelée directement dans
les handlers async, un DNS lent gèle tout le serveur single-worker.

**À faire** :
1. Ajouter dans `core/security.py` :
   ```python
   async def validate_proxy_url_async(url: str, allowed_schemes=("http", "https")) -> str:
       return await asyncio.to_thread(validate_proxy_url, url, allowed_schemes)
   ```
2. Remplacer tous les appels directs dans les handlers async (y compris ceux
   ajoutés au Lot 1) par la version async. `ssrf_redirect_hook` utilise déjà
   `to_thread` — inchangé.

**Critère** : `grep -rn "validate_proxy_url(" backend/api/` ne montre plus d'appel
synchrone dans un handler async.

### 3.7 — Micro-corrections

**Fichier** : `backend/api/youtube.py`

1. ~Lignes 477-480 : doublon `except HTTPException: raise` — supprimer l'un des deux.
2. `hls_playlist` (~ligne 681) : `session = _hls_sessions[session_key]` est lu hors
   verrou après `_start_hls_session` ; une requête concurrente peut avoir tué la
   session → `KeyError` → 500. Remplacer par `_hls_sessions.get(session_key)` et
   retourner un 503 « session interrompue, réessayez » si None.

---

## Lot 4 — Qualité et cohérence

### 4.1 — Écritures atomiques pour tous les fichiers d'état

**Fichiers** : mêmes points d'écriture que la tâche 1.6, plus tout autre
`open(path, "w")` sur un fichier de `~/.mytube`

Si la tâche 1.6 est faite avec le helper `write_secret_file` (tmp + chmod +
`os.replace`), cette tâche est déjà couverte pour les secrets. Vérifier qu'il ne
reste aucune écriture directe non atomique d'un fichier d'état :
`grep -rn 'open(.*"w"' backend/` et traiter les restants.

### 4.2 — Nettoyage git

**Fichiers** : `.gitignore`, index git

1. `git rm --cached frontend/tsconfig.tsbuildinfo` + ajouter
   `frontend/tsconfig.tsbuildinfo` (ou `*.tsbuildinfo`) au `.gitignore`
   (section Next.js).
2. Ajouter `.claude/worktrees/` au `.gitignore`.

**Critère** : `git status` propre après un `npm run build`.

### 4.3 — Headers CORS : supprimer la redondance

**Fichiers** : `backend/api/*.py`

Le middleware CORS global (`main.py`) gère déjà `Access-Control-Allow-Origin` ;
19 endpoints le rajoutent à la main dans leurs headers de réponse.

**À faire** : supprimer toutes les occurrences manuelles de
`"Access-Control-Allow-Origin": "*"` dans les dicts de headers des réponses
(garder les autres headers : Cache-Control, Content-Disposition, etc.).

**Critère** : `grep -rn "Access-Control-Allow-Origin" backend/api/` vide ; vérifier
manuellement qu'un flux HLS et une image se chargent toujours depuis le front
(le middleware couvre ces réponses, y compris les StreamingResponse).

### 4.4 — nginx : headers forwarded + uvicorn proxy-headers

**Fichiers** : `nginx/nginx.conf`, `backend/Dockerfile` (CMD)

Le backend construit des URLs absolues avec `request.base_url` (manifests HLS,
MPD). Sans `X-Forwarded-Proto`, derrière un TLS terminé en amont, elles sortent en
`http://` → contenu mixte bloqué.

**À faire** :
1. Dans le bloc `location /api/` (et `/`) de nginx.conf, ajouter :
   ```
   proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header X-Forwarded-Host  $host;
   ```
2. Dans le Dockerfile backend, CMD :
   `["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]`
   (le backend n'est pas publié directement, seul nginx y accède via le réseau
   compose — `*` est acceptable ici).

**Critère** : smoke test CI toujours vert (le workflow `.github/workflows/ci.yml`
monte la stack complète).

### 4.5 — Mettre à jour le co-auteur dans CLAUDE.md

**Fichier** : `CLAUDE.md`

La ligne `Co-Authored-By: Claude Sonnet 4.6` est obsolète. La remplacer par le
modèle effectivement utilisé par l'agent qui exécutera cette roadmap (garder le
format `Co-Authored-By: <nom> <noreply@anthropic.com>`).

### 4.6 — (Optionnel, gros chantier) Scinder `api/youtube.py`

1 822 lignes mêlant navigation, streaming, HLS/DASH, téléchargement, images.
**Ne faire qu'après tous les autres lots** (sinon les diffs des correctifs
deviennent illisibles). Découpage suggéré, sans changement de comportement :
- `api/youtube_browse.py` : trending, search, video, playlist, channel*, invidious
- `api/youtube_streams.py` : stream, audio, trailer, hls*, dash, live, hls-proxy
- `api/youtube_media.py` : thumbnail, channel_thumbnail, channel_banner, subtitles, download

Conserver un `api/youtube.py` qui ré-exporte les trois routers pour ne pas toucher
`main.py`, ou enregistrer les trois routers dans `main.py`. Vérifier le check CI
« Import check » (compte de routes inchangé).

---

## Ordre d'exécution et validation finale

1. Lot 1 complet (1.1 → 1.6) — un commit par tâche, tests de régression inclus.
2. Lot 2 (2.1 puis 2.2) — c'est le changement le plus transverse ; le faire après
   le Lot 1 pour ne pas mélanger les diffs.
3. Lot 3 (3.1 → 3.7).
4. Lot 4 (4.1 → 4.5 ; 4.6 seulement si explicitement demandé).

**Validation finale** : `ruff` + `pytest` + `npm run type-check` + `npm run lint`
verts, puis `docker compose up -d --build` local et vérification manuelle :
lecture d'une vidéo YouTube (HLS), d'un flux IPTV live, d'un VOD IPTV avec seek,
d'une radio et d'un podcast. Vérifier dans les logs qu'aucune URL Xtream complète
n'apparaît. Ne pas pousser sans que le smoke test CI passe.

## Hors périmètre (volontairement)

- Anti-bot YouTube au-delà du failover : `player_client` alternatif (`tv`/`mweb`),
  support cookies (`cookiefile` + upload UI), cache de l'info dict yt-dlp par
  vidéo, PO tokens (`bgutil-ytdlp-pot-provider`). À traiter dans une roadmap
  séparée si demandé.
- Persistance serveur des données frontend (localStorage actuellement).
- Découpage de `VideoPlayer.tsx` / `SettingsPanel.tsx` / `translations.ts`.
- Durcissement DNS-rebinding complet (épinglage d'IP entre validation et fetch).
