"""YouTube-facing API routes: trending, search, video, streams, HLS, DASH,
playlists, subtitles, thumbnails, channels, downloads and Invidious control."""
import asyncio
import base64
import html as html_lib
import re
import shutil
from datetime import datetime
from pathlib import Path
from time import time as _time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
import httpx
from core.security import validate_proxy_url_async
from core.cache import (
    cache_get,
    cache_set,
    thumb_cache_get,
    thumb_cache_set,
    _get_channel_thumbnails,
    live_url_cache_get,
    live_url_cache_set,
    stream_url_cache_get,
    stream_url_cache_set,
    stream_url_cache_invalidate,
)
from core.config import YOUTUBE_HEADERS, _FFMPEG
from services import innertube
from services.innertube import (
    get_ydl_opts,
    ydl_extract,
    httpx_client,
    rewrite_hls_manifest,
    _get_instances,
    youtubei_search,
    youtubei_trending,
    youtubei_channel_videos,
    invidious_search,
    extract_video_card,
    format_duration,
    format_views,
    time_ago,
)
from services.ffmpeg import (
    _hls_sessions,
    _hls_lock,
    _start_hls_session,
    _kill_hls_sessions_for,
    _iptv_vod_hls_sessions,
    _iptv_vod_hls_lock,
    _kill_vod_session,
    _start_iptv_vod_hls_session,
)
router = APIRouter()

# Per-category, per-language search queries — year injected at startup
_Y = str(datetime.now().year)
CATEGORY_SEARCH_I18N: Dict[str, Dict[str, List[str]]] = {
    "music": {
        "en": [f"official music video {_Y}", "top songs music video"],
        "fr": [f"clip officiel {_Y}", "meilleures chansons"],
        "es": [f"video musical oficial {_Y}", "mejores canciones"],
        "de": [f"offizielles Musikvideo {_Y}", "beste Lieder"],
        "pt": [f"clipe oficial {_Y}", "melhores músicas"],
        "it": [f"video musicale ufficiale {_Y}", "migliori canzoni"],
        "ja": [f"公式ミュージックビデオ {_Y}", "人気曲"],
        "ko": [f"공식 뮤직비디오 {_Y}", "인기 노래"],
        "ru": [f"официальный клип {_Y}", "лучшие песни"],
    },
    "gaming": {
        "en": [f"gaming highlights {_Y}", "best video game gameplay"],
        "fr": [f"gameplay jeux vidéo {_Y}", "meilleurs jeux vidéo"],
        "es": [f"gameplay videojuegos {_Y}", "mejores juegos"],
        "de": [f"Gaming Highlights {_Y}", "bestes Gameplay Videospiele"],
        "pt": [f"gameplay jogos {_Y}", "melhores jogos"],
        "it": [f"gameplay videogiochi {_Y}", "migliori giochi"],
        "ja": [f"ゲーム実況 {_Y}", "人気ゲームプレイ"],
        "ko": [f"게임 하이라이트 {_Y}", "인기 게임플레이"],
        "ru": [f"геймплей игры {_Y}", "лучшие видеоигры"],
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
        "en": [f"official movie trailer {_Y}", "film review"],
        "fr": [f"bande annonce film {_Y}", "critique film"],
        "es": [f"tráiler película {_Y}", "reseña película"],
        "de": [f"offizieller Filmtrailer {_Y}", "Filmkritik"],
        "pt": [f"trailer oficial filme {_Y}", "análise filme"],
        "it": [f"trailer ufficiale film {_Y}", "recensione film"],
        "ja": [f"映画予告編 {_Y}", "映画レビュー"],
        "ko": [f"영화 공식 예고편 {_Y}", "영화 리뷰"],
        "ru": [f"официальный трейлер фильма {_Y}", "обзор фильма"],
    },
}


@router.get("/api/invidious/instances")
async def list_invidious_instances():
    async def ping(url: str) -> dict:
        try:
            async with httpx_client(timeout=4.0) as client:
                r = await client.get(f"{url}/api/v1/stats")
                ok = r.status_code == 200
        except Exception:
            ok = False
        return {"url": url, "healthy": ok, "preferred": url == innertube._preferred_instance}

    results = await asyncio.gather(*[ping(i) for i in innertube.INVIDIOUS_INSTANCES])
    return list(results)


@router.post("/api/invidious/select")
async def select_invidious_instance(body: dict):
    url = (body.get("url") or "").rstrip("/")
    if url:
        await validate_proxy_url_async(url, ("https",))
    innertube._preferred_instance = url if url else None
    return {"selected": innertube._preferred_instance}


