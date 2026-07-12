"""YouTube Music and internet radio API routes."""
import asyncio
import urllib.parse
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from ytmusicapi import YTMusic as _YTMusic

from services.innertube import httpx_client
from services.vpn import _get_proxy_url, _ytm_cache
from api.podcasts import _proxy_podcast_thumb

router = APIRouter()


def get_ytm(language: str = "en") -> _YTMusic:
    global _ytm_cache
    proxy = _get_proxy_url()
    cache_key = f"{language}:{proxy or ''}"
    if cache_key not in _ytm_cache:
        kwargs: dict = {"language": language}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}
        _ytm_cache[cache_key] = _YTMusic(**kwargs)
    return _ytm_cache[cache_key]


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


@router.get("/api/music/charts")
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


@router.get("/api/music/search")
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


@router.get("/api/music/artist/{browse_id}")
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


@router.get("/api/music/album/{browse_id}")
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


@router.get("/api/music/playlist/{playlist_id}")
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


@router.get("/api/music/song/{video_id}")
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


RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info/json"


@router.get("/api/radio/stations")
async def radio_stations(
    country: str = "US",
    tag: str = "",
    q: str = "",
    limit: int = 30,
):
    """Fetch radio stations from Radio Browser, filtered by country and optional genre/search."""
    params: Dict[str, str] = {
        "limit": str(limit),
        "order": "clickcount",
        "reverse": "true",
        "hidebroken": "true",
    }
    # Only filter by country when browsing (no text query) — searching by name
    # should be worldwide so "France Inter" works regardless of region setting
    if not q:
        params["countrycode"] = country.upper()
    if tag:
        params["tag"] = tag
    if q:
        params["name"] = q
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{RADIO_BROWSER_BASE}/stations/search",
                params=params,
                headers={"User-Agent": "MyTube/1.0"},
            )
            r.raise_for_status()
            stations = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Radio Browser error: {str(e)}")

    result = []
    for s in stations:
        stream_url = s.get("url_resolved") or s.get("url", "")
        if not stream_url:
            continue
        favicon = s.get("favicon") or ""
        # Radio Browser sometimes sends the string "null" — treat it as empty
        if favicon in ("null", "undefined") or not favicon.startswith("http"):
            favicon = ""
        result.append({
            "id": s.get("stationuuid", ""),
            "name": (s.get("name") or "").strip(),
            "url": f"/api/radio/stream/proxy?url={urllib.parse.quote(stream_url, safe='')}",
            "favicon": _proxy_podcast_thumb(favicon) if favicon else None,
            "tags": [t.strip() for t in (s.get("tags") or "").split(",") if t.strip()][:3],
            "country": s.get("country", ""),
            "bitrate": s.get("bitrate", 0),
            "codec": s.get("codec", ""),
        })
    return result


@router.get("/api/radio/stream/proxy")
async def radio_stream_proxy(url: str, request: Request):
    """Proxy radio stream through backend to preserve privacy."""
    range_header = request.headers.get("range")
    req_headers: Dict[str, str] = {"User-Agent": "MyTube/1.0", "Icy-MetaData": "0"}
    if range_header:
        req_headers["Range"] = range_header

    chunk_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=16)
    header_event = asyncio.Event()
    upstream_meta: Dict[str, str] = {}
    upstream_status: list[int] = [200]

    async def _fetch():
        try:
            async with httpx_client(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", url, headers=req_headers) as resp:
                    upstream_status[0] = resp.status_code
                    upstream_meta["content_type"] = resp.headers.get("content-type", "audio/mpeg")
                    header_event.set()
                    async for chunk in resp.aiter_bytes(65536):
                        await chunk_queue.put(chunk)
        except Exception as exc:
            logger.warning(f"Radio stream proxy error: {exc}")
        finally:
            header_event.set()
            await chunk_queue.put(None)

    task = asyncio.create_task(_fetch())
    try:
        await asyncio.wait_for(header_event.wait(), timeout=15.0)
    except asyncio.TimeoutError:
        task.cancel()
        raise HTTPException(status_code=504, detail="Radio stream timeout")

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
        status_code=upstream_status[0],
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
        media_type=upstream_meta.get("content_type", "audio/mpeg"),
    )


@router.get("/api/music/home")
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
