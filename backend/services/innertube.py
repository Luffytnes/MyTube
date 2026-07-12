"""YouTube InnerTube / Invidious helpers, HTTP client factories and formatting."""
import asyncio
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
import base64
import json
import re

import httpx

from core.config import (
    INVIDIOUS_INSTANCES,
    YDL_OPTS_BASE,
    _YT_HEADERS,
    _YT_VIDEOS_TAB_PARAMS,
)
from services.vpn import (
    _get_proxy_url,
    vpn_record_activity,
    record_youtube_error,
    reset_youtube_errors,
)

_preferred_instance: Optional[str] = None


def _get_instances() -> list:
    if _preferred_instance:
        rest = [i for i in INVIDIOUS_INSTANCES if i != _preferred_instance]
        return [_preferred_instance] + rest
    return INVIDIOUS_INSTANCES


def get_ydl_opts(**extra) -> Dict[str, Any]:
    """Return yt-dlp options with proxy injected when VPN is active."""
    opts = {**YDL_OPTS_BASE, **extra}
    proxy = _get_proxy_url()
    if proxy:
        opts["proxy"] = proxy
    return opts


def httpx_client(**kwargs) -> httpx.AsyncClient:
    """Return an httpx.AsyncClient with proxy injected when VPN is active."""
    proxy = _get_proxy_url()
    if proxy:
        kwargs.setdefault("proxy", proxy)
        vpn_record_activity()
    return httpx.AsyncClient(**kwargs)


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
