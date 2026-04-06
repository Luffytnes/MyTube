import asyncio
import base64
import re
from time import time as _time
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
import httpx
import yt_dlp

app = FastAPI(title="MyTube API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INVIDIOUS_INSTANCES = [
    "https://iv.melmac.space",
    "https://invidious.slipfox.xyz",
    "https://invidious.nerdvpn.de",
    "https://inv.nadeko.net",
    "https://invidious.privacyredirect.com",
    "https://yewtu.be",
]

_preferred_instance: Optional[str] = None


def _get_instances() -> list:
    if _preferred_instance:
        rest = [i for i in INVIDIOUS_INSTANCES if i != _preferred_instance]
        return [_preferred_instance] + rest
    return INVIDIOUS_INSTANCES


@app.get("/api/invidious/instances")
async def list_invidious_instances():
    async def ping(url: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(f"{url}/api/v1/stats")
                ok = r.status_code == 200
        except Exception:
            ok = False
        return {"url": url, "healthy": ok, "preferred": url == _preferred_instance}

    results = await asyncio.gather(*[ping(i) for i in INVIDIOUS_INSTANCES])
    return list(results)


@app.post("/api/invidious/select")
async def select_invidious_instance(body: dict):
    global _preferred_instance
    url = (body.get("url") or "").rstrip("/")
    _preferred_instance = url if url else None
    return {"selected": _preferred_instance}


YDL_OPTS_BASE: Dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "nocheckcertificate": True,
}

# Simple TTL cache (trending/search results)
_cache: Dict[str, tuple] = {}
CACHE_TTL = 300  # 5 minutes

def cache_get(key: str) -> Optional[Any]:
    if key in _cache:
        ts, data = _cache[key]
        if _time() - ts < CACHE_TTL:
            return data
        del _cache[key]
    return None

def cache_set(key: str, data: Any) -> None:
    _cache[key] = (_time(), data)

# In-memory thumbnail cache (1 hour TTL)
_thumb_cache: Dict[str, tuple] = {}
THUMB_CACHE_TTL = 3600

def thumb_cache_get(key: str):
    if key in _thumb_cache:
        ts, data, ct = _thumb_cache[key]
        if _time() - ts < THUMB_CACHE_TTL:
            return data, ct
        del _thumb_cache[key]
    return None

def thumb_cache_set(key: str, data: bytes, ct: str) -> None:
    _thumb_cache[key] = (_time(), data, ct)

# Cache for raw yt-dlp channel thumbnails list (shared between avatar + banner)
_channel_thumbs_cache: Dict[str, tuple] = {}

def _channel_thumbs_cache_get(channel_id: str):
    if channel_id in _channel_thumbs_cache:
        ts, data = _channel_thumbs_cache[channel_id]
        if _time() - ts < THUMB_CACHE_TTL:
            return data
        del _channel_thumbs_cache[channel_id]
    return None

def _channel_thumbs_cache_set(channel_id: str, data: list) -> None:
    _channel_thumbs_cache[channel_id] = (_time(), data)

async def _get_channel_thumbnails(channel_id: str) -> list:
    cached = _channel_thumbs_cache_get(channel_id)
    if cached is not None:
        return cached
    opts = {**YDL_OPTS_BASE, "extract_flat": True, "playlistend": 1}
    loop = asyncio.get_event_loop()
    def _fetch():
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/channel/{channel_id}", download=False)
            return info.get("thumbnails", []) if info else []
    thumbs = await loop.run_in_executor(None, _fetch)
    _channel_thumbs_cache_set(channel_id, thumbs)
    return thumbs


# In-memory cache for live HLS URLs (short TTL — YouTube URLs expire)
_live_url_cache: Dict[str, tuple] = {}
LIVE_URL_TTL = 180  # 3 minutes

def live_url_cache_get(video_id: str) -> Optional[str]:
    if video_id in _live_url_cache:
        ts, url = _live_url_cache[video_id]
        if _time() - ts < LIVE_URL_TTL:
            return url
        del _live_url_cache[video_id]
    return None

def live_url_cache_set(video_id: str, url: str) -> None:
    _live_url_cache[video_id] = (_time(), url)


YOUTUBE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}


def rewrite_hls_manifest(content: str, source_url: str, proxy_base: str) -> str:
    """Rewrite all URLs in an HLS manifest to route through our proxy."""
    parsed = urlparse(source_url)
    base_dir = source_url.rsplit("/", 1)[0] + "/"

    def encode_url(u: str) -> str:
        if u.startswith("http"):
            absolute = u
        elif u.startswith("//"):
            absolute = f"{parsed.scheme}:{u}"
        elif u.startswith("/"):
            absolute = f"{parsed.scheme}://{parsed.netloc}{u}"
        else:
            absolute = base_dir + u
        encoded = base64.urlsafe_b64encode(absolute.encode()).decode().rstrip("=")
        return f"{proxy_base}?url={encoded}"

    def replace_uri_attr(m: re.Match) -> str:
        return f'URI="{encode_url(m.group(1))}"'

    lines = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            lines.append(line)
        elif stripped.startswith("#"):
            lines.append(re.sub(r'URI="([^"]+)"', replace_uri_attr, line))
        else:
            lines.append(encode_url(stripped))
    return "\n".join(lines)



_YT_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": "2.20240101.00.00",
    "Origin": "https://www.youtube.com",
    "Referer": "https://www.youtube.com/",
}


def _yt_context(hl: str = "en", gl: str = "US") -> Dict[str, Any]:
    return {"client": {"clientName": "WEB", "clientVersion": "2.20240101.00.00", "hl": hl, "gl": gl}}


