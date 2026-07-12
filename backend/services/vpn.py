"""VPN (wireproxy) state management, proxy URL resolution and failover."""
import asyncio
import json
import os
import shutil
import subprocess
from time import time as _time
from typing import List, Optional

# YouTube Music instance cache — cleared whenever the proxy changes so new
# YTMusic clients pick up (or drop) the proxy. Lives here because the VPN
# lifecycle owns its invalidation.
_ytm_cache: dict = {}

_wireproxy_process: Optional[subprocess.Popen] = None
_wireproxy_conf_path: Optional[str] = None  # path to the currently active .conf
_wireproxy_conf_name: Optional[str] = None  # display name of active .conf
_wireproxy_socks_port: int = 25344

# ── Auto-failover state ──────────────────────────────────────────────────────
_vpn_auto_mode: bool = False          # user-enabled auto failover
_vpn_error_count: int = 0             # consecutive YouTube errors on current conf
_vpn_failed_confs: set = set()        # confs that have already been tried and failed
_vpn_all_failed: bool = False         # True when all confs exhausted
_vpn_failover_threshold: int = 1      # errors before switching conf
_vpn_failover_lock = asyncio.Lock()   # prevent concurrent failovers

WIREPROXY_BIN = shutil.which("wireproxy") or "/usr/local/bin/wireproxy"

# When WIREPROXY_HOST is set, the backend delegates wireproxy to a dedicated
# container instead of managing it as a subprocess.
WIREPROXY_HOST: str = os.getenv("WIREPROXY_HOST", "")

SOCKS5_SECTION = f"\n[Socks5]\nBindAddress = 127.0.0.1:{_wireproxy_socks_port}\n"
SOCKS5_SECTION_EXT = f"\n[Socks5]\nBindAddress = 0.0.0.0:{_wireproxy_socks_port}\n"

# Persistent storage for saved configs
VPN_CONFIGS_DIR = os.path.join(os.path.expanduser("~"), ".mytube", "vpn_configs")
VPN_STATE_FILE  = os.path.join(os.path.expanduser("~"), ".mytube", "vpn_state.json")
# Active conf written to shared volume for the wireproxy container
_ACTIVE_CONF_PATH = os.path.join(os.path.expanduser("~"), ".mytube", ".wireproxy.conf")
os.makedirs(VPN_CONFIGS_DIR, exist_ok=True)


