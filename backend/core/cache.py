"""In-memory TTL caches shared across the MyTube backend."""
import asyncio
from time import time as _time
from typing import Any, Dict, Optional

import yt_dlp
from cachetools import TTLCache

from services.innertube import get_ydl_opts

# Simple TTL cache (trending/search results) — bounded to 200 entries
CACHE_TTL = 300  # 5 minutes
_cache: TTLCache = TTLCache(maxsize=200, ttl=CACHE_TTL)


def cache_get(key: str) -> Optional[Any]:
    return _cache.get(key)


def cache_set(key: str, data: Any) -> None:
    _cache[key] = data


# In-memory thumbnail cache (1 hour TTL) — bounded to 500 entries (~image bytes)
THUMB_CACHE_TTL = 3600
_thumb_cache: TTLCache = TTLCache(maxsize=500, ttl=THUMB_CACHE_TTL)


def thumb_cache_get(key: str):
    return _thumb_cache.get(key)


def thumb_cache_set(key: str, data: bytes, ct: str) -> None:
    _thumb_cache[key] = (data, ct)


# Cache for raw yt-dlp channel thumbnails list (shared between avatar + banner)
_channel_thumbs_cache: TTLCache = TTLCache(maxsize=200, ttl=THUMB_CACHE_TTL)


def _channel_thumbs_cache_get(channel_id: str):
    return _channel_thumbs_cache.get(channel_id)


def _channel_thumbs_cache_set(channel_id: str, data: list) -> None:
    _channel_thumbs_cache[channel_id] = data


async def _get_channel_thumbnails(channel_id: str) -> list:
    cached = _channel_thumbs_cache_get(channel_id)
    if cached is not None:
        return cached
    opts = get_ydl_opts(**{"extract_flat": True, "playlistend": 1})
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


# Cache for direct stream URLs (YouTube CDN URLs last ~6h — we cache for 3h)
_stream_url_cache: Dict[str, tuple] = {}
STREAM_URL_TTL = 10800  # 3 hours


def stream_url_cache_get(key: str) -> Optional[tuple]:
    if key in _stream_url_cache:
        ts, url, ext = _stream_url_cache[key]
        if _time() - ts < STREAM_URL_TTL:
            return url, ext
        del _stream_url_cache[key]
    return None


def stream_url_cache_set(key: str, url: str, ext: str) -> None:
    _stream_url_cache[key] = (_time(), url, ext)


def stream_url_cache_invalidate(video_id: str) -> None:
    """Remove all cached URLs for a given video (e.g. after a 403 error)."""
    keys = [k for k in _stream_url_cache if k.startswith(f"stream:{video_id}:")]
    for k in keys:
        del _stream_url_cache[k]
