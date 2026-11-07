"""Server-side copy of what the browser saves (history, likes, playlists,
settings…). Browsers that wipe site data on close (LibreWolf by default) get
everything back on the next visit, and every browser of the user shares it."""
import asyncio
import json
import os
import threading
import time
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel

from core.security import is_cross_site_request

router = APIRouter()

USERDATA_PATH = os.path.join(os.path.expanduser("~"), ".mytube", "userdata.json")
KEY_PATTERN = r"^(mytube-[a-z0-9-]{1,48}|tv_[a-z_]{1,32})$"
MAX_VALUE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024

StorageKey = Annotated[str, Path(pattern=KEY_PATTERN)]

_lock = threading.Lock()


class Entry(BaseModel):
    value: Optional[str] = None  # None: the browser removed the key


def _load() -> dict:
    try:
        with open(USERDATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(USERDATA_PATH), exist_ok=True)
    tmp = f"{USERDATA_PATH}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, USERDATA_PATH)


def _reject_other_sites(request: Request) -> None:
    # CORS is open on the API: without this, any page the user visits could
    # read their history with a plain fetch()
    if is_cross_site_request(request.headers):
        raise HTTPException(status_code=403, detail="Cross-site request blocked")


def _put(key: str, value: Optional[str]) -> int:
    with _lock:
        data = _load()
        previous = data.get(key, {}).get("updated", 0)
        others = sum(len(e.get("value") or "") for k, e in data.items() if k != key)
        if others + len(value or "") > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Saved data is too large")
        # Strictly increasing per key, even when two writes land in the same ms
        updated = max(int(time.time() * 1000), previous + 1)
        data[key] = {"value": value, "updated": updated}
        _save(data)
        return updated


@router.get("/api/userdata")
async def get_userdata(request: Request):
    _reject_other_sites(request)
    with _lock:
        data = _load()
    return {"entries": data}


@router.put("/api/userdata/{key}")
async def put_userdata(key: StorageKey, entry: Entry, request: Request):
    _reject_other_sites(request)
    if entry.value is not None and len(entry.value.encode("utf-8")) > MAX_VALUE_BYTES:
        raise HTTPException(status_code=413, detail="Value is too large")
    updated = await asyncio.to_thread(_put, key, entry.value)
    return {"updated": updated}
