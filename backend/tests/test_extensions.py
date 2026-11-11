"""Tests for the November 2026 additions: server copy of the browser data,
SponsorBlock lookups, lyrics and the MyTube TV seek-bar previews."""
import asyncio
import hashlib
import os
import sys
from unittest.mock import AsyncMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _mock_httpx(handler):
    def client(**kw):
        kw.pop("follow_redirects", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kw)
    return client


# ---------------------------------------------------------------------------
# /api/userdata
# ---------------------------------------------------------------------------

class TestUserData:
    @pytest.fixture
    def client(self, tmp_path):
        import api.userdata as ud
        with patch.object(ud, "USERDATA_PATH", str(tmp_path / "userdata.json")):
            yield _client(ud.router), tmp_path / "userdata.json"

    def test_round_trip(self, client):
        c, path = client
        first = c.put("/api/userdata/mytube-likes", json={"value": '[{"id":"x"}]'}).json()["updated"]
        entries = c.get("/api/userdata").json()["entries"]
        assert entries["mytube-likes"] == {"value": '[{"id":"x"}]', "updated": first}
        assert oct(os.stat(path).st_mode & 0o777) == "0o600"

    def test_updates_are_strictly_increasing(self, client):
        c, _ = client
        a = c.put("/api/userdata/tv_favorites", json={"value": "[]"}).json()["updated"]
        b = c.put("/api/userdata/tv_favorites", json={"value": "[1]"}).json()["updated"]
        assert b > a

    def test_removal_is_kept_as_a_tombstone(self, client):
        c, _ = client
        c.put("/api/userdata/mytube-history", json={"value": "[]"})
        c.put("/api/userdata/mytube-history", json={"value": None})
        assert c.get("/api/userdata").json()["entries"]["mytube-history"]["value"] is None

    @pytest.mark.parametrize("key", ["other-key", "mytube-../x", "MYTUBE-LIKES", "tv_" + "a" * 40])
    def test_unknown_keys_rejected(self, client, key):
        c, _ = client
        assert c.put(f"/api/userdata/{key}", json={"value": "1"}).status_code in (404, 422)

    def test_other_sites_cannot_read_it(self, client):
        c, _ = client
        resp = c.get("/api/userdata", headers={"Sec-Fetch-Site": "cross-site"})
        assert resp.status_code == 403
        assert c.get("/api/userdata", headers={"Sec-Fetch-Site": "same-site"}).status_code == 200

    def test_value_size_limited(self, client):
        c, _ = client
        import api.userdata as ud
        with patch.object(ud, "MAX_VALUE_BYTES", 10):
            assert c.put("/api/userdata/mytube-likes", json={"value": "x" * 11}).status_code == 413

    def test_total_size_limited(self, client):
        c, _ = client
        import api.userdata as ud
        with patch.object(ud, "MAX_TOTAL_BYTES", 15):
            assert c.put("/api/userdata/mytube-likes", json={"value": "x" * 10}).status_code == 200
            assert c.put("/api/userdata/mytube-history", json={"value": "x" * 10}).status_code == 413


# ---------------------------------------------------------------------------
# SponsorBlock
# ---------------------------------------------------------------------------

class TestSponsorBlock:
    VIDEO = "eXjGWlJOhWg"

    def _lookup(self, handler):
        import api.sponsorblock as sb
        sb._segments_cache.clear()
        with patch.object(sb, "httpx_client", _mock_httpx(handler)):
            return asyncio.run(sb.sponsorblock_segments(self.VIDEO))["segments"]

    def test_only_a_hash_prefix_leaves(self):
        seen = []

        def handler(request):
            seen.append(request.url)
            return httpx.Response(200, json=[])

        self._lookup(handler)
        prefix = hashlib.sha256(self.VIDEO.encode()).hexdigest()[:4]
        assert seen[0].path == f"/api/skipSegments/{prefix}"
        assert self.VIDEO not in str(seen[0])

    def test_keeps_this_video_and_sorts(self):
        payload = [
            {"videoID": "other000000", "segments": [{"category": "sponsor", "actionType": "skip", "segment": [1, 2]}]},
            {"videoID": self.VIDEO, "segments": [
                {"category": "outro", "actionType": "skip", "segment": [500, 520]},
                {"category": "sponsor", "actionType": "skip", "segment": [10, 40.5]},
                {"category": "evil", "actionType": "skip", "segment": [1, 2]},
                {"category": "sponsor", "actionType": "skip", "segment": [30, 20]},
            ]},
        ]
        segments = self._lookup(lambda r: httpx.Response(200, json=payload))
        assert segments == [
            {"category": "sponsor", "actionType": "skip", "start": 10.0, "end": 40.5},
            {"category": "outro", "actionType": "skip", "start": 500.0, "end": 520.0},
        ]

    def test_404_means_no_segments_and_is_cached(self):
        import api.sponsorblock as sb
        assert self._lookup(lambda r: httpx.Response(404)) == []
        assert sb._segments_cache[self.VIDEO] == []

    def test_errors_are_not_cached(self):
        import api.sponsorblock as sb
        assert self._lookup(lambda r: httpx.Response(502)) == []
        assert self.VIDEO not in sb._segments_cache

    def test_invalid_video_id_rejected(self):
        import api.sponsorblock as sb
        assert _client(sb.router).get("/api/sponsorblock/bad%20id").status_code == 422