@router.get("/api/trending")
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
            opts = get_ydl_opts(**{"extract_flat": True})
            ydl_videos: List[Dict[str, Any]] = []

            for q in queries[:1]:
                res = await ydl_extract(f"ytsearch12:{q}", opts)
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

    async with httpx_client(timeout=8.0) as client:
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


@router.get("/api/search")
async def search_videos(q: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    # Attempt 1: YouTube internal API (no Invidious dependency)
    result = await youtubei_search(q, page)
    if result:
        videos, channels, playlists = result
        return {"videos": videos, "channels": channels, "playlists": playlists, "query": q, "page": page}

    # Attempt 2: Invidious (videos only)
    videos = await invidious_search(q, page)
    if videos:
        return {"videos": videos, "channels": [], "playlists": [], "query": q, "page": page}

    # Fallback: yt-dlp search (videos only)
    try:
        offset = (page - 1) * 20
        search_query = f"ytsearch{20 + offset}:{q}"
        opts = get_ydl_opts(**{"extract_flat": True})
        info = await ydl_extract(search_query, opts)
        entries = info.get("entries", []) if info else []
        page_entries = entries[offset:offset + 20] if offset < len(entries) else entries
        fallback_videos = [extract_video_card(e) for e in page_entries if e and e.get("id")]
        return {"videos": fallback_videos, "channels": [], "playlists": [], "query": q, "page": page}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/api/video/{video_id}")
async def get_video(video_id: str):
    try:
        opts = get_ydl_opts(**{"format": "bestvideo+bestaudio/best"})
        info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
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

        def _is_channel_entry(e: Dict[str, Any]) -> bool:
            ie_key = e.get("ie_key", "")
            if ie_key in ("YoutubeChannel", "YoutubeTab"):
                return True
            # No duration and no view count → likely a channel suggestion
            if not e.get("duration") and not e.get("view_count") and not e.get("viewCount"):
                eid = e.get("id", "")
                if eid.startswith("UC") or eid.startswith("@"):
                    return True
            return False

        def _make_channel_entry(e: Dict[str, Any]) -> Dict[str, Any]:
            cid = e.get("id", "")
            cname = e.get("author") or e.get("channel") or e.get("uploader") or e.get("title", "")
            return {
                "type": "channel",
                "id": cid,
                "title": cname,
                "thumbnail": f"/api/channel_thumbnail/{cid}" if cid else None,
                "duration": "",
                "views": "",
                "published": "",
                "channel": {"id": cid, "name": cname, "thumbnail": f"/api/channel_thumbnail/{cid}" if cid else None},
            }

        for entry in info.get("related_videos", [])[:10]:
            if entry and entry.get("id"):
                if _is_channel_entry(entry):
                    related.append(_make_channel_entry(entry))
                else:
                    related.append(extract_video_card(entry))

        if len(related) < 5:
            channel_name_for_search = info.get("channel") or info.get("uploader") or ""
            search_q = channel_name_for_search or info.get("title", "")[:40]
            if search_q:
                try:
                    opts_rel = get_ydl_opts(**{"extract_flat": True})
                    rel_info = await ydl_extract(f"ytsearch12:{search_q}", opts_rel)
                    if rel_info and "entries" in rel_info:
                        existing_ids = {r["id"] for r in related} | {video_id}
                        for entry in rel_info["entries"]:
                            if entry and entry.get("id") and entry["id"] not in existing_ids:
                                if _is_channel_entry(entry):
                                    related.append(_make_channel_entry(entry))
                                else:
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
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("not available", "private video", "has been removed", "age-restricted", "sign in", "unavailable", "your country", "not made this video", "geo", "blocked")):
            raise HTTPException(status_code=404, detail="This video is unavailable in your region or has been removed.")
        raise HTTPException(status_code=500, detail=f"Failed to get video info: {str(e)}")


@router.get("/api/live/{video_id}")
async def get_live_stream(video_id: str):
    """Returns our proxied HLS URL — avoids CORS/auth issues with YouTube CDN."""
    return {"url": f"/api/live/{video_id}/hls", "type": "m3u8"}


