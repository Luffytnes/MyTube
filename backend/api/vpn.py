"""VPN (wireproxy) control API routes."""
import os
import re

from fastapi import APIRouter, File, HTTPException, UploadFile

from services import vpn as vpn_svc
from services.vpn import (
    WIREPROXY_BIN,
    WIREPROXY_HOST,
    VPN_CONFIGS_DIR,
    _get_proxy_url,
    _prepare_conf,
    _vpn_state_load,
    _vpn_state_save,
    _start_wireproxy_sync,
    _stop_wireproxy_sync,
    _ytm_cache,
    is_wireproxy_active,
)
from services.innertube import httpx_client

router = APIRouter()


def _safe_conf_name(raw: str) -> str:
    """Sanitize a VPN config filename: basename only, safe chars only, must end in .conf."""
    name = os.path.basename(raw or "vpn.conf")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    if not name.endswith(".conf"):
        name += ".conf"
    return name or "vpn.conf"


@router.get("/api/vpn/status")
async def vpn_status():
    running = is_wireproxy_active()
    return {
        "running": running,
        "conf_loaded": vpn_svc._wireproxy_conf_path is not None,
        "conf_name": vpn_svc._wireproxy_conf_name,
        "error": None,
        "proxy": _get_proxy_url(),
        "auto_mode": vpn_svc._vpn_auto_mode,
        "all_failed": vpn_svc._vpn_all_failed,
        "error_count": vpn_svc._vpn_error_count,
    }


@router.post("/api/vpn/auto")
async def vpn_set_auto_mode(body: dict):
    enabled = bool(body.get("enabled", False))
    vpn_svc._vpn_auto_mode = enabled
    # Reset failover state when toggling
    vpn_svc._vpn_error_count = 0
    vpn_svc._vpn_failed_confs = set()
    vpn_svc._vpn_all_failed = False
    return {"auto_mode": vpn_svc._vpn_auto_mode}


@router.post("/api/vpn/reset_failover")
async def vpn_reset_failover():
    """Reset the failover state so all confs are candidates again."""
    vpn_svc._vpn_error_count = 0
    vpn_svc._vpn_failed_confs = set()
    vpn_svc._vpn_all_failed = False
    return {"ok": True}


@router.get("/api/vpn/configs")
async def vpn_list_configs():
    """List all saved .conf files."""
    try:
        names = sorted(
            f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf")
        )
    except Exception:
        names = []
    return {"configs": names, "active": vpn_svc._wireproxy_conf_name}


@router.post("/api/vpn/upload")
async def vpn_upload_conf(file: UploadFile = File(...)):
    content = await file.read()
    try:
        raw = content.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file encoding — expected UTF-8 .conf")

    if "[Interface]" not in raw:
        raise HTTPException(status_code=400, detail="Invalid WireGuard config: missing [Interface] section")

    conf = _prepare_conf(raw)

    name = _safe_conf_name(file.filename or "vpn.conf")
    path = os.path.join(VPN_CONFIGS_DIR, name)
    with open(path, "w") as f:
        f.write(conf)

    vpn_svc._wireproxy_conf_path = path
    vpn_svc._wireproxy_conf_name = name
    _vpn_state_save({"active": name})
    _ytm_cache.clear()

    configs = sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    return {"ok": True, "conf_name": name, "configs": configs}


@router.post("/api/vpn/select")
async def vpn_select_conf(body: dict):
    """Select a previously saved config as active."""
    raw_name = body.get("name")
    if not raw_name:
        raise HTTPException(status_code=400, detail="Missing 'name'")
    name = _safe_conf_name(raw_name)

    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    if is_wireproxy_active():
        raise HTTPException(status_code=409, detail="Stop the VPN before switching config")

    vpn_svc._wireproxy_conf_path = path
    vpn_svc._wireproxy_conf_name = name
    _vpn_state_save({"active": name})

    return {"ok": True, "conf_name": name}


@router.delete("/api/vpn/configs/{name}")
async def vpn_delete_conf(name: str):
    """Delete a saved config. Cannot delete the active one while VPN is running."""
    name = _safe_conf_name(name)
    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    if is_wireproxy_active() and vpn_svc._wireproxy_conf_name == name:
        raise HTTPException(status_code=409, detail="Cannot delete the active config while VPN is running")

    os.remove(path)

    # If it was the active config, deselect it
    if vpn_svc._wireproxy_conf_name == name:
        vpn_svc._wireproxy_conf_path = None
        vpn_svc._wireproxy_conf_name = None
        state = _vpn_state_load()
        state.pop("active", None)
        _vpn_state_save(state)

    configs = sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    return {"ok": True, "configs": configs}


@router.post("/api/vpn/start")
async def vpn_start():
    if not vpn_svc._wireproxy_conf_path or not os.path.exists(vpn_svc._wireproxy_conf_path):
        raise HTTPException(status_code=400, detail="No VPN config loaded. Upload a .conf file first.")

    if is_wireproxy_active():
        return {"running": True, "message": "Already running"}

    if not WIREPROXY_HOST and not os.path.exists(WIREPROXY_BIN):
        raise HTTPException(
            status_code=500,
            detail=f"wireproxy not found at {WIREPROXY_BIN}. Install it: https://github.com/pufferffish/wireproxy"
        )

    import asyncio
    loop = asyncio.get_event_loop()
    success = await loop.run_in_executor(None, _start_wireproxy_sync, vpn_svc._wireproxy_conf_path)
    if not success:
        raise HTTPException(status_code=500, detail="wireproxy failed to start")

    return {"running": True}


@router.post("/api/vpn/stop")
async def vpn_stop():
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _stop_wireproxy_sync)
    return {"running": False}


@router.get("/api/vpn/myip")
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
