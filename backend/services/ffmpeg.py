"""ffmpeg-based HLS/VOD transcoding sessions and helpers."""
import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict

import httpx
from fastapi import HTTPException

from core import config
from core.config import _FFMPEG, _FFPROBE, _OUTPUT_ARGS
from core.cache import (
    stream_url_cache_get,
    stream_url_cache_set,
)
from services.innertube import get_ydl_opts, httpx_client

import yt_dlp

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
