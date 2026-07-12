"""SSRF protection — validate proxy URLs before fetching."""
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException


def _is_private_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        )
    except ValueError:
        return False  # not an IP literal — hostnames are checked via DNS resolution


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


def ssrf_redirect_hook(response) -> None:
    """httpx response event hook: block redirects pointing to private/internal addresses."""
    if response.is_redirect:
        location = response.headers.get("location", "")
        if location:
            validate_proxy_url(location)
