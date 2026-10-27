"""ffmpeg-based HLS/VOD transcoding sessions and helpers."""
import asyncio
import os
import re
import shutil
import tempfile
from pathlib import Path
from time import time as _time
from typing import Any, Dict, List, Optional

import httpx
from cachetools import TTLCache
from fastapi import HTTPException

from core import config
from core.config import _FFMPEG, _FFMPEG_HTTP_CHUNK_ARGS, _FFPROBE, _PROXYCHAINS4
from core.cache import (
    stream_url_cache_get,
    stream_url_cache_set,
)
from services.innertube import get_ydl_opts, httpx_client, ydl_extract
from services.vpn import _get_proxy_url, record_youtube_error

_PROXYCHAINS_CONF = "/tmp/mytube_proxychains.conf"


def _redact_url(url: str) -> str:
    """Return scheme://host/…/{last segment} — hides intermediate path components
    such as Xtream username/password from log output."""
    from urllib.parse import urlparse
    try:
        p = urlparse(url)
        last = p.path.rstrip("/").rsplit("/", 1)[-1] or "…"
        return f"{p.scheme}://{p.netloc}/…/{last}"
    except Exception:
        return "[url redacted]"

# Active HLS transcoding sessions, keyed by hls_session_key()
_hls_sessions: Dict[str, Dict[str, Any]] = {}
_hls_lock = asyncio.Lock()


def _proxychains_prefix(proxy_url: Optional[str]) -> List[str]:
    """Return ["proxychains4", "-q", "-f", conf] when proxy is active and available, else []."""
    if not proxy_url or not _PROXYCHAINS4:
        return []
    from urllib.parse import urlparse
    p = urlparse(proxy_url)
    host = p.hostname or "wireproxy"
    try:
        port = p.port or 25344
    except ValueError:
        port = 25344
    conf = f"strict_chain\nproxy_dns\n[ProxyList]\nsocks5 {host} {port}\n"
    tmp = _PROXYCHAINS_CONF + ".tmp"
    with open(tmp, "w") as f:
        f.write(conf)
    os.replace(tmp, _PROXYCHAINS_CONF)
    return [_PROXYCHAINS4, "-q", "-f", _PROXYCHAINS_CONF]


# One yt-dlp extraction per video at a time, shared between the prefetch
# endpoint (fired on hover/click) and the HLS session the player requests a
# moment later — usually while that extraction is still running.
_extractions: Dict[str, "asyncio.Task[Optional[dict]]"] = {}


def is_direct_format(fmt: Dict[str, Any]) -> bool:
    """Plain HTTP(S) media file. With its JS challenge solver yt-dlp also lists
    HLS variants (protocol m3u8_native) whose URL is a playlist, not a file —
    played directly they fail with MEDIA_ERR_SRC_NOT_SUPPORTED."""
    return bool(fmt.get("url")) and fmt.get("protocol", "https") in ("https", "http")


def audio_rank(fmt: Dict[str, Any]) -> tuple:
    """Original audio track first, then bitrate. YouTube adds AI-dubbed tracks
    with the same bitrate as the original, so ranking on bitrate alone picked
    an arbitrary language (yt-dlp gives the original language_preference 10)."""
    return (fmt.get("language_preference") or 0, fmt.get("abr") or 0)


