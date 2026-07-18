"""Tests for SSRF protection (core/security.py), conf name sanitization, and TMDB key endpoint."""
import asyncio
import socket as _socket
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException
from core.security import validate_proxy_url, _is_private_ip


# ---------------------------------------------------------------------------
# Helpers for DNS mocking
# ---------------------------------------------------------------------------

def _dns_public(host, port=None, *a, **kw):
    """Mock DNS: always returns a public IP."""
    return [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]


def _dns_private(host, port=None, *a, **kw):
    """Mock DNS: always returns a private IP."""
    return [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]


def _dns_fail(host, port=None, *a, **kw):
    """Mock DNS: always raises an exception."""
    raise OSError("Name or service not known")


# ---------------------------------------------------------------------------
# _is_private_ip
# ---------------------------------------------------------------------------

class TestIsPrivateIp:
    def test_loopback_ipv4(self):
        assert _is_private_ip("127.0.0.1") is True

    def test_loopback_ipv4_other(self):
        assert _is_private_ip("127.255.255.255") is True

    def test_loopback_ipv6(self):
        assert _is_private_ip("::1") is True

    def test_private_10(self):
        assert _is_private_ip("10.0.0.1") is True

    def test_private_172(self):
        assert _is_private_ip("172.16.0.1") is True
        assert _is_private_ip("172.31.255.255") is True

    def test_private_192_168(self):
        assert _is_private_ip("192.168.1.1") is True

    def test_link_local(self):
        assert _is_private_ip("169.254.1.1") is True

    def test_ipv6_link_local(self):
        assert _is_private_ip("fe80::1") is True

    def test_multicast(self):
        assert _is_private_ip("224.0.0.1") is True

    def test_all_zeros(self):
        assert _is_private_ip("0.0.0.0") is True

    def test_public_ipv4(self):
        assert _is_private_ip("1.1.1.1") is False
        assert _is_private_ip("8.8.8.8") is False
        assert _is_private_ip("93.184.216.34") is False

    def test_public_ipv6(self):
        assert _is_private_ip("2606:4700:4700::1111") is False

    def test_invalid_ip(self):
        # Non-IP strings are not IP literals — DNS resolution handles them separately
        assert _is_private_ip("not-an-ip") is False


# ---------------------------------------------------------------------------
# validate_proxy_url — blocked cases
# ---------------------------------------------------------------------------

class TestValidateProxyUrlBlocked:
    def _assert_blocked(self, url: str):
        with pytest.raises(HTTPException) as exc_info:
            validate_proxy_url(url)
        assert exc_info.value.status_code == 400

    def test_loopback_ip(self):
        self._assert_blocked("http://127.0.0.1/etc/passwd")

    def test_localhost(self):
        with patch("core.security._dns_resolve", side_effect=_dns_private):
            self._assert_blocked("http://localhost/secret")

    def test_private_10(self):
        self._assert_blocked("http://10.0.0.1/admin")

    def test_private_192_168(self):
        self._assert_blocked("http://192.168.1.1/router")

    def test_link_local(self):
        self._assert_blocked("http://169.254.169.254/latest/meta-data/")

    def test_file_scheme(self):
        self._assert_blocked("file:///etc/passwd")

    def test_ftp_scheme(self):
        self._assert_blocked("ftp://example.com/file")

    def test_no_scheme(self):
        self._assert_blocked("//evil.com/path")

    def test_no_hostname(self):
        self._assert_blocked("http:///path")

    def test_ipv6_loopback(self):
        self._assert_blocked("http://[::1]/secret")

    def test_ipv6_private(self):
        self._assert_blocked("http://[fc00::1]/secret")

    def test_dns_fail_closed(self):
        """DNS failures must block the request (fail-closed)."""
        with patch("core.security._dns_resolve", side_effect=_dns_fail):
            self._assert_blocked("http://unresolvable.internal/secret")

    def test_dns_resolves_to_private(self):
        """A public-looking hostname that DNS resolves to a private IP must be blocked."""
        with patch("core.security._dns_resolve", side_effect=_dns_private):
            self._assert_blocked("http://evil-redirect.example.com/secret")


# ---------------------------------------------------------------------------
# validate_proxy_url — allowed cases
# ---------------------------------------------------------------------------

