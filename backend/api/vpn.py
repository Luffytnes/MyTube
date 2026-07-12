"""VPN (wireproxy) control API routes."""
import os
import subprocess

from fastapi import APIRouter, File, HTTPException, UploadFile

from services import vpn as vpn_svc
from services.vpn import (
    WIREPROXY_BIN,
    VPN_CONFIGS_DIR,
    _get_proxy_url,
    _prepare_conf,
    _vpn_state_load,
    _vpn_state_save,
    _ytm_cache,
)
from services.innertube import httpx_client

router = APIRouter()


@router.get("/api/vpn/status")
async def vpn_status():
    running = vpn_svc._wireproxy_process is not None and vpn_svc._wireproxy_process.poll() is None
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

    name = file.filename or "vpn.conf"
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
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Missing 'name'")

    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    if vpn_svc._wireproxy_process and vpn_svc._wireproxy_process.poll() is None:
        raise HTTPException(status_code=409, detail="Stop the VPN before switching config")

    vpn_svc._wireproxy_conf_path = path
    vpn_svc._wireproxy_conf_name = name
    _vpn_state_save({"active": name})

    return {"ok": True, "conf_name": name}


@router.delete("/api/vpn/configs/{name}")
async def vpn_delete_conf(name: str):
    """Delete a saved config. Cannot delete the active one while VPN is running."""
    path = os.path.join(VPN_CONFIGS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

    running = vpn_svc._wireproxy_process is not None and vpn_svc._wireproxy_process.poll() is None
    if running and vpn_svc._wireproxy_conf_name == name:
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

    if vpn_svc._wireproxy_process and vpn_svc._wireproxy_process.poll() is None:
        return {"running": True, "message": "Already running"}

    if not os.path.exists(WIREPROXY_BIN):
        raise HTTPException(
            status_code=500,
            detail=f"wireproxy not found at {WIREPROXY_BIN}. Install it: https://github.com/pufferffish/wireproxy"
        )

    try:
        vpn_svc._wireproxy_process = subprocess.Popen(
            [WIREPROXY_BIN, "-c", vpn_svc._wireproxy_conf_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        # Give it a moment to start
        import time
        time.sleep(1.5)

        if vpn_svc._wireproxy_process.poll() is not None:
            stderr = vpn_svc._wireproxy_process.stderr.read().decode("utf-8", errors="replace") if vpn_svc._wireproxy_process.stderr else ""
            raise HTTPException(status_code=500, detail=f"wireproxy exited immediately: {stderr[:300]}")

        # Clear ytmusicapi cache so new instances use the proxy
        _ytm_cache.clear()

        return {"running": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start wireproxy: {str(e)}")


@router.post("/api/vpn/stop")
async def vpn_stop():
    if vpn_svc._wireproxy_process:
        try:
            vpn_svc._wireproxy_process.terminate()
            vpn_svc._wireproxy_process.wait(timeout=5)
        except Exception:
            try:
                vpn_svc._wireproxy_process.kill()
            except Exception:
                pass
        vpn_svc._wireproxy_process = None

    # Clear ytmusicapi cache so new instances don't use the proxy
    _ytm_cache.clear()

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