def _parse_youtubei_video_renderer(vr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    video_id = vr.get("videoId", "")
    if not video_id:
        return None

    title_obj = vr.get("title", {})
    title = "".join(r.get("text", "") for r in title_obj.get("runs", [])) or title_obj.get("simpleText", "Unknown Title")

    duration = vr.get("lengthText", {}).get("simpleText", "")

    view_obj = vr.get("viewCountText", {}) or vr.get("shortViewCountText", {})
    view_text = view_obj.get("simpleText", "") or "".join(r.get("text", "") for r in view_obj.get("runs", []))
    views = view_text if view_text else "0 views"

    published = vr.get("publishedTimeText", {}).get("simpleText", "Unknown date")

    channel_name, channel_id = "", ""
    for key in ("longBylineText", "shortBylineText", "ownerText"):
        runs = vr.get(key, {}).get("runs", [])
        if runs:
            channel_name = runs[0].get("text", "")
            channel_id = runs[0].get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId", "")
            break

    return {
        "id": video_id,
        "title": title,
        "thumbnail": f"/api/thumbnail/{video_id}",
        "duration": duration,
        "views": views,
        "published": published,
        "channel": {
            "id": channel_id,
            "name": channel_name or "Unknown Channel",
            "thumbnail": f"/api/channel_thumbnail/{channel_id}" if channel_id else None,
        },
    }


def _extract_search_videos(data: Dict[str, Any]) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """Returns (videos, continuation_token)."""
    videos = []
    continuation_token = None
    try:
        sections = (
            data["contents"]["twoColumnSearchResultsRenderer"]
                ["primaryContents"]["sectionListRenderer"]["contents"]
        )
        for section in sections:
            for item in section.get("itemSectionRenderer", {}).get("contents", []):
                vr = item.get("videoRenderer")
                if vr:
                    v = _parse_youtubei_video_renderer(vr)
                    if v:
                        videos.append(v)
            # Extract continuation token from continuationItemRenderer
            token = (
                section.get("continuationItemRenderer", {})
                       .get("continuationEndpoint", {})
                       .get("continuationCommand", {})
                       .get("token")
            )
            if token:
                continuation_token = token
    except (KeyError, TypeError):
        pass
    return videos, continuation_token


def _extract_continuation_videos(data: Dict[str, Any]) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """Parse results from a continuation response (search or channel)."""
    videos = []
    continuation_token = None
    try:
        for cmd in data.get("onResponseReceivedCommands", []):
            items = cmd.get("appendContinuationItemsAction", {}).get("continuationItems", [])
            for item in items:
                # Channel pages use richItemRenderer
                vr = item.get("richItemRenderer", {}).get("content", {}).get("videoRenderer")
                if vr:
                    v = _parse_youtubei_video_renderer(vr)
                    if v:
                        videos.append(v)
                    continue
                # Search pages use itemSectionRenderer.contents
                for content in item.get("itemSectionRenderer", {}).get("contents", []):
                    vr = content.get("videoRenderer")
                    if vr:
                        v = _parse_youtubei_video_renderer(vr)
                        if v:
                            videos.append(v)
                # Or directly as videoRenderer
                vr = item.get("videoRenderer")
                if vr:
                    v = _parse_youtubei_video_renderer(vr)
                    if v:
                        videos.append(v)
                # Next continuation token
                token = (
                    item.get("continuationItemRenderer", {})
                        .get("continuationEndpoint", {})
                        .get("continuationCommand", {})
                        .get("token")
                )
                if token:
                    continuation_token = token
    except (KeyError, TypeError):
        pass
    return videos, continuation_token


# Cache: (query, page) -> continuation token for next page
_search_continuations: Dict[str, str] = {}

# Cache: (channel_id, page) -> continuation token for channel videos
_channel_continuations: Dict[str, str] = {}

# params value for YouTube Videos tab (base64 encoded)
_YT_VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA"


def _extract_channel_videos(data: Dict[str, Any]) -> tuple[List[Dict[str, Any]], Optional[str], str]:
    """Extract videos, continuation token, and channel name from a channel browse response."""
    videos = []
    continuation_token = None
    channel_name = (
        data.get("metadata", {}).get("channelMetadataRenderer", {}).get("title", "")
        or data.get("header", {}).get("c4TabbedHeaderRenderer", {}).get("title", "")
        or ""
    )
    try:
        tabs = data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
        for tab in tabs:
            tr = tab.get("tabRenderer", {})
            if not tr.get("selected") and not tr.get("content"):
                continue
            for section in tr.get("content", {}).get("richGridRenderer", {}).get("contents", []):
                # Videos
                item = section.get("richItemRenderer", {}).get("content", {}).get("videoRenderer")
                if item:
                    v = _parse_youtubei_video_renderer(item)
                    if v:
                        videos.append(v)
                # Continuation token
                token = (
                    section.get("continuationItemRenderer", {})
                           .get("continuationEndpoint", {})
                           .get("continuationCommand", {})
                           .get("token")
                )
                if token:
                    continuation_token = token
    except (KeyError, TypeError):
        pass
    return videos, continuation_token, channel_name


def _enrich_channel_info(videos: List[Dict[str, Any]], channel_id: str, channel_name: str = "") -> None:
    """Fill in missing channel info on videos from a known channel page."""
    for v in videos:
        if not v["channel"]["id"]:
            v["channel"]["id"] = channel_id
            v["channel"]["thumbnail"] = f"/api/channel_thumbnail/{channel_id}"
        if channel_name and (not v["channel"]["name"] or v["channel"]["name"] == "Unknown Channel"):
            v["channel"]["name"] = channel_name


async def youtubei_channel_videos(channel_id: str, page: int = 1) -> Optional[List[Dict[str, Any]]]:
    """Fetch channel videos via YouTube's internal API with pagination."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            if page == 1:
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/browse",
                    json={"context": _yt_context(), "browseId": channel_id, "params": _YT_VIDEOS_TAB_PARAMS},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    videos, token, channel_name = _extract_channel_videos(resp.json())
                    if token:
                        _channel_continuations[f"{channel_id}:{page + 1}"] = token
                    if channel_name:
                        _channel_continuations[f"{channel_id}:name"] = channel_name
                    _enrich_channel_info(videos, channel_id, channel_name)
                    return videos if videos else None
            else:
                token = _channel_continuations.get(f"{channel_id}:{page}")
                if not token:
                    return None
                channel_name = _channel_continuations.get(f"{channel_id}:name", "")
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/browse",
                    json={"context": _yt_context(), "continuation": token},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    videos, next_token = _extract_continuation_videos(resp.json())
                    if next_token:
                        _channel_continuations[f"{channel_id}:{page + 1}"] = next_token
                    _enrich_channel_info(videos, channel_id, channel_name)
                    return videos if videos else None
    except Exception:
        pass
    return None


def _extract_trending_videos(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    videos = []
    try:
        tabs = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        for tab in tabs:
            tr = tab.get("tabRenderer", {})
            content = tr.get("content", {})
            for section in content.get("sectionListRenderer", {}).get("contents", []):
                for item in section.get("itemSectionRenderer", {}).get("contents", []):
                    vr = item.get("videoRenderer")
                    if vr:
                        v = _parse_youtubei_video_renderer(vr)
                        if v:
                            videos.append(v)
                for item in (section.get("shelfRenderer", {}).get("content", {})
                                     .get("expandedShelfContentsRenderer", {}).get("items", [])):
                    vr = item.get("videoRenderer")
                    if vr:
                        v = _parse_youtubei_video_renderer(vr)
                        if v:
                            videos.append(v)
    except (KeyError, TypeError):
        pass
    return videos


async def youtubei_search(query: str, page: int = 1) -> Optional[List[Dict[str, Any]]]:
    """Search via YouTube's internal API with continuation token support for pagination."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            if page == 1:
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/search",
                    json={"context": _yt_context(), "query": query},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    videos, token = _extract_search_videos(resp.json())
                    if token:
                        _search_continuations[f"{query}:{page + 1}"] = token
                    return videos if videos else None
            else:
                token = _search_continuations.get(f"{query}:{page}")
                if not token:
                    return None
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/search",
                    json={"context": _yt_context(), "continuation": token},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    videos, next_token = _extract_continuation_videos(resp.json())
                    if next_token:
                        _search_continuations[f"{query}:{page + 1}"] = next_token
                    return videos if videos else None
    except Exception:
        pass
    return None


async def youtubei_trending(region: str = "US", lang: str = "en") -> Optional[List[Dict[str, Any]]]:
    """Fetch trending directly via YouTube's internal API."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.post(
                "https://www.youtube.com/youtubei/v1/browse",
                json={"context": _yt_context(hl=lang, gl=region), "browseId": "FEtrending"},
                headers=_YT_HEADERS,
            )
            if resp.status_code == 200:
                videos = _extract_trending_videos(resp.json())
                return videos if videos else None
    except Exception:
        pass
    return None


async def invidious_search(query: str, page: int = 1) -> Optional[List[Dict[str, Any]]]:
    """Fast video search via Invidious API — races all instances, takes first result."""
    params = {"q": query, "page": page, "sort_by": "relevance", "type": "video"}

    async def _try(client: httpx.AsyncClient, instance: str) -> Optional[List[Dict[str, Any]]]:
        try:
            resp = await client.get(f"{instance}/api/v1/search", params=params)
            if resp.status_code == 200:
                items = resp.json()
                if isinstance(items, list):
                    videos = [extract_video_card(item) for item in items if item.get("videoId")]
                    return videos if videos else None
        except Exception:
            pass
        return None

    async with httpx.AsyncClient(timeout=8.0) as client:
        tasks = {asyncio.ensure_future(_try(client, i)): i for i in _get_instances()}
        pending = set(tasks)
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done:
                result = fut.result()
                if result:
                    for p in pending:
                        p.cancel()
                    return result
    return None

# Category → Invidious trending type
INVIDIOUS_TYPES = {"music", "gaming", "news", "movies"}

# Per-category, per-language search queries
CATEGORY_SEARCH_I18N: Dict[str, Dict[str, List[str]]] = {
    "music": {
        "en": ["official music video 2024", "top songs music video"],
        "fr": ["clip officiel 2024", "meilleures chansons"],
        "es": ["video musical oficial 2024", "mejores canciones"],
        "de": ["offizielles Musikvideo 2024", "beste Lieder"],
        "pt": ["clipe oficial 2024", "melhores músicas"],
        "it": ["video musicale ufficiale 2024", "migliori canzoni"],
        "ja": ["公式ミュージックビデオ 2024", "人気曲"],
        "ko": ["공식 뮤직비디오 2024", "인기 노래"],
        "ru": ["официальный клип 2024", "лучшие песни"],
    },
    "gaming": {
        "en": ["gaming highlights 2024", "best video game gameplay"],
        "fr": ["gameplay jeux vidéo 2024", "meilleurs jeux vidéo"],
        "es": ["gameplay videojuegos 2024", "mejores juegos"],
        "de": ["Gaming Highlights 2024", "bestes Gameplay Videospiele"],
        "pt": ["gameplay jogos 2024", "melhores jogos"],
        "it": ["gameplay videogiochi 2024", "migliori giochi"],
        "ja": ["ゲーム実況 2024", "人気ゲームプレイ"],
        "ko": ["게임 하이라이트 2024", "인기 게임플레이"],
        "ru": ["геймплей игры 2024", "лучшие видеоигры"],
    },
    "news": {
        "en": ["world news today", "breaking news"],
        "fr": ["actualités du jour", "informations monde"],
        "es": ["noticias de hoy", "últimas noticias"],
        "de": ["Nachrichten heute", "aktuelle Nachrichten"],
        "pt": ["notícias de hoje", "últimas notícias"],
        "it": ["notizie di oggi", "ultime notizie"],
        "ja": ["今日のニュース", "最新ニュース"],
        "ko": ["오늘의 뉴스", "최신 뉴스"],
        "ru": ["новости сегодня", "последние новости"],
    },
    "movies": {
        "en": ["official movie trailer 2024", "film review"],
        "fr": ["bande annonce film 2024", "critique film"],
        "es": ["tráiler película 2024", "reseña película"],
        "de": ["offizieller Filmtrailer 2024", "Filmkritik"],
        "pt": ["trailer oficial filme 2024", "análise filme"],
        "it": ["trailer ufficiale film 2024", "recensione film"],
        "ja": ["映画予告編 2024", "映画レビュー"],
        "ko": ["영화 공식 예고편 2024", "영화 리뷰"],
        "ru": ["официальный трейлер фильма 2024", "обзор фильма"],
    },
}


def format_views(n: int) -> str:
    if n is None:
        return "0 views"
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B views"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M views"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K views"
    return f"{n} views"


def format_duration(seconds: int) -> str:
    if seconds is None:
        return "0:00"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def time_ago(timestamp: int) -> str:
    if not timestamp:
        return "Unknown date"
    import time
    now = int(time.time())
    diff = now - timestamp
    if diff < 60:
        return "Just now"
    if diff < 3600:
        m = diff // 60
        return f"{m} minute{'s' if m != 1 else ''} ago"
    if diff < 86400:
        h = diff // 3600
        return f"{h} hour{'s' if h != 1 else ''} ago"
    if diff < 2592000:
        d = diff // 86400
        return f"{d} day{'s' if d != 1 else ''} ago"
    if diff < 31536000:
        mo = diff // 2592000
        return f"{mo} month{'s' if mo != 1 else ''} ago"
    y = diff // 31536000
    return f"{y} year{'s' if y != 1 else ''} ago"


def extract_video_card(entry: Dict[str, Any]) -> Dict[str, Any]:
    video_id = entry.get("id") or entry.get("videoId", "")
    duration_raw = entry.get("duration") or entry.get("lengthSeconds") or 0
    if isinstance(duration_raw, str) and ":" in duration_raw:
        duration_str = duration_raw
    else:
        try:
            duration_str = format_duration(int(duration_raw))
        except (TypeError, ValueError):
            duration_str = "0:00"

    views_raw = entry.get("view_count") or entry.get("viewCount") or 0
    try:
        views_str = format_views(int(views_raw))
    except (TypeError, ValueError):
        views_str = "0 views"

    timestamp = entry.get("timestamp") or entry.get("published") or 0
    try:
        published_str = time_ago(int(timestamp))
    except (TypeError, ValueError):
        published_str = "Unknown date"

    channel_id = (
        entry.get("channel_id")
        or entry.get("authorId")
        or entry.get("uploader_id")
        or ""
    )
    channel_name = (
        entry.get("channel")
        or entry.get("author")
        or entry.get("uploader")
        or "Unknown Channel"
    )

    return {
        "id": video_id,
        "title": entry.get("title", "Unknown Title"),
        "thumbnail": f"/api/thumbnail/{video_id}",
        "duration": duration_str,
        "views": views_str,
        "published": published_str,
        "channel": {
            "id": channel_id,
            "name": channel_name,
            "thumbnail": f"/api/channel_thumbnail/{channel_id}" if channel_id else None,
        },
    }


@app.get("/api/trending")
async def get_trending(region: str = "US", category: str = "all", lang: str = "en"):
    cache_key = f"trending:{region}:{category}"
    if (cached := cache_get(cache_key)) is not None:
        return cached

    # For specific categories, Invidious trending ignores the type parameter on most
    # regions (returns same default videos). Use targeted search instead.
    if category != "all":
        safe_lang = lang if lang in ("en","fr","es","de","pt","it","ja","ko","ru") else "en"
        cat_map = CATEGORY_SEARCH_I18N.get(category, {})
        queries = cat_map.get(safe_lang) or cat_map.get("en") or [f"{category} popular", f"best {category}"]
        all_videos: List[Dict[str, Any]] = []
        seen_ids: set = set()

        # Attempt 1: YouTube internal API
        yt_tasks = [youtubei_search(q) for q in queries]
        yt_results = await asyncio.gather(*yt_tasks, return_exceptions=True)
        for r in yt_results:
            if isinstance(r, list):
                for v in r:
                    if v["id"] not in seen_ids:
                        seen_ids.add(v["id"])
                        all_videos.append(v)

        if not all_videos:
            # Attempt 2: Invidious
            inv_tasks = [invidious_search(q) for q in queries]
            inv_results = await asyncio.gather(*inv_tasks, return_exceptions=True)
            for r in inv_results:
                if isinstance(r, list):
                    for v in r:
                        if v["id"] not in seen_ids:
                            seen_ids.add(v["id"])
                            all_videos.append(v)

        if all_videos:
            result = {"videos": all_videos[:24]}
            cache_set(cache_key, result)
            return result

        # Last resort: yt-dlp
        try:
            loop = asyncio.get_event_loop()
            opts = {**YDL_OPTS_BASE, "extract_flat": True}
            ydl_videos: List[Dict[str, Any]] = []

            def _fetch(q: str):
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(f"ytsearch12:{q}", download=False)

            for q in queries[:1]:
                res = await loop.run_in_executor(None, lambda q=q: _fetch(q))
                if res and "entries" in res:
                    for entry in res["entries"]:
                        if entry and entry.get("id") and entry["id"] not in seen_ids:
                            seen_ids.add(entry["id"])
                            ydl_videos.append(extract_video_card(entry))

            if ydl_videos:
                result = {"videos": ydl_videos[:24]}
                cache_set(cache_key, result)
                return result
        except Exception:
            pass

        raise HTTPException(status_code=503, detail="Could not fetch category content")

    # For "all": attempt 1 — YouTube internal API
    yt_videos = await youtubei_trending(region=region, lang=lang)
    if yt_videos:
        result = {"videos": yt_videos[:24]}
        cache_set(cache_key, result)
        return result

    # Attempt 2: Invidious instances in parallel
    def _parse_trending_items(data: list) -> List[Dict[str, Any]]:
        videos = []
        for item in data:
            try:
                video_id = item.get("videoId", "")
                if not video_id:
                    continue
                channel_id = item.get("authorId", "")
                videos.append({
                    "id": video_id,
                    "title": item.get("title", ""),
                    "thumbnail": f"/api/thumbnail/{video_id}",
                    "duration": format_duration(int(item.get("lengthSeconds", 0))),
                    "views": format_views(int(item.get("viewCount", 0))),
                    "published": time_ago(int(item.get("published", 0))),
                    "channel": {
                        "id": channel_id,
                        "name": item.get("author", "Unknown Channel"),
                        "thumbnail": f"/api/channel_thumbnail/{channel_id}" if channel_id else None,
                    },
                })
            except Exception:
                continue
        return videos

    async def _fetch_trending(client: httpx.AsyncClient, instance: str) -> List[Dict[str, Any]]:
        try:
            resp = await client.get(
                f"{instance}/api/v1/trending",
                params={"type": "default", "region": region},
            )
            if resp.status_code == 200:
                videos = _parse_trending_items(resp.json())
                if videos:
                    return videos
        except Exception:
            pass
        return []

    async with httpx.AsyncClient(timeout=8.0) as client:
        instances = _get_instances()
        # Race all instances, return as soon as one succeeds
        tasks = {asyncio.ensure_future(_fetch_trending(client, i)): i for i in instances}
        pending = set(tasks)
        videos_result: List[Dict[str, Any]] = []
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done:
                result_videos = fut.result()
                if result_videos and not videos_result:
                    videos_result = result_videos
                    # Cancel remaining
                    for p in pending:
                        p.cancel()
                    pending = set()
                    break
        if videos_result:
            result = {"videos": videos_result}
            cache_set(cache_key, result)
            return result

    # "all" category: fallback to Invidious search if trending failed
    fallback_all: List[Dict[str, Any]] = []
    seen_all: set = set()
    for q in ["trending now", "viral videos", "popular music", "top videos"]:
        r = await invidious_search(q)
        if r:
            for v in r:
                if v["id"] not in seen_all:
                    seen_all.add(v["id"])
                    fallback_all.append(v)
        if len(fallback_all) >= 20:
            break

    if fallback_all:
        result = {"videos": fallback_all[:24]}
        cache_set(cache_key, result)
        return result

    raise HTTPException(status_code=503, detail="Could not fetch trending content")


@app.get("/api/search")
async def search_videos(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    # Attempt 1: YouTube internal API (no Invidious dependency)
    videos = await youtubei_search(q, page)
    if videos:
        return {"videos": videos, "query": q, "page": page}

    # Attempt 2: Invidious
    videos = await invidious_search(q, page)
    if videos:
        return {"videos": videos, "query": q, "page": page}

    # Fallback: yt-dlp search
    try:
        offset = (page - 1) * 20
        search_query = f"ytsearch{20 + offset}:{q}"
        opts = {**YDL_OPTS_BASE, "extract_flat": True}
        loop = asyncio.get_event_loop()

        def _search():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(search_query, download=False)

        info = await loop.run_in_executor(None, _search)
        entries = info.get("entries", []) if info else []
        page_entries = entries[offset:offset + 20] if offset < len(entries) else entries
        fallback_videos = [extract_video_card(e) for e in page_entries if e and e.get("id")]
        return {"videos": fallback_videos, "query": q, "page": page}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.get("/api/video/{video_id}")
async def get_video(video_id: str):
    try:
        opts = {
            **YDL_OPTS_BASE,
            "format": "bestvideo+bestaudio/best",
        }

        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")

        formats = []
        seen_itags = set()
        for fmt in info.get("formats", []):
            itag = fmt.get("format_id")
            if itag in seen_itags:
                continue
            seen_itags.add(itag)

            has_video = fmt.get("vcodec", "none") != "none"
            has_audio = fmt.get("acodec", "none") != "none"
            height = fmt.get("height")
            ext = fmt.get("ext", "mp4")
            filesize = fmt.get("filesize") or fmt.get("filesize_approx")

            if has_video:
                quality = f"{height}p" if height else fmt.get("format_note", "unknown")
            elif has_audio:
                abr = fmt.get("abr")
                quality = f"{int(abr)}k audio" if abr else fmt.get("format_note", "audio")
            else:
                continue

            formats.append(
                {
                    "itag": itag,
                    "ext": ext,
                    "quality": quality,
                    "filesize": filesize,
                    "hasAudio": has_audio,
                    "hasVideo": has_video,
                    "height": height or 0,
                    "abr": fmt.get("abr") or 0,
                }
            )

        # Sort: combined first (has both), then video-only (by height desc), then audio-only
        def sort_key(f):
            if f["hasVideo"] and f["hasAudio"]:
                return (0, -(f["height"] or 0))
            elif f["hasVideo"]:
                return (1, -(f["height"] or 0))
            else:
                return (2, -(f["abr"] or 0))

        formats.sort(key=sort_key)

        # Related videos — try metadata first, then fallback to channel search
        related: List[Dict[str, Any]] = []
        for entry in info.get("related_videos", [])[:10]:
            if entry and entry.get("id"):
                related.append(extract_video_card(entry))

        if len(related) < 5:
            channel_name_for_search = info.get("channel") or info.get("uploader") or ""
            search_q = channel_name_for_search or info.get("title", "")[:40]
            if search_q:
                try:
                    opts_rel = {**YDL_OPTS_BASE, "extract_flat": True}

                    def _search_related():
                        with yt_dlp.YoutubeDL(opts_rel) as ydl:
                            return ydl.extract_info(f"ytsearch12:{search_q}", download=False)

                    rel_info = await loop.run_in_executor(None, _search_related)
                    if rel_info and "entries" in rel_info:
                        existing_ids = {r["id"] for r in related} | {video_id}
                        for entry in rel_info["entries"]:
                            if entry and entry.get("id") and entry["id"] not in existing_ids:
                                related.append(extract_video_card(entry))
                                existing_ids.add(entry["id"])
                                if len(related) >= 12:
                                    break
                except Exception:
                    pass

        timestamp = info.get("timestamp") or info.get("release_timestamp") or 0
        views_raw = info.get("view_count", 0) or 0
        likes_raw = info.get("like_count", 0) or 0

        channel_id = info.get("channel_id") or info.get("uploader_id") or ""
        channel_name = info.get("channel") or info.get("uploader") or "Unknown Channel"
        subscriber_count = info.get("channel_follower_count") or 0

        is_live = bool(info.get("is_live") or info.get("was_live"))

        return {
            "id": video_id,
            "title": info.get("title", ""),
            "thumbnail": f"/api/thumbnail/{video_id}",
            "duration": format_duration(info.get("duration", 0) or 0),
            "views": format_views(views_raw),
            "viewCount": views_raw,
            "published": time_ago(int(timestamp)) if timestamp else "Unknown date",
            "uploadDate": info.get("upload_date", ""),
            "description": info.get("description", ""),
            "isLive": is_live,
            "likes": f"{likes_raw:,}" if likes_raw else "N/A",
            "formats": formats,
            "related": related,
            "channel": {
                "id": channel_id,
                "name": channel_name,
                "thumbnail": f"/api/channel_thumbnail/{channel_id}" if channel_id else None,
                "subscriberCount": subscriber_count,
            },
        }
    except HTTPException:
        raise
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("not available", "private video", "has been removed", "age-restricted", "sign in", "unavailable")):
            raise HTTPException(status_code=404, detail="This video is unavailable in your region or has been removed.")
        raise HTTPException(status_code=500, detail=f"Failed to get video info: {str(e)}")


@app.get("/api/live/{video_id}")
async def get_live_stream(video_id: str):
    """Returns our proxied HLS URL — avoids CORS/auth issues with YouTube CDN."""
    return {"url": f"/api/live/{video_id}/hls", "type": "m3u8"}


@app.get("/api/live/{video_id}/hls")
async def live_hls_master(video_id: str, request: Request):
    """Fetch the YouTube live HLS master playlist and rewrite URLs through our proxy."""
    try:
        loop = asyncio.get_event_loop()

        # Use cached URL if still fresh, otherwise fetch via yt-dlp
        hls_url = live_url_cache_get(video_id)
        if not hls_url:
            def _get_hls():
                with yt_dlp.YoutubeDL({**YDL_OPTS_BASE}) as ydl:
                    info = ydl.extract_info(
                        f"https://www.youtube.com/watch?v={video_id}", download=False
                    )
                    if not info:
                        return None
                    for fmt in info.get("formats", []):
                        proto = fmt.get("protocol", "")
                        ext = fmt.get("ext", "")
                        url = fmt.get("url", "")
                        if proto in ("m3u8", "m3u8_native") or ext == "m3u8":
                            return url
                    # Fall back to manifest_url or direct url
                    return info.get("manifest_url") or info.get("url")

            hls_url = await loop.run_in_executor(None, _get_hls)
            if not hls_url:
                raise HTTPException(status_code=404, detail="No HLS stream found for this video")
            live_url_cache_set(video_id, hls_url)

        # Determine the proxy base URL (same host as this request)
        base = str(request.base_url).rstrip("/")
        proxy_base = f"{base}/api/hls-proxy"

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(hls_url, headers=YOUTUBE_HEADERS)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"YouTube returned {resp.status_code}")

        rewritten = rewrite_hls_manifest(resp.text, str(resp.url), proxy_base)

        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-store"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Live stream error: {str(e)}")


@app.get("/api/hls-proxy")
async def hls_proxy(url: str, request: Request):
    """Generic HLS reverse proxy — fetches manifests/segments from YouTube with proper headers."""
    try:
        # Decode the base64url-encoded URL (strip padding first)
        decoded_url = base64.urlsafe_b64decode(url + "==").decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL encoding")

    try:
        base = str(request.base_url).rstrip("/")
        proxy_base = f"{base}/api/hls-proxy"

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(decoded_url, headers=YOUTUBE_HEADERS)

        ct = resp.headers.get("content-type", "")

        # If it's an m3u8 sub-playlist, rewrite its URLs too
        if "mpegurl" in ct or decoded_url.split("?")[0].endswith(".m3u8"):
            rewritten = rewrite_hls_manifest(resp.text, decoded_url, proxy_base)
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
                headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-store"},
            )

        # TS segment or key file — stream it back
        return Response(
            content=resp.content,
            media_type=ct or "video/mp2t",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {str(e)}")


@app.get("/api/stream/{video_id}/audio")
async def stream_audio(video_id: str, request: Request):
    """Stream the best audio-only track (for dual video+audio playback in the browser)."""
    try:
        opts = {**YDL_OPTS_BASE, "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"}
        loop = asyncio.get_event_loop()

        def _get_url():
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                if not info:
                    return None, "m4a"
                return info.get("url"), info.get("ext", "m4a")

        direct_url, ext = await loop.run_in_executor(None, _get_url)
        if not direct_url:
            raise HTTPException(status_code=404, detail="Audio stream not found")

        range_header = request.headers.get("range")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.youtube.com/",
        }
        if range_header:
            headers["Range"] = range_header

        content_type = "audio/mp4" if ext in ("m4a", "mp4") else f"audio/{ext}"

        async def stream_generator():
            async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", direct_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            head_resp = await client.head(direct_url, headers=headers)
        response_headers = {
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        }
        if cl := head_resp.headers.get("content-length"):
            response_headers["Content-Length"] = cl
        if cr := head_resp.headers.get("content-range"):
            response_headers["Content-Range"] = cr

        return StreamingResponse(
            stream_generator(),
            status_code=206 if range_header else 200,
            headers=response_headers,
            media_type=content_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio stream error: {str(e)}")


@app.get("/api/stream/{video_id}")
async def stream_video(video_id: str, request: Request, itag: Optional[str] = None):
    try:
        opts = {
            **YDL_OPTS_BASE,
            "format": itag if itag else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        }

        loop = asyncio.get_event_loop()

        def _get_url():
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                if not info:
                    return None, None
                # If specific itag requested, find matching format
                if itag:
                    for fmt in info.get("formats", []):
                        if str(fmt.get("format_id")) == str(itag):
                            return fmt.get("url"), fmt.get("ext", "mp4")
                # Otherwise return best format URL
                return info.get("url"), info.get("ext", "mp4")

        direct_url, ext = await loop.run_in_executor(None, _get_url)

        if not direct_url:
            raise HTTPException(status_code=404, detail="Stream URL not found")

        range_header = request.headers.get("range")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.youtube.com/",
        }
        if range_header:
            headers["Range"] = range_header

        content_type = "video/mp4" if ext in ("mp4", "m4v") else f"video/{ext}"

        async def stream_generator():
            async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", direct_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        # Make a head request to get content length and determine status
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            head_resp = await client.head(direct_url, headers=headers)
            response_headers = {
                "Content-Type": content_type,
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
            }
            content_length = head_resp.headers.get("content-length")
            content_range = head_resp.headers.get("content-range")
            if content_length:
                response_headers["Content-Length"] = content_length
            if content_range:
                response_headers["Content-Range"] = content_range

            status_code = 206 if range_header else 200

        return StreamingResponse(
            stream_generator(),
            status_code=status_code,
            headers=response_headers,
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Streaming failed: {str(e)}")


@app.get("/api/thumbnail/{video_id}")
async def get_thumbnail(video_id: str):
    cached = thumb_cache_get(video_id)
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        for quality in ["hqdefault", "mqdefault", "default"]:
            try:
                url = f"https://i.ytimg.com/vi/{video_id}/{quality}.jpg"
                resp = await client.get(url)
                if resp.status_code == 200:
                    thumb_cache_set(video_id, resp.content, "image/jpeg")
                    return Response(
                        content=resp.content,
                        media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=3600"},
                    )
            except Exception:
                continue
    raise HTTPException(status_code=404, detail="Thumbnail not found")


@app.get("/api/debug/channel_thumbnails/{channel_id}")
async def debug_channel_thumbnails(channel_id: str):
    opts = {**YDL_OPTS_BASE, "extract_flat": True, "playlistend": 1}
    loop = asyncio.get_event_loop()
    def _fetch():
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(f"https://www.youtube.com/channel/{channel_id}", download=False)
    info = await loop.run_in_executor(None, _fetch)
    if not info:
        return {"error": "not found"}
    return {"thumbnails": info.get("thumbnails", [])}


async def _get_avatar_url_via_youtubei(channel_id: str) -> Optional[str]:
    """Fetch channel avatar URL directly via YouTube's internal API (same as Invidious)."""
    payload = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
                "hl": "en",
                "gl": "US",
            }
        },
        "browseId": channel_id,
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20240101.00.00",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.post(
                "https://www.youtube.com/youtubei/v1/browse",
                json=payload,
                headers=headers,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            thumbnails = (
                data.get("metadata", {})
                    .get("channelMetadataRenderer", {})
                    .get("avatar", {})
                    .get("thumbnails", [])
            )
            if thumbnails:
                best = max(thumbnails, key=lambda t: t.get("width", 0))
                return best.get("url")
    except Exception:
        pass
    return None