def _vpn_state_load() -> dict:
    try:
        with open(VPN_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _vpn_state_save(state: dict):
    try:
        with open(VPN_STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass


def _restore_active_conf():
    """On startup: restore last active config if it still exists."""
    global _wireproxy_conf_path, _wireproxy_conf_name
    state = _vpn_state_load()
    active = state.get("active")
    if active:
        path = os.path.join(VPN_CONFIGS_DIR, active)
        if os.path.exists(path):
            _wireproxy_conf_path = path
            _wireproxy_conf_name = active


_restore_active_conf()


_vpn_last_activity: float = _time()  # updated on every proxied request
_VPN_IDLE_RESTART_SECS = 300  # restart after 5 min idle to recover stale tunnels


def is_wireproxy_active() -> bool:
    """True if wireproxy tunnel is running (subprocess or external container)."""
    if WIREPROXY_HOST:
        return _wireproxy_conf_path is not None and os.path.exists(_ACTIVE_CONF_PATH)
    return _wireproxy_process is not None and _wireproxy_process.poll() is None


def vpn_record_activity():
    global _vpn_last_activity
    _vpn_last_activity = _time()


async def _restart_wireproxy():
    """Stop and restart wireproxy with the current conf."""
    loop = asyncio.get_event_loop()
    conf_path = _wireproxy_conf_path
    await loop.run_in_executor(None, _stop_wireproxy_sync)
    await asyncio.sleep(1)
    await loop.run_in_executor(None, _start_wireproxy_sync, conf_path)


async def _vpn_watchdog():
    """Periodically check that the VPN tunnel is actually alive:
    1. If the SOCKS5 port is unresponsive → restart immediately.
    2. If idle for >5 min → restart proactively to recover stale WireGuard tunnels.
    """
    await asyncio.sleep(30)  # let the server fully start first
    socks_host = WIREPROXY_HOST if WIREPROXY_HOST else "127.0.0.1"
    while True:
        await asyncio.sleep(20)
        try:
            if not is_wireproxy_active():
                continue
            if not _wireproxy_conf_path:
                continue

            # 1. Liveness check: try connecting to SOCKS5 port
            port_alive = False
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(socks_host, _wireproxy_socks_port),
                    timeout=3.0,
                )
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
                port_alive = True
            except Exception:
                pass

            if not port_alive:
                await _restart_wireproxy()
                continue

            # 2. Idle check: tunnel may be alive but WireGuard handshake stale
            idle_secs = _time() - _vpn_last_activity
            if idle_secs > _VPN_IDLE_RESTART_SECS:
                await _restart_wireproxy()
                vpn_record_activity()  # reset timer after restart

        except Exception:
            pass


def _list_all_confs() -> List[str]:
    """Return sorted list of all saved .conf filenames."""
    try:
        return sorted(f for f in os.listdir(VPN_CONFIGS_DIR) if f.endswith(".conf"))
    except Exception:
        return []


def _stop_wireproxy_sync():
    """Stop wireproxy synchronously (subprocess or external container)."""
    global _wireproxy_process
    if WIREPROXY_HOST:
        try:
            os.remove(_ACTIVE_CONF_PATH)
        except FileNotFoundError:
            pass
        except Exception:
            pass
    elif _wireproxy_process:
        try:
            _wireproxy_process.terminate()
            _wireproxy_process.wait(timeout=5)
        except Exception:
            try:
                _wireproxy_process.kill()
            except Exception:
                pass
        _wireproxy_process = None
    _ytm_cache.clear()


def _start_wireproxy_sync(conf_path: str) -> bool:
    """Start wireproxy with given conf. Returns True on success."""
    global _wireproxy_process
    import time
    import re

    if WIREPROXY_HOST:
        # External container mode: write prepared conf to shared volume atomically.
        # The wireproxy container polls _ACTIVE_CONF_PATH and restarts on change.
        try:
            raw = open(conf_path).read()
            if "[Socks5]" in raw:
                prepared = re.sub(
                    r'BindAddress\s*=\s*\S+',
                    f'BindAddress = 0.0.0.0:{_wireproxy_socks_port}',
                    raw,
                )
            else:
                prepared = raw.rstrip() + SOCKS5_SECTION_EXT
            os.makedirs(os.path.dirname(_ACTIVE_CONF_PATH), exist_ok=True)
            tmp_path = _ACTIVE_CONF_PATH + ".tmp"
            try:
                with open(tmp_path, "w") as f:
                    f.write(prepared)
                os.replace(tmp_path, _ACTIVE_CONF_PATH)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
            time.sleep(2)  # give wireproxy container time to restart
            _ytm_cache.clear()
            return True
        except Exception:
            return False

    # Subprocess mode
    try:
        _wireproxy_process = subprocess.Popen(
            [WIREPROXY_BIN, "-c", conf_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        time.sleep(1.5)
        if _wireproxy_process.poll() is not None:
            _wireproxy_process = None
            return False
        _ytm_cache.clear()
        return True
    except Exception:
        _wireproxy_process = None
        return False


async def _vpn_failover():
    """Try the next available conf. If all exhausted, disable wireproxy."""
    global _wireproxy_conf_path, _wireproxy_conf_name
    global _vpn_error_count, _vpn_failed_confs, _vpn_all_failed

    async with _vpn_failover_lock:
        if not _vpn_auto_mode:
            return

        # Mark current conf as failed
        if _wireproxy_conf_name:
            _vpn_failed_confs.add(_wireproxy_conf_name)

        all_confs = _list_all_confs()
        candidates = [c for c in all_confs if c not in _vpn_failed_confs]

        if not candidates:
            # All confs exhausted — disable wireproxy
            _stop_wireproxy_sync()
            _vpn_all_failed = True
            _vpn_error_count = 0
            return

        # Try next candidate
        next_conf = candidates[0]
        next_path = os.path.join(VPN_CONFIGS_DIR, next_conf)

        _stop_wireproxy_sync()

        loop = asyncio.get_event_loop()
        success = await loop.run_in_executor(None, _start_wireproxy_sync, next_path)

        if success:
            _wireproxy_conf_path = next_path
            _wireproxy_conf_name = next_conf
            _vpn_state_save({"active": next_conf})
            _vpn_error_count = 0
        else:
            _vpn_failed_confs.add(next_conf)
            # Recurse to try the next one
            await _vpn_failover()


def record_youtube_error(status_code: int):
    """Call this when YouTube returns a blocking error. Triggers failover if needed."""
    global _vpn_error_count
    if not _vpn_auto_mode:
        return
    if not is_wireproxy_active():
        return
    if status_code in (403, 429, 451):
        _vpn_error_count += 1
        if _vpn_error_count >= _vpn_failover_threshold:
            _vpn_error_count = 0
            asyncio.create_task(_vpn_failover())


def reset_youtube_errors():
    """Call this on a successful YouTube response to reset the error counter."""
    global _vpn_error_count
    _vpn_error_count = 0


def _get_proxy_url() -> Optional[str]:
    if WIREPROXY_HOST:
        if _wireproxy_conf_path and os.path.exists(_ACTIVE_CONF_PATH):
            return f"socks5://{WIREPROXY_HOST}:{_wireproxy_socks_port}"
        return None
    if _wireproxy_process and _wireproxy_process.poll() is None:
        return f"socks5://127.0.0.1:{_wireproxy_socks_port}"
    return None


def _prepare_conf(raw: str) -> str:
    """Ensure the conf has a [Socks5] section for wireproxy."""
    if "[Socks5]" in raw:
        return raw
    return raw.rstrip() + SOCKS5_SECTION
