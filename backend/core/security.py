"""SSRF protection, request validation patterns and HTTP security middleware."""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse

# Path parameter patterns — reject anything that is not a plausible YouTube ID
# before it reaches yt-dlp URLs, cache keys or generated manifests.
VIDEO_ID_PATTERN = r"^[A-Za-z0-9_-]{11}$"
CHANNEL_ID_PATTERN = r"^@?[A-Za-z0-9._-]{1,100}$"
PLAYLIST_ID_PATTERN = r"^[A-Za-z0-9_-]{1,100}$"
FORMAT_ID_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"
LANG_PATTERN = r"^[A-Za-z0-9_-]{1,20}$"


def _is_private_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False  # not an IP literal — hostnames are checked via DNS resolution
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    # is_global (unlike is_private) also rejects the shared 100.64.0.0/10 range
    # used by CGNAT and Tailscale; multicast is "global" so check it separately.
    return not addr.is_global or addr.is_multicast


def _dns_resolve(hostname: str) -> list:
    """Resolve hostname to a list of (family, type, proto, canonname, sockaddr) tuples."""
    return socket.getaddrinfo(hostname, None)


def validate_proxy_url(url: str, allowed_schemes: tuple = ("http", "https")) -> str:
    """Raise HTTP 400 if the URL targets a private/internal host. Returns the URL unchanged."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme not in allowed_schemes:
        raise HTTPException(status_code=400, detail=f"Scheme '{parsed.scheme}' not allowed")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Missing hostname")

    # Reject bare IP literals that are private
    try:
        if _is_private_ip(hostname):
            raise HTTPException(status_code=400, detail="Access to internal addresses is not allowed")
    except HTTPException:
        raise
    except Exception:
        pass

    # Resolve hostname and check all returned IPs — fail-closed on DNS error
    try:
        results = _dns_resolve(hostname)
        for res in results:
            ip = res[4][0]
            if _is_private_ip(ip):
                raise HTTPException(status_code=400, detail="Access to internal addresses is not allowed")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="DNS resolution failed")

    return url


async def validate_proxy_url_async(url: str, allowed_schemes: tuple = ("http", "https")) -> str:
    """Async wrapper: runs the blocking DNS resolution in a thread."""
    return await asyncio.to_thread(validate_proxy_url, url, allowed_schemes)


async def ssrf_redirect_hook(response) -> None:
    """httpx async response event hook: block redirects pointing to private/internal addresses.

    Resolves relative Location headers against the request URL before validating,
    so that redirects like `/internal/path` or `//evil.example.com/` cannot bypass
    the SSRF check by omitting the scheme or host.
    """
    if response.is_redirect:
        location = response.headers.get("location", "")
        if location:
            from urllib.parse import urljoin
            absolute = urljoin(str(response.request.url), location)
            await asyncio.to_thread(validate_proxy_url, absolute)


_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Applied to every /api/ response: several endpoints proxy third-party bodies
# with the upstream Content-Type, so a crafted URL could otherwise make the
# browser render attacker-controlled HTML on our origin. Media elements and
# fetch() ignore these headers, so legitimate playback is unaffected.
_API_SECURITY_HEADERS = (
    ("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox"),
    ("x-content-type-options", "nosniff"),
)


def is_cross_site_request(headers: Headers) -> bool:
    """True when a browser sent this request from another site.

    HTTP Basic credentials are replayed by the browser like cookies, so a
    cross-site form POST (multipart uploads, body-less POSTs) would otherwise
    be authenticated. Requests without Origin/Sec-Fetch-Site (curl, scripts)
    are not browser-originated and are let through.
    """
    site = headers.get("sec-fetch-site")
    if site is not None:
        return site == "cross-site"
    origin = headers.get("origin")
    if origin is None:
        return False
    if origin == "null":
        return True
    host = headers.get("x-forwarded-host") or headers.get("host") or ""
    return urlparse(origin).hostname != urlparse(f"//{host}").hostname


class SecurityMiddleware:
    """Pure ASGI middleware (no buffering, safe for streaming responses)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope["method"] in _UNSAFE_METHODS and is_cross_site_request(Headers(scope=scope)):
            response = JSONResponse({"detail": "Cross-site request blocked"}, status_code=403)
            await response(scope, receive, send)
            return

        if not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _API_SECURITY_HEADERS:
                    if name not in headers:
                        headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)
