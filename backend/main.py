"""MyTube API — FastAPI application entrypoint.

The implementation is split across:
  - core/      shared config + in-memory caches
  - services/  innertube, ffmpeg, vpn, tmdb helpers and state
  - api/       APIRouter modules grouped by feature
"""
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services.vpn import _vpn_watchdog
from services.ffmpeg import _vod_cache_cleanup_loop

from api.youtube import router as youtube_router
from api.music import router as music_router
from api.iptv import router as iptv_router
from api.news import router as news_router
from api.vpn import router as vpn_router
from api.tmdb import router as tmdb_router
from api.podcasts import router as podcasts_router

app = FastAPI(title="MyTube API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(youtube_router)
app.include_router(music_router)
app.include_router(iptv_router)
app.include_router(news_router)
app.include_router(vpn_router)
app.include_router(tmdb_router)
app.include_router(podcasts_router)


@app.on_event("startup")
async def start_vpn_watchdog():
    asyncio.create_task(_vpn_watchdog())
    asyncio.create_task(_vod_cache_cleanup_loop())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