# ---------------------------------------------------------------------------
# Lyrics
# ---------------------------------------------------------------------------

class TestLyrics:
    LRC = "[00:01.50] First line\n[01:02.25] Second line\nnot a timed line"

    def _lyrics(self, handler, ytm=None, **params):
        import api.music as music
        music._lyrics_cache.clear()
        with patch.object(music, "httpx_client", _mock_httpx(handler)), \
             patch.object(music, "_ytmusic_lyrics", lambda vid: ytm):
            return asyncio.run(music.music_lyrics("fJ9rUzIMcZQ", **params))

    def test_parse_lrc(self):
        from api.music import _parse_lrc
        assert _parse_lrc(self.LRC) == [
            {"time": 1.5, "text": "First line"},
            {"time": 62.25, "text": "Second line"},
        ]

    def test_lrclib_synced_lyrics_first(self):
        def handler(request):
            assert request.url.path == "/api/get"
            assert request.url.params["track_name"] == "Song"
            return httpx.Response(200, json={"syncedLyrics": self.LRC, "plainLyrics": "x"})

        result = self._lyrics(handler, title="Song (Official Video)", artist="Band", duration=200)
        assert result["synced"] and result["source"] == "LRCLIB"
        assert result["lines"][0] == {"time": 1.5, "text": "First line"}

    def test_search_skips_other_cuts_of_the_song(self):
        def handler(request):
            if request.url.path == "/api/get":
                return httpx.Response(404)
            return httpx.Response(200, json=[
                {"duration": 260, "syncedLyrics": "[00:09.00] live version"},
                {"duration": 201, "syncedLyrics": self.LRC},
            ])

        result = self._lyrics(handler, title="Song", artist="Band", duration=200)
        assert result["lines"][0]["text"] == "First line"

    def test_youtube_music_timed_lyrics_beat_plain_lrclib(self):
        ytm = {"synced": True, "lines": [{"time": 3.0, "text": "timed"}], "source": "YTM"}
        result = self._lyrics(lambda r: httpx.Response(200, json=[{"duration": 200, "plainLyrics": "plain"}]) if r.url.path == "/api/search" else httpx.Response(404),
                              ytm=ytm, title="Song", artist="Band", duration=200)
        assert result["source"] == "YTM"

    def test_unreachable_sources_are_retried(self):
        import api.music as music

        def handler(request):
            raise httpx.ConnectError("down")

        result = self._lyrics(handler, title="Song", artist="Band", duration=200)
        assert result["lines"] == []
        assert "fJ9rUzIMcZQ" not in music._lyrics_cache


# ---------------------------------------------------------------------------
# MyTube TV seek-bar previews
# ---------------------------------------------------------------------------

