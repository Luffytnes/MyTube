"""Podcast Index API routes and shared podcast helpers."""
import asyncio
import hashlib
import json
import os
import urllib.parse
from time import time as _time
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from services.innertube import httpx_client
from core.security import validate_proxy_url

router = APIRouter()

PODCAST_INDEX_KEY    = os.getenv("PODCAST_INDEX_KEY", "")
PODCAST_INDEX_SECRET = os.getenv("PODCAST_INDEX_SECRET", "")
PODCAST_INDEX_BASE   = "https://api.podcastindex.org/api/1.0"
PODCAST_CONFIG_FILE  = os.path.join(os.path.expanduser("~"), ".mytube", "podcast_config.json")

# Runtime override (set via settings UI, persisted to disk)
_pi_key_override: str = ""
_pi_secret_override: str = ""


def _podcast_config_load() -> dict:
    try:
        with open(PODCAST_CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _podcast_config_save():
    try:
        os.makedirs(os.path.dirname(PODCAST_CONFIG_FILE), exist_ok=True)
        with open(PODCAST_CONFIG_FILE, "w") as f:
            json.dump({"key": _pi_key_override, "secret": _pi_secret_override}, f)
    except Exception:
        pass


# Restore saved keys on startup
_pi_saved = _podcast_config_load()
if _pi_saved.get("key"):
    _pi_key_override = _pi_saved["key"]
if _pi_saved.get("secret"):
    _pi_secret_override = _pi_saved["secret"]


def _pi_effective_key() -> str:
    return _pi_key_override or PODCAST_INDEX_KEY


def _pi_effective_secret() -> str:
    return _pi_secret_override or PODCAST_INDEX_SECRET


def _pi_headers() -> dict:
    key = _pi_effective_key()
    secret = _pi_effective_secret()
    ts = str(int(_time()))
    auth = hashlib.sha1(f"{key}{secret}{ts}".encode()).hexdigest()
    return {
        "X-Auth-Key": key,
        "X-Auth-Date": ts,
        "Authorization": auth,
        "User-Agent": "MyTube/1.0",
    }


def _pi_configured() -> bool:
    return bool(_pi_effective_key() and _pi_effective_secret())


@router.get("/api/podcasts/config")
async def get_podcast_config():
    """Return current Podcast Index config (secret masked)."""
    return {
        "key": _pi_effective_key(),
        "secret": "set" if _pi_effective_secret() else "",
    }


@router.post("/api/podcasts/config")
async def set_podcast_config(body: dict):
    """Update Podcast Index API key and secret at runtime (persisted to disk)."""
    global _pi_key_override, _pi_secret_override
    if key := body.get("key"):
        _pi_key_override = key.strip()
    if secret := body.get("secret"):
        _pi_secret_override = secret.strip()
    _podcast_config_save()
    return {"ok": True}


def _fmt_duration(secs: Optional[int]) -> Optional[str]:
    if not secs:
        return None
    h, rem = divmod(int(secs), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _fmt_date(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%d %b %Y")


@router.get("/api/podcasts/image/proxy")
async def podcast_image_proxy(url: str):
    """Proxy podcast/radio artwork to avoid third-party tracker exposure."""
    # Transparent 1×1 GIF returned on any error so clients don't log 404s
    _EMPTY_GIF = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    if not url or url == "null" or not url.startswith("http"):
        return Response(content=_EMPTY_GIF, media_type="image/gif",
                        headers={"Cache-Control": "public, max-age=3600"})
    try:
        await asyncio.to_thread(validate_proxy_url, url)
    except HTTPException:
        return Response(content=_EMPTY_GIF, media_type="image/gif",
                        headers={"Cache-Control": "public, max-age=3600"})
    try:
        async with httpx_client(timeout=8.0) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
            if resp.status_code >= 400:
                return Response(content=_EMPTY_GIF, media_type="image/gif",
                                headers={"Cache-Control": "public, max-age=3600"})
            ct = resp.headers.get("content-type", "image/jpeg")
            return Response(
                content=resp.content,
                media_type=ct,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception:
        return Response(content=_EMPTY_GIF, media_type="image/gif",
                        headers={"Cache-Control": "public, max-age=3600"})


def _proxy_podcast_thumb(url: str | None) -> str | None:
    if not url:
        return None
    return f"/api/podcasts/image/proxy?url={urllib.parse.quote(url, safe='')}"


@router.get("/api/podcasts/search")
async def podcasts_search(q: str = "", lang: str = "en"):
    """Search podcasts via Podcast Index."""
    if not _pi_configured():
        raise HTTPException(status_code=503, detail="Podcast Index API not configured. Set PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET.")
    try:
        term = q.strip() or "technology"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{PODCAST_INDEX_BASE}/search/byterm",
                params={"q": term, "max": 20, "clean": True},
                headers=_pi_headers(),
            )
            r.raise_for_status()
            feeds = r.json().get("feeds", [])
        return [
            {
                "id": str(f["id"]),
                "title": f.get("title", ""),
                "author": f.get("author") or f.get("ownerName"),
                "thumbnail": _proxy_podcast_thumb(f.get("image") or f.get("artwork")),
                "description": f.get("description"),
                "episodeCount": f.get("episodeCount"),
            }
            for f in feeds if f.get("id")
        ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Podcast search error: {str(e)}")


@router.get("/api/podcasts/{podcast_id}")
async def podcast_detail(podcast_id: str):
    """Get podcast info + episodes from Podcast Index."""
    if not _pi_configured():
        raise HTTPException(status_code=503, detail="Podcast Index API not configured.")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            pod_r, eps_r = await asyncio.gather(
                client.get(f"{PODCAST_INDEX_BASE}/podcasts/byfeedid",
                           params={"id": podcast_id}, headers=_pi_headers()),
                client.get(f"{PODCAST_INDEX_BASE}/episodes/byfeedid",
                           params={"id": podcast_id, "max": 50, "fulltext": True}, headers=_pi_headers()),
            )
            pod_r.raise_for_status()
            eps_r.raise_for_status()

        feed = pod_r.json().get("feed", {})
        episodes = []
        feed_thumb = _proxy_podcast_thumb(feed.get("image") or feed.get("artwork"))
        for ep in eps_r.json().get("items", []):
            episodes.append({
                "id": str(ep["id"]),
                "title": ep.get("title", ""),
                "description": ep.get("description") or ep.get("subtitle"),
                "thumbnail": _proxy_podcast_thumb(ep.get("image")) or feed_thumb,
                "duration": _fmt_duration(ep.get("duration")),
                "date": _fmt_date(ep.get("datePublished")),
                "enclosureUrl": ep.get("enclosureUrl"),
                "enclosureType": ep.get("enclosureType", "audio/mpeg"),
            })

        return {
            "id": str(feed.get("id", podcast_id)),
            "title": feed.get("title", ""),
            "author": feed.get("author") or feed.get("ownerName"),
            "description": feed.get("description"),
            "thumbnail": feed_thumb,
            "episodeCount": feed.get("episodeCount"),
            "episodes": [e for e in episodes if e["enclosureUrl"]],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Podcast error: {str(e)}")


@router.get("/api/podcasts/audio/proxy")
async def podcast_audio_proxy(url: str, request: Request):
    """Proxy podcast episode audio to avoid CORS issues."""
    await asyncio.to_thread(validate_proxy_url, url)
    range_header = request.headers.get("range")
    req_headers: Dict[str, str] = {"User-Agent": "MyTube/1.0"}
    if range_header:
        req_headers["Range"] = range_header

    # Use a queue so the background task keeps the httpx connection alive
    # while StreamingResponse consumes it — avoids StreamClosed errors.
    chunk_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=8)
    header_event = asyncio.Event()
    upstream_meta: Dict[str, str] = {}
    upstream_status: list[int] = [200]

    async def _fetch():
        try:
            async with httpx_client(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", url, headers=req_headers) as resp:
                    upstream_status[0] = resp.status_code
                    upstream_meta["content_type"] = resp.headers.get("content-type", "audio/mpeg")
                    if cl := resp.headers.get("content-length"):
                        upstream_meta["content_length"] = cl
                    if cr := resp.headers.get("content-range"):
                        upstream_meta["content_range"] = cr
                    header_event.set()
                    async for chunk in resp.aiter_bytes(65536):
                        await chunk_queue.put(chunk)
        except Exception as exc:
            print(f"[podcast] audio proxy error: {exc}", flush=True)
        finally:
            header_event.set()          # unblock waiter even on error
            await chunk_queue.put(None)  # sentinel → end of stream

    task = asyncio.create_task(_fetch())

    try:
        await asyncio.wait_for(header_event.wait(), timeout=15.0)
    except asyncio.TimeoutError:
        task.cancel()
        raise HTTPException(status_code=504, detail="Upstream audio timeout")

    resp_headers: Dict[str, str] = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
    }
    if cl := upstream_meta.get("content_length"):
        resp_headers["Content-Length"] = cl
    if cr := upstream_meta.get("content_range"):
        resp_headers["Content-Range"] = cr

    status_code = upstream_status[0] if range_header else 200

    async def generate():
        try:
            while True:
                chunk = await chunk_queue.get()
                if chunk is None:
                    break
                yield chunk
        except Exception:
            pass
        finally:
            task.cancel()

    return StreamingResponse(
        generate(),
        status_code=status_code,
        headers=resp_headers,
        media_type=upstream_meta.get("content_type", "audio/mpeg"),
    )