@router.get("/api/live/{video_id}/hls")
async def live_hls_master(video_id: str, request: Request):
    """Fetch the YouTube live HLS master playlist and rewrite URLs through our proxy."""
    try:
        # Use cached URL if still fresh, otherwise fetch via yt-dlp
        hls_url = live_url_cache_get(video_id)
        if not hls_url:
            _info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", get_ydl_opts())
            if _info:
                if _info.get("manifest_url"):
                    hls_url = _info["manifest_url"]
                else:
                    # Fall back to the highest-resolution HLS format
                    hls_fmts = [
                        f for f in _info.get("formats", [])
                        if f.get("protocol", "") in ("m3u8", "m3u8_native") or f.get("ext", "") == "m3u8"
                    ]
                    if hls_fmts:
                        best = max(hls_fmts, key=lambda f: f.get("height") or 0)
                        hls_url = best.get("url")
                    else:
                        hls_url = _info.get("url")
            if not hls_url:
                raise HTTPException(status_code=404, detail="No HLS stream found for this video")
            live_url_cache_set(video_id, hls_url)

        # Determine the proxy base URL (same host as this request)
        base = str(request.base_url).rstrip("/")
        proxy_base = f"{base}/api/hls-proxy"

        async with httpx_client(timeout=15.0, follow_redirects=True) as client:
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


@router.get("/api/hls-proxy")
async def hls_proxy(url: str, request: Request):
    """Generic HLS reverse proxy — fetches manifests/segments from YouTube with proper headers."""
    try:
        # Decode the base64url-encoded URL (strip padding first)
        decoded_url = base64.urlsafe_b64decode(url + "==").decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL encoding")
    await validate_proxy_url_async(decoded_url)

    try:
        base = str(request.base_url).rstrip("/")
        proxy_base = f"{base}/api/hls-proxy"

        async with httpx_client(timeout=15.0, follow_redirects=True) as client:
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