def _audio_only(formats: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [f for f in formats if is_direct_format(f)
            and f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none"]


def _best_m4a_audio(formats: List[Dict[str, Any]], lang: Optional[str] = None) -> Optional[Dict[str, Any]]:
    audio = [f for f in _audio_only(formats) if f.get("ext") in ("m4a", "mp4")]
    if lang:
        # Unknown language (track removed since): fall back to the original
        audio = [f for f in audio if f.get("language") == lang] or audio
    return max(audio, key=audio_rank) if audio else None


def _track_label(fmt: Dict[str, Any]) -> str:
    # format_note looks like "English (US) original (default), medium"
    note = (fmt.get("format_note") or "").split(",")[0]
    return re.sub(r"\s+(original|dubbed|descriptive|\(default\)).*$", "", note).strip() or str(fmt.get("language"))


def list_audio_tracks(formats: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One entry per audio language, the original first."""
    best: Dict[str, Dict[str, Any]] = {}
    for fmt in _audio_only(formats):
        lang = fmt.get("language")
        if lang and (lang not in best or audio_rank(fmt) > audio_rank(best[lang])):
            best[lang] = fmt
    tracks = [
        {"lang": lang, "label": _track_label(fmt), "original": (fmt.get("language_preference") or 0) >= 10}
        for lang, fmt in best.items()
    ]
    return sorted(tracks, key=lambda t: (not t["original"], t["label"]))


_audio_tracks_cache: TTLCache = TTLCache(maxsize=1000, ttl=3 * 3600)


def cached_audio_tracks(video_id: str) -> Optional[List[Dict[str, Any]]]:
    return _audio_tracks_cache.get(video_id)


def hls_session_key(video_id: str, itag: str, start: int, audio_lang: Optional[str] = None) -> str:
    return f"{video_id}:{itag}:{start}:{audio_lang or ''}"


async def _extract_and_cache(video_id: str) -> Optional[dict]:
    info = await ydl_extract(f"https://www.youtube.com/watch?v={video_id}", get_ydl_opts())
    if not info:
        return None
    formats = [f for f in info.get("formats", []) if is_direct_format(f)]
    for fmt in formats:
        fid, url = fmt.get("format_id"), fmt.get("url")
        video_only = fmt.get("vcodec", "none") != "none" and fmt.get("acodec", "none") == "none"
        audio_only = fmt.get("acodec", "none") != "none" and fmt.get("vcodec", "none") == "none"
        if fid and url and (video_only or audio_only):
            stream_url_cache_set(f"stream:{video_id}:{fid}", url, fmt.get("ext", "mp4"))
    if audio := _best_m4a_audio(formats):
        stream_url_cache_set(f"stream:{video_id}:bestaudio_m4a", audio["url"], audio.get("ext", "m4a"))
    tracks = list_audio_tracks(formats)
    _audio_tracks_cache[video_id] = tracks
    for track in tracks:
        if audio := _best_m4a_audio(formats, track["lang"]):
            stream_url_cache_set(f"stream:{video_id}:audio:{track['lang']}", audio["url"], audio.get("ext", "m4a"))
    return info


def prefetch_stream_urls(video_id: str) -> "asyncio.Task[Optional[dict]]":
    """Start (or join) the extraction that fills the stream URL cache."""
    task = _extractions.get(video_id)
    if task is None:
        task = asyncio.ensure_future(_extract_and_cache(video_id))
        _extractions[video_id] = task

        def _done(t: "asyncio.Task[Optional[dict]]") -> None:
            if _extractions.get(video_id) is t:
                del _extractions[video_id]
            if not t.cancelled():
                t.exception()  # failures are re-raised to whoever awaits the task

        task.add_done_callback(_done)
    return task


async def _get_video_and_audio_urls(video_id: str, itag: str, audio_lang: Optional[str] = None) -> tuple:
    """Return (video_url, audio_url), using cache where possible. Without
    `audio_lang` the original audio track is used."""
    video_cache_key = f"stream:{video_id}:{itag}"
    audio_cache_key = f"stream:{video_id}:audio:{audio_lang}" if audio_lang else f"stream:{video_id}:bestaudio_m4a"

    cached_v = stream_url_cache_get(video_cache_key)
    cached_a = stream_url_cache_get(audio_cache_key)

    if cached_v and cached_a:
        return cached_v[0], cached_a[0]

    # Height in pixels for the most common YouTube video-only itags
    _ITAG_HEIGHT: Dict[str, int] = {
        "160": 144, "394": 144,
        "133": 240, "242": 240, "278": 240, "395": 240,
        "134": 360, "243": 360, "396": 360,
        "135": 480, "244": 480, "397": 480,
        "136": 720, "247": 720, "298": 720, "302": 720, "398": 720,
        "137": 1080, "248": 1080, "299": 1080, "303": 1080, "399": 1080,
        "264": 1440, "271": 1440, "308": 1440, "400": 1440,
        "266": 2160, "272": 2160, "315": 2160, "313": 2160, "401": 2160,
    }

    # shield: a player that disconnects must not cancel an extraction others share
    info = await asyncio.shield(prefetch_stream_urls(video_id))
    if not info:
        print(f"[hls] yt-dlp returned no info for {video_id}", flush=True)
        return None, None

    formats = [f for f in info.get("formats", []) if is_direct_format(f)]
    v_url = None
    for fmt in formats:
        if str(fmt.get("format_id")) == str(itag):
            v_url = fmt.get("url")
            stream_url_cache_set(video_cache_key, v_url, fmt.get("ext", "mp4"))
            break

    # Fallback: itag missing from this API response (YouTube occasionally returns
    # different format sets). Try the best video-only format at the same height.
    if not v_url:
        target_h = _ITAG_HEIGHT.get(str(itag))
        if target_h:
            video_fmts = [
                f for f in formats
                if f.get("vcodec", "none") != "none"
                and f.get("acodec", "none") == "none"
                and f.get("url")
            ]
            # Exact height first, then best height below target
            exact = [f for f in video_fmts if f.get("height") == target_h]
            below = sorted(
                [f for f in video_fmts if (f.get("height") or 0) < target_h],
                key=lambda f: -(f.get("height") or 0),
            )
            candidates = exact or below
            # Prefer H.264 (avc) for client compatibility
            h264 = [f for f in candidates if "avc" in (f.get("vcodec") or "")]
            best = h264[0] if h264 else (candidates[0] if candidates else None)
            if best:
                v_url = best.get("url")
                stream_url_cache_set(video_cache_key, v_url, best.get("ext", "mp4"))
                print(
                    f"[hls] itag {itag} unavailable for {video_id}, "
                    f"using {best.get('format_id')} ({best.get('height')}p) as fallback",
                    flush=True,
                )
            else:
                available = [f.get("format_id") for f in formats if f.get("url")]
                print(
                    f"[hls] no fallback for itag {itag} ({target_h}p) on {video_id}. "
                    f"Available: {available}",
                    flush=True,
                )
        else:
            available = [f.get("format_id") for f in formats if f.get("url")]
            print(f"[hls] unknown itag {itag} not found for {video_id}. Available: {available}", flush=True)

    a_url = None
    if audio := _best_m4a_audio(formats, audio_lang):
        a_url = audio["url"]
        stream_url_cache_set(audio_cache_key, a_url, audio.get("ext", "m4a"))
    else:
        fallback_exts = [f"{f.get('format_id')}/{f.get('ext')}" for f in _audio_only(formats)]
        print(f"[hls] no m4a/mp4 audio for {video_id}. Audio formats: {fallback_exts}", flush=True)
    return v_url, a_url


MAX_HLS_SESSIONS = 6


def _evict_hls_sessions_over_limit() -> None:
    """Kill least-recently-used sessions so a new one fits (call inside lock)."""
    while len(_hls_sessions) >= MAX_HLS_SESSIONS:
        oldest = min(_hls_sessions, key=lambda k: _hls_sessions[k].get("last_access", 0))
        session = _hls_sessions.pop(oldest)
        try:
            session["process"].kill()
        except Exception:
            pass
        shutil.rmtree(session["dir"], ignore_errors=True)


async def _start_hls_session(video_id: str, itag: str, start: int = 0, audio_lang: Optional[str] = None) -> str:
    """Start ffmpeg transcoding from `start` seconds. Returns the session key."""
    session_key = hls_session_key(video_id, itag, start, audio_lang)

    async with _hls_lock:
        existing = _hls_sessions.get(session_key)
        if existing and existing["process"].returncode not in (None, 0):
            # ffmpeg died (expired URL, network error): rebuild rather than serve
            # a truncated playlist — players no longer DELETE before starting
            _hls_sessions.pop(session_key)
            shutil.rmtree(existing["dir"], ignore_errors=True)
        elif existing:
            return session_key

    # yt-dlp extraction takes seconds: resolving outside the lock keeps other
    # videos' playlists and segments responsive in the meantime.
    video_url, audio_url = await _get_video_and_audio_urls(video_id, itag, audio_lang)
    if not video_url or not audio_url:
        raise HTTPException(status_code=404, detail="Stream URLs not found")

    async with _hls_lock:
        if session_key in _hls_sessions:
            return session_key
        _evict_hls_sessions_over_limit()

        tmpdir = tempfile.mkdtemp(prefix="mytube_hls_")
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        seek = ["-ss", str(start)] if start > 0 else []
        proxy_url = _get_proxy_url()
        cmd_prefix = _proxychains_prefix(proxy_url)

        cmd = [
            *cmd_prefix, _FFMPEG, "-loglevel", "warning", "-y",
            *seek,
            *_FFMPEG_HTTP_CHUNK_ARGS,
            "-headers", f"User-Agent: {ua}\r\nReferer: https://www.youtube.com/\r\n",
            "-i", video_url,
            *seek,
            *_FFMPEG_HTTP_CHUNK_ARGS,
            "-headers", f"User-Agent: {ua}\r\nReferer: https://www.youtube.com/\r\n",
            "-i", audio_url,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "copy",
            "-f", "hls",
            "-hls_time", "1",
            "-hls_list_size", "0",
            "-hls_flags", "append_list",
            # fMP4 rather than MPEG-TS: TS cannot carry VP9/AV1, the only codecs
            # YouTube offers above 1080p, so 1440p/2160p played as a black screen.
            "-hls_segment_type", "fmp4",
            # Without edit lists the muxer keeps the audio/video offset in the
            # fragment timestamps (hls.js ignores edit lists), so tracks stay in sync
            "-hls_segment_options", "use_editlist=0",
            "-hls_fmp4_init_filename", "init.mp4",
            "-hls_segment_filename", str(Path(tmpdir) / "seg%05d.m4s"),
            str(Path(tmpdir) / "stream.m3u8"),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.ensure_future(_log_stderr(process.stderr))

        keyframe_task = (
            asyncio.ensure_future(_probe_seek_keyframe(video_url, start, cmd_prefix, ua))
            if start > 0 else None
        )
        _hls_sessions[session_key] = {
            "dir": tmpdir, "process": process, "start": start, "last_access": _time(),
            "keyframe_task": keyframe_task,
        }
        return session_key


async def _probe_seek_keyframe(video_url: str, start: int, cmd_prefix: List[str], ua: str) -> Optional[float]:
    """Timestamp of the keyframe a stream-copy seek to `start` really begins at.

    Copying video can only start on a keyframe (YouTube fragments are ~5 s), so
    the session begins up to a few seconds before `start`; the playlist announces
    the gap with EXT-X-START so the player still starts at the requested time."""
    cmd = [
        *cmd_prefix, _FFPROBE, "-v", "error", *_FFMPEG_HTTP_CHUNK_ARGS,
        "-headers", f"User-Agent: {ua}\r\nReferer: https://www.youtube.com/\r\n",
        "-select_streams", "v:0", "-show_entries", "packet=pts_time",
        "-read_intervals", f"{start}%+#1", "-of", "csv=p=0", video_url,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return float(out.decode().split()[0])
    except Exception:
        return None


async def hls_session_lead(session: Dict[str, Any]) -> float:
    """Seconds between the session's first frame and the requested start."""
    task = session.get("keyframe_task")
    if task is None:
        return 0.0
    try:
        keyframe = await asyncio.wait_for(asyncio.shield(task), timeout=5)
    except Exception:
        return 0.0
    if keyframe is None:
        return 0.0
    lead = session["start"] - keyframe
    return lead if 0.05 < lead < 30 else 0.0


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
            _FFPROBE, "-v", "error",
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
    s, u, p = config._xtream_cfg["server"], config._xtream_cfg["username"], config._xtream_cfg["password"]
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
            "-vf", "setpts=PTS-STARTPTS",
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
            "-af", "asetpts=PTS-STARTPTS",
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

        session = {"dir": tmpdir, "process": proc, "pipe_task": pipe_task, "start": start, "key": session_key, "last_access": _time()}
        _iptv_vod_hls_sessions[session_key] = session
        return session


HLS_IDLE_TTL = 120  # seconds before an untouched HLS session is killed
# IPTV films/episodes get longer: pausing a movie for a few minutes is normal,
# and a killed session made the resume fail (segments answered 404).
IPTV_VOD_IDLE_TTL = 600


async def _hls_idle_cleanup_loop() -> None:
    """Kill HLS sessions that have not served a request in HLS_IDLE_TTL seconds."""
    while True:
        await asyncio.sleep(60)
        now = _time()

        async with _hls_lock:
            stale = [k for k, s in _hls_sessions.items()
                     if now - s.get("last_access", 0) > HLS_IDLE_TTL]
            for k in stale:
                sess = _hls_sessions.pop(k)
                try:
                    sess["process"].kill()
                except Exception:
                    pass
                shutil.rmtree(sess["dir"], ignore_errors=True)

        async with _iptv_vod_hls_lock:
            stale = [k for k, s in _iptv_vod_hls_sessions.items()
                     if now - s.get("last_access", 0) > IPTV_VOD_IDLE_TTL]
            for k in stale:
                _kill_vod_session(_iptv_vod_hls_sessions.pop(k))


_FFMPEG_BLOCK_PATTERNS = (
    "server returned 403",
    "http error 403",
    "server returned 429",
    "http error 429",
    "server returned 500",
    "http error 500",
)

async def _log_stderr(stderr: asyncio.StreamReader) -> None:
    """Drain stderr line-by-line, log it, and trigger VPN failover on HTTP blocks."""
    try:
        async for raw in stderr:
            msg = raw.decode("utf-8", errors="replace").rstrip()
            if msg:
                print(f"[ffmpeg] {msg}", flush=True)
                low = msg.lower()
                if any(p in low for p in _FFMPEG_BLOCK_PATTERNS):
                    record_youtube_error(403)
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
    if "/" in cache_key or "\\" in cache_key or ".." in cache_key:
        raise ValueError(f"Invalid cache_key: {cache_key!r}")
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


def cancel_vod_downloads(keep_key: Optional[str] = None) -> int:
    """Stop and forget background VOD downloads other than `keep_key`.

    Each download holds a connection to the Xtream server until the whole file
    is fetched, even after the viewer moved on. Returns how many were stopped."""
    stopped = 0
    for key, entry in list(_vod_dl_cache.items()):
        task = entry.get("task")
        if key == keep_key or not task or task.done():
            continue
        task.cancel()
        # Forget the partial file: once the task ends it is flagged "done" and
        # would otherwise be served later as if it were complete
        _vod_dl_cache.pop(key, None)
        try:
            os.unlink(entry["path"])
        except OSError:
            pass
        stopped += 1
    return stopped


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
    from time import time as _time
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
    print(f"[downloader] start url={_redact_url(url)} initial_offset={initial_offset}", flush=True)
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


_ORPHAN_DIR_PREFIXES = ("mytube_hls_", "mytube_iptv_hls_")
_ORPHAN_VOD_FILE = re.compile(r"mytube_[A-Za-z0-9_-]+\.(?:mp4|mkv|avi|ts|m2ts|mts|webm|mov|flv|m3u8)")


def cleanup_orphan_media_files() -> int:
    """Delete HLS session dirs and VOD cache files left by a previous process.

    Sessions live in memory, so after a restart (crash, --reload, redeploy)
    their temp files belong to nobody and were never removed — gigabytes
    accumulated. Called at startup; returns the number of entries removed."""
    removed = 0
    tmp = tempfile.gettempdir()
    for name in os.listdir(tmp):
        path = os.path.join(tmp, name)
        try:
            if name.startswith(_ORPHAN_DIR_PREFIXES) and os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
            elif _ORPHAN_VOD_FILE.fullmatch(name) and os.path.isfile(path):
                os.unlink(path)
                removed += 1
        except OSError:
            continue
    return removed


def stop_all_sessions() -> None:
    """Kill every ffmpeg session and delete its files (called at shutdown)."""
    for session in list(_hls_sessions.values()):
        try:
            session["process"].kill()
        except Exception:
            pass
        shutil.rmtree(session["dir"], ignore_errors=True)
    _hls_sessions.clear()
    for session in list(_iptv_vod_hls_sessions.values()):
        _kill_vod_session(session)
    _iptv_vod_hls_sessions.clear()
    for entry in list(_vod_dl_cache.values()):
        task = entry.get("task")
        if task and not task.done():
            task.cancel()
