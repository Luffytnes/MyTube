"""Regression tests for the October 2026 audit: CSRF guard, API security headers,
SSRF ranges, path ID validation, download filenames, proxy content types,
ffmpeg capability detection and VPN upload limits."""
import os
import socket as _socket
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.security import SecurityMiddleware, _is_private_ip


def _dns_public(host, port=None, *a, **kw):
    return [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]


# ---------------------------------------------------------------------------
# SSRF: ranges that is_private alone does not cover
# ---------------------------------------------------------------------------

class TestExtendedPrivateRanges:
    def test_cgnat_tailscale_range_blocked(self):
        assert _is_private_ip("100.64.0.1") is True
        assert _is_private_ip("100.100.100.100") is True

    def test_ipv4_mapped_private_blocked(self):
        assert _is_private_ip("::ffff:10.0.0.1") is True
        assert _is_private_ip("::ffff:127.0.0.1") is True

    def test_ipv4_mapped_public_allowed(self):
        assert _is_private_ip("::ffff:8.8.8.8") is False

    def test_benchmark_range_blocked(self):
        assert _is_private_ip("198.18.0.1") is True


# ---------------------------------------------------------------------------
# SecurityMiddleware: CSRF guard + headers on /api/
# ---------------------------------------------------------------------------

def _middleware_client() -> TestClient:
    app = FastAPI()

    @app.post("/api/thing")
    async def write_thing():
        return {"ok": True}

    @app.get("/api/thing")
    async def read_thing():
        return {"ok": True}

    @app.get("/page")
    async def page():
        return {"ok": True}

    app.add_middleware(SecurityMiddleware)
    return TestClient(app)


class TestCsrfGuard:
    def test_cross_site_post_blocked(self):
        resp = _middleware_client().post("/api/thing", headers={"Sec-Fetch-Site": "cross-site"})
        assert resp.status_code == 403

    def test_same_origin_post_allowed(self):
        resp = _middleware_client().post("/api/thing", headers={"Sec-Fetch-Site": "same-origin"})
        assert resp.status_code == 200

    def test_same_site_post_allowed(self):
        # Dev setup: Next.js on :3000 calling the API on :8000
        resp = _middleware_client().post("/api/thing", headers={"Sec-Fetch-Site": "same-site"})
        assert resp.status_code == 200

    def test_non_browser_client_allowed(self):
        assert _middleware_client().post("/api/thing").status_code == 200

    def test_foreign_origin_without_fetch_metadata_blocked(self):
        resp = _middleware_client().post("/api/thing", headers={"Origin": "https://evil.example"})
        assert resp.status_code == 403

    def test_null_origin_blocked(self):
        resp = _middleware_client().post("/api/thing", headers={"Origin": "null"})
        assert resp.status_code == 403

    def test_matching_origin_allowed_regardless_of_port(self):
        resp = _middleware_client().post(
            "/api/thing",
            headers={"Origin": "http://mytube.lan:54321", "Host": "mytube.lan"},
        )
        assert resp.status_code == 200

    def test_cross_site_get_not_blocked(self):
        resp = _middleware_client().get("/api/thing", headers={"Sec-Fetch-Site": "cross-site"})
        assert resp.status_code == 200


class TestApiSecurityHeaders:
    def test_api_responses_are_sandboxed(self):
        resp = _middleware_client().get("/api/thing")
        assert "sandbox" in resp.headers["content-security-policy"]
        assert resp.headers["x-content-type-options"] == "nosniff"

    def test_non_api_routes_untouched(self):
        resp = _middleware_client().get("/page")
        assert "content-security-policy" not in resp.headers


# ---------------------------------------------------------------------------
# Path parameter validation on YouTube routes
# ---------------------------------------------------------------------------

def _youtube_client() -> TestClient:
    from api.youtube import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestYoutubeIdValidation:
    @pytest.mark.parametrize("path", [
        "/api/video/short",
        "/api/video/abc$%25def123",
        "/api/subtitles/dQw4w9WgXcQ/en%0Aevil",
        "/api/hls/dQw4w9WgXcQ/137%0A/stream.m3u8",
        "/api/channel/UC%3Cscript%3E",
        "/api/stream/dQw4w9WgXcQ?itag=1%0A2",
    ])
    def test_malformed_ids_rejected(self, path):
        assert _youtube_client().get(path).status_code == 422

    def test_debug_endpoint_removed(self):
        resp = _youtube_client().get("/api/debug/channel_thumbnails/UCuAXFkgsw1L7xaCfnd5JJOw")
        assert resp.status_code == 404


