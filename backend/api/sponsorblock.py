"""SponsorBlock segments (sponsors, self-promotion, intros, non-music parts…).

Looked up by hash prefix: SponsorBlock only learns the first 4 hex digits of
the video ID's SHA-256, shared by thousands of videos, never which one plays."""
import hashlib
import json
from typing import Annotated

from cachetools import TTLCache
from fastapi import APIRouter, Path

from core.security import VIDEO_ID_PATTERN
from services.innertube import httpx_client

router = APIRouter()

VideoId = Annotated[str, Path(pattern=VIDEO_ID_PATTERN)]

SPONSORBLOCK_API = "https://sponsor.ajay.app"
CATEGORIES = (
    "sponsor", "selfpromo", "interaction", "intro", "outro",
    "preview", "filler", "music_offtopic", "poi_highlight",
)
ACTION_TYPES = ("skip", "mute", "poi")

_segments_cache: TTLCache = TTLCache(maxsize=1024, ttl=3600)


def _clean_segments(entries: list, video_id: str) -> list[dict]:
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or entry.get("videoID") != video_id:
            continue
        segments = []
        for seg in entry.get("segments") or []:
            try:
                start, end = (float(x) for x in seg["segment"])
            except (KeyError, TypeError, ValueError):
                continue
            if seg.get("category") not in CATEGORIES or seg.get("actionType") not in ACTION_TYPES:
                continue
            if start < 0 or end < start:
                continue
            segments.append({
                "category": seg["category"],
                "actionType": seg["actionType"],
                "start": start,
                "end": end,
            })
        return sorted(segments, key=lambda s: s["start"])
    return []


@router.get("/api/sponsorblock/{video_id}")
async def sponsorblock_segments(video_id: VideoId):
    if video_id in _segments_cache:
        return {"segments": _segments_cache[video_id]}
    prefix = hashlib.sha256(video_id.encode()).hexdigest()[:4]
    params = {"categories": json.dumps(CATEGORIES), "actionTypes": json.dumps(ACTION_TYPES)}
    try:
        async with httpx_client(timeout=6.0) as client:
            resp = await client.get(f"{SPONSORBLOCK_API}/api/skipSegments/{prefix}", params=params)
    except Exception:
        return {"segments": []}  # not cached: the next video load retries
    if resp.status_code == 404:  # SponsorBlock's answer for "no segment at all"
        segments: list[dict] = []
    elif resp.status_code != 200:
        return {"segments": []}
    else:
        try:
            segments = _clean_segments(resp.json(), video_id)
        except ValueError:
            return {"segments": []}
    _segments_cache[video_id] = segments
    return {"segments": segments}
