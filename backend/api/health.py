"""Health check endpoint."""
import shutil
import subprocess
import sys
from time import time as _time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core import cache as _cache_module
from services.vpn import is_wireproxy_active as _vpn_active
from services import vpn as _vpn

router = APIRouter()

_START_TIME = _time()


def _ffmpeg_ok() -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


def _wireproxy_ok() -> bool:
    return _vpn_active()


@router.get("/api/health")
async def health():
    uptime = int(_time() - _START_TIME)
    ffmpeg = shutil.which("ffmpeg") is not None and _ffmpeg_ok()
    vpn_active = _wireproxy_ok()

    cache_entries = (
        len(_cache_module._cache)
        + len(_cache_module._thumb_cache)
        + len(_cache_module._channel_thumbs_cache)
    )

    status = "ok"
    checks = {
        "ffmpeg": "ok" if ffmpeg else "unavailable",
        "vpn": "active" if vpn_active else "off",
        "vpn_conf": _vpn._wireproxy_conf_name or None,
        "vpn_mode": "external" if _vpn.WIREPROXY_HOST else "subprocess",
        "vpn_auto": _vpn._vpn_auto_mode,
        "cache_entries": cache_entries,
        "uptime_seconds": uptime,
        "python": sys.version.split()[0],
    }

    http_status = 200 if status == "ok" else 503
    return JSONResponse({"status": status, **checks}, status_code=http_status)