@app.get("/api/channel_thumbnail/{channel_id}")
async def get_channel_thumbnail(channel_id: str):
    cached = thumb_cache_get(f"avatar:{channel_id}")
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        # Attempt 1: /youtubei/v1/browse (fast, no yt-dlp)
        avatar_yt_url = await _get_avatar_url_via_youtubei(channel_id)

        if avatar_yt_url:
            parsed = urlparse(avatar_yt_url)
            hash_part = parsed.path.lstrip('/').split('=')[0]
            for instance in _get_instances():
                try:
                    proxy_url = f"{instance}/ggpht/{hash_part}=s900-c-k-c0x00ffffff-no-rj"
                    img = await client.get(proxy_url)
                    if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                        ct = img.headers.get("content-type", "image/jpeg")
                        thumb_cache_set(f"avatar:{channel_id}", img.content, ct)
                        return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                except Exception:
                    continue

        # Attempt 2: fallback via yt-dlp
        try:
            thumbnails = await _get_channel_thumbnails(channel_id)
            avatar_yt_url = None
            for t in thumbnails:
                if t.get("id") == "avatar_uncropped":
                    avatar_yt_url = t.get("url")
                    break
            if not avatar_yt_url:
                for t in sorted(thumbnails, key=lambda x: x.get("width", 0), reverse=True):
                    w, h = t.get("width", 0), t.get("height", 0)
                    if w and h and w == h:
                        avatar_yt_url = t.get("url")
                        break
            if avatar_yt_url:
                parsed = urlparse(avatar_yt_url)
                hash_part = parsed.path.lstrip('/').split('=')[0]
                for instance in _get_instances():
                    try:
                        proxy_url = f"{instance}/ggpht/{hash_part}=s900-c-k-c0x00ffffff-no-rj"
                        img = await client.get(proxy_url)
                        if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                            ct = img.headers.get("content-type", "image/jpeg")
                            thumb_cache_set(f"avatar:{channel_id}", img.content, ct)
                            return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                    except Exception:
                        continue
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="Channel thumbnail not found")


