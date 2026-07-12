"""TMDB API routes."""
from time import time as _time

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from services import tmdb as tmdb_svc
from services.tmdb import (
    _TMDB_BASE,
    _TMDB_IMG,
    _tmdb_cache,
    _tmdb_save,
    _tmdb_search,
    _tmdb_details,
)
from services.innertube import httpx_client

router = APIRouter()


@router.get("/api/tmdb/details")
async def tmdb_details(name: str = "", type: str = "movie"):
    """Return TMDB details JSON for a movie or TV show."""
    if not tmdb_svc._TMDB_API_KEY or not name.strip():
        raise HTTPException(status_code=503, detail="TMDB not configured")
    result = await _tmdb_search(name, type)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    tmdb_id = result.get("id")
    if not tmdb_id:
        raise HTTPException(status_code=404, detail="Not found")
    details = await _tmdb_details(tmdb_id, type)
    return details or result


@router.get("/api/tmdb/poster")
async def tmdb_poster(name: str = "", type: str = "movie"):
    """Return poster image for a movie or TV show (proxied from TMDB)."""
    if not tmdb_svc._TMDB_API_KEY or not name.strip():
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


@router.get("/api/tmdb/meta")
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


@router.get("/api/tmdb/image")
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


@router.get("/api/tmdb/discover")
async def tmdb_discover(type: str = "movie", list: str = "popular", page: int = 1):
    """Return a TMDB discover list (popular/top_rated/upcoming/now_playing)."""
    if not tmdb_svc._TMDB_API_KEY:
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
                                 params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "fr-FR", "page": page})
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail="TMDB error")
        data = r.json()
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/api/tmdb/videos")
async def tmdb_videos(name: str = "", type: str = "movie"):
    """Return TMDB videos (trailers) for a movie or TV show."""
    if not tmdb_svc._TMDB_API_KEY or not name.strip():
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
                                 params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "fr-FR"})
        data = r.json() if r.status_code == 200 else {"results": []}
        # Fallback to English if no French results
        if not data.get("results"):
            async with httpx_client(timeout=8.0) as client:
                r2 = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}/videos",
                                      params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "en-US"})
            data = r2.json() if r2.status_code == 200 else {"results": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"results": []}


@router.get("/api/tmdb/recommendations")
async def tmdb_recommendations(name: str = "", type: str = "movie"):
    """Return TMDB recommendations for a movie or TV show."""
    if not tmdb_svc._TMDB_API_KEY or not name.strip():
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
                                 params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "fr-FR", "page": 1})
        data = r.json() if r.status_code == 200 else {"results": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"results": []}


@router.get("/api/tmdb/tv_season")
async def tmdb_tv_season(name: str = "", season: int = 1):
    """Return TMDB season details (episodes with stills) for a TV show."""
    if not tmdb_svc._TMDB_API_KEY or not name.strip():
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
                                 params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "fr-FR"})
        data = r.json() if r.status_code == 200 else {"episodes": []}
        _tmdb_cache[cache_key] = (_time(), data)
        return data
    except Exception:
        return {"episodes": []}


@router.get("/api/tmdb/person_credits")
async def tmdb_person_credits(person_id: int):
    """Return combined movie+TV credits for a TMDB person."""
    if not tmdb_svc._TMDB_API_KEY:
        return {"cast": []}
    cache_key = f"tmdb:person:{person_id}"
    if cache_key in _tmdb_cache:
        ts, data = _tmdb_cache[cache_key]
        if _time() - ts < 3600:
            return data
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/person/{person_id}/combined_credits",
                                 params={"api_key": tmdb_svc._TMDB_API_KEY, "language": "fr-FR"})
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


@router.get("/api/tmdb/key")
async def tmdb_get_key():
    return {"key": tmdb_svc._TMDB_API_KEY}


@router.post("/api/tmdb/key")
async def tmdb_set_key(body: dict):
    key = body.get("key", "")
    tmdb_svc._TMDB_API_KEY = key
    _tmdb_save(key)
    return {"ok": True}
