"""IPTV / Xtream Codes API routes (live, VOD, series, TNT)."""
import asyncio
import base64
import json
import os
import re
from time import time as _time
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from core.security import validate_proxy_url
from core import config
from core.config import _FFMPEG, _FFPROBE, _OUTPUT_ARGS
from core.cache import cache_get, cache_set
from services.innertube import httpx_client, rewrite_hls_manifest
from services.tmdb import _clean_title_for_tmdb
from services.ffmpeg import _ensure_vod_download, _pipe_from_vod_cache, _log_stderr
from services.ffmpeg import _vod_dl_cache

router = APIRouter()


@router.get("/api/iptv/status")
async def iptv_status():
    return {"configured": bool(config._xtream_cfg.get("server"))}


@router.post("/api/iptv/credentials")
async def iptv_save_credentials(body: dict = Body(...)):
    server = body.get("server", "").rstrip("/")
    if not server.startswith("http"):
        server = "http://" + server
    config._xtream_cfg = {"server": server, "username": body.get("username",""), "password": body.get("password","")}
    config._xtream_save()
    return {"ok": True}


@router.delete("/api/iptv/credentials")
async def iptv_delete_credentials():
    config._xtream_cfg = {}
    config._xtream_save()
    return {"ok": True}


async def _xtream_api(action: str, extra: dict | None = None, timeout: float = 45.0) -> Any:
    """Call Xtream Codes player_api.php directly, bypassing any VPN proxy."""
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/debug")
async def iptv_debug():
    """Test Xtream connection and return diagnostics."""
    if not config._xtream_cfg.get("server"):
        return {"configured": False}
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/categories")
async def iptv_categories():
    data = await _xtream_api("get_live_categories", timeout=15.0)
    return data if isinstance(data, list) else []


@router.get("/api/iptv/channels")
async def iptv_channels(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_live_streams", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []


@router.get("/api/iptv/stream/{stream_id}")
async def iptv_stream_url(stream_id: str, request: Request):
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/api/iptv/hls/{stream_id}"}


@router.get("/api/iptv/hls/{stream_id}")
async def iptv_hls_stream(stream_id: str, request: Request):
    """Fetch IPTV HLS manifest and rewrite URLs through our proxy to fix CORS."""
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/proxy")
async def iptv_hls_proxy(url: str, request: Request):
    """Proxy IPTV HLS sub-playlists and TS segments (no VPN, no CORS issues)."""
    try:
        decoded_url = base64.urlsafe_b64decode(url + "==").decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL encoding")
    validate_proxy_url(decoded_url)
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


@router.get("/api/iptv/icon")
async def iptv_icon_proxy(url: str):
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    validate_proxy_url(url)
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


@router.get("/api/iptv/vod_categories")
async def iptv_vod_categories():
    data = await _xtream_api("get_vod_categories", timeout=15.0)
    return data if isinstance(data, list) else []


@router.get("/api/iptv/vod")
async def iptv_vod(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_vod_streams", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []


_vod_all_cache: tuple[float, list] = (0.0, [])
_series_all_cache: tuple[float, list] = (0.0, [])


@router.get("/api/iptv/search_catalog")
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


@router.get("/api/iptv/vod_tracks/{stream_id}")
async def iptv_vod_tracks(stream_id: str, ext: str = "mp4", media: str = "movie"):
    """List audio and subtitle tracks via ffprobe."""
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/vod_subtitle/{stream_id}")
async def iptv_vod_subtitle(stream_id: str, ext: str = "mp4", media: str = "movie", sub_idx: int = 0):
    """Extract an embedded subtitle track as WebVTT.

    Uses the local vod_cache file when available (shared with the HLS session),
    which is orders of magnitude faster than reading from the remote URL.
    """
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/vod_stream/{stream_id}")
async def iptv_vod_stream_url(stream_id: str, request: Request, ext: str = "mp4", media: str = "movie", audio_idx: int = 0):
    """Return the ffmpeg-transcoded proxy URL + duration via ffprobe (3 s timeout)."""
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/vod_hls/{stream_id}")
async def iptv_vod_hls(stream_id: str, request: Request, media: str = "movie"):
    """Proxy VOD HLS manifest + rewrite segment URLs through our proxy."""
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/vod_proxy/{stream_id}")
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
    if not config._xtream_cfg.get("server"):
        raise HTTPException(status_code=400, detail="IPTV not configured")
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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


@router.get("/api/iptv/series_categories")
async def iptv_series_categories():
    data = await _xtream_api("get_series_categories", timeout=15.0)
    return data if isinstance(data, list) else []


@router.get("/api/iptv/series")
async def iptv_series_list(category_id: Optional[str] = None):
    extra = {"category_id": category_id} if category_id else None
    data = await _xtream_api("get_series", extra=extra, timeout=60.0)
    return data if isinstance(data, list) else []


@router.get("/api/iptv/series_info/{series_id}")
async def iptv_series_info(series_id: str):
    return await _xtream_api("get_series_info", extra={"series_id": series_id}, timeout=20.0)


@router.get("/api/iptv/search")
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


@router.get("/api/iptv/tnt_channels")
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