@app.get("/api/download/{video_id}")
async def download_video(
    video_id: str,
    itag: Optional[str] = None,
    format: str = "mp4",
    quality: str = "best",
):
    try:
        if itag:
            fmt_selector = itag
        elif format == "mp3":
            fmt_selector = "bestaudio[ext=m4a]/bestaudio"
        elif quality == "best":
            fmt_selector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        else:
            height_map = {"1080p": 1080, "720p": 720, "480p": 480, "360p": 360}
            h = height_map.get(quality, 720)
            fmt_selector = f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={h}][ext=mp4]/best"

        opts = {**YDL_OPTS_BASE, "format": fmt_selector}
        loop = asyncio.get_event_loop()

        def _get_info():
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                if not info:
                    return None, None, None
                if itag:
                    for fmt in info.get("formats", []):
                        if str(fmt.get("format_id")) == str(itag):
                            return fmt.get("url"), info.get("title", video_id), fmt.get("ext", "mp4")
                return info.get("url"), info.get("title", video_id), info.get("ext", "mp4")

        direct_url, title, ext = await loop.run_in_executor(None, _get_info)

        if not direct_url:
            raise HTTPException(status_code=404, detail="Download URL not found")

        # Sanitize filename
        safe_title = re.sub(r'[^\w\s-]', '', title or video_id).strip()
        safe_title = re.sub(r'[-\s]+', '-', safe_title)[:100]
        filename = f"{safe_title}.{ext}"

        async def download_generator():
            async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
                async with client.stream(
                    "GET",
                    direct_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://www.youtube.com/",
                    },
                ) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        return StreamingResponse(
            download_generator(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-cache",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


async def _get_banner_url_via_youtubei(channel_id: str) -> Optional[str]:
    """Fetch channel banner URL directly via YouTube's internal API (same as Invidious)."""
    payload = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20240101.00.00",
                "hl": "en",
                "gl": "US",
            }
        },
        "browseId": channel_id,
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": "2.20240101.00.00",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.post(
                "https://www.youtube.com/youtubei/v1/browse",
                json=payload,
                headers=headers,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            # Standard channel header
            thumbnails = (
                data.get("header", {})
                    .get("c4TabbedHeaderRenderer", {})
                    .get("banner", {})
                    .get("thumbnails", [])
            )
            # Fallback: pageHeaderRenderer
            if not thumbnails:
                thumbnails = (
                    data.get("header", {})
                        .get("pageHeaderRenderer", {})
                        .get("content", {})
                        .get("pageHeaderViewModel", {})
                        .get("banner", {})
                        .get("imageBannerViewModel", {})
                        .get("image", {})
                        .get("sources", [])
                )
            if thumbnails:
                best = max(thumbnails, key=lambda t: t.get("width", 0))
                return best.get("url")
    except Exception:
        pass
    return None