@router.get("/api/stream/{video_id}/audio")
async def stream_audio(video_id: str, request: Request, itag: Optional[str] = None):
    """Stream the best audio-only track (for dual video+audio playback in the browser)."""
    try:
        cache_key = f"stream:{video_id}:{itag or 'bestaudio'}"
        cached = stream_url_cache_get(cache_key)

        if cached:
            direct_url, ext = cached
        else:
            format_spec = itag if itag else "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
            opts = get_ydl_opts(**{"format": format_spec})
            _info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
            if not _info:
                direct_url, ext = None, "m4a"
            elif itag:
                _found = next(
                    (f for f in _info.get("formats", []) if str(f.get("format_id")) == str(itag)),
                    None,
                )
                direct_url = _found.get("url") if _found else None
                ext = _found.get("ext", "m4a") if _found else "m4a"
            else:
                direct_url = _info.get("url")
                ext = _info.get("ext", "m4a")
            if direct_url:
                stream_url_cache_set(cache_key, direct_url, ext or "m4a")

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
            async with httpx_client(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", direct_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        async with httpx_client(timeout=10.0, follow_redirects=True) as client:
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


@router.get("/api/hls/{video_id}/{itag}/stream.m3u8")
async def hls_playlist(video_id: str, itag: str, start: int = 0):
    """Start (or reuse) an ffmpeg HLS session from `start` seconds."""
    try:
        async with _hls_lock:
            # Kill any existing session for a different start time
            prefix = f"{video_id}:{itag}:"
            existing = [k for k in _hls_sessions if k.startswith(prefix) and k != f"{video_id}:{itag}:{start}"]
            for k in existing:
                session = _hls_sessions.pop(k)
                try:
                    session["process"].kill()
                except Exception:
                    pass
                shutil.rmtree(session["dir"], ignore_errors=True)

        session_key = await _start_hls_session(video_id, itag, start)
        session = _hls_sessions.get(session_key)
        if session is None:
            raise HTTPException(status_code=503, detail="Session interrupted, please retry")
        session["last_access"] = _time()
        tmpdir = session["dir"]
        playlist_path = Path(tmpdir) / "stream.m3u8"

        # Wait up to 12s for the first playlist, invalidate cache if ffmpeg dies
        for _ in range(120):
            if playlist_path.exists() and playlist_path.stat().st_size > 10:
                break
            # Check if ffmpeg process died unexpectedly
            proc = session["process"]
            if proc.returncode is not None and proc.returncode != 0:
                # URL may have expired — clear stream cache and let client retry
                stream_url_cache_invalidate(video_id)
                async with _hls_lock:
                    _hls_sessions.pop(session_key, None)
                shutil.rmtree(tmpdir, ignore_errors=True)
                raise HTTPException(status_code=503, detail="ffmpeg failed, stream URLs may have expired")
            await asyncio.sleep(0.1)
        else:
            raise HTTPException(status_code=504, detail="Transcoding timeout")

        content = playlist_path.read_text()
        # Declare EVENT so hls.js starts from the first segment, not the live edge
        if "#EXT-X-PLAYLIST-TYPE" not in content:
            content = content.replace("#EXTM3U", "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT", 1)
        # Rewrite segment filenames to include start offset in URL
        content = re.sub(
            r'^(seg\d+\.ts)$',
            lambda m: f"/api/hls/{video_id}/{itag}/{start}/{m.group(1)}",
            content,
            flags=re.MULTILINE,
        )

        return Response(
            content=content,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/hls/{video_id}/{itag}/{start}/{segment}")
async def hls_segment(video_id: str, itag: str, start: int, segment: str):
    """Serve an HLS segment from the correct session temp dir."""
    if not re.match(r'^seg\d+\.ts$', segment):
        raise HTTPException(status_code=400, detail="Invalid segment name")

    session_key = f"{video_id}:{itag}:{start}"
    session = _hls_sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session["last_access"] = _time()

    seg_path = Path(session["dir"]) / segment

    for _ in range(50):
        if seg_path.exists() and seg_path.stat().st_size > 0:
            return FileResponse(seg_path, media_type="video/mp2t",
                                headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"})
        await asyncio.sleep(0.1)

    raise HTTPException(status_code=404, detail="Segment not ready")


@router.delete("/api/hls/{video_id}/{itag}")
async def hls_stop(video_id: str, itag: str):
    """Kill all ffmpeg sessions for this video+itag and clean up."""
    async with _hls_lock:
        _kill_hls_sessions_for(video_id, itag)
    # Invalidate stream URL cache so the next session fetches fresh YouTube URLs
    # (without this, the next session reuses expired URLs → immediate ffmpeg crash → 503)
    stream_url_cache_invalidate(video_id)
    return {"ok": True}


@router.get("/api/iptv/vod_hls2/{stream_id}/playlist.m3u8")
async def iptv_vod_hls2_playlist(
    request: Request,
    stream_id: str,
    ext: str = "mp4",
    media: str = "movie",
    audio_idx: int = 0,
    start: int = 0,
):
    from core import config
    from api.iptv import _check_vod_params
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    _check_vod_params(ext, media, stream_id)

    # Kill sessions for same stream but different parameters
    async with _iptv_vod_hls_lock:
        session_key = f"{stream_id}:{ext}:{media}:{audio_idx}:{start}"
        to_kill = [k for k in _iptv_vod_hls_sessions
                   if k.startswith(f"{stream_id}:") and k != session_key]
        for k in to_kill:
            _kill_vod_session(_iptv_vod_hls_sessions.pop(k))

    try:
        session = await _start_iptv_vod_hls_session(stream_id, ext, media, audio_idx, start)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    session["last_access"] = _time()

    playlist_path = Path(session["dir"]) / "playlist.m3u8"

    for _ in range(150):
        if playlist_path.exists() and playlist_path.stat().st_size > 10:
            break
        proc = session["process"]
        if proc.returncode is not None and proc.returncode != 0:
            async with _iptv_vod_hls_lock:
                _iptv_vod_hls_sessions.pop(session["key"], None)
            pt = session.get("pipe_task")
            if pt and not pt.done():
                pt.cancel()
            shutil.rmtree(session["dir"], ignore_errors=True)
            raise HTTPException(status_code=503, detail="ffmpeg failed to start")
        await asyncio.sleep(0.1)
    else:
        raise HTTPException(status_code=504, detail="HLS transcoding timeout")

    content = playlist_path.read_text()
    # Declare EVENT so Shaka starts from the first segment, not the live edge
    if "#EXT-X-PLAYLIST-TYPE" not in content:
        content = content.replace("#EXTM3U", "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT", 1)
    base = str(request.base_url).rstrip("/")
    seg_base = f"{base}/api/iptv/vod_hls2/{stream_id}/{start}"
    qs = f"ext={ext}&media={media}&audio_idx={audio_idx}"

    content = re.sub(
        r"^(seg\d+\.ts)$",
        lambda m: f"{seg_base}/{m.group(1)}?{qs}",
        content,
        flags=re.MULTILINE,
    )

    return Response(
        content=content,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


@router.get("/api/iptv/vod_hls2/{stream_id}/{start}/{segment}")
async def iptv_vod_hls2_segment(
    stream_id: str, start: int, segment: str,
    ext: str = "mp4", media: str = "movie", audio_idx: int = 0,
):
    from api.iptv import _check_vod_params
    _check_vod_params(ext, media, stream_id)
    if not re.match(r"^seg\d+\.ts$", segment):
        raise HTTPException(status_code=400, detail="Invalid segment")

    session_key = f"{stream_id}:{ext}:{media}:{audio_idx}:{start}"
    session = _iptv_vod_hls_sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    session["last_access"] = _time()

    seg_path = Path(session["dir"]) / segment

    for _ in range(100):
        if seg_path.exists() and seg_path.stat().st_size > 0:
            return FileResponse(
                seg_path, media_type="video/mp2t",
                headers={"Cache-Control": "public, max-age=31536000", "Access-Control-Allow-Origin": "*"},
            )
        proc = session["process"]
        if proc.returncode is not None and proc.returncode != 0:
            raise HTTPException(status_code=503, detail="ffmpeg terminated")
        await asyncio.sleep(0.1)
    raise HTTPException(status_code=404, detail="Segment not ready")


@router.get("/api/stream/{video_id}")
async def stream_video(video_id: str, request: Request, itag: Optional[str] = None):
    try:
        cache_key = f"stream:{video_id}:{itag or 'best'}"
        cached = stream_url_cache_get(cache_key)

        if cached:
            direct_url, ext = cached
        else:
            # No itag = Shorts player requesting video-only (audio comes from /audio endpoint).
            # Never use bestvideo+bestaudio: yt-dlp puts adaptive URLs in requested_formats,
            # not in info["url"], so direct_url ends up None → 404.
            format_spec = itag if itag else "bestvideo[ext=mp4]/bestvideo[ext=webm]/bestvideo"
            opts = get_ydl_opts(**{"format": format_spec})
            _info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
            if not _info:
                direct_url, ext = None, None
            elif itag:
                _found = next(
                    (f for f in _info.get("formats", []) if str(f.get("format_id")) == str(itag)),
                    None,
                )
                direct_url = _found.get("url") if _found else None
                ext = _found.get("ext", "mp4") if _found else None
            else:
                direct_url = _info.get("url")
                ext = _info.get("ext", "mp4")
            if direct_url:
                stream_url_cache_set(cache_key, direct_url, ext or "mp4")

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
            async with httpx_client(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", direct_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        # Make a head request to get content length and determine status
        async with httpx_client(timeout=10.0, follow_redirects=True) as client:
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


@router.get("/api/trailer/{video_id}")
async def stream_trailer(video_id: str, request: Request):
    """Stream a YouTube video as a combined audio+video stream (optimised for trailers).

    Uses best[height<=720][ext=mp4] which YouTube always provides as a single
    merged stream (no DASH splitting), so no FFmpeg merging is required.
    """
    try:
        cache_key = f"stream:{video_id}:trailer"
        cached = stream_url_cache_get(cache_key)

        if cached:
            direct_url, ext = cached
        else:
            opts = get_ydl_opts()
            _info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
            if not _info:
                direct_url, ext = None, None
            else:
                _formats = _info.get("formats", [])
                # Find combined (pre-merged) formats: vcodec and acodec both present
                combined = [
                    f for f in _formats
                    if f.get("url")
                    and f.get("vcodec") not in (None, "none")
                    and f.get("acodec") not in (None, "none")
                ]
                if combined:
                    # Prefer mp4 at ≤720p, fall back to any combined
                    pool = [f for f in combined if (f.get("height") or 999) <= 720 and f.get("ext") == "mp4"]
                    if not pool:
                        pool = [f for f in combined if (f.get("height") or 999) <= 720]
                    if not pool:
                        pool = [f for f in combined if f.get("ext") == "mp4"]
                    if not pool:
                        pool = combined
                    chosen = max(pool, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0))
                    direct_url = chosen["url"]
                    ext = chosen.get("ext", "mp4")
                else:
                    direct_url, ext = None, None
            if direct_url:
                stream_url_cache_set(cache_key, direct_url, ext or "mp4")

        if not direct_url:
            raise HTTPException(status_code=404, detail="Trailer not available")

        range_header = request.headers.get("range")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.youtube.com/",
        }
        if range_header:
            headers["Range"] = range_header

        content_type = "video/mp4" if ext in ("mp4", "m4v") else f"video/{ext}"

        async def stream_generator():
            async with httpx_client(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", direct_url, headers=headers) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        async with httpx_client(timeout=10.0, follow_redirects=True) as client:
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

        return StreamingResponse(
            stream_generator(),
            status_code=206 if range_header else 200,
            headers=response_headers,
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trailer stream failed: {str(e)}")


@router.get("/api/dash/{video_id}.mpd")
async def get_dash_mpd(video_id: str, request: Request):
    """Generate a DASH MPD manifest for the given video.

    All video/audio representations point back to our proxy endpoints,
    which use the stream URL cache to avoid repeated yt-dlp calls.
    """
    try:
        opts = get_ydl_opts(**{
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
        })
        info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")

        duration = float(info.get("duration") or 0)

        # Pre-populate the stream URL cache for all formats
        video_reprs: List[Dict[str, Any]] = []
        audio_reprs: List[Dict[str, Any]] = []

        for fmt in info.get("formats", []):
            itag = fmt.get("format_id")
            url = fmt.get("url")
            if not itag or not url:
                continue

            ext = fmt.get("ext", "mp4")
            has_video = fmt.get("vcodec", "none") != "none"
            has_audio = fmt.get("acodec", "none") != "none"

            # Cache the URL so subsequent proxy requests are instant
            cache_key = f"stream:{video_id}:{itag}"
            if not stream_url_cache_get(cache_key):
                stream_url_cache_set(cache_key, url, ext)

            tbr = fmt.get("tbr") or 0
            bandwidth = int(tbr * 1000) if tbr else 500000

            # Only mp4 video-only streams (consistent container, no webm mixing)
            if has_video and not has_audio and ext == "mp4":
                height = fmt.get("height") or 0
                width = fmt.get("width") or 0
                vcodec = html_lib.escape(fmt.get("vcodec") or "avc1", quote=True)
                video_reprs.append({
                    "itag": itag,
                    "mime": "video/mp4",
                    "codecs": vcodec,
                    "bandwidth": bandwidth,
                    "width": width,
                    "height": height,
                })

            # Only m4a/mp4 audio-only streams
            elif has_audio and not has_video and ext in ("m4a", "mp4"):
                acodec = html_lib.escape(fmt.get("acodec") or "mp4a.40.2", quote=True)
                abr = fmt.get("abr") or 0
                audio_bandwidth = int(abr * 1000) if abr else 128000
                audio_reprs.append({
                    "itag": itag,
                    "mime": "audio/mp4",
                    "codecs": acodec,
                    "bandwidth": audio_bandwidth,
                })

        if not video_reprs or not audio_reprs:
            raise HTTPException(status_code=404, detail="No compatible mp4 streams found for DASH")

        # Sort: video by height descending, audio by bandwidth descending
        video_reprs.sort(key=lambda r: -r["height"])
        audio_reprs.sort(key=lambda r: -r["bandwidth"])

        # Build base URL prefix
        base_req = str(request.base_url).rstrip("/")

        def _xml_url(path: str) -> str:
            return html_lib.escape(path, quote=False)

        def _video_repr(r: dict) -> str:
            url = _xml_url(f"{base_req}/api/stream/{video_id}?itag={r['itag']}")
            return (
                f'      <Representation id="{r["itag"]}" mimeType="{r["mime"]}" '
                f'codecs="{r["codecs"]}" bandwidth="{r["bandwidth"]}" '
                f'width="{r["width"]}" height="{r["height"]}">\n'
                f'        <BaseURL>{url}</BaseURL>\n'
                f'        <SegmentBase>\n'
                f'          <Initialization range="0-65535"/>\n'
                f'        </SegmentBase>\n'
                f'      </Representation>'
            )

        def _audio_repr(r: dict) -> str:
            url = _xml_url(f"{base_req}/api/stream/{video_id}/audio?itag={r['itag']}")
            return (
                f'      <Representation id="{r["itag"]}" mimeType="{r["mime"]}" '
                f'codecs="{r["codecs"]}" bandwidth="{r["bandwidth"]}">\n'
                f'        <BaseURL>{url}</BaseURL>\n'
                f'        <SegmentBase>\n'
                f'          <Initialization range="0-65535"/>\n'
                f'        </SegmentBase>\n'
                f'      </Representation>'
            )

        video_block = "\n".join(_video_repr(r) for r in video_reprs)
        audio_block = "\n".join(_audio_repr(r) for r in audio_reprs)

        # Duration in ISO 8601 / DASH format
        h = int(duration // 3600)
        m = int((duration % 3600) // 60)
        s = duration % 60
        dur_str = f"PT{h}H{m}M{s:.3f}S" if h else (f"PT{m}M{s:.3f}S" if m else f"PT{s:.3f}S")

        mpd = f"""<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     type="static"
     mediaPresentationDuration="{dur_str}"
     minBufferTime="PT4S"
     profiles="urn:mpeg:dash:profile:full:2011">
  <Period id="1" start="PT0S" duration="{dur_str}">
    <AdaptationSet id="1" mimeType="video/mp4" contentType="video" segmentAlignment="true" bitstreamSwitching="true">
{video_block}
    </AdaptationSet>
    <AdaptationSet id="2" mimeType="audio/mp4" contentType="audio" segmentAlignment="true">
{audio_block}
    </AdaptationSet>
  </Period>
</MPD>"""

        return Response(
            content=mpd,
            media_type="application/dash+xml",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MPD generation failed: {str(e)}")


@router.get("/api/playlist/{playlist_id}")
async def get_playlist(playlist_id: str):
    """Fetch video list for a YouTube playlist."""
    cached = cache_get(f"playlist:{playlist_id}")
    if cached:
        return cached

    try:
        opts = get_ydl_opts(**{
            "extract_flat": True,
            "playlistend": 100,
            "quiet": True,
        })
        info = await ydl_extract(f"https://www.youtube.com/playlist?list={playlist_id}", opts)
        if not info:
            raise HTTPException(status_code=404, detail="Playlist not found")

        videos = []
        for entry in (info.get("entries") or []):
            if not entry or not entry.get("id"):
                continue
            videos.append({
                "id": entry["id"],
                "title": entry.get("title", ""),
                "duration": format_duration(entry.get("duration") or 0),
                "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/mqdefault.jpg",
                "channel": entry.get("uploader") or entry.get("channel") or "",
                "channelId": entry.get("channel_id") or entry.get("uploader_id") or "",
            })

        result = {
            "id": playlist_id,
            "title": info.get("title", ""),
            "uploader": info.get("uploader") or info.get("channel") or "",
            "videoCount": len(videos),
            "videos": videos,
        }
        cache_set(f"playlist:{playlist_id}", result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/subtitles/{video_id}")
async def list_subtitles(video_id: str):
    """Return list of available subtitle/caption tracks for a video."""
    try:
        opts = get_ydl_opts(**{
            "listsubtitles": False,
            "writesubtitles": False,
            "writeautomaticsub": False,
            "skip_download": True,
        })
        info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
        if not info:
            return {"subtitles": []}

        tracks = []
        seen = set()
        # Manual subtitles first
        for lang, subs in (info.get("subtitles") or {}).items():
            if lang in seen:
                continue
            seen.add(lang)
            fmt = next((s for s in subs if s.get("ext") == "vtt"), subs[0] if subs else None)
            if fmt:
                tracks.append({"lang": lang, "label": lang, "auto": False, "url": fmt.get("url", "")})
        # Auto-generated subtitles
        for lang, subs in (info.get("automatic_captions") or {}).items():
            if lang in seen:
                continue
            seen.add(lang)
            fmt = next((s for s in subs if s.get("ext") == "vtt"), subs[0] if subs else None)
            if fmt:
                tracks.append({"lang": lang, "label": f"{lang} (auto)", "auto": True, "url": fmt.get("url", "")})

        return {"subtitles": tracks}
    except Exception as e:
        return {"subtitles": [], "error": str(e)}


@router.get("/api/subtitles/{video_id}/{lang}")
async def get_subtitle_vtt(video_id: str, lang: str, auto: bool = False):
    """Proxy a subtitle VTT file for a given language."""
    try:
        opts = get_ydl_opts(**{"skip_download": True})
        info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")

        # Try manual subtitles first, then auto-captions
        source = info.get("subtitles", {})
        subs = source.get(lang)
        if not subs and (auto or True):
            source = info.get("automatic_captions", {})
            subs = source.get(lang)

        if not subs:
            raise HTTPException(status_code=404, detail=f"No subtitles for language: {lang}")

        fmt = next((s for s in subs if s.get("ext") == "vtt"), subs[0])
        url = fmt.get("url")
        if not url:
            raise HTTPException(status_code=404, detail="No subtitle URL available")

        async with httpx_client(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch subtitle")
            return Response(
                content=resp.content,
                media_type="text/vtt; charset=utf-8",
                headers={"Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*"},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/thumbnail/{video_id}")
async def get_thumbnail(video_id: str):
    cached = thumb_cache_get(video_id)
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx_client(timeout=10.0, follow_redirects=True) as client:
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


@router.get("/api/debug/channel_thumbnails/{channel_id}")
async def debug_channel_thumbnails(channel_id: str):
    opts = get_ydl_opts(**{"extract_flat": True, "playlistend": 1})
    info = await ydl_extract(f"https://www.youtube.com/channel/{channel_id}", opts)
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
        async with httpx_client(timeout=8.0, follow_redirects=True) as client:
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


@router.get("/api/channel_thumbnail/{channel_id}")
async def get_channel_thumbnail(channel_id: str):
    cached = thumb_cache_get(f"avatar:{channel_id}")
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx_client(timeout=8.0, follow_redirects=True) as client:
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


@router.get("/api/download/{video_id}")
async def download_video(
    video_id: str,
    itag: Optional[str] = None,
    format: str = "mp4",
    quality: str = "best",
):
    try:
        opts = get_ydl_opts(**{"format": "bestvideo+bestaudio/best"})
        _dl_info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", opts)
        if not _dl_info:
            video_url, title, ext, audio_url, needs_merge = None, None, None, None, None
        else:
            title = _dl_info.get("title", video_id)
            if itag:
                video_fmt = next(
                    (f for f in _dl_info.get("formats", []) if str(f.get("format_id")) == str(itag)),
                    None,
                )
                if not video_fmt:
                    video_url, ext, audio_url, needs_merge = None, "mp4", None, None
                else:
                    has_video = video_fmt.get("vcodec", "none") != "none"
                    has_audio = video_fmt.get("acodec", "none") != "none"
                    video_url = video_fmt.get("url")
                    ext = video_fmt.get("ext", "mp4")
                    if has_video and not has_audio:
                        audio_fmt = next(
                            (f for f in sorted(_dl_info.get("formats", []), key=lambda f: -(f.get("abr") or 0))
                             if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"),
                            None,
                        )
                        audio_url = audio_fmt.get("url") if audio_fmt else None
                        ext, needs_merge = "mp4", True
                    else:
                        audio_url, needs_merge = None, False
            elif format == "mp3":
                audio_fmt = next(
                    (f for f in sorted(_dl_info.get("formats", []), key=lambda f: -(f.get("abr") or 0))
                     if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"),
                    None,
                )
                video_url = audio_fmt.get("url") if audio_fmt else None
                ext, audio_url, needs_merge = "m4a", None, False
            else:
                video_url = _dl_info.get("url")
                ext = _dl_info.get("ext", "mp4")
                audio_url, needs_merge = None, False

        if not video_url:
            raise HTTPException(status_code=404, detail="Download URL not found")

        # Sanitize filename
        safe_title = re.sub(r'[^\w\s-]', '', title or video_id).strip()
        safe_title = re.sub(r'[-\s]+', '-', safe_title)[:100]
        filename = f"{safe_title}.{ext}"

        yt_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.youtube.com/",
        }

        if needs_merge and audio_url:
            # Use ffmpeg to merge video-only + audio-only streams on the fly
            async def ffmpeg_merge_generator():
                cmd = [
                    _FFMPEG, "-y",
                    "-headers", "".join(f"{k}: {v}\r\n" for k, v in yt_headers.items()),
                    "-i", video_url,
                    "-headers", "".join(f"{k}: {v}\r\n" for k, v in yt_headers.items()),
                    "-i", audio_url,
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-movflags", "frag_keyframe+empty_moov",
                    "-f", "mp4",
                    "pipe:1",
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    while True:
                        chunk = await proc.stdout.read(65536)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    try:
                        proc.kill()
                    except Exception:
                        pass

            return StreamingResponse(
                ffmpeg_merge_generator(),
                media_type="application/octet-stream",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-cache",
                },
            )
        else:
            async def download_generator():
                async with httpx_client(timeout=None, follow_redirects=True) as client:
                    async with client.stream("GET", video_url, headers=yt_headers) as response:
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
        async with httpx_client(timeout=8.0, follow_redirects=True) as client:
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


@router.get("/api/channel_banner/{channel_id}")
async def get_channel_banner(channel_id: str):
    cached = thumb_cache_get(f"banner:{channel_id}")
    if cached:
        data, ct = cached
        return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

    async with httpx_client(timeout=10.0, follow_redirects=True) as client:
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


@router.get("/api/channel/{channel_id}")
async def get_channel(channel_id: str):
    try:
        opts = get_ydl_opts(**{"extract_flat": True, "playlistend": 1})
        info = await ydl_extract(f"https://www.youtube.com/channel/{channel_id}", opts)
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


@router.get("/api/channel/{channel_id}/videos")
async def get_channel_videos(channel_id: str, page: int = Query(1, ge=1)):
    # Attempt 1: YouTube internal API with pagination
    videos = await youtubei_channel_videos(channel_id, page)
    if videos:
        return {"videos": videos, "channelId": channel_id, "page": page}

    # Attempt 2: Invidious
    async with httpx_client(timeout=10.0) as client:
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
        opts = get_ydl_opts(**{"extract_flat": True, "playliststart": start, "playlistend": end})
        info = await ydl_extract(f"https://www.youtube.com/channel/{channel_id}/videos", opts)
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
