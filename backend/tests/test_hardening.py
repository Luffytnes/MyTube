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