@app.get("/api/channel_banner/{channel_id}")
async def get_channel_banner(channel_id: str):
    cached = thumb_cache_get(f"banner:{channel_id}")
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        # Attempt 1: /youtubei/v1/browse (fast, no yt-dlp)
        banner_yt_url = await _get_banner_url_via_youtubei(channel_id)

        if banner_yt_url:
            parsed = urlparse(banner_yt_url)
            path_with_params = parsed.path.lstrip('/')
            try:
                img = await client.get(banner_yt_url)
                if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                    ct = img.headers.get("content-type", "image/jpeg")
                    thumb_cache_set(f"banner:{channel_id}", img.content, ct)
                    return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
            except Exception:
                pass
            for instance in _get_instances():
                try:
                    proxy_url = f"{instance}/ggpht/{path_with_params}"
                    img = await client.get(proxy_url)
                    if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                        ct = img.headers.get("content-type", "image/jpeg")
                        thumb_cache_set(f"banner:{channel_id}", img.content, ct)
                        return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                except Exception:
                    continue

        # Attempt 2: fallback via yt-dlp
        try:
            thumbnails = await _get_channel_thumbnails(channel_id)
            banner_yt_url = None
            for t in sorted(thumbnails, key=lambda x: x.get("width", 0), reverse=True):
                if t.get("id") == "banner_uncropped":
                    continue
                url = t.get("url", "")
                if t.get("preference") == -10 or "fcrop64" in url:
                    banner_yt_url = url
                    break

            if banner_yt_url:
                parsed = urlparse(banner_yt_url)
                path_with_params = parsed.path.lstrip('/')
                try:
                    img = await client.get(banner_yt_url)
                    if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                        ct = img.headers.get("content-type", "image/jpeg")
                        thumb_cache_set(f"banner:{channel_id}", img.content, ct)
                        return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                except Exception:
                    pass
                for instance in _get_instances():
                    try:
                        proxy_url = f"{instance}/ggpht/{path_with_params}"
                        img = await client.get(proxy_url)
                        if img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"):
                            ct = img.headers.get("content-type", "image/jpeg")
                            thumb_cache_set(f"banner:{channel_id}", img.content, ct)
                            return Response(content=img.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                    except Exception:
                        continue
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="Banner not found")