class TestVodThumb:
    def test_never_reads_the_provider(self):
        import api.iptv as iptv
        import services.ffmpeg as ff
        ff._vod_dl_cache.pop("77.mp4", None)
        resp = _client(iptv.router).get("/api/iptv/vod_thumb/77?ext=mp4&t=30")
        assert resp.status_code == 404

    def test_rejects_bad_parameters(self):
        import api.iptv as iptv
        c = _client(iptv.router)
        assert c.get("/api/iptv/vod_thumb/77?ext=exe&t=30").status_code == 400
        assert c.get("/api/iptv/vod_thumb/77?ext=mp4&t=-1").status_code == 422

    def test_frame_from_the_local_download(self, tmp_path):
        import subprocess
        import api.iptv as iptv
        import services.ffmpeg as ff
        from core.config import _FFMPEG
        video = tmp_path / "mytube_78.mp4"
        try:
            subprocess.run([_FFMPEG, "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=20:size=320x180:rate=10",
                            "-c:v", "mpeg4", str(video)], check=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            pytest.skip("ffmpeg not available")
        ff._vod_dl_cache["78.mp4"] = {"path": str(video), "written": video.stat().st_size, "done": True}
        iptv._thumb_cache.clear()
        try:
            resp = _client(iptv.router).get("/api/iptv/vod_thumb/78?ext=mp4&t=10")
        finally:
            ff._vod_dl_cache.pop("78.mp4", None)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content[:2] == b"\xff\xd8"


# ---------------------------------------------------------------------------
# Formats from yt-dlp when YouTube.js gets none
# ---------------------------------------------------------------------------

class TestPlayerFormats:
    FORMATS = [
        {"format_id": "18", "protocol": "https", "url": "https://x/18", "vcodec": "avc1", "acodec": "mp4a", "height": 360, "ext": "mp4"},
        {"format_id": "137", "protocol": "https", "url": "https://x/137", "vcodec": "avc1", "acodec": "none", "height": 1080, "ext": "mp4"},
        {"format_id": "96", "protocol": "m3u8_native", "url": "https://x/96.m3u8", "vcodec": "avc1", "acodec": "mp4a", "height": 1080},
        {"format_id": "140", "protocol": "https", "url": "https://x/140", "vcodec": "none", "acodec": "mp4a", "abr": 129.5, "ext": "m4a"},
        {"format_id": "sb0", "protocol": "mhtml", "url": "https://x/sb", "vcodec": "none", "acodec": "none"},
    ]

    def test_shape_and_order(self):
        from services.ffmpeg import player_formats
        out = player_formats(self.FORMATS)
        assert [f["itag"] for f in out] == ["18", "137", "140"]
        assert out[1] == {"itag": "137", "ext": "mp4", "quality": "1080p", "filesize": None,
                          "hasAudio": False, "hasVideo": True, "height": 1080, "abr": 0}
        assert out[2]["quality"] == "129k audio"

    def test_endpoint_uses_the_shared_extraction(self):
        import api.youtube as yt
        import services.ffmpeg as ff
        ff._player_formats_cache.clear()

        async def extract(video_id):
            ff._player_formats_cache[video_id] = ff.player_formats(self.FORMATS)
            return {}

        with patch.object(yt, "prefetch_stream_urls", lambda vid: asyncio.ensure_future(extract(vid))):
            resp = _client(yt.router).get("/api/formats/dQw4w9WgXcQ")
        assert [f["itag"] for f in resp.json()["formats"]] == ["18", "137", "140"]

    def test_duration_from_the_extraction(self):
        """YouTube sometimes leaves the length out too: the seek bar then grew
        with what the server had transcoded."""
        import api.youtube as yt
        import services.ffmpeg as ff
        ff._player_formats_cache.clear()
        ff._durations_cache.clear()
        info = {"duration": 503, "formats": self.FORMATS}
        with patch.object(ff, "ydl_extract", AsyncMock(return_value=info)), \
             patch.object(ff, "stream_url_cache_set", lambda *a, **k: None):
            resp = _client(yt.router).get("/api/formats/dQw4w9WgXcQ")
        assert resp.json()["duration"] == 503.0
        assert len(resp.json()["formats"]) == 3

    def test_unplayable_video_gives_empty_lists(self):
        import api.youtube as yt
        import services.ffmpeg as ff
        ff._player_formats_cache.clear()
        ff._audio_tracks_cache.clear()

        async def fail(video_id):
            raise RuntimeError("Private video")

        with patch.object(yt, "prefetch_stream_urls", lambda vid: asyncio.ensure_future(fail(vid))):
            c = _client(yt.router)
            assert c.get("/api/formats/dQw4w9WgXcQ").json() == {"formats": [], "duration": None}
            assert c.get("/api/audio_tracks/dQw4w9WgXcQ").json() == {"tracks": []}


class TestVodDownloadProgress:
    def test_progress_of_a_running_download(self):
        import api.iptv as iptv
        import services.ffmpeg as ff
        ff._vod_dl_cache["91.avi"] = {"path": "/x", "written": 3 * 2**20, "total_size": 351 * 2**20,
                                      "speed": 8192.0, "done": False}
        try:
            resp = _client(iptv.router).get("/api/iptv/vod_download/91?ext=avi")
        finally:
            ff._vod_dl_cache.pop("91.avi", None)
        assert resp.json() == {"written": 3 * 2**20, "total": 351 * 2**20, "speed": 8192.0, "done": False, "error": None}

    def test_no_download(self):
        import api.iptv as iptv
        c = _client(iptv.router)
        assert c.get("/api/iptv/vod_download/92?ext=avi").status_code == 404
        assert c.get("/api/iptv/vod_download/92?ext=exe").status_code == 400