class TestValidateProxyUrlAllowed:
    def test_public_http(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            result = validate_proxy_url("http://example.com/file.m3u8")
        assert result == "http://example.com/file.m3u8"

    def test_public_https(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            result = validate_proxy_url("https://cdn.example.com/segment.ts")
        assert result == "https://cdn.example.com/segment.ts"

    def test_youtube_url(self):
        url = "https://r1---sn-test.googlevideo.com/videoplayback?itag=137"
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            result = validate_proxy_url(url)
        assert result == url

    def test_url_with_port(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            result = validate_proxy_url("http://example.com:8080/stream.m3u8")
        assert result == "http://example.com:8080/stream.m3u8"

    def test_custom_allowed_schemes(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            result = validate_proxy_url("https://example.com/", allowed_schemes=("https",))
        assert result == "https://example.com/"

    def test_custom_scheme_rejected(self):
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            with pytest.raises(HTTPException) as exc_info:
                validate_proxy_url("http://example.com/", allowed_schemes=("https",))
        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# ssrf_redirect_hook — relative URL resolution (B1)
# ---------------------------------------------------------------------------

class TestSsrfRedirectHook:
    """Verify that relative Location headers are resolved before SSRF validation."""

    def _make_response(self, location: str, request_url: str = "https://cdn.example.com/stream"):
        """Create a minimal httpx-like response mock."""
        response = MagicMock()
        response.is_redirect = True
        response.headers = {"location": location}
        request = MagicMock()
        request.url = request_url
        response.request = request
        return response

    def test_absolute_url_private_blocked(self):
        from core.security import ssrf_redirect_hook
        response = self._make_response("http://192.168.1.1/evil")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ssrf_redirect_hook(response))
        assert exc.value.status_code == 400

    def test_relative_path_resolves_and_blocks_private(self):
        """A relative redirect like '/admin' on a private-IP origin must be blocked."""
        from core.security import ssrf_redirect_hook
        response = self._make_response("/admin", request_url="http://10.0.0.1/start")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ssrf_redirect_hook(response))
        assert exc.value.status_code == 400

    def test_protocol_relative_url_blocked(self):
        """Protocol-relative redirect '//127.0.0.1/' must be blocked."""
        from core.security import ssrf_redirect_hook
        response = self._make_response("//127.0.0.1/secret")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ssrf_redirect_hook(response))
        assert exc.value.status_code == 400

    def test_relative_redirect_to_public_host_allowed(self):
        """Relative redirect on a public origin resolves to a public URL — allowed."""
        from core.security import ssrf_redirect_hook
        with patch("core.security._dns_resolve", side_effect=_dns_public):
            response = self._make_response(
                "/new-path",
                request_url="https://cdn.example.com/old-path",
            )
            asyncio.run(ssrf_redirect_hook(response))  # must not raise

    def test_non_redirect_is_noop(self):
        """Non-redirect responses are ignored."""
        from core.security import ssrf_redirect_hook
        response = MagicMock()
        response.is_redirect = False
        asyncio.run(ssrf_redirect_hook(response))  # must not raise

    def test_empty_location_is_noop(self):
        """Empty Location header is silently skipped."""
        from core.security import ssrf_redirect_hook
        response = self._make_response("")
        asyncio.run(ssrf_redirect_hook(response))  # must not raise


# ---------------------------------------------------------------------------
# _safe_conf_name — path traversal and sanitization
# ---------------------------------------------------------------------------

class TestSafeConfName:
    @pytest.fixture(autouse=True)
    def _import(self):
        from api.vpn import _safe_conf_name
        self.fn = _safe_conf_name

    def test_path_traversal_stripped(self):
        assert self.fn("../../etc/passwd") == "passwd.conf"

    def test_special_chars_replaced(self):
        assert self.fn("my vpn!.conf") == "my_vpn_.conf"

    def test_empty_string_returns_default(self):
        assert self.fn("") == "vpn.conf"

    def test_none_returns_default(self):
        assert self.fn(None) == "vpn.conf"  # type: ignore[arg-type]

    def test_no_conf_extension_appended(self):
        assert self.fn("myvpn") == "myvpn.conf"

    def test_valid_name_unchanged(self):
        assert self.fn("my-vpn.conf") == "my-vpn.conf"


# ---------------------------------------------------------------------------
# GET /api/tmdb/key — never exposes the raw key
# ---------------------------------------------------------------------------

class TestTmdbKeyEndpoint:
    @pytest.fixture(autouse=True)
    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.tmdb import router
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_response_has_configured_bool(self):
        response = self.client.get("/api/tmdb/key")
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        assert isinstance(data["configured"], bool)

    def test_raw_key_never_in_response(self):
        import services.tmdb as tmdb_svc
        sentinel = "SENTINEL_SECRET_ABC123"
        original = tmdb_svc._TMDB_API_KEY
        try:
            tmdb_svc._TMDB_API_KEY = sentinel
            response = self.client.get("/api/tmdb/key")
            assert sentinel not in response.text
        finally:
            tmdb_svc._TMDB_API_KEY = original

    def test_configured_true_when_key_set(self):
        import services.tmdb as tmdb_svc
        original = tmdb_svc._TMDB_API_KEY
        try:
            tmdb_svc._TMDB_API_KEY = "any_key_value"
            response = self.client.get("/api/tmdb/key")
            assert response.json()["configured"] is True
        finally:
            tmdb_svc._TMDB_API_KEY = original

    def test_configured_false_when_no_key(self):
        import services.tmdb as tmdb_svc
        original = tmdb_svc._TMDB_API_KEY
        try:
            tmdb_svc._TMDB_API_KEY = ""
            response = self.client.get("/api/tmdb/key")
            assert response.json()["configured"] is False
        finally:
            tmdb_svc._TMDB_API_KEY = original
