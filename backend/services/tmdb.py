"""TMDB search / details helpers and shared TMDB state."""
import json
import os
import re

from cachetools import TTLCache

from services.innertube import httpx_client

_TMDB_BASE = "https://api.themoviedb.org/3"
_TMDB_IMG  = "https://image.tmdb.org/t/p"
_tmdb_cache: TTLCache = TTLCache(maxsize=2000, ttl=3600)
_tmdb_cfg_path = os.path.join(os.path.expanduser("~"), ".mytube", "tmdb.json")


def _tmdb_load() -> str:
    try:
        with open(_tmdb_cfg_path) as f:
            return json.load(f).get("key", "")
    except Exception:
        return ""


def _tmdb_save(key: str) -> None:
    try:
        from core.config import write_secret_file
        write_secret_file(_tmdb_cfg_path, json.dumps({"key": key}))
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
        return _tmdb_cache[cache_key]
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
                    _tmdb_cache[cache_key] = result
                    return result
        _tmdb_cache[cache_key] = None
        return None
    except Exception:
        return None


async def _tmdb_details(tmdb_id: int, media_type: str) -> dict | None:
    """Fetch full TMDB details (with credits) for a movie or TV show."""
    if not _TMDB_API_KEY:
        return None
    cache_key = f"tmdb:detail:{media_type}:{tmdb_id}"
    if cache_key in _tmdb_cache:
        return _tmdb_cache[cache_key]
    endpoint = "tv" if media_type == "tv" else "movie"
    try:
        async with httpx_client(timeout=8.0) as client:
            r = await client.get(f"{_TMDB_BASE}/{endpoint}/{tmdb_id}",
                                 params={"api_key": _TMDB_API_KEY, "language": "fr-FR",
                                         "append_to_response": "credits"})
        if r.status_code != 200:
            return None
        data = r.json()
        _tmdb_cache[cache_key] = data
        return data
    except Exception:
        return None
