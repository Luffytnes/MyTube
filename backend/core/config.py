"""Shared constants and configuration for MyTube backend."""
import json
import os
import shutil
from typing import Any, Dict

import httpx

# --- Invidious ---------------------------------------------------------------
INVIDIOUS_INSTANCES = [
    "https://iv.melmac.space",
    "https://invidious.slipfox.xyz",
    "https://invidious.nerdvpn.de",
    "https://inv.nadeko.net",
    "https://invidious.privacyredirect.com",
    "https://yewtu.be",
]

# Category -> Invidious trending type
INVIDIOUS_TYPES = {"music", "gaming", "news", "movies"}

# --- yt-dlp ------------------------------------------------------------------
YDL_OPTS_BASE: Dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "nocheckcertificate": True,
}

# --- HTTP headers ------------------------------------------------------------
YOUTUBE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}

_YT_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": "2.20240101.00.00",
    "Origin": "https://www.youtube.com",
    "Referer": "https://www.youtube.com/",
}

# params value for YouTube Videos tab (base64 encoded)
_YT_VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA"

# --- ffmpeg binaries ---------------------------------------------------------
_FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
_FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"

_OUTPUT_ARGS = [
    # Disable subtitle/data streams (fMP4 can't mux most subtitle codecs)
    "-sn", "-dn",
    # Downmix to stereo + 48 kHz — Apple AudioToolbox (Firefox/Safari) rejects
    # multi-channel AAC-LC AudioSpecificConfig (5.1 AC3/DTS input → 6-ch AAC fails)
    "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
    "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
]

# --- IPTV / Xtream config (shared between services.ffmpeg and api.iptv) -------
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
