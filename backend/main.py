import asyncio
import base64
import difflib
import html as html_lib
import json
import os
import re
from time import time as _time
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
import urllib.parse
from fastapi import FastAPI, HTTPException, Request, Query, Body
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
            async with httpx_client(timeout=4.0) as client:
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

def get_ydl_opts(**extra) -> Dict[str, Any]:
    """Return yt-dlp options with proxy injected when VPN is active."""
    opts = {**YDL_OPTS_BASE, **extra}
    proxy = _get_proxy_url() if '_wireproxy_process' in globals() else None
    if proxy:
        opts["proxy"] = proxy
    return opts

def httpx_client(**kwargs) -> httpx.AsyncClient:
    """Return an httpx.AsyncClient with proxy injected when VPN is active."""
    proxy = _get_proxy_url() if '_wireproxy_process' in globals() else None
    if proxy:
        kwargs.setdefault("proxy", proxy)
        if 'vpn_record_activity' in globals():
            vpn_record_activity()
    return httpx.AsyncClient(**kwargs)

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


def _parse_channel_renderer(cr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse a channelRenderer from a YouTube search response."""
    try:
        channel_id = cr.get("channelId") or (
            cr.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId")
        )
        if not channel_id:
            return None
        name = (
            cr.get("title", {}).get("simpleText")
            or "".join(r.get("text", "") for r in cr.get("title", {}).get("runs", []))
        )
        thumbs = cr.get("thumbnail", {}).get("thumbnails", [])
        thumbnail = thumbs[-1]["url"] if thumbs else None
        if thumbnail and thumbnail.startswith("//"):
            thumbnail = "https:" + thumbnail

        desc_runs = cr.get("descriptionSnippet", {}).get("runs", [])
        description = "".join(r.get("text", "") for r in desc_runs)

        sub_text = (
            cr.get("subscriberCountText", {}).get("simpleText")
            or cr.get("subscriberCountText", {}).get("accessibility", {}).get("accessibilityData", {}).get("label", "")
        )
        video_count_runs = cr.get("videoCountText", {}).get("runs", [])
        video_count_text = "".join(r.get("text", "") for r in video_count_runs)

        return {
            "type": "channel",
            "id": channel_id,
            "name": name or "Unknown Channel",
            "thumbnail": thumbnail,
            "description": description,
            "subscriberText": sub_text or "",
            "videoCountText": video_count_text or "",
        }
    except Exception:
        return None


def _parse_lockup_view_model(lvm: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse a lockupViewModel (new YouTube format) as a playlist entry."""
    import re as _re
    try:
        # Extract playlistId + firstVideoId from the watch URL embedded in onTap
        full_json = json.dumps(lvm)
        m = _re.search(r'/watch\?v=([A-Za-z0-9_-]+)&list=(PL[A-Za-z0-9_-]+)', full_json)
        if not m:
            return None
        first_video_id = m.group(1)
        playlist_id = m.group(2)

        # Title
        title = (
            lvm.get("metadata", {})
               .get("lockupMetadataViewModel", {})
               .get("title", {})
               .get("content", "")
        )

        # Channel name + video count from metadataRows
        channel_name = ""
        video_count = ""
        rows = (
            lvm.get("metadata", {})
               .get("lockupMetadataViewModel", {})
               .get("metadata", {})
               .get("contentMetadataViewModel", {})
               .get("metadataRows", [])
        )
        meta_texts = []
        for row in rows:
            for part in row.get("metadataParts", []):
                txt = part.get("text", {}).get("content", "")
                if txt:
                    meta_texts.append(txt)
        # First meta text = channel name, ignore "Playlist" literal and video titles
        for txt in meta_texts:
            if txt and txt.lower() != "playlist" and "·" not in txt and "view full" not in txt.lower():
                if not channel_name:
                    channel_name = txt
                break

        # Video count from thumbnail overlay badge: "text": "133 videos"
        badge_match = _re.search(r'"text"\s*:\s*"(\d+)\s*videos?"', full_json)
        if badge_match:
            video_count = badge_match.group(1)

        # Thumbnail from collectionThumbnailViewModel
        sources = (
            lvm.get("contentImage", {})
               .get("collectionThumbnailViewModel", {})
               .get("primaryThumbnail", {})
               .get("thumbnailViewModel", {})
               .get("image", {})
               .get("sources", [])
        )
        thumbnail = sources[-1].get("url") if sources else None

        return {
            "type": "playlist",
            "id": playlist_id,
            "title": title or "Untitled playlist",
            "thumbnail": thumbnail,
            "videoCount": video_count,
            "channelName": channel_name,
            "channelId": "",
            "firstVideoId": first_video_id,
        }
    except Exception:
        return None


def _parse_playlist_renderer(pr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse a legacy playlistRenderer from a YouTube search response."""
    try:
        playlist_id = pr.get("playlistId")
        if not playlist_id:
            return None
        title = (
            pr.get("title", {}).get("simpleText")
            or "".join(r.get("text", "") for r in pr.get("title", {}).get("runs", []))
        )
        thumb_list = pr.get("thumbnails", [])
        thumbnail = None
        for t in thumb_list:
            thumbs = t.get("thumbnails", [])
            if thumbs:
                url = thumbs[-1].get("url", "")
                if url:
                    thumbnail = "https:" + url if url.startswith("//") else url
                    break

        video_count = pr.get("videoCount", "")
        channel_runs = (
            pr.get("shortBylineText", {}).get("runs", [])
            or pr.get("longBylineText", {}).get("runs", [])
        )
        channel_name = "".join(r.get("text", "") for r in channel_runs)
        channel_id = ""
        for run in channel_runs:
            cid = run.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId", "")
            if cid:
                channel_id = cid
                break

        first_video_id = (
            pr.get("navigationEndpoint", {}).get("watchEndpoint", {}).get("videoId", "")
        )

        return {
            "type": "playlist",
            "id": playlist_id,
            "title": title or "Untitled playlist",
            "thumbnail": thumbnail,
            "videoCount": video_count,
            "channelName": channel_name,
            "channelId": channel_id,
            "firstVideoId": first_video_id,
        }
    except Exception:
        return None


def _extract_search_results(data: Dict[str, Any]) -> tuple[
    List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Optional[str]
]:
    """Returns (videos, channels, playlists, continuation_token)."""
    videos: List[Dict[str, Any]] = []
    channels: List[Dict[str, Any]] = []
    playlists: List[Dict[str, Any]] = []
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
                    continue
                cr = item.get("channelRenderer")
                if cr:
                    c = _parse_channel_renderer(cr)
                    if c:
                        channels.append(c)
                    continue
                plr = item.get("playlistRenderer")
                if plr:
                    p = _parse_playlist_renderer(plr)
                    if p:
                        playlists.append(p)
                    continue
                # New YouTube format (2024+): playlists come as lockupViewModel
                lvm = item.get("lockupViewModel")
                if lvm:
                    p = _parse_lockup_view_model(lvm)
                    if p:
                        playlists.append(p)
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
    return videos, channels, playlists, continuation_token


# Keep old name as alias for non-search (channel continuation) callers
def _extract_search_videos(data: Dict[str, Any]) -> tuple[List[Dict[str, Any]], Optional[str]]:
    videos, _, _, token = _extract_search_results(data)
    return videos, token


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
        async with httpx_client(timeout=10.0, follow_redirects=True) as client:
            if page == 1:
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/browse",
                    json={"context": _yt_context(), "browseId": channel_id, "params": _YT_VIDEOS_TAB_PARAMS},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    reset_youtube_errors()
                    videos, token, channel_name = _extract_channel_videos(resp.json())
                    if token:
                        _channel_continuations[f"{channel_id}:{page + 1}"] = token
                    if channel_name:
                        _channel_continuations[f"{channel_id}:name"] = channel_name
                    _enrich_channel_info(videos, channel_id, channel_name)
                    return videos if videos else None
                else:
                    record_youtube_error(resp.status_code)
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
                    reset_youtube_errors()
                    videos, next_token = _extract_continuation_videos(resp.json())
                    if next_token:
                        _channel_continuations[f"{channel_id}:{page + 1}"] = next_token
                    _enrich_channel_info(videos, channel_id, channel_name)
                    return videos if videos else None
                else:
                    record_youtube_error(resp.status_code)
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


async def youtubei_search(
    query: str, page: int = 1
) -> Optional[tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]]:
    """Search via YouTube's internal API.
    Returns (videos, channels, playlists) or None on failure.
    """
    try:
        async with httpx_client(timeout=8.0, follow_redirects=True) as client:
            if page == 1:
                resp = await client.post(
                    "https://www.youtube.com/youtubei/v1/search",
                    json={"context": _yt_context(), "query": query},
                    headers=_YT_HEADERS,
                )
                if resp.status_code == 200:
                    reset_youtube_errors()
                    videos, channels, playlists, token = _extract_search_results(resp.json())
                    if token:
                        _search_continuations[f"{query}:{page + 1}"] = token
                    if videos or channels or playlists:
                        return videos, channels, playlists
                    return None
                else:
                    record_youtube_error(resp.status_code)
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
                    reset_youtube_errors()
                    videos, next_token = _extract_continuation_videos(resp.json())
                    if next_token:
                        _search_continuations[f"{query}:{page + 1}"] = next_token
                    return (videos, [], []) if videos else None
                else:
                    record_youtube_error(resp.status_code)
    except Exception:
        pass
    return None


async def youtubei_trending(region: str = "US", lang: str = "en") -> Optional[List[Dict[str, Any]]]:
    """Fetch trending directly via YouTube's internal API."""
    try:
        async with httpx_client(timeout=8.0, follow_redirects=True) as client:
            resp = await client.post(
                "https://www.youtube.com/youtubei/v1/browse",
                json={"context": _yt_context(hl=lang, gl=region), "browseId": "FEtrending"},
                headers=_YT_HEADERS,
            )
            if resp.status_code == 200:
                reset_youtube_errors()
                videos = _extract_trending_videos(resp.json())
                return videos if videos else None
            else:
                record_youtube_error(resp.status_code)
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

    async with httpx_client(timeout=8.0) as client:
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
            opts = get_ydl_opts(**{"extract_flat": True})
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


@app.get("/api/search")
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
        loop = asyncio.get_event_loop()

        def _search():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(search_query, download=False)

        info = await loop.run_in_executor(None, _search)
        entries = info.get("entries", []) if info else []
        page_entries = entries[offset:offset + 20] if offset < len(entries) else entries
        fallback_videos = [extract_video_card(e) for e in page_entries if e and e.get("id")]
        return {"videos": fallback_videos, "channels": [], "playlists": [], "query": q, "page": page}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.get("/api/video/{video_id}")
async def get_video(video_id: str):
    try:
        opts = get_ydl_opts(**{"format": "bestvideo+bestaudio/best"})

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

                    def _search_related():
                        with yt_dlp.YoutubeDL(opts_rel) as ydl:
                            return ydl.extract_info(f"ytsearch12:{search_q}", download=False)

                    rel_info = await loop.run_in_executor(None, _search_related)
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
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("not available", "private video", "has been removed", "age-restricted", "sign in", "unavailable", "your country", "not made this video", "geo", "blocked")):
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
                with yt_dlp.YoutubeDL(get_ydl_opts()) as ydl:
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


@app.get("/api/stream/{video_id}/audio")
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
            loop = asyncio.get_event_loop()

            def _get_audio_url():
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(
                        f"https://www.youtube.com/watch?v={video_id}", download=False
                    )
                    if not info:
                        return None, "m4a"
                    if itag:
                        for fmt in info.get("formats", []):
                            if str(fmt.get("format_id")) == str(itag):
                                return fmt.get("url"), fmt.get("ext", "m4a")
                    return info.get("url"), info.get("ext", "m4a")

            direct_url, ext = await loop.run_in_executor(None, _get_audio_url)
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


import tempfile
import shutil
from pathlib import Path
from fastapi.responses import FileResponse

# Active HLS transcoding sessions: key = f"{video_id}:{itag}"
_hls_sessions: Dict[str, Dict[str, Any]] = {}
_hls_lock = asyncio.Lock()

async def _get_video_and_audio_urls(video_id: str, itag: str) -> tuple:
    """Return (video_url, audio_url), using cache where possible."""
    video_cache_key = f"stream:{video_id}:{itag}"
    audio_cache_key = f"stream:{video_id}:bestaudio_m4a"

    cached_v = stream_url_cache_get(video_cache_key)
    cached_a = stream_url_cache_get(audio_cache_key)

    if cached_v and cached_a:
        return cached_v[0], cached_a[0]

    opts = get_ydl_opts(**{"quiet": True, "no_warnings": True})
    loop = asyncio.get_event_loop()

    def _fetch():
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            if not info:
                return None, None
            v_url = None
            for fmt in info.get("formats", []):
                if str(fmt.get("format_id")) == str(itag):
                    v_url = fmt.get("url")
                    stream_url_cache_set(video_cache_key, v_url, fmt.get("ext", "mp4"))
                    break
            a_url = None
            for fmt in sorted(info.get("formats", []), key=lambda f: -(f.get("abr") or 0)):
                if (fmt.get("acodec", "none") != "none"
                        and fmt.get("vcodec", "none") == "none"
                        and fmt.get("ext") in ("m4a", "mp4")):
                    a_url = fmt.get("url")
                    stream_url_cache_set(audio_cache_key, a_url, fmt.get("ext", "m4a"))
                    break
            return v_url, a_url

    return await loop.run_in_executor(None, _fetch)


async def _start_hls_session(video_id: str, itag: str, start: int = 0) -> str:
    """Start ffmpeg transcoding from `start` seconds. Returns the session key."""
    session_key = f"{video_id}:{itag}:{start}"

    async with _hls_lock:
        if session_key in _hls_sessions:
            return session_key

        video_url, audio_url = await _get_video_and_audio_urls(video_id, itag)
        if not video_url or not audio_url:
            raise HTTPException(status_code=404, detail="Stream URLs not found")

        tmpdir = tempfile.mkdtemp(prefix="mytube_hls_")
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        seek = ["-ss", str(start)] if start > 0 else []

        cmd = [
            "ffmpeg", "-loglevel", "error", "-y",
            *seek,
            "-headers", f"User-Agent: {ua}\r\nReferer: https://www.youtube.com/\r\n",
            "-i", video_url,
            *seek,
            "-headers", f"User-Agent: {ua}\r\nReferer: https://www.youtube.com/\r\n",
            "-i", audio_url,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "copy",
            "-f", "hls",
            "-hls_time", "1",
            "-hls_list_size", "0",
            "-hls_flags", "append_list",
            "-hls_segment_filename", str(Path(tmpdir) / "seg%05d.ts"),
            str(Path(tmpdir) / "stream.m3u8"),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

        _hls_sessions[session_key] = {"dir": tmpdir, "process": process, "start": start}
        return session_key


def _kill_hls_sessions_for(video_id: str, itag: str):
    """Kill all existing sessions for a given video+itag (synchronous, call inside lock)."""
    prefix = f"{video_id}:{itag}:"
    to_remove = [k for k in _hls_sessions if k.startswith(prefix)]
    for k in to_remove:
        session = _hls_sessions.pop(k)
        try:
            session["process"].kill()
        except Exception:
            pass
        shutil.rmtree(session["dir"], ignore_errors=True)


@app.get("/api/hls/{video_id}/{itag}/stream.m3u8")
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
        session = _hls_sessions[session_key]
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


@app.get("/api/hls/{video_id}/{itag}/{start}/{segment}")
async def hls_segment(video_id: str, itag: str, start: int, segment: str):
    """Serve an HLS segment from the correct session temp dir."""
    if not re.match(r'^seg\d+\.ts$', segment):
        raise HTTPException(status_code=400, detail="Invalid segment name")

    session_key = f"{video_id}:{itag}:{start}"
    session = _hls_sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    seg_path = Path(session["dir"]) / segment

    for _ in range(50):
        if seg_path.exists() and seg_path.stat().st_size > 0:
            return FileResponse(seg_path, media_type="video/mp2t",
                                headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"})
        await asyncio.sleep(0.1)

    raise HTTPException(status_code=404, detail="Segment not ready")


@app.delete("/api/hls/{video_id}/{itag}")
async def hls_stop(video_id: str, itag: str):
    """Kill all ffmpeg sessions for this video+itag and clean up."""
    async with _hls_lock:
        _kill_hls_sessions_for(video_id, itag)
    # Invalidate stream URL cache so the next session fetches fresh YouTube URLs
    # (without this, the next session reuses expired URLs → immediate ffmpeg crash → 503)
    stream_url_cache_invalidate(video_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# IPTV VOD — HLS session management (Shaka Player backend)
# Each session transcodes an IPTV VOD file to HLS segments via ffmpeg.
# Sessions are keyed by stream_id:ext:media:audio_idx:start so that a new
# seek position always creates a fresh session.
# ---------------------------------------------------------------------------

_iptv_vod_hls_sessions: Dict[str, Dict[str, Any]] = {}
_iptv_vod_hls_lock = asyncio.Lock()


def _kill_vod_session(sess: Dict[str, Any]) -> None:
    """Cancel the pipe task and close stdin before killing ffmpeg to avoid BrokenPipeError."""
    pt = sess.get("pipe_task")
    if pt and not pt.done():
        pt.cancel()
    proc = sess["process"]
    try:
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.close()
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass
    shutil.rmtree(sess["dir"], ignore_errors=True)


async def _probe_vod_duration(path: str) -> float:
    """Quick ffprobe to read duration from local file. Returns 0.0 on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8.0)
        text = stdout.decode().strip()
        return float(text) if text else 0.0
    except Exception:
        return 0.0




async def _choose_ffmpeg_input(vod_entry: dict, cache_path: str, start: int) -> tuple:
    """Pick the fastest ffmpeg input strategy for this start position.

    For start > 0 with a partial cache, estimates the seek byte offset,
    waits (up to 60s) for the download to cover it, then returns file-input
    args so ffmpeg can use the MKV cue table for a near-instant seek instead
    of reading the entire file linearly through a pipe.
    """
    seek = ["-ss", str(start)] if start > 0 else []
    cache_done = (
        vod_entry.get("done", False)
        and bool(cache_path) and os.path.exists(cache_path)
        and os.path.getsize(cache_path) > 0
    )

    if cache_done:
        return [*seek, "-i", cache_path], False

    if not cache_path or not os.path.exists(cache_path) or start == 0:
        return ["-fflags", "+ignidx", *seek, "-i", "pipe:0"], True

    # start > 0, partial cache — try to fast-seek via file input
    total_size = vod_entry.get("total_size", 0)
    if total_size > 0 and vod_entry.get("written", 0) >= 5 * 1024 * 1024:
        duration = await _probe_vod_duration(cache_path)
        if duration > 1.0:
            seek_byte = int(start / duration * total_size)
            # 20 MB safety buffer so ffmpeg isn't reading at the exact frontier
            target = min(seek_byte + 20 * 1024 * 1024, total_size)
            deadline = asyncio.get_event_loop().time() + 60
            while (
                vod_entry.get("written", 0) < target
                and not vod_entry.get("done")
                and asyncio.get_event_loop().time() < deadline
            ):
                await asyncio.sleep(0.5)
            if vod_entry.get("written", 0) >= seek_byte or vod_entry.get("done"):
                print(
                    f"[vod_hls] seek={start}s seek_byte={seek_byte//1024//1024}MB "
                    f"written={vod_entry['written']//1024//1024}MB → file seek",
                    flush=True,
                )
                return [*seek, "-i", cache_path], False

    return ["-fflags", "+ignidx", *seek, "-i", "pipe:0"], True


async def _start_iptv_vod_hls_session(
    stream_id: str, ext: str, media: str, audio_idx: int, start: int
) -> Dict[str, Any]:
    session_key = f"{stream_id}:{ext}:{media}:{audio_idx}:{start}"

    # Fast path: session already exists
    async with _iptv_vod_hls_lock:
        if session_key in _iptv_vod_hls_sessions:
            return _iptv_vod_hls_sessions[session_key]

    # Heavy work outside the lock so we don't block other session creation
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    src = f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"
    vod_entry = await _ensure_vod_download(f"{stream_id}.{ext}", src)
    cache_path = vod_entry.get("path", "")

    input_args, use_pipe = await _choose_ffmpeg_input(vod_entry, cache_path, start)

    async with _iptv_vod_hls_lock:
        # Double-check: another concurrent request might have created this session
        if session_key in _iptv_vod_hls_sessions:
            return _iptv_vod_hls_sessions[session_key]

        tmpdir = tempfile.mkdtemp(prefix="mytube_iptv_hls_")

        cmd = [
            _FFMPEG, "-loglevel", "error",
            "-probesize", "5000000", "-analyzeduration", "5000000",
            *input_args,
            "-map", "0:v:0?", "-map", f"0:a:{audio_idx}?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-profile:v", "high", "-level", "4.1",
            "-bf", "0",
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
            "-max_muxing_queue_size", "9999",
            "-sn", "-dn",
            "-f", "hls",
            "-hls_time", "20",
            "-hls_list_size", "0",
            "-hls_flags", "append_list",
            "-hls_segment_filename", str(Path(tmpdir) / "seg%05d.ts"),
            str(Path(tmpdir) / "playlist.m3u8"),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if use_pipe else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.ensure_future(_log_stderr(proc.stderr))
        pipe_task = None
        if use_pipe:
            pipe_task = asyncio.ensure_future(_pipe_from_vod_cache(vod_entry, proc.stdin, 0))
            pipe_task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)

        session = {"dir": tmpdir, "process": proc, "pipe_task": pipe_task, "start": start, "key": session_key}
        _iptv_vod_hls_sessions[session_key] = session
        return session


@app.get("/api/iptv/vod_hls2/{stream_id}/playlist.m3u8")
async def iptv_vod_hls2_playlist(
    request: Request,
    stream_id: str,
    ext: str = "mp4",
    media: str = "movie",
    audio_idx: int = 0,
    start: int = 0,
):
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")

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


@app.get("/api/iptv/vod_hls2/{stream_id}/{start}/{segment}")
async def iptv_vod_hls2_segment(
    stream_id: str, start: int, segment: str,
    ext: str = "mp4", media: str = "movie", audio_idx: int = 0,
):
    if not re.match(r"^seg\d+\.ts$", segment):
        raise HTTPException(status_code=400, detail="Invalid segment")

    session_key = f"{stream_id}:{ext}:{media}:{audio_idx}:{start}"
    session = _iptv_vod_hls_sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

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


@app.get("/api/stream/{video_id}")
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
            loop = asyncio.get_event_loop()

            def _get_video_url():
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(
                        f"https://www.youtube.com/watch?v={video_id}", download=False
                    )
                    if not info:
                        return None, None
                    if itag:
                        for fmt in info.get("formats", []):
                            if str(fmt.get("format_id")) == str(itag):
                                return fmt.get("url"), fmt.get("ext", "mp4")
                    return info.get("url"), info.get("ext", "mp4")

            direct_url, ext = await loop.run_in_executor(None, _get_video_url)
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


@app.get("/api/trailer/{video_id}")
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
            loop = asyncio.get_event_loop()

            def _get_trailer_url():
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(
                        f"https://www.youtube.com/watch?v={video_id}", download=False
                    )
                    if not info:
                        return None, None

                    formats = info.get("formats", [])

                    # Find combined (pre-merged) formats: vcodec and acodec both present
                    combined = [
                        f for f in formats
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
                        return chosen["url"], chosen.get("ext", "mp4")

                    # No combined format found
                    return None, None

            direct_url, ext = await loop.run_in_executor(None, _get_trailer_url)
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


@app.get("/api/dash/{video_id}.mpd")
async def get_dash_mpd(video_id: str, request: Request):
    """Generate a DASH MPD manifest for the given video.

    All video/audio representations point back to our proxy endpoints,
    which use the stream URL cache to avoid repeated yt-dlp calls.
    """
    try:
        loop = asyncio.get_event_loop()
        opts = get_ydl_opts(**{
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
        })

        def _fetch_all():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch_all)
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


@app.get("/api/playlist/{playlist_id}")
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
        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/playlist?list={playlist_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
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


@app.get("/api/subtitles/{video_id}")
async def list_subtitles(video_id: str):
    """Return list of available subtitle/caption tracks for a video."""
    try:
        opts = get_ydl_opts(**{
            "listsubtitles": False,
            "writesubtitles": False,
            "writeautomaticsub": False,
            "skip_download": True,
        })
        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
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


@app.get("/api/subtitles/{video_id}/{lang}")
async def get_subtitle_vtt(video_id: str, lang: str, auto: bool = False):
    """Proxy a subtitle VTT file for a given language."""
    try:
        opts = get_ydl_opts(**{"skip_download": True})
        loop = asyncio.get_event_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )

        info = await loop.run_in_executor(None, _fetch)
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


@app.get("/api/thumbnail/{video_id}")
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


@app.get("/api/debug/channel_thumbnails/{channel_id}")
async def debug_channel_thumbnails(channel_id: str):
    opts = get_ydl_opts(**{"extract_flat": True, "playlistend": 1})
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


@app.get("/api/channel_thumbnail/{channel_id}")
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


@app.get("/api/download/{video_id}")
async def download_video(
    video_id: str,
    itag: Optional[str] = None,
    format: str = "mp4",
    quality: str = "best",
):
    try:
        opts = get_ydl_opts(**{"format": "bestvideo+bestaudio/best"})
        loop = asyncio.get_event_loop()

        def _get_info():
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                if not info:
                    return None, None, None, None, None
                title = info.get("title", video_id)
                if itag:
                    # Find the requested video format
                    video_fmt = next(
                        (f for f in info.get("formats", []) if str(f.get("format_id")) == str(itag)),
                        None
                    )
                    if not video_fmt:
                        return None, title, "mp4", None, None
                    has_video = video_fmt.get("vcodec", "none") != "none"
                    has_audio = video_fmt.get("acodec", "none") != "none"
                    video_url = video_fmt.get("url")
                    ext = video_fmt.get("ext", "mp4")
                    if has_video and not has_audio:
                        # Video-only: find best audio to merge with ffmpeg
                        audio_fmt = next(
                            (f for f in sorted(info.get("formats", []), key=lambda f: -(f.get("abr") or 0))
                             if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"),
                            None
                        )
                        audio_url = audio_fmt.get("url") if audio_fmt else None
                        return video_url, title, "mp4", audio_url, True
                    else:
                        return video_url, title, ext, None, False
                elif format == "mp3":
                    audio_fmt = next(
                        (f for f in sorted(info.get("formats", []), key=lambda f: -(f.get("abr") or 0))
                         if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"),
                        None
                    )
                    return audio_fmt.get("url") if audio_fmt else None, title, "m4a", None, False
                else:
                    return info.get("url"), title, info.get("ext", "mp4"), None, False

        video_url, title, ext, audio_url, needs_merge = await loop.run_in_executor(None, _get_info)

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
                    "ffmpeg", "-y",
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


@app.get("/api/channel_banner/{channel_id}")
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


@app.get("/api/channel/{channel_id}")
async def get_channel(channel_id: str):
    try:
        opts = get_ydl_opts(**{"extract_flat": True, "playlistend": 1})
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

_ytm_cache: dict = {}

def get_ytm(language: str = "en") -> _YTMusic:
    global _ytm_cache
    proxy = _get_proxy_url() if '_wireproxy_process' in globals() else None
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


# ─── Podcast Index API ───────────────────────────────────────────────────────
import hashlib

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


@app.get("/api/podcasts/config")
async def get_podcast_config():
    """Return current Podcast Index config (secret masked)."""
    return {
        "key": _pi_effective_key(),
        "secret": "set" if _pi_effective_secret() else "",
    }


@app.post("/api/podcasts/config")
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


@app.get("/api/podcasts/image/proxy")
async def podcast_image_proxy(url: str):
    """Proxy podcast/radio artwork to avoid third-party tracker exposure."""
    # Transparent 1×1 GIF returned on any error so clients don't log 404s
    _EMPTY_GIF = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    if not url or url == "null" or not url.startswith("http"):
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


@app.get("/api/podcasts/search")
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


@app.get("/api/podcasts/{podcast_id}")
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


@app.get("/api/podcasts/audio/proxy")
async def podcast_audio_proxy(url: str, request: Request):
    """Proxy podcast episode audio to avoid CORS issues."""
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
            logger.warning(f"Podcast audio proxy error: {exc}")
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


RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info/json"


@app.get("/api/radio/stations")
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


@app.get("/api/radio/stream/proxy")
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


# ─── VPN WireGuard (wireproxy) ───────────────────────────────────────────────

import subprocess
import shutil
import tempfile
from fastapi import UploadFile, File

_wireproxy_process: Optional[subprocess.Popen] = None
_wireproxy_conf_path: Optional[str] = None  # path to the currently active .conf
_wireproxy_conf_name: Optional[str] = None  # display name of active .conf
_wireproxy_socks_port: int = 25344

# ── Auto-failover state ──────────────────────────────────────────────────────
_vpn_auto_mode: bool = False          # user-enabled auto failover
_vpn_error_count: int = 0             # consecutive YouTube errors on current conf
_vpn_failed_confs: set = set()        # confs that have already been tried and failed
_vpn_all_failed: bool = False         # True when all confs exhausted
_vpn_failover_threshold: int = 1      # errors before switching conf
_vpn_failover_lock = asyncio.Lock()   # prevent concurrent failovers

WIREPROXY_BIN = shutil.which("wireproxy") or "/usr/local/bin/wireproxy"

SOCKS5_SECTION = f"\n[Socks5]\nBindAddress = 127.0.0.1:{_wireproxy_socks_port}\n"

# Persistent storage for saved configs
VPN_CONFIGS_DIR = os.path.join(os.path.expanduser("~"), ".mytube", "vpn_configs")
VPN_STATE_FILE  = os.path.join(os.path.expanduser("~"), ".mytube", "vpn_state.json")
os.makedirs(VPN_CONFIGS_DIR, exist_ok=True)

def _vpn_state_load() -> dict:
    try:
        with open(VPN_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def _vpn_state_save(state: dict):
    try:
        with open(VPN_STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass

def _restore_active_conf():
    """On startup: restore last active config if it still exists."""
    global _wireproxy_conf_path, _wireproxy_conf_name
    state = _vpn_state_load()
    active = state.get("active")
    if active:
        path = os.path.join(VPN_CONFIGS_DIR, active)
        if os.path.exists(path):
            _wireproxy_conf_path = path
            _wireproxy_conf_name = active

_restore_active_conf()


_vpn_last_activity: float = _time()  # updated on every proxied request
_VPN_IDLE_RESTART_SECS = 300  # restart after 5 min idle to recover stale tunnels


def vpn_record_activity():
    global _vpn_last_activity
    _vpn_last_activity = _time()


async def _restart_wireproxy():
    """Stop and restart wireproxy with the current conf."""
    loop = asyncio.get_event_loop()
    conf_path = _wireproxy_conf_path
    await loop.run_in_executor(None, _stop_wireproxy_sync)
    await asyncio.sleep(1)
    await loop.run_in_executor(None, _start_wireproxy_sync, conf_path)


async def _vpn_watchdog():
    """Periodically check that the VPN tunnel is actually alive:
    1. If the SOCKS5 port is unresponsive → restart immediately.
    2. If idle for >5 min → restart proactively to recover stale WireGuard tunnels.
    """
    await asyncio.sleep(30)  # let the server fully start first
    while True:
        await asyncio.sleep(20)
        try:
            if not (_wireproxy_process and _wireproxy_process.poll() is None):
                continue
            if not _wireproxy_conf_path:
                continue

            # 1. Liveness check: try connecting to SOCKS5 port
            port_alive = False
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", _wireproxy_socks_port),
                    timeout=3.0,
                )
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
                port_alive = True
            except Exception:
                pass

            if not port_alive:
                await _restart_wireproxy()
                continue

            # 2. Idle check: tunnel may be alive but WireGuard handshake stale
            idle_secs = _time() - _vpn_last_activity
            if idle_secs > _VPN_IDLE_RESTART_SECS:
                await _restart_wireproxy()
                vpn_record_activity()  # reset timer after restart

        except Exception:
            pass


@app.on_event("startup")
async def start_vpn_watchdog():
    asyncio.create_task(_vpn_watchdog())
    asyncio.create_task(_vod_cache_cleanup_loop())


def _list_all_confs() -> List[str]:
    """Return sorted list of all saved .conf filenames."""
    try:
        return sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    except Exception:
        return []


def _stop_wireproxy_sync():
    """Stop wireproxy synchronously."""
    global _wireproxy_process
    if _wireproxy_process:
        try:
            _wireproxy_process.terminate()
            _wireproxy_process.wait(timeout=5)
        except Exception:
            try:
                _wireproxy_process.kill()
            except Exception:
                pass
        _wireproxy_process = None
    _ytm_cache.clear()


def _start_wireproxy_sync(conf_path: str) -> bool:
    """Start wireproxy with given conf. Returns True on success."""
    global _wireproxy_process
    import time
    try:
        _wireproxy_process = subprocess.Popen(
            [WIREPROXY_BIN, "-c", conf_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        time.sleep(1.5)
        if _wireproxy_process.poll() is not None:
            _wireproxy_process = None
            return False
        _ytm_cache.clear()
        return True
    except Exception:
        _wireproxy_process = None
        return False


async def _vpn_failover():
    """Try the next available conf. If all exhausted, disable wireproxy."""
    global _wireproxy_conf_path, _wireproxy_conf_name
    global _vpn_error_count, _vpn_failed_confs, _vpn_all_failed

    async with _vpn_failover_lock:
        if not _vpn_auto_mode:
            return

        # Mark current conf as failed
        if _wireproxy_conf_name:
            _vpn_failed_confs.add(_wireproxy_conf_name)

        all_confs = _list_all_confs()
        candidates = [c for c in all_confs if c not in _vpn_failed_confs]

        if not candidates:
            # All confs exhausted — disable wireproxy
            _stop_wireproxy_sync()
            _vpn_all_failed = True
            _vpn_error_count = 0
            return

        # Try next candidate
        next_conf = candidates[0]
        next_path = os.path.join(VPN_CONFIGS_DIR, next_conf)

        _stop_wireproxy_sync()

        loop = asyncio.get_event_loop()
        success = await loop.run_in_executor(None, _start_wireproxy_sync, next_path)

        if success:
            _wireproxy_conf_path = next_path
            _wireproxy_conf_name = next_conf
            _vpn_state_save({"active": next_conf})
            _vpn_error_count = 0
        else:
            _vpn_failed_confs.add(next_conf)
            # Recurse to try the next one
            await _vpn_failover()


def record_youtube_error(status_code: int):
    """Call this when YouTube returns a blocking error. Triggers failover if needed."""
    global _vpn_error_count
    if not _vpn_auto_mode:
        return
    if _wireproxy_process is None or _wireproxy_process.poll() is not None:
        return
    if status_code in (403, 429, 451):
        _vpn_error_count += 1
        if _vpn_error_count >= _vpn_failover_threshold:
            _vpn_error_count = 0
            asyncio.create_task(_vpn_failover())


def reset_youtube_errors():
    """Call this on a successful YouTube response to reset the error counter."""
    global _vpn_error_count
    _vpn_error_count = 0


def _get_proxy_url() -> Optional[str]:
    if _wireproxy_process and _wireproxy_process.poll() is None:
        return f"socks5://127.0.0.1:{_wireproxy_socks_port}"
    return None


def _prepare_conf(raw: str) -> str:
    """Ensure the conf has a [Socks5] section for wireproxy."""
    if "[Socks5]" in raw:
        return raw
    return raw.rstrip() + SOCKS5_SECTION


@app.get("/api/vpn/status")
async def vpn_status():
    running = _wireproxy_process is not None and _wireproxy_process.poll() is None
    return {
        "running": running,
        "conf_loaded": _wireproxy_conf_path is not None,
        "conf_name": _wireproxy_conf_name,
        "error": None,
        "proxy": _get_proxy_url(),
        "auto_mode": _vpn_auto_mode,
        "all_failed": _vpn_all_failed,
        "error_count": _vpn_error_count,
    }


@app.post("/api/vpn/auto")
async def vpn_set_auto_mode(body: dict):
    global _vpn_auto_mode, _vpn_error_count, _vpn_failed_confs, _vpn_all_failed
    enabled = bool(body.get("enabled", False))
    _vpn_auto_mode = enabled
    # Reset failover state when toggling
    _vpn_error_count = 0
    _vpn_failed_confs = set()
    _vpn_all_failed = False
    return {"auto_mode": _vpn_auto_mode}


@app.post("/api/vpn/reset_failover")
async def vpn_reset_failover():
    """Reset the failover state so all confs are candidates again."""
    global _vpn_error_count, _vpn_failed_confs, _vpn_all_failed
    _vpn_error_count = 0
    _vpn_failed_confs = set()
    _vpn_all_failed = False
    return {"ok": True}


@app.get("/api/vpn/configs")
async def vpn_list_configs():
    """List all saved .conf files."""
    try:
        names = sorted(
            f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf")
        )
    except Exception:
        names = []
    return {"configs": names, "active": _wireproxy_conf_name}


@app.post("/api/vpn/upload")
async def vpn_upload_conf(file: UploadFile = File(...)):
    global _wireproxy_conf_path, _wireproxy_conf_name

    content = await file.read()
    try:
        raw = content.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file encoding — expected UTF-8 .conf")

    if "[Interface]" not in raw:
        raise HTTPException(status_code=400, detail="Invalid WireGuard config: missing [Interface] section")

    conf = _prepare_conf(raw)

    name = file.filename or "vpn.conf"
    path = os.path.join(VPN_CONFIGS_DIR, name)
    with open(path, "w") as f:
        f.write(conf)

    _wireproxy_conf_path = path
    _wireproxy_conf_name = name
    _vpn_state_save({"active": name})
    _ytm_cache.clear()

    configs = sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    return {"ok": True, "conf_name": name, "configs": configs}


@app.post("/api/vpn/select")
async def vpn_select_conf(body: dict):
    """Select a previously saved config as active."""
    global _wireproxy_conf_path, _wireproxy_conf_name

    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Missing 'name'")

    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    if _wireproxy_process and _wireproxy_process.poll() is None:
        raise HTTPException(status_code=409, detail="Stop the VPN before switching config")

    _wireproxy_conf_path = path
    _wireproxy_conf_name = name
    _vpn_state_save({"active": name})

    return {"ok": True, "conf_name": name}


@app.delete("/api/vpn/configs/{name}")
async def vpn_delete_conf(name: str):
    """Delete a saved config. Cannot delete the active one while VPN is running."""
    global _wireproxy_conf_path, _wireproxy_conf_name

    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    running = _wireproxy_process is not None and _wireproxy_process.poll() is None
    if running and _wireproxy_conf_name == name:
        raise HTTPException(status_code=409, detail="Cannot delete the active config while VPN is running")

    os.remove(path)

    # If it was the active config, deselect it
    if _wireproxy_conf_name == name:
        _wireproxy_conf_path = None
        _wireproxy_conf_name = None
        state = _vpn_state_load()
        state.pop("active", None)
        _vpn_state_save(state)

    configs = sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    return {"ok": True, "configs": configs}


@app.post("/api/vpn/start")
async def vpn_start():
    global _wireproxy_process

    if not _wireproxy_conf_path or not os.path.exists(_wireproxy_conf_path):
        raise HTTPException(status_code=400, detail="No VPN config loaded. Upload a .conf file first.")

    if _wireproxy_process and _wireproxy_process.poll() is None:
        return {"running": True, "message": "Already running"}

    if not os.path.exists(WIREPROXY_BIN):
        raise HTTPException(
            status_code=500,
            detail=f"wireproxy not found at {WIREPROXY_BIN}. Install it: https://github.com/pufferffish/wireproxy"
        )

    try:
        _wireproxy_process = subprocess.Popen(
            [WIREPROXY_BIN, "-c", _wireproxy_conf_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        # Give it a moment to start
        import time
        time.sleep(1.5)

        if _wireproxy_process.poll() is not None:
            stderr = _wireproxy_process.stderr.read().decode("utf-8", errors="replace") if _wireproxy_process.stderr else ""
            raise HTTPException(status_code=500, detail=f"wireproxy exited immediately: {stderr[:300]}")

        # Clear ytmusicapi cache so new instances use the proxy
        _ytm_cache.clear()

        return {"running": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start wireproxy: {str(e)}")


@app.post("/api/vpn/stop")
async def vpn_stop():
    global _wireproxy_process

    if _wireproxy_process:
        try:
            _wireproxy_process.terminate()
            _wireproxy_process.wait(timeout=5)
        except Exception:
            try:
                _wireproxy_process.kill()
            except Exception:
                pass
        _wireproxy_process = None

    # Clear ytmusicapi cache so new instances don't use the proxy
    _ytm_cache.clear()

    return {"running": False}


@app.get("/api/vpn/myip")
async def vpn_myip():
    """Return the public IP as seen by external servers (routes through VPN if active)."""
    try:
        async with httpx_client(timeout=6.0) as client:
            r = await client.get("https://ipinfo.io/json")
            if r.status_code == 200:
                data = r.json()
                return {
                    "ip": data.get("ip"),
                    "city": data.get("city"),
                    "region": data.get("region"),
                    "country": data.get("country"),
                    "org": data.get("org"),
                }
    except Exception:
        pass
    raise HTTPException(status_code=503, detail="Could not fetch IP info")


NEWS_CACHE_TTL = 900  # 15 minutes
_news_cache: Dict[str, tuple] = {}

def news_cache_get(key: str):
    if key in _news_cache:
        ts, data = _news_cache[key]
        if _time() - ts < NEWS_CACHE_TTL:
            return data
        del _news_cache[key]
    return None

def news_cache_set(key: str, data: Any):
    _news_cache[key] = (_time(), data)

GOOGLE_NEWS_CATEGORIES = {
    "general": None,
    "technology": "TECHNOLOGY",
    "business": "BUSINESS",
    "entertainment": "ENTERTAINMENT",
    "sports": "SPORTS",
    "science": "SCIENCE",
    "health": "HEALTH",
    "world": "WORLD",
    "nation": "NATION",
    "politics": "NATION",  # Google News has no POLITICS topic, NATION is closest
}

REGION_LANG_MAP = {
    "FR": "fr", "US": "en", "GB": "en", "DE": "de", "ES": "es",
    "PT": "pt", "IT": "it", "JP": "ja", "KR": "ko", "RU": "ru",
    "AR": "ar", "BR": "pt", "CA": "en", "AU": "en", "MX": "es",
    "IN": "hi", "CN": "zh", "NL": "nl", "PL": "pl", "SE": "sv",
    "NO": "no", "DK": "da", "FI": "fi", "CH": "de", "BE": "fr",
}

def _extract_raw_tag(text: str, tag: str) -> str:
    """Extract raw content of first tag occurrence, handling CDATA and encoded HTML."""
    m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', text, re.DOTALL)
    if not m:
        return ""
    content = m.group(1).strip()
    # Unwrap CDATA if present
    cdata = re.match(r'<!\[CDATA\[(.*?)\]\]>', content, re.DOTALL)
    if cdata:
        return cdata.group(1).strip()
    # Otherwise HTML-decode (Google News uses &lt; &gt; encoded HTML)
    return html_lib.unescape(content)

def _parse_rss(xml_text: str) -> list:
    articles = []
    try:
        items = re.findall(r'<item>(.*?)</item>', xml_text, re.DOTALL)
        for raw in items:
            title = re.sub(r"<[^>]+>", "", _extract_raw_tag(raw, "title")).strip()
            if not title:
                continue

            # <link> in RSS 2.0 is a bare text node
            link_m = re.search(r'<link>(.*?)</link>', raw, re.DOTALL)
            link = link_m.group(1).strip() if link_m else ""

            pub_date = _extract_raw_tag(raw, "pubDate")

            # Source
            source_m = re.search(r'<source[^>]*>(.*?)</source>', raw, re.DOTALL)
            source = source_m.group(1).strip() if source_m else ""

            # Description: HTML-decode then extract image and clean text
            desc_html = _extract_raw_tag(raw, "description")

            # Image: look for <img src="..."> in decoded HTML
            image = None
            img_m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_html)
            if img_m:
                image = img_m.group(1)
            if not image:
                media_m = re.search(r'<media:content[^>]+url=["\']([^"\']+)["\']', raw)
                if media_m:
                    image = media_m.group(1)

            # Strip HTML tags from description, collapse whitespace
            clean_desc = re.sub(r"<[^>]+>", " ", desc_html)
            clean_desc = clean_desc.replace("\xa0", " ")  # non-breaking spaces
            clean_desc = re.sub(r"\s{2,}", " ", clean_desc).strip()
            if len(clean_desc) > 220:
                clean_desc = clean_desc[:220] + "…"

            articles.append({
                "title": title,
                "link": link,
                "pubDate": pub_date,
                "source": source,
                "description": clean_desc,
                "image": image,
            })
    except Exception:
        pass
    return articles


@app.get("/api/news")
async def get_news(region: str = "FR", category: str = "general"):
    cache_key = f"news:{region}:{category}"
    cached = news_cache_get(cache_key)
    if cached:
        return cached

    lang = REGION_LANG_MAP.get(region.upper(), "en")
    country = region.upper()
    cat = GOOGLE_NEWS_CATEGORIES.get(category.lower())

    if cat:
        url = f"https://news.google.com/rss/headlines/section/topic/{cat}?hl={lang}&gl={country}&ceid={country}:{lang}"
    else:
        url = f"https://news.google.com/rss?hl={lang}&gl={country}&ceid={country}:{lang}"

    try:
        async with httpx_client(timeout=10.0) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch news feed")
            articles = _parse_rss(r.text)
            result = {"articles": articles, "region": region, "category": category}
            news_cache_set(cache_key, result)
            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ─── IPTV / Xtream ────────────────────────────────────────────────────────────
_xtream_cfg_path = os.path.join(os.path.expanduser("~"), ".mytube", "xtream.json")
_xtream_cfg: dict = {}

# Persistent client for IPTV VOD streaming — reuses TCP connections to Xtream
# so that each browser Range request doesn't pay a full TLS handshake.
_iptv_stream_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=10.0, read=None, write=None, pool=5.0),
    follow_redirects=True,
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30),
)

def _xtream_load():
    global _xtream_cfg
    try:
        with open(_xtream_cfg_path) as f:
            _xtream_cfg = json.load(f)
    except Exception:
        _xtream_cfg = {}

def _xtream_save():
    try:
        os.makedirs(os.path.dirname(_xtream_cfg_path), exist_ok=True)
        with open(_xtream_cfg_path, "w") as f:
            json.dump(_xtream_cfg, f)
    except Exception:
        pass

_xtream_load()

@app.get("/api/iptv/status")
async def iptv_status():
    return {"configured": bool(_xtream_cfg.get("server"))}

@app.post("/api/iptv/credentials")
async def iptv_save_credentials(body: dict = Body(...)):
    global _xtream_cfg
    server = body.get("server", "").rstrip("/")
    if not server.startswith("http"):
        server = "http://" + server
    _xtream_cfg = {"server": server, "username": body.get("username",""), "password": body.get("password","")}
    _xtream_save()
    return {"ok": True}

@app.delete("/api/iptv/credentials")
async def iptv_delete_credentials():
    global _xtream_cfg
    _xtream_cfg = {}
    _xtream_save()
    return {"ok": True}

async def _xtream_api(action: str, extra: dict | None = None, timeout: float = 45.0) -> Any:
    """Call Xtream Codes player_api.php directly, bypassing any VPN proxy."""
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    params: dict = {"username": u, "password": p, "action": action}
    if extra:
        params.update(extra)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(f"{s}/player_api.php", params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Xtream HTTP {resp.status_code}")
        try:
            return resp.json()
        except Exception:
            raise HTTPException(status_code=502, detail="Xtream returned non-JSON response")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Xtream connection error: {type(e).__name__}: {e}")

@app.get("/api/iptv/debug")
async def iptv_debug():
    """Test Xtream connection and return diagnostics."""
    if not _xtream_cfg.get("server"):
        return {"configured": False}
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(f"{s}/player_api.php", params={"username": u, "password": p})
        data = resp.json() if resp.status_code == 200 else {}
        return {
            "server": s,
            "http_status": resp.status_code,
            "user_status": data.get("user_info", {}).get("status", "unknown"),
            "active": data.get("user_info", {}).get("active_cons", "?"),
            "max_connections": data.get("user_info", {}).get("max_connections", "?"),
            "expiry": data.get("user_info", {}).get("exp_date", "?"),
        }
    except Exception as e:
        return {"server": s, "error": str(e)}

@app.get("/api/iptv/categories")
async def iptv_categories():
    data = await _xtream_api("get_live_categories", timeout=15.0)
    return data if isinstance(data, list) else []

@app.get("/api/iptv/channels")
async def iptv_channels(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_live_streams", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []

@app.get("/api/iptv/stream/{stream_id}")
async def iptv_stream_url(stream_id: str, request: Request):
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/api/iptv/hls/{stream_id}"}

@app.get("/api/iptv/hls/{stream_id}")
async def iptv_hls_stream(stream_id: str, request: Request):
    """Fetch IPTV HLS manifest and rewrite URLs through our proxy to fix CORS."""
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    m3u8_url = f"{s}/live/{u}/{p}/{stream_id}.m3u8"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(m3u8_url)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Stream returned HTTP {resp.status_code}")
        base = str(request.base_url).rstrip("/")
        proxy_base = f"{base}/api/iptv/proxy"
        rewritten = rewrite_hls_manifest(resp.text, str(resp.url), proxy_base)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-store"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"HLS error: {e}")

@app.get("/api/iptv/proxy")
async def iptv_hls_proxy(url: str, request: Request):
    """Proxy IPTV HLS sub-playlists and TS segments (no VPN, no CORS issues)."""
    try:
        decoded_url = base64.urlsafe_b64decode(url + "==").decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL encoding")
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(decoded_url)
        ct = resp.headers.get("content-type", "")
        if "mpegurl" in ct or decoded_url.split("?")[0].endswith(".m3u8"):
            base = str(request.base_url).rstrip("/")
            proxy_base = f"{base}/api/iptv/proxy"
            rewritten = rewrite_hls_manifest(resp.text, decoded_url, proxy_base)
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
                headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-store"},
            )
        return Response(
            content=resp.content,
            media_type=ct or "video/mp2t",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")

@app.get("/api/iptv/icon")
async def iptv_icon_proxy(url: str):
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        parsed = urlparse(url)
        referer = f"{parsed.scheme}://{parsed.netloc}/"
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": referer,
            })
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Icon not found")
        ct = resp.headers.get("content-type", "image/png")
        return Response(content=resp.content, media_type=ct)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Icon not found")

@app.get("/api/iptv/vod_categories")
async def iptv_vod_categories():
    data = await _xtream_api("get_vod_categories", timeout=15.0)
    return data if isinstance(data, list) else []

@app.get("/api/iptv/vod")
async def iptv_vod(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_vod_streams", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []

_vod_all_cache: tuple[float, list] = (0.0, [])
_series_all_cache: tuple[float, list] = (0.0, [])

@app.get("/api/iptv/search_catalog")
async def iptv_search_catalog(q: str = "", type: str = "movie", limit: int = 3):
    """Search VOD (movie) or series catalog by title using string similarity.
    Returns matching items with their stream_id (VOD) or series_id (series)."""
    global _vod_all_cache, _series_all_cache
    if not q.strip():
        return []

    is_series = (type == "tv")

    # Refresh cache every 10 min
    if is_series:
        if _time() - _series_all_cache[0] > 600:
            data = await _xtream_api("get_series", timeout=60.0)
            _series_all_cache = (_time(), data if isinstance(data, list) else [])
        all_items = _series_all_cache[1]
    else:
        if _time() - _vod_all_cache[0] > 600:
            data = await _xtream_api("get_vod_streams", timeout=60.0)
            _vod_all_cache = (_time(), data if isinstance(data, list) else [])
        all_items = _vod_all_cache[1]

    clean_q, year_q = _clean_title_for_tmdb(q)
    clean_q_l = clean_q.lower()

    scored: list[tuple[float, dict]] = []
    for item in all_items:
        raw = item.get("name", "")
        clean_item, year_item = _clean_title_for_tmdb(raw)
        clean_item_l = clean_item.lower()

        # Word-level Jaccard: require at least one common word to avoid
        # false positives like "michael" matching "chapel" via shared chars.
        q_words = set(re.findall(r'\b\w{2,}\b', clean_q_l))
        c_words = set(re.findall(r'\b\w{2,}\b', clean_item_l))
        if not q_words or not c_words:
            continue
        intersection = q_words & c_words
        if not intersection:
            continue
        jaccard = len(intersection) / len(q_words | c_words)
        if jaccard < 0.45:
            continue

        score: float = jaccard * 100
        if clean_item_l == clean_q_l:
            score += 50          # exact match bonus
        if year_q and year_item == year_q:
            score += 30          # year match bonus
        scored.append((score, item))

    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:limit]]

@app.get("/api/iptv/vod_tracks/{stream_id}")
async def iptv_vod_tracks(stream_id: str, ext: str = "mp4", media: str = "movie"):
    """List audio and subtitle tracks via ffprobe."""
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    src_url = f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"
    streams = []
    try:
        proc = await asyncio.create_subprocess_exec(
            _FFPROBE,
            "-v", "quiet", "-print_format", "json",
            "-seekable", "0",
            "-analyzeduration", "8000000", "-probesize", "20000000",
            "-show_streams",
            src_url,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd="/tmp",
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=20.0)
            streams = json.loads(stdout).get("streams", [])
        except (asyncio.TimeoutError, Exception):
            try: proc.kill()
            except Exception: pass
            try: await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception: pass
    except Exception:
        pass

    # Codecs image-based qui ne peuvent pas être convertis en WebVTT texte
    _IMAGE_SUB_CODECS = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub", "pgssub", "dvb_teletext"}

    audio, subtitles, a_idx, s_idx = [], [], 0, 0
    for stream in streams:
        ctype = stream.get("codec_type", "")
        tags = stream.get("tags", {})
        lang = (tags.get("language") or tags.get("lang") or "").upper()
        title = tags.get("title") or tags.get("handler_name") or ""
        codec = stream.get("codec_name", "")
        disposition = stream.get("disposition", {})
        if ctype == "audio":
            audio.append({"index": a_idx, "language": lang, "title": title, "codec": codec, "channels": stream.get("channels", 2)})
            a_idx += 1
        elif ctype == "subtitle":
            if codec not in _IMAGE_SUB_CODECS:
                forced = bool(disposition.get("forced", 0))
                display_title = f"{title} (Forcé)" if forced and title else ("Forcé" if forced else title)
                subtitles.append({"index": s_idx, "language": lang, "title": display_title, "codec": codec})
            s_idx += 1  # toujours incrémenter pour conserver l'index ffmpeg correct

    # Dédupliquer les libellés identiques (ex: deux pistes "FRE" sans titre)
    label_count: dict = {}
    for sub in subtitles:
        key = f"{sub['language']}|{sub['title']}"
        label_count[key] = label_count.get(key, 0) + 1
    label_seen: dict = {}
    for sub in subtitles:
        key = f"{sub['language']}|{sub['title']}"
        if label_count[key] > 1:
            label_seen[key] = label_seen.get(key, 0) + 1
            suffix = str(label_seen[key])
            sub["title"] = f"{sub['title']} {suffix}".strip() if sub["title"] else suffix

    return {"audio": audio, "subtitles": subtitles}


@app.get("/api/iptv/vod_subtitle/{stream_id}")
async def iptv_vod_subtitle(stream_id: str, ext: str = "mp4", media: str = "movie", sub_idx: int = 0):
    """Extract an embedded subtitle track as WebVTT.

    Uses the local vod_cache file when available (shared with the HLS session),
    which is orders of magnitude faster than reading from the remote URL.
    """
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    remote_url = f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"

    # Prefer the local cache file (already being downloaded by the HLS session).
    # Even a partial file lets ffmpeg seek via the MKV cues element instantly.
    cache_key = f"{stream_id}.{ext}"
    vod_entry = _vod_dl_cache.get(cache_key)
    if not vod_entry:
        vod_entry = await _ensure_vod_download(cache_key, remote_url)

    cache_path = vod_entry.get("path", "")
    cache_written = vod_entry.get("written", 0)
    use_local = (
        bool(cache_path)
        and os.path.exists(cache_path)
        and cache_written >= 10 * 1024 * 1024  # at least 10 MB (covers MKV headers + index)
    )
    src = cache_path if use_local else remote_url

    cmd = [
        _FFMPEG, "-loglevel", "error",
        "-i", src,
        "-map", f"0:s:{sub_idx}",
        "-vn", "-an",
        "-f", "webvtt",
        "pipe:1",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd="/tmp",
        )
        try:
            timeout = 15.0 if use_local else 60.0
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try: proc.kill()
            except Exception: pass
            await proc.wait()
            raise HTTPException(status_code=504, detail="Subtitle extraction timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return Response(
        content=stdout,
        media_type="text/vtt",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"},
    )


@app.get("/api/iptv/vod_stream/{stream_id}")
async def iptv_vod_stream_url(stream_id: str, request: Request, ext: str = "mp4", media: str = "movie", audio_idx: int = 0):
    """Return the ffmpeg-transcoded proxy URL + duration via ffprobe (3 s timeout)."""
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    base = str(request.base_url).rstrip("/")
    src_url = f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"

    duration_secs: float | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            _FFPROBE,
            "-v", "quiet", "-print_format", "json",
            "-seekable", "0",
            "-analyzeduration", "3000000", "-probesize", "10000000",
            # Ask for both container duration and per-stream duration (fallback)
            "-show_entries", "format=duration:stream=duration,codec_type",
            src_url,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd="/tmp",
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            info = json.loads(stdout)
            # 1) Format-level duration (most reliable)
            dur = float(info.get("format", {}).get("duration") or 0)
            if dur <= 0:
                # 2) Fall back to first video stream duration
                for s in info.get("streams", []):
                    if s.get("codec_type") == "video":
                        dur = float(s.get("duration") or 0)
                        if dur > 0:
                            break
            if dur <= 0:
                # 3) Any stream with a positive duration
                for s in info.get("streams", []):
                    dur = float(s.get("duration") or 0)
                    if dur > 0:
                        break
            if dur > 0:
                duration_secs = dur
        except (asyncio.TimeoutError, Exception):
            try:
                proc.kill()
            except Exception:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception:
                pass
    except Exception:
        pass

    # Pre-start the file download so vod_proxy can reuse it immediately
    asyncio.create_task(_ensure_vod_download(f"{stream_id}.{ext}", src_url))

    return {
        "url": f"/api/iptv/vod_proxy/{stream_id}?ext={ext}&media={media}&audio_idx={audio_idx}",
        "hls": False,
        "duration": duration_secs,
    }

_TMDB_BASE = "https://api.themoviedb.org/3"
_TMDB_IMG  = "https://image.tmdb.org/t/p"
_tmdb_cache: Dict[str, tuple] = {}
_tmdb_cfg_path = os.path.join(os.path.expanduser("~"), ".mytube", "tmdb.json")

def _tmdb_load() -> str:
    try:
        with open(_tmdb_cfg_path) as f:
            return json.load(f).get("key", "")
    except Exception:
        return ""

def _tmdb_save(key: str) -> None:
    try:
        os.makedirs(os.path.dirname(_tmdb_cfg_path), exist_ok=True)
        with open(_tmdb_cfg_path, "w") as f:
            json.dump({"key": key}, f)
    except Exception:
        pass

_TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "") or _tmdb_load()

_RE_IPTV_PREFIX = re.compile(
    r"^(?:(?:FR|VF|VOF|VO|EN|DE|ES|IT|AR|NL|PT|PL|RU|TR|US|UK)"
    r"(?:\s*[\|:\-]\s*|\s+))+",
    re.IGNORECASE,
)
_RE_IPTV_SUFFIX = re.compile(
    r"\s*[\[\(](?:\d{4}|4K|2160p|1080p|720p|480p|HDTV|BluRay|WEB(?:-?DL)?|REMUX"
    r"|HDR|DV|HEVC|H\.?264|x264|x265|MULTI|TRUEFRENCH|FRENCH|VF|VO|VOSTFR"
    r"|S\d{1,2}E\d{1,2}|SAISON\s*\d+|SEASON\s*\d+)[^\]\)]*[\]\)].*$",
    re.IGNORECASE,
)
_RE_YEAR = re.compile(r"\b(19[5-9]\d|20[0-3]\d)\b")

def _clean_title_for_tmdb(name: str) -> tuple[str, str | None]:
    """Strip IPTV-style prefixes/tags. Returns (clean_title, year_or_None).
    Matches the Jellyfin/Plex approach: extract year before stripping so it
    can be passed as a separate TMDB search parameter for accurate matching."""
    # Extract year BEFORE stripping (brackets may contain the year)
    year_m = _RE_YEAR.search(name)
    year = year_m.group(1) if year_m else None

    name = _RE_IPTV_PREFIX.sub("", name).strip()
    name = _RE_IPTV_SUFFIX.sub("", name).strip()
    # Remove trailing junk after " - " if it looks like a tag (all caps / digits)
    parts = name.rsplit(" - ", 1)
    if len(parts) == 2 and re.match(r"^[A-Z0-9 _/]+$", parts[1]):
        name = parts[0].strip()
    # Also strip bare 4-digit year at the end (e.g. "Film Title 2023")
    name = re.sub(r"\s+\d{4}$", "", name).strip()
    return name, year

_ANIMATION_GENRE_ID = 16

def _pick_best_tmdb_result(results: list[dict], clean_name: str) -> dict | None:
    """Among TMDB results, prefer well-established animated series over
    recent live-action remakes when both share the same title.
    Example: One Piece anime >> Netflix live-action, Avatar animated >> Netflix remake."""
    if not results:
        return None
    if len(results) == 1:
        return results[0]

    top = results[0]
    if _ANIMATION_GENRE_ID in top.get("genre_ids", []):
        return top  # Already animation, keep it

    top_votes = top.get("vote_count", 0)
    qlow = clean_name.lower()

    for r in results[1:5]:
        if _ANIMATION_GENRE_ID not in r.get("genre_ids", []):
            continue
        t = (r.get("title") or r.get("name") or "").lower()
        ot = (r.get("original_title") or r.get("original_name") or "").lower()
        if not (qlow in t or qlow in ot or t in qlow or ot in qlow):
            continue
        # Prefer animated version if it has at least 30% of the top result's votes.
        # Animated originals (One Piece, Avatar) typically have far more votes than
        # recent live-action remakes, so this threshold is conservative enough to avoid
        # accidentally preferring obscure animations over popular live-action series.
        if r.get("vote_count", 0) >= top_votes * 0.3:
            return r

    return top

async def _tmdb_search(name: str, media_type: str) -> dict | None:
    """Search TMDB for a movie or TV show by name. Returns best result or None."""
    if not _TMDB_API_KEY:
        return None
    cache_key = f"tmdb:{media_type}:{name.lower()}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    endpoint = "tv" if media_type == "tv" else "movie"
    year_param = "first_air_date_year" if media_type == "tv" else "year"
    clean, year = _clean_title_for_tmdb(name)
    try:
        async with httpx_client(timeout=8.0) as client:
            # Strategy (Jellyfin/Plex approach):
            # 1. cleaned title + year  → most precise
            # 2. cleaned title alone   → catches year-less titles
            # 3. original name         → last resort if cleaning went wrong
            queries: list[tuple[str, str | None]] = [(clean, year), (clean, None)]
            if name != clean:
                queries.append((name, None))
            for query, yr in dict.fromkeys(queries):  # deduplicate preserving order
                params: dict = {"api_key": _TMDB_API_KEY, "query": query,
                                "language": "fr-FR", "page": 1}
                if yr:
                    params[year_param] = yr
                r = await client.get(f"{_TMDB_BASE}/search/{endpoint}", params=params)
                if r.status_code != 200:
                    continue
                results = r.json().get("results") or []
                if results:
                    result = _pick_best_tmdb_result(results, clean)
                    _tmdb_cache[cache_key] = (_time(), result)
                    return result
        _tmdb_cache[cache_key] = (_time(), None)
        return None
    except Exception:
        return None

async def _tmdb_details(tmdb_id: int, media_type: str) -> dict | None:
    """Fetch full TMDB details (with credits) for a movie or TV show."""
    if not _TMDB_API_KEY:
        return None
    cache_key = f"tmdb:detail:{media_type}:{tmdb_id}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    endpoint = "tv" if media_type == "tv" else "movie"
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR",
                                         "append_to_response": "credits"})
        if r.status_code != 200:
            return None
        data = r.json()
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return None

@app.get("/api/tmdb/details")
async def tmdb_details(name: str = "", type: str = "movie"):
    """Return TMDB details JSON for a movie or TV show."""
    if not _TMDB_API_KEY or not name.strip():
        raise HTTPException(status_code=503, detail="TMDB not configured")
    result = await _tmdb_search(name, type)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    tmdb_id = result.get("id")
    if not tmdb_id:
        raise HTTPException(status_code=404, detail="Not found")
    details = await _tmdb_details(tmdb_id, type)
    return details or result

@app.get("/api/tmdb/poster")
async def tmdb_poster(name: str = "", type: str = "movie"):
    """Return poster image for a movie or TV show (proxied from TMDB)."""
    if not _TMDB_API_KEY or not name.strip():
        raise HTTPException(status_code=404, detail="Not found")
    result = await _tmdb_search(name, type)
    poster_path = result.get("poster_path") if result else None
    if not poster_path:
        raise HTTPException(status_code=404, detail="No poster")
    try:
        async with httpx_client(timeout=10.0) as client:
            img = await client.get(f"{_TMDB_IMG}/w500{poster_path}")
        if img.status_code != 200:
            raise HTTPException(status_code=404, detail="Image not found")
        return Response(content=img.content, media_type=img.headers.get("content-type", "image/jpeg"),
                        headers={"Cache-Control": "public, max-age=86400",
                                 "Access-Control-Allow-Origin": "*"})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="TMDB image fetch failed")

@app.get("/api/tmdb/meta")
async def tmdb_meta(name: str = "", type: str = "movie"):
    """Return poster_path and vote_average for a title (JSON). Uses _tmdb_search cache."""
    if not name.strip():
        return {"poster_path": None, "vote_average": None}
    result = await _tmdb_search(name, type)
    if not result:
        return {"poster_path": None, "vote_average": None}
    return {
        "poster_path": result.get("poster_path"),
        "vote_average": result.get("vote_average"),
    }

@app.get("/api/tmdb/image")
async def tmdb_image(path: str = ""):
    """Proxy a TMDB image by path (e.g. /w500/xyz.jpg)."""
    if not path:
        raise HTTPException(status_code=400, detail="path required")
    if not path.startswith("/"):
        path = "/" + path
    try:
        async with httpx_client(timeout=10.0) as client:
            img = await client.get(f"{_TMDB_IMG}{path}")
        if img.status_code != 200:
            raise HTTPException(status_code=404, detail="Image not found")
        return Response(content=img.content, media_type=img.headers.get("content-type", "image/jpeg"),
                        headers={"Cache-Control": "public, max-age=86400",
                                 "Access-Control-Allow-Origin": "*"})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="TMDB image fetch failed")


@app.get("/api/tmdb/discover")
async def tmdb_discover(type: str = "movie", list: str = "popular", page: int = 1):
    """Return a TMDB discover list (popular/top_rated/upcoming/now_playing)."""
    if not _TMDB_API_KEY:
        raise HTTPException(status_code=503, detail="TMDB not configured")
    endpoint = "tv" if type == "tv" else "movie"
    cache_key = f"tmdb:discover:{endpoint}:{list}:{page}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 1800:
            return data
    try:
        async with httpx_client(timeout=10.0) as client:
            r = await client.get(f"{_TMDB_BASE}/{endpoint}/{list}",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR", "page": page})
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail="TMDB error")
        data = r.json()
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/tmdb/videos")
async def tmdb_videos(name: str = "", type: str = "movie"):
    """Return TMDB videos (trailers) for a movie or TV show."""
    if not _TMDB_API_KEY or not name.strip():
        return {"results": []}
    result = await _tmdb_search(name, type)
    if not result:
        return {"results": []}
    tmdb_id = result.get("id")
    if not tmdb_id:
        return {"results": []}
    cache_key = f"tmdb:videos:{type}:{tmdb_id}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    endpoint = "tv" if type == "tv" else "movie"
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}/videos",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR"})
        data = r.json() if r.status_code == 200 else {"results": []}
        # Fallback to English if no French results
        if not data.get("results"):
            async with httpx_client(timeout=8.0) as client:
                r2 = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}/videos",
                                      params={"api_key": _TMDB_API_KEY, "language": "en-US"})
            data = r2.json() if r2.status_code == 200 else {"results": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"results": []}


@app.get("/api/tmdb/recommendations")
async def tmdb_recommendations(name: str = "", type: str = "movie"):
    """Return TMDB recommendations for a movie or TV show."""
    if not _TMDB_API_KEY or not name.strip():
        return {"results": []}
    result = await _tmdb_search(name, type)
    if not result:
        return {"results": []}
    tmdb_id = result.get("id")
    if not tmdb_id:
        return {"results": []}
    cache_key = f"tmdb:reco:{type}:{tmdb_id}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    endpoint = "tv" if type == "tv" else "movie"
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}/recommendations",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR", "page": 1})
        data = r.json() if r.status_code == 200 else {"results": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"results": []}


@app.get("/api/tmdb/tv_season")
async def tmdb_tv_season(name: str = "", season: int = 1):
    """Return TMDB season details (episodes with stills) for a TV show."""
    if not _TMDB_API_KEY or not name.strip():
        return {"episodes": []}
    result = await _tmdb_search(name, "tv")
    if not result:
        return {"episodes": []}
    tmdb_id = result.get("id")
    if not tmdb_id:
        return {"episodes": []}
    cache_key = f"tmdb:season:{tmdb_id}:{season}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/tv/{tmdb_id}/season/{season}",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR"})
        data = r.json() if r.status_code == 200 else {"episodes": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"episodes": []}


@app.get("/api/tmdb/person_credits")
async def tmdb_person_credits(person_id: int):
    """Return combined movie+TV credits for a TMDB person."""
    if not _TMDB_API_KEY:
        return {"cast": []}
    cache_key = f"tmdb:person:{person_id}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/person/{person_id}/combined_credits",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR"})
        if r.status_code != 200:
            return {"cast": []}
        raw = r.json().get("cast", [])
        seen: set[int] = set()
        items = []
        for item in sorted(raw, key=lambda x: x.get("vote_average", 0) or 0, reverse=True):
            mid = item.get("id")
            if mid in seen:
                continue
            seen.add(mid)
            items.append({
                "id": mid,
                "media_type": item.get("media_type"),
                "title": item.get("title") or item.get("name"),
                "poster_path": item.get("poster_path"),
                "vote_average": item.get("vote_average"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "character": item.get("character"),
            })
        data = {"cast": items[:40]}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"cast": []}


@app.get("/api/tmdb/key")
async def tmdb_get_key():
    return {"key": _TMDB_API_KEY}


@app.post("/api/tmdb/key")
async def tmdb_set_key(body: dict):
    global _TMDB_API_KEY
    key = body.get("key", "")
    _TMDB_API_KEY = key
    _tmdb_save(key)
    return {"ok": True}


@app.get("/api/iptv/vod_hls/{stream_id}")
async def iptv_vod_hls(stream_id: str, request: Request, media: str = "movie"):
    """Proxy VOD HLS manifest + rewrite segment URLs through our proxy."""
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    m3u8_url = f"{s}/{media}/{u}/{p}/{stream_id}.m3u8"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        resp = await client.get(m3u8_url)
    if resp.status_code != 200 or "#EXTM3U" not in resp.text:
        raise HTTPException(status_code=502, detail="VOD HLS not available")
    base = str(request.base_url).rstrip("/")
    rewritten = rewrite_hls_manifest(resp.text, str(resp.url), f"{base}/api/iptv/proxy")
    return Response(
        content=rewritten,
        media_type="application/vnd.apple.mpegurl",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-store"},
    )

import shutil as _shutil
_FFMPEG = _shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
_FFPROBE = _shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
_OUTPUT_ARGS = [
    # Disable subtitle/data streams (fMP4 can't mux most subtitle codecs)
    "-sn", "-dn",
    # Downmix to stereo + 48 kHz — Apple AudioToolbox (Firefox/Safari) rejects
    # multi-channel AAC-LC AudioSpecificConfig (5.1 AC3/DTS input → 6-ch AAC fails)
    "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
    "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
]

async def _log_stderr(stderr: asyncio.StreamReader) -> None:
    """Drain stderr line-by-line and log it. Must start BEFORE reading stdout
    to prevent the 64 KB pipe-buffer from filling and deadlocking ffmpeg."""
    try:
        async for raw in stderr:
            msg = raw.decode("utf-8", errors="replace").rstrip()
            if msg:
                print(f"[ffmpeg] {msg}", flush=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# VOD file cache: download each stream to a temp file once, shared across
# all ffmpeg instances (seeks, re-fetches).  Avoids restarting the download
# from byte 0 on every seek.
# ---------------------------------------------------------------------------

_vod_dl_cache: dict[str, dict] = {}


async def _download_to_file(url: str, path: str, entry: dict) -> None:
    """Download *url* with reconnection and write to *path*."""
    offset = 0
    try:
        with open(path, 'wb') as f:
            for _ in range(300):
                headers: dict[str, str] = {}
                if offset > 0:
                    headers["Range"] = f"bytes={offset}-"
                try:
                    async with httpx_client(
                        timeout=httpx.Timeout(connect=15.0, read=120.0, write=None, pool=None),
                        follow_redirects=True,
                    ) as client:
                        async with client.stream("GET", url, headers=headers) as resp:
                            if resp.status_code == 416:
                                break
                            if resp.status_code not in (200, 206):
                                break
                            if resp.status_code == 200 and offset > 0:
                                break
                            if not entry.get("total_size"):
                                cl = int(resp.headers.get("content-length", 0) or 0)
                                cr = resp.headers.get("content-range", "")
                                if cr and "/" in cr:
                                    try:
                                        cl = int(cr.split("/")[-1].strip())
                                    except Exception:
                                        pass
                                if cl > 0:
                                    entry["total_size"] = cl
                            async for chunk in resp.aiter_bytes(65536):
                                f.write(chunk)
                                f.flush()
                                entry["written"] += len(chunk)
                                offset += len(chunk)
                                entry["event"].set()
                                entry["event"].clear()
                    await asyncio.sleep(0.2)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    print(f"[vod_cache] dl error at {offset}: {exc}", flush=True)
                    if offset == 0:
                        break
                    await asyncio.sleep(0.2)
        print(f"[vod_cache] done, total={offset} bytes, path={path}", flush=True)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[vod_cache] unexpected: {e}", flush=True)
    finally:
        entry["done"] = True
        entry["event"].set()


async def _ensure_vod_download(cache_key: str, url: str) -> dict:
    """Return the cache entry for *cache_key*, starting a download if needed."""
    if cache_key in _vod_dl_cache:
        entry = _vod_dl_cache[cache_key]
        task = entry.get("task")
        if task and not task.done():
            return entry
        if entry["done"] and entry["written"] > 0 and os.path.exists(entry["path"]):
            return entry
    import tempfile as _tempfile
    path = os.path.join(_tempfile.gettempdir(), f"mytube_{cache_key}")
    entry: dict = {"path": path, "written": 0, "done": False, "total_size": 0, "event": asyncio.Event(), "task": None}
    _vod_dl_cache[cache_key] = entry
    entry["task"] = asyncio.create_task(_download_to_file(url, path, entry))
    return entry


async def _pipe_from_vod_cache(entry: dict, stdin: asyncio.StreamWriter, start_byte: int = 0) -> None:
    """Read from a growing cached temp file and pipe to ffmpeg stdin."""
    pos = start_byte
    cancelled = False
    try:
        with open(entry["path"], "rb") as f:
            if pos > 0:
                f.seek(pos)
            while True:
                if stdin.is_closing():
                    return
                chunk = f.read(65536)
                if not chunk:
                    if entry["done"]:
                        break
                    await asyncio.sleep(0.05)
                    continue
                try:
                    stdin.write(chunk)
                    await stdin.drain()
                except Exception:
                    return
                pos += len(chunk)
    except asyncio.CancelledError:
        cancelled = True
        raise
    except Exception as e:
        print(f"[vod_cache] pipe error: {e}", flush=True)
    finally:
        if not cancelled:
            try:
                if not stdin.is_closing():
                    stdin.close()
                    await stdin.wait_closed()
            except Exception:
                pass


async def _vod_cache_cleanup_loop() -> None:
    """Delete temp files that are done and older than 1 hour."""
    while True:
        await asyncio.sleep(1800)
        now = _time()
        to_remove = []
        for key, entry in list(_vod_dl_cache.items()):
            if not entry["done"]:
                continue
            try:
                if now - os.path.getmtime(entry["path"]) > 3600:
                    os.unlink(entry["path"])
                    to_remove.append(key)
                    print(f"[vod_cache] cleaned {key}", flush=True)
            except Exception:
                to_remove.append(key)
        for key in to_remove:
            _vod_dl_cache.pop(key, None)


async def _download_reconnecting(url: str, stdin: asyncio.StreamWriter, initial_offset: int = 0) -> None:
    """Download *url* sequentially, reconnecting with Range requests whenever
    the provider closes the connection mid-file (common rate-limit pattern).

    initial_offset: start downloading from this byte position (Range: bytes=N-).
    Writes each received byte directly to *stdin* (ffmpeg's stdin pipe).
    Stops cleanly when stdin closes (ffmpeg exited) or all data is received.
    """
    try:
        await _download_reconnecting_inner(url, stdin, initial_offset)
    except Exception as e:
        print(f"[downloader] unexpected exception: {e}", flush=True)


async def _download_reconnecting_inner(url: str, stdin: asyncio.StreamWriter, initial_offset: int = 0) -> None:
    print(f"[downloader] start url={url[-40:]} initial_offset={initial_offset}", flush=True)
    offset = initial_offset
    for attempt in range(300):
        headers: dict[str, str] = {}
        if offset > 0:
            headers["Range"] = f"bytes={offset}-"
            print(f"[downloader] reconnect attempt={attempt} offset={offset}", flush=True)
        try:
            async with httpx_client(
                timeout=httpx.Timeout(connect=15.0, read=120.0, write=None, pool=None),
                follow_redirects=True,
            ) as client:
                async with client.stream("GET", url, headers=headers) as resp:
                    print(f"[downloader] HTTP {resp.status_code} offset={offset}", flush=True)
                    if resp.status_code == 416:
                        break  # Range not satisfiable → already have everything
                    if resp.status_code not in (200, 206):
                        break
                    if resp.status_code == 200 and offset > 0:
                        # Provider ignored Range header — would re-send from byte 0,
                        # corrupting the pipe stream.  Stop so ffmpeg sees clean EOF.
                        print(f"[downloader] Range not honoured (200 at offset={offset}), stopping", flush=True)
                        break
                    async for chunk in resp.aiter_bytes(65536):
                        if stdin.is_closing():
                            return
                        try:
                            stdin.write(chunk)
                            await stdin.drain()
                        except Exception as e:
                            print(f"[downloader] stdin closed at offset={offset}: {e}", flush=True)
                            return
                        offset += len(chunk)
            print(f"[downloader] server EOF at offset={offset}, reconnecting...", flush=True)
            if offset == 0:
                print("[downloader] no data received, giving up", flush=True)
                break
        except Exception as exc:
            print(f"[downloader] exception at offset={offset}: {exc}", flush=True)
            if offset == 0 and attempt >= 2:
                break
            await asyncio.sleep(0.2)
    print(f"[downloader] done, total={offset} bytes", flush=True)
    try:
        stdin.close()
        await stdin.wait_closed()
    except Exception:
        pass


async def _start_ffmpeg(cmd: list, timeout: float = 25.0) -> tuple[asyncio.subprocess.Process, bytes]:
    """Start ffmpeg and read the first chunk within *timeout* seconds.

    Returns (process, first_chunk) so the caller can start streaming.
    Raises RuntimeError if ffmpeg exits without producing any output.

    stderr is piped and drained by _log_stderr (started before reading stdout)
    so the 64 KB pipe buffer never fills → no deadlock.
    """
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    # Start draining stderr immediately — before touching stdout.
    asyncio.ensure_future(_log_stderr(proc.stderr))
    try:
        chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=timeout)
    except asyncio.TimeoutError:
        try: proc.kill()
        except Exception: pass
        await proc.wait()
        raise RuntimeError(f"timeout ({timeout:.0f}s) — source indisponible ou trop lente")
    if not chunk:
        rc = await proc.wait()
        raise RuntimeError(f"source inaccessible ou format non supporté (exit {rc})")
    return proc, chunk


@app.get("/api/iptv/vod_proxy/{stream_id}")
async def iptv_vod_proxy(stream_id: str, request: Request, ext: str = "mp4", media: str = "movie",
                         audio_idx: int = 0, start: int = 0, duration: float = 0.0):
    """Transcode VOD/series → fragmented H.264 MP4.

    start=0  : pipe source into ffmpeg via stdin through the reconnecting downloader.
    start>0  : seek to that position (seconds).  Tries 4 strategies in order:
               1) ffmpeg direct URL seek with -seekable 1 (instant if server supports Range)
               2) pipe with estimated byte offset (fast when Content-Range is available)
               3) pipe from byte 0 with ffmpeg -ss (always works, slow for large files)
               4) same as 3 but with VideoToolbox encoder
    """
    if not _xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = _xtream_cfg["server"], _xtream_cfg["username"], _xtream_cfg["password"]
    src = f"{s}/{media}/{u}/{p}/{stream_id}.{ext}"

    vargs_x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                  "-profile:v", "high", "-level", "4.1"]
    vargs_vtb  = ["-c:v", "h264_videotoolbox", "-b:v", "3M",
                  "-profile:v", "high", "-level", "4.1"]

    def _cmd(input_args: list, video_args: list, fast_probe: bool = False, ts_offset: int = 0) -> list:
        probesize = "131072" if fast_probe else "2097152"
        analyzedur = "500000" if fast_probe else "2000000"
        offset_args = ["-output_ts_offset", str(ts_offset)] if ts_offset > 0 else []
        return [_FFMPEG, "-loglevel", "error",
                "-probesize", probesize, "-analyzeduration", analyzedur,
                *input_args,
                "-map", "0:v:0?", "-map", f"0:a:{audio_idx}?",
                *video_args, *offset_args, *_OUTPUT_ARGS]

    # For seeks: estimate byte offset so the pipe downloader can jump directly
    # to approximately the right position (much faster than reading from byte 0).
    # Try HEAD first; if no Content-Length, probe with a tiny Range GET instead.
    byte_offset = 0
    if start > 0 and duration > 0:
        try:
            async with httpx_client(
                timeout=httpx.Timeout(connect=5.0, read=5.0, write=None, pool=None),
                follow_redirects=True,
            ) as client:
                head = await client.head(src)
                cl = int(head.headers.get("content-length", 0) or 0)
                if cl <= 0:
                    # HEAD gave no Content-Length; probe with Range: bytes=0-1
                    async with client.stream("GET", src, headers={"Range": "bytes=0-1"}) as rng:
                        if rng.status_code == 206:
                            cr = rng.headers.get("content-range", "")
                            if "/" in cr and not cr.endswith("/*"):
                                cl = int(cr.rsplit("/", 1)[-1])
                        elif rng.status_code == 200:
                            cl = int(rng.headers.get("content-length", 0) or 0)
            if cl > 0:
                byte_offset = int(0.90 * start / duration * cl)
                print(f"[seek] byte_offset={byte_offset} ({start}s / {duration:.0f}s, size={cl})", flush=True)
            else:
                print(f"[seek] no Content-Length from HEAD/Range-probe, byte_offset=0", flush=True)
        except Exception as e:
            print(f"[seek] probe failed: {e}, byte_offset=0", flush=True)

    vod_cache_entry = await _ensure_vod_download(f"{stream_id}.{ext}", src)
    cache_path = vod_cache_entry.get("path", "")
    cache_done = vod_cache_entry.get("done", False) and bool(cache_path) and os.path.exists(cache_path) and os.path.getsize(cache_path) > 0

    if start > 0:
        # +ignidx: ignore MKV SeekHead index so ffmpeg reads linearly through
        # the pipe without trying to jump to referenced byte positions.
        pipe_ss = ["-fflags", "+ignidx", "-ss", str(start), "-i", "pipe:0"]
        # MP4/MKV/AVI/TS: the container header lives at offset 0 — starting
        # mid-file always breaks parsing, so skip the byte-offset attempt.
        non_seekable_pipe = ext.lower() in ("mp4", "mkv", "avi", "ts", "m2ts", "mts")
        attempts = [
            # 1. File seek (instant random-access, no pipe decoding from byte 0)
            #    Only when vod_cache is fully downloaded. libx264 re-encoding always resets
            #    PTS to 0 regardless of input position, so ts_offset is required here too.
            *([{"cmd": _cmd(["-ss", str(start), "-i", cache_path], vargs_x264, ts_offset=start),
                "use_pipe": False, "timeout": 60.0, "min_chunk": 1, "initial_offset": 0}]
              if cache_done else []),
            # 2. Pipe with estimated byte offset — skipped for all common formats
            #    because the moov/header atom is always at the start of the file.
            *([{"cmd": _cmd(pipe_ss, vargs_x264, fast_probe=True, ts_offset=start),
                "use_pipe": True, "timeout": 60.0, "min_chunk": 1, "initial_offset": byte_offset}]
              if byte_offset > 0 and not non_seekable_pipe else []),
            # 3. Pipe from byte 0 with ts_offset so PTS matches startSec on frontend
            {"cmd": _cmd(pipe_ss, vargs_x264, ts_offset=start),
             "use_pipe": True, "timeout": 300.0, "min_chunk": 1, "initial_offset": 0},
            # 4. VideoToolbox hardware encoder fallback
            {"cmd": _cmd(pipe_ss, vargs_vtb, ts_offset=start),
             "use_pipe": True, "timeout": 300.0, "min_chunk": 1, "initial_offset": 0},
        ]
    else:
        attempts = [
            {"cmd": _cmd(["-i", "pipe:0"], vargs_x264), "use_pipe": True, "timeout": 45.0, "min_chunk": 1, "initial_offset": 0},
            {"cmd": _cmd(["-i", "pipe:0"], vargs_vtb),  "use_pipe": True, "timeout": 15.0, "min_chunk": 1, "initial_offset": 0},
        ]

    process: asyncio.subprocess.Process | None = None
    first_chunk: bytes = b""
    last_err = "transcoding failed"

    async def _kill_attempt(proc: asyncio.subprocess.Process, dl: "asyncio.Task | None") -> None:
        if dl is not None:
            dl.cancel()
            try: await dl
            except BaseException: pass  # CancelledError is BaseException, not Exception
        try: proc.kill()
        except Exception: pass
        await proc.wait()

    for attempt in attempts:
        cmd, use_pipe = attempt["cmd"], attempt["use_pipe"]
        timeout, min_chunk = attempt["timeout"], attempt["min_chunk"]
        initial_offset = attempt.get("initial_offset", 0)
        dl_task: "asyncio.Task | None" = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE if use_pipe else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            asyncio.ensure_future(_log_stderr(proc.stderr))
            if use_pipe:
                dl_task = asyncio.ensure_future(
                    _pipe_from_vod_cache(vod_cache_entry, proc.stdin, initial_offset))
            try:
                first_chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=timeout)
            except asyncio.TimeoutError:
                await _kill_attempt(proc, dl_task)
                dl_task = None
                last_err = f"timeout ({timeout:.0f}s)"
                process = None
                continue
            if not first_chunk or len(first_chunk) < min_chunk:
                print(f"[seek] attempt failed ({len(first_chunk)}B < {min_chunk}B), trying next", flush=True)
                await _kill_attempt(proc, dl_task)
                dl_task = None
                last_err = f"output insuffisant ({len(first_chunk)}B)"
                first_chunk = b""
                process = None
                continue
            process = proc
            break
        except Exception as e:
            last_err = str(e)
            if dl_task: dl_task.cancel()
            process = None

    if process is None or not first_chunk:
        raise HTTPException(status_code=502, detail=f"ffmpeg: {last_err}")

    async def _stream():
        assert process is not None
        total = len(first_chunk)
        yield first_chunk
        try:
            while True:
                chunk = await process.stdout.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                yield chunk
        finally:
            print(f"[stream] ended, total={total//1024}KB", flush=True)
            if dl_task is not None:
                dl_task.cancel()
                try: await dl_task
                except BaseException: pass
            try: process.kill()
            except Exception: pass
            await process.wait()

    return StreamingResponse(
        _stream(),
        media_type="video/mp4",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/iptv/series_categories")
async def iptv_series_categories():
    data = await _xtream_api("get_series_categories", timeout=15.0)
    return data if isinstance(data, list) else []

@app.get("/api/iptv/series")
async def iptv_series_list(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_series", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []

@app.get("/api/iptv/series_info/{series_id}")
async def iptv_series_info(series_id: str):
    return await _xtream_api("get_series_info", extra={"series_id": series_id}, timeout=20.0)

@app.get("/api/iptv/search")
async def iptv_search(q: str = "", type: str = "live"):
    """Search across all live/vod/series streams (no category filter)."""
    if not q.strip():
        return []
    q_lower = q.lower()
    if type == "live":
        data = await _xtream_api("get_live_streams", timeout=60.0)
    elif type == "vod":
        data = await _xtream_api("get_vod_streams", timeout=60.0)
    else:
        data = await _xtream_api("get_series", timeout=60.0)
    if not isinstance(data, list):
        return []
    name_key = "name"
    return [item for item in data if q_lower in str(item.get(name_key, "")).lower()][:100]


_TNT_ORDER = [
    "TF1", "France 2", "France 3", "Canal+", "France 5", "M6", "Arte",
    "C8", "W9", "TMC", "TFX", "TF1 Séries Films", "LCI", "France 4",
    "CNews", "CStar", "Gulli", "France Info", "BFM TV", "RMC Story",
    "RMC Découverte", "Chérie 25", "NRJ 12", "LCP",
]

_THEMATIC_WORDS = {
    "sport", "sports", "foot", "football", "rugby", "tennis",
    "cinema", "cinéma", "film", "films",
    "series", "séries",
    "kids", "junior", "family", "famille",
    "news", "business",
    "décou", "decouverte", "découverte",
    "comedy", "comedie",
}
_HD_TOKENS = {"hd", "4k", "uhd", "fhd"}


def _normalize_tnt(s: str) -> str:
    """Normalize a channel name for flexible TNT matching.

    - Replace dots / underscores with spaces (providers use dots as separators)
    - Insert space between letter→digit transitions (France2 → France 2, Chérie25 → Chérie 25)
    - Collapse whitespace
    """
    s = re.sub(r'[._]+', ' ', s)
    # [^\W\d_] matches any Unicode letter (including accented)
    s = re.sub(r'([^\W\d_])(\d)', r'\1 \2', s)
    return re.sub(r'\s+', ' ', s).strip()


def _tnt_score(ch_lower: str, tnt_lower: str) -> int:
    """Score how well ch_lower matches tnt_lower. Returns -1 if not a valid match.

    HD variants score higher than exact SD matches so that 'TF1 HD' beats 'TF1'.
    Thematic variants (sport, cinema, ...) are always rejected.
    Handles provider naming conventions: 'FR:France2.HD', 'FR:France.Info.HD', etc.
    """
    # Strip common country/provider prefixes: "FR:", "FRA:", "[FR]", "FRANCE |", etc.
    # Use IGNORECASE because ch_lower is already lowercased.
    stripped = re.sub(r'^(\[?[A-Za-z]{2,4}\]?\s*[-|:]\s*)', '', ch_lower).strip()

    # Normalize both sides: dots→spaces, letter-digit spacing
    cand = _normalize_tnt(stripped)
    base = _normalize_tnt(tnt_lower)

    def _suffix_ok(full: str, pfx: str) -> tuple[bool, bool]:
        """(valid, has_hd) — rejects thematic suffixes."""
        suffix = full[len(pfx):].strip()
        tokens = {t for t in suffix.split() if t}
        if tokens & _THEMATIC_WORDS:
            return False, False
        return True, bool(tokens & _HD_TOKENS)

    # Exact match (normalized)
    if cand == base:
        return 85

    # Word-boundary startswith: "france 2 hd" starts with "france 2"
    if cand.startswith(base) and (len(cand) == len(base) or cand[len(base)] == ' '):
        ok, hd = _suffix_ok(cand, base)
        if not ok:
            return -1
        return 100 if hd else 82  # HD beats exact (85)

    # TNT base appears somewhere within candidate (word boundaries)
    pattern = r'(?<!\w)' + re.escape(base) + r'(?!\w)'
    if re.search(pattern, cand):
        remainder = re.sub(pattern, ' ', cand).strip()
        tokens = {t for t in remainder.split() if t}
        if tokens & _THEMATIC_WORDS:
            return -1
        return 70 if bool(tokens & _HD_TOKENS) else 60

    return -1


@app.get("/api/iptv/tnt_channels")
async def iptv_tnt_channels():
    """Return best IPTV matches for French TNT channels, sorted by broadcast order."""
    cached = cache_get("iptv:tnt")
    if cached is not None:
        return cached
    data = await _xtream_api("get_live_streams", timeout=60.0)
    if not isinstance(data, list):
        return []
    result = []
    for idx, tnt_name in enumerate(_TNT_ORDER):
        tnt_lower = tnt_name.lower()
        best_score, best_ch = -1, None
        for ch in data:
            ch_name = str(ch.get("name", ""))
            score = _tnt_score(ch_name.lower(), tnt_lower)
            if score > best_score:
                best_score, best_ch = score, ch
        if best_ch is not None:
            result.append({
                "tnt_index": idx,
                "tnt_name": tnt_name,
                "stream_id": best_ch.get("stream_id"),
                "name": best_ch.get("name", tnt_name),
                "stream_icon": best_ch.get("stream_icon", ""),
            })
    cache_set("iptv:tnt", result)
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