@app.get("/api/channel/{channel_id}")
async def get_channel(channel_id: str):
    try:
        opts = {**YDL_OPTS_BASE, "extract_flat": True, "playlistend": 1}
        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/channel/{channel_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
        if not info:
            raise HTTPException(status_code=404, detail="Channel not found")

        subscriber_count = info.get("channel_follower_count") or 0
        thumbnails = info.get("thumbnails", [])
        avatar_url = None
        if thumbnails:
            avatar_url = f"/api/channel_thumbnail/{channel_id}"

        return {
            "id": channel_id,
            "name": info.get("channel") or info.get("uploader") or info.get("title") or "Unknown",
            "description": info.get("description", ""),
            "subscriberCount": subscriber_count,
            "videoCount": info.get("playlist_count") or 0,
            "thumbnail": avatar_url,
            "banner": f"/api/channel_banner/{channel_id}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get channel: {str(e)}")


@app.get("/api/channel/{channel_id}/videos")
async def get_channel_videos(channel_id: str, page: int = Query(1, ge=1)):
    # Attempt 1: YouTube internal API with pagination
    videos = await youtubei_channel_videos(channel_id, page)
    if videos:
        return {"videos": videos, "channelId": channel_id, "page": page}

    # Attempt 2: Invidious
    async with httpx.AsyncClient(timeout=10.0) as client:
        for instance in _get_instances():
            try:
                resp = await client.get(
                    f"{instance}/api/v1/channels/{channel_id}/videos",
                    params={"page": page},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    items = data.get("videos", [])
                    if items:
                        videos = [extract_video_card(item) for item in items if item.get("videoId")]
                        return {"videos": videos, "channelId": channel_id, "page": page}
            except Exception:
                continue

    # Fallback: yt-dlp (enriches channel info from what we know)
    try:
        start = (page - 1) * 20 + 1
        end = page * 20
        opts = {
            **YDL_OPTS_BASE,
            "extract_flat": True,
            "playliststart": start,
            "playlistend": end,
        }
        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/channel/{channel_id}/videos", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
        channel_name = (info.get("channel") or info.get("uploader") or info.get("title") or "") if info else ""
        videos = []
        if info and "entries" in info:
            for entry in info["entries"]:
                if entry and entry.get("id"):
                    card = extract_video_card(entry)
                    # Enrich with channel info since flat extraction omits it
                    if card["channel"]["name"] == "Unknown Channel" and channel_name:
                        card["channel"]["id"] = channel_id
                        card["channel"]["name"] = channel_name
                        card["channel"]["thumbnail"] = f"/api/channel_thumbnail/{channel_id}"
                    videos.append(card)

        return {"videos": videos, "channelId": channel_id, "page": page}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get channel videos: {str(e)}")


# ─── YouTube Music ──────────────────────────────────────────────────────────

from ytmusicapi import YTMusic as _YTMusic

_ytm: Optional[_YTMusic] = None

def get_ytm() -> _YTMusic:
    global _ytm
    if _ytm is None:
        _ytm = _YTMusic()
    return _ytm


def _thumb_url(thumbnails: list) -> Optional[str]:
    if not thumbnails:
        return None
    return max(thumbnails, key=lambda t: t.get("width", 0)).get("url")


def _fmt_duration(ms: Optional[int]) -> str:
    if not ms:
        return ""
    s = ms // 1000
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


@app.get("/api/music/charts")
async def music_charts(country: str = "ZZ"):
    """Top charts from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_charts(country=country)
            songs = []
            for item in data.get("songs", {}).get("items", [])[:30]:
                songs.append({
                    "videoId": item.get("videoId"),
                    "title": item.get("title"),
                    "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                    "album": item.get("album", {}).get("name") if item.get("album") else None,
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "duration": item.get("duration"),
                    "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                    "rank": item.get("rank"),
                })
            trending = []
            for item in data.get("trending", {}).get("items", [])[:20]:
                trending.append({
                    "videoId": item.get("videoId"),
                    "title": item.get("title"),
                    "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "duration": item.get("duration"),
                })
            return {"songs": songs, "trending": trending}
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Charts error: {str(e)}")


@app.get("/api/music/search")
async def music_search(q: str, filter: str = "songs"):
    """Search YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            allowed = {"songs", "albums", "artists", "playlists", "community_playlists"}
            f = filter if filter in allowed else "songs"
            results = ytm.search(q, filter=f, limit=30)
            out = []
            for item in results:
                kind = item.get("resultType", "")
                if kind == "song" or kind == "video":
                    out.append({
                        "type": "song",
                        "videoId": item.get("videoId"),
                        "title": item.get("title"),
                        "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                        "album": item.get("album", {}).get("name") if item.get("album") else None,
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "duration": item.get("duration"),
                        "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                    })
                elif kind == "album":
                    out.append({
                        "type": "album",
                        "browseId": item.get("browseId"),
                        "title": item.get("title"),
                        "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "year": item.get("year"),
                        "albumType": item.get("type"),
                    })
                elif kind == "artist":
                    out.append({
                        "type": "artist",
                        "browseId": item.get("browseId"),
                        "name": item.get("artist"),
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "subscribers": item.get("subscribers"),
                    })
                elif kind == "playlist":
                    out.append({
                        "type": "playlist",
                        "browseId": item.get("browseId"),
                        "playlistId": item.get("playlistId"),
                        "title": item.get("title"),
                        "author": item.get("author"),
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "itemCount": item.get("itemCount"),
                    })
            return out
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Music search error: {str(e)}")


@app.get("/api/music/artist/{browse_id}")
async def music_artist(browse_id: str):
    """Artist page from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_artist(browse_id)
            songs = []
            for item in data.get("songs", {}).get("results", [])[:10]:
                songs.append({
                    "videoId": item.get("videoId"),
                    "title": item.get("title"),
                    "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                    "album": item.get("album", {}).get("name") if item.get("album") else None,
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "duration": item.get("duration"),
                    "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                })
            albums = []
            for item in data.get("albums", {}).get("results", [])[:12]:
                albums.append({
                    "browseId": item.get("browseId"),
                    "title": item.get("title"),
                    "year": item.get("year"),
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "albumType": item.get("type"),
                })
            singles = []
            for item in data.get("singles", {}).get("results", [])[:12]:
                singles.append({
                    "browseId": item.get("browseId"),
                    "title": item.get("title"),
                    "year": item.get("year"),
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                })
            related = []
            for item in data.get("related", {}).get("results", [])[:8]:
                related.append({
                    "browseId": item.get("browseId"),
                    "name": item.get("title"),
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "subscribers": item.get("subscribers"),
                })
            return {
                "browseId": browse_id,
                "name": data.get("name"),
                "description": data.get("description"),
                "subscribers": data.get("subscribers"),
                "thumbnail": _thumb_url(data.get("thumbnails", [])),
                "songs": songs,
                "albums": albums,
                "singles": singles,
                "related": related,
            }
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Artist error: {str(e)}")


@app.get("/api/music/album/{browse_id}")
async def music_album(browse_id: str):
    """Album page from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_album(browse_id)
            tracks = []
            for item in data.get("tracks", []):
                tracks.append({
                    "videoId": item.get("videoId"),
                    "title": item.get("title"),
                    "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                    "duration": item.get("duration"),
                    "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                    "trackNumber": item.get("trackNumber"),
                    "isExplicit": item.get("isExplicit", False),
                    "thumbnail": _thumb_url(item.get("thumbnails", [])) or _thumb_url(data.get("thumbnails", [])),
                })
            artists = [{"id": a.get("id"), "name": a.get("name")} for a in data.get("artists", [])]
            return {
                "browseId": browse_id,
                "title": data.get("title"),
                "artists": artists,
                "year": data.get("year"),
                "description": data.get("description"),
                "thumbnail": _thumb_url(data.get("thumbnails", [])),
                "trackCount": data.get("trackCount"),
                "duration": data.get("duration"),
                "audioPlaylistId": data.get("audioPlaylistId"),
                "tracks": tracks,
            }
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Album error: {str(e)}")


@app.get("/api/music/playlist/{playlist_id}")
async def music_playlist(playlist_id: str):
    """Playlist from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_playlist(playlist_id, limit=100)
            tracks = []
            for item in data.get("tracks", []):
                if not item.get("videoId"):
                    continue
                tracks.append({
                    "videoId": item.get("videoId"),
                    "title": item.get("title"),
                    "artists": [{"id": a.get("id"), "name": a.get("name")} for a in (item.get("artists") or [])],
                    "album": item.get("album", {}).get("name") if item.get("album") else None,
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "duration": item.get("duration"),
                    "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                })
            return {
                "playlistId": playlist_id,
                "title": data.get("title"),
                "description": data.get("description"),
                "thumbnail": _thumb_url(data.get("thumbnails", [])),
                "trackCount": data.get("trackCount"),
                "author": data.get("author", [{}])[0].get("name") if data.get("author") else None,
                "tracks": tracks,
            }
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Playlist error: {str(e)}")


@app.get("/api/music/song/{video_id}")
async def music_song(video_id: str):
    """Get song metadata from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_song(video_id)
            details = data.get("videoDetails", {})
            return {
                "videoId": video_id,
                "title": details.get("title"),
                "artist": details.get("author"),
                "thumbnail": _thumb_url(details.get("thumbnail", {}).get("thumbnails", [])),
                "durationMs": int(details.get("lengthSeconds", 0)) * 1000,
                "related": [
                    {
                        "videoId": r.get("videoId"),
                        "title": r.get("title"),
                        "artists": [{"name": a.get("name"), "id": a.get("id")} for a in r.get("artists", [])],
                        "thumbnail": _thumb_url(r.get("thumbnails", [])),
                        "duration": r.get("duration"),
                    }
                    for r in data.get("related", [])[:10]
                ],
            }
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Song error: {str(e)}")


@app.get("/api/music/podcasts/search")
async def music_podcasts_search(q: str = "", lang: str = "en"):
    """Search podcasts on YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            results = ytm.search(q if q.strip() else "podcast", filter="podcasts")
            podcasts = []
            for item in results[:20]:
                podcasts.append({
                    "browseId": item.get("browseId"),
                    "playlistId": item.get("browseId"),
                    "title": item.get("title"),
                    "author": item.get("author") or (item.get("podcasters", [{}])[0].get("name") if item.get("podcasters") else None),
                    "thumbnail": _thumb_url(item.get("thumbnails", [])),
                    "episodes": item.get("episodes"),
                })
            return [p for p in podcasts if p["browseId"]]
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Podcast search error: {str(e)}")


@app.get("/api/music/podcast/{browse_id}")
async def music_podcast(browse_id: str):
    """Get podcast details and episodes from YouTube Music."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            data = ytm.get_podcast(browse_id)
            episodes = []
            episodes_data = data.get("episodes") or {}
            for ep in (episodes_data.get("results", []) or [])[:50]:
                episodes.append({
                    "videoId": ep.get("videoId"),
                    "title": ep.get("title"),
                    "description": ep.get("description", {}).get("text") if isinstance(ep.get("description"), dict) else ep.get("description"),
                    "thumbnail": _thumb_url(ep.get("thumbnails", [])),
                    "duration": ep.get("duration"),
                    "date": ep.get("date"),
                    "index": ep.get("index"),
                })
            podcasters = data.get("author", {})
            return {
                "browseId": browse_id,
                "title": data.get("title"),
                "author": podcasters.get("name") if isinstance(podcasters, dict) else str(podcasters),
                "description": data.get("description", {}).get("text") if isinstance(data.get("description"), dict) else data.get("description"),
                "thumbnail": _thumb_url(data.get("thumbnails", [])),
                "episodes": [e for e in episodes if e["videoId"]],
            }
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Podcast error: {str(e)}")


@app.get("/api/music/home")
async def music_home():
    """YouTube Music home — mix of charts + new releases."""
    loop = asyncio.get_event_loop()
    try:
        def _get():
            ytm = get_ytm()
            try:
                charts = ytm.get_charts(country="ZZ")
                songs = []
                for item in charts.get("songs", {}).get("items", [])[:20]:
                    songs.append({
                        "videoId": item.get("videoId"),
                        "title": item.get("title"),
                        "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                        "album": item.get("album", {}).get("name") if item.get("album") else None,
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "duration": item.get("duration"),
                        "durationMs": item.get("duration_seconds", 0) * 1000 if item.get("duration_seconds") else 0,
                    })
                trending = []
                for item in charts.get("trending", {}).get("items", [])[:20]:
                    trending.append({
                        "videoId": item.get("videoId"),
                        "title": item.get("title"),
                        "artists": [{"id": a.get("id"), "name": a.get("name")} for a in item.get("artists", [])],
                        "thumbnail": _thumb_url(item.get("thumbnails", [])),
                        "duration": item.get("duration"),
                    })
                return {"topSongs": songs, "trending": trending}
            except Exception:
                return {"topSongs": [], "trending": []}
        result = await loop.run_in_executor(None, _get)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Music home error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