class TestAttachmentDisposition:
    def test_non_latin_title_is_header_safe(self):
        from api.youtube import _attachment_disposition
        value = _attachment_disposition("日本語のタイトル", "mp4")
        value.encode("latin-1")  # Starlette encodes headers as latin-1
        assert 'filename="video.mp4"' in value
        assert "filename*=UTF-8''" in value

    def test_ascii_title_kept(self):
        from api.youtube import _attachment_disposition
        value = _attachment_disposition("Never-Gonna-Give-You-Up", "mp4")
        assert 'filename="Never-Gonna-Give-You-Up.mp4"' in value


# ---------------------------------------------------------------------------
# Image proxies only relay images
# ---------------------------------------------------------------------------

def _fake_httpx_client(content_type: str, body: bytes = b"<script>alert(1)</script>"):
    response = MagicMock(status_code=200, content=body, headers={"content-type": content_type})
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


class TestImageProxyContentType:
    def _client(self):
        from api.podcasts import router
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_html_upstream_replaced_by_gif(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public), \
             patch("api.podcasts.httpx_client", _fake_httpx_client("text/html")):
            resp = self._client().get("/api/podcasts/image/proxy", params={"url": "https://evil.example/x"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/gif"
        assert b"script" not in resp.content

    def test_real_image_relayed(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public), \
             patch("api.podcasts.httpx_client", _fake_httpx_client("image/png", b"\x89PNG")):
            resp = self._client().get("/api/podcasts/image/proxy", params={"url": "https://cdn.example/a.png"})
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"\x89PNG"


# ---------------------------------------------------------------------------
# ffmpeg HTTP chunk options are only used when the binary supports them
# ---------------------------------------------------------------------------

class TestFfmpegChunkArgs:
    def test_supported(self):
        from core.config import _http_chunk_args
        help_text = "  -request_size      <int64>\n  -initial_request_size <int64>\n"
        assert _http_chunk_args(help_text) == ["-request_size", "1048576", "-initial_request_size", "1048576"]

    def test_unsupported_ffmpeg_7(self):
        from core.config import _http_chunk_args
        assert _http_chunk_args("  -seekable <int>\n  -chunked_post <boolean>\n") == []

    def test_partial_support_is_ignored(self):
        from core.config import _http_chunk_args
        assert _http_chunk_args("  -request_size      <int64>\n") == []


# ---------------------------------------------------------------------------
# VPN upload size limit
# ---------------------------------------------------------------------------

class TestVpnUploadLimit:
    def test_oversized_config_rejected(self):
        from api.vpn import MAX_CONF_BYTES, router
        app = FastAPI()
        app.include_router(router)
        payload = b"[Interface]\n" + b"#" * (MAX_CONF_BYTES + 10)
        resp = TestClient(app).post("/api/vpn/upload", files={"file": ("big.conf", payload)})
        assert resp.status_code == 413


# ---------------------------------------------------------------------------
# HLS: keyframe lead announced via EXT-X-START, fMP4 segment names
# ---------------------------------------------------------------------------

class TestHlsSessionLead:
    def _run(self, session):
        import asyncio
        from services.ffmpeg import hls_session_lead
        return asyncio.run(hls_session_lead(session))

    def test_no_seek_has_no_lead(self):
        assert self._run({"start": 0, "keyframe_task": None}) == 0.0

    def test_lead_is_gap_to_previous_keyframe(self):
        from services.ffmpeg import hls_session_lead
        import asyncio

        async def scenario():
            task = asyncio.ensure_future(asyncio.sleep(0, result=101.92))
            return await hls_session_lead({"start": 106, "keyframe_task": task})
        assert abs(asyncio.run(scenario()) - 4.08) < 1e-6

    def test_failed_probe_means_no_lead(self):
        import asyncio
        from services.ffmpeg import hls_session_lead

        async def scenario():
            task = asyncio.ensure_future(asyncio.sleep(0, result=None))
            return await hls_session_lead({"start": 106, "keyframe_task": task})
        assert asyncio.run(scenario()) == 0.0

    def test_implausible_gap_ignored(self):
        import asyncio
        from services.ffmpeg import hls_session_lead

        async def scenario():
            task = asyncio.ensure_future(asyncio.sleep(0, result=10.0))
            return await hls_session_lead({"start": 106, "keyframe_task": task})
        assert asyncio.run(scenario()) == 0.0


class TestHlsSegmentNames:
    @pytest.mark.parametrize("name", ["seg00001.m4s", "seg00001.ts", "init.mp4"])
    def test_valid_names_reach_session_lookup(self, name):
        resp = _youtube_client().get(f"/api/hls/dQw4w9WgXcQ/137/0/{name}")
        assert resp.status_code == 404  # passed validation, no such session

    @pytest.mark.parametrize("name", ["stream.m3u8", "init.mp4.bak", "..%2Fsecret", "seg1.mp4"])
    def test_other_names_rejected(self, name):
        resp = _youtube_client().get(f"/api/hls/dQw4w9WgXcQ/137/0/{name}")
        assert resp.status_code in (400, 404)
        if name != "..%2Fsecret":
            assert resp.status_code == 400


class TestNewsEntities:
    def test_double_encoded_entities_are_decoded(self):
        from api.news import _parse_rss
        xml = (
            "<rss><channel><item>"
            "<title>Tom &amp;amp; Jerry</title>"
            "<link>https://news.example/a</link>"
            "<description>&lt;a href=&quot;x&quot;&gt;Story&lt;/a&gt;&amp;nbsp;&amp;nbsp;Source</description>"
            "<source url=\"https://news.example\">Example</source>"
            "</item></channel></rss>"
        )
        article = _parse_rss(xml)[0]
        assert "&nbsp;" not in article["description"]
        assert article["description"] == "Story Source"
        assert article["title"] == "Tom & Jerry"


class TestSharedExtraction:
    def test_prefetch_and_session_share_one_extraction(self):
        import asyncio
        import services.ffmpeg as ff
        from core.cache import stream_url_cache_invalidate

        calls = []
        info = {"formats": [
            {"format_id": "137", "url": "https://v/137", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 1080},
            {"format_id": "140", "url": "https://a/140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "abr": 128},
        ]}

        async def fake_extract(url, opts):
            calls.append(url)
            await asyncio.sleep(0.05)
            return info

        async def scenario():
            stream_url_cache_invalidate("aaaaaaaaaaa")
            with patch.object(ff, "ydl_extract", fake_extract):
                ff.prefetch_stream_urls("aaaaaaaaaaa")             # fired on hover
                first = await ff._get_video_and_audio_urls("aaaaaaaaaaa", "137")  # player, mid-extraction
                second = await ff._get_video_and_audio_urls("aaaaaaaaaaa", "137")  # served from cache
            return first, second

        first, second = asyncio.run(scenario())
        assert first == ("https://v/137", "https://a/140")
        assert second == first
        assert len(calls) == 1

    def test_prefetch_endpoint_accepts_valid_ids_only(self):
        with patch("api.youtube.prefetch_stream_urls") as started:
            client = _youtube_client()
            assert client.post("/api/prefetch/bad").status_code == 422
            assert client.post("/api/prefetch/zzzzzzzzzz1").status_code == 202
        started.assert_called_once_with("zzzzzzzzzz1")


class TestDirectFormats:
    FORMATS = [
        {"format_id": "312", "protocol": "m3u8_native", "url": "https://hls/312.m3u8", "vcodec": "avc1.64002A", "acodec": "none", "width": 1920, "height": 1080, "ext": "mp4"},
        {"format_id": "299", "protocol": "https", "url": "https://v/299", "vcodec": "avc1.64002a", "acodec": "none", "width": 1920, "height": 1080, "ext": "mp4", "tbr": 4000},
        {"format_id": "399", "protocol": "https", "url": "https://v/399", "vcodec": "av01.0.08M.08", "acodec": "none", "width": 1920, "height": 1080, "ext": "mp4", "tbr": 2000},
        {"format_id": "140", "protocol": "https", "url": "https://a/140", "vcodec": "none", "acodec": "mp4a.40.2", "ext": "m4a", "abr": 129},
        {"format_id": "233", "protocol": "m3u8_native", "url": "https://hls/233.m3u8", "vcodec": "none", "acodec": "mp4a.40.5", "ext": "mp4", "abr": 200},
    ]

    def test_hls_variants_are_not_direct(self):
        from services.ffmpeg import is_direct_format
        assert not is_direct_format(self.FORMATS[0])
        assert is_direct_format(self.FORMATS[1])

    def test_progressive_pick_prefers_direct_h264(self):
        from api.youtube import _pick_progressive_video
        assert _pick_progressive_video(self.FORMATS)["format_id"] == "299"

    def test_vertical_short_is_capped_on_its_short_side(self):
        from api.youtube import _pick_progressive_video
        vertical = [dict(f, width=f.get("height"), height=f.get("width")) for f in self.FORMATS if f.get("width")]
        assert _pick_progressive_video(vertical)["format_id"] == "299"

    def test_best_audio_ignores_hls(self):
        from services.ffmpeg import _best_m4a_audio
        assert _best_m4a_audio(self.FORMATS)["format_id"] == "140"


class TestChunkedMediaProxy:
    """The browser gets one continuous response while upstream requests stay
    bounded (googlevideo throttles open-ended ranges)."""

    BLOB = bytes(range(256)) * (5 * 1024 * 1024 // 256 + 123)  # ~5 MB, not chunk-aligned

    def _client(self, seen_ranges):
        import re as _re
        import httpx as _httpx

        def handler(request):
            seen_ranges.append(request.headers.get("range"))
            m = _re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers.get("range", ""))
            lo, hi = int(m.group(1)), min(int(m.group(2)), len(self.BLOB) - 1)
            return _httpx.Response(206, content=self.BLOB[lo:hi + 1],
                                   headers={"content-range": f"bytes {lo}-{hi}/{len(self.BLOB)}"})

        return lambda **kw: _httpx.AsyncClient(transport=_httpx.MockTransport(handler))

    def _get(self, headers=None):
        seen = []
        with patch("api.youtube.httpx_client", self._client(seen)), \
             patch("api.youtube._resolve_stream_url", AsyncMock(return_value=("https://gv/x", "mp4"))):
            resp = _youtube_client().get("/api/stream/dQw4w9WgXcQ?itag=137", headers=headers or {})
        return resp, seen

    def test_full_file_is_reassembled_from_bounded_chunks(self):
        from api.youtube import _MEDIA_CHUNK
        resp, seen = self._get()
        assert resp.status_code == 200
        assert resp.content == self.BLOB
        assert int(resp.headers["content-length"]) == len(self.BLOB)
        assert len(seen) == -(-len(self.BLOB) // _MEDIA_CHUNK)
        for r in seen:
            lo, hi = map(int, r.removeprefix("bytes=").split("-"))
            assert hi - lo + 1 <= _MEDIA_CHUNK

    def test_open_range_from_offset(self):
        resp, _ = self._get({"Range": "bytes=3000000-"})
        assert resp.status_code == 206
        assert resp.content == self.BLOB[3000000:]
        assert resp.headers["content-range"] == f"bytes 3000000-{len(self.BLOB) - 1}/{len(self.BLOB)}"

    def test_small_range_is_a_single_request(self):
        resp, seen = self._get({"Range": "bytes=100-199"})
        assert resp.status_code == 206
        assert resp.content == self.BLOB[100:200]
        assert seen == ["bytes=100-199"]


class TestOrphanCleanup:
    def test_only_mytube_session_leftovers_are_removed(self, tmp_path):
        import services.ffmpeg as ff
        (tmp_path / "mytube_hls_abc").mkdir()
        (tmp_path / "mytube_hls_abc" / "seg00001.m4s").write_bytes(b"x")
        (tmp_path / "mytube_iptv_hls_def").mkdir()
        (tmp_path / "mytube_4243.mkv").write_bytes(b"x")
        (tmp_path / "mytube_proxychains.conf").write_text("keep")
        (tmp_path / "other_app_cache").mkdir()
        with patch.object(ff.tempfile, "gettempdir", return_value=str(tmp_path)):
            assert ff.cleanup_orphan_media_files() == 3
        assert sorted(p.name for p in tmp_path.iterdir()) == ["mytube_proxychains.conf", "other_app_cache"]


class TestFreeXtreamConnection:
    def _scenario(self, max_connections):
        import asyncio
        import api.iptv as iptv
        import services.ffmpeg as ff
        from core import config

        async def run(tmp):
            hang = asyncio.Event()
            entries = {}
            for key in ("1.mkv", "2.mkv"):
                path = os.path.join(tmp, f"mytube_{key}")
                open(path, "wb").close()
                entries[key] = {"path": path, "task": asyncio.ensure_future(hang.wait()), "done": False, "written": 1}
            ff._vod_dl_cache.clear()
            ff._vod_dl_cache.update(entries)
            iptv._max_connections.update(value=max_connections, at=time.monotonic())
            with patch.dict(config._xtream_cfg, {"server": "http://x", "username": "u", "password": "p"}):
                await iptv.free_xtream_connection(keep_key="2.mkv")
            await asyncio.sleep(0)
            result = (sorted(ff._vod_dl_cache), entries["1.mkv"]["task"].cancelled(), os.path.exists(entries["1.mkv"]["path"]))
            for e in entries.values():
                e["task"].cancel()
            ff._vod_dl_cache.clear()
            iptv._max_connections.update(value=None, at=0.0)
            return result

        import tempfile as _tf
        import time
        with _tf.TemporaryDirectory() as tmp:
            return asyncio.run(run(tmp))

    def test_single_connection_account_stops_other_downloads(self):
        kept, cancelled, file_left = self._scenario(1)
        assert kept == ["2.mkv"]
        assert cancelled and not file_left

    def test_multi_connection_account_is_left_alone(self):
        kept, cancelled, file_left = self._scenario(2)
        assert kept == ["1.mkv", "2.mkv"]
        assert not cancelled and file_left


class TestAudioLanguages:
    FORMATS = [
        # Same bitrate everywhere, like YouTube's AI dubs: only language_preference marks the original
        {"format_id": "140-0", "protocol": "https", "url": "https://a/vi", "vcodec": "none", "acodec": "mp4a", "ext": "m4a", "abr": 129.5, "language": "vi", "language_preference": -1, "format_note": "Vietnamese, medium"},
        {"format_id": "140-9", "protocol": "https", "url": "https://a/fr", "vcodec": "none", "acodec": "mp4a", "ext": "m4a", "abr": 129.5, "language": "fr", "language_preference": -1, "format_note": "French, medium"},
        {"format_id": "140-23", "protocol": "https", "url": "https://a/en", "vcodec": "none", "acodec": "mp4a", "ext": "m4a", "abr": 129.5, "language": "en-US", "language_preference": 10, "format_note": "English (US) original (default), medium"},
        {"format_id": "139-9", "protocol": "https", "url": "https://a/fr-low", "vcodec": "none", "acodec": "mp4a", "ext": "m4a", "abr": 48.8, "language": "fr", "language_preference": -1, "format_note": "French, low"},
        {"format_id": "251-9", "protocol": "https", "url": "https://a/fr-opus", "vcodec": "none", "acodec": "opus", "ext": "webm", "abr": 140, "language": "fr", "language_preference": -1, "format_note": "French, medium"},
    ]

    def test_default_is_the_original_track(self):
        from services.ffmpeg import _best_m4a_audio
        assert _best_m4a_audio(self.FORMATS)["format_id"] == "140-23"

    def test_requested_language(self):
        from services.ffmpeg import _best_m4a_audio
        assert _best_m4a_audio(self.FORMATS, "fr")["format_id"] == "140-9"

    def test_unknown_language_falls_back_to_original(self):
        from services.ffmpeg import _best_m4a_audio
        assert _best_m4a_audio(self.FORMATS, "ko")["format_id"] == "140-23"

    def test_track_list(self):
        from services.ffmpeg import list_audio_tracks
        assert list_audio_tracks(self.FORMATS) == [
            {"lang": "en-US", "label": "English (US)", "original": True},
            {"lang": "fr", "label": "French", "original": False},
            {"lang": "vi", "label": "Vietnamese", "original": False},
        ]

    def test_audio_language_is_part_of_the_hls_session(self):
        from services.ffmpeg import hls_session_key
        assert hls_session_key("dQw4w9WgXcQ", "137", 0) != hls_session_key("dQw4w9WgXcQ", "137", 0, "fr")

    def test_invalid_audio_parameter_rejected(self):
        resp = _youtube_client().get("/api/hls/dQw4w9WgXcQ/137/stream.m3u8?audio=fr%0A")
        assert resp.status_code == 422
