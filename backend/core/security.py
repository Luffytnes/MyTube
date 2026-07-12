"""SSRF protection — validate proxy URLs before fetching."""
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

# Private, loopback, link-local, and multicast ranges to block
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),    # loopback
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("10.0.0.0/8"),     # private
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"), # link-local
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("224.0.0.0/4"),    # multicast
    ipaddress.ip_network("fc00::/7"),       # unique local
    ipaddress.ip_network("0.0.0.0/8"),
]


def _is_private_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in net for net in _BLOCKED_NETWORKS)
    except ValueError:
        return True


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

    # Resolve hostname and check all returned IPs
    try:
        results = socket.getaddrinfo(hostname, None)
        for res in results:
            ip = res[4][0]
            if _is_private_ip(ip):
                raise HTTPException(status_code=400, detail="Access to internal addresses is not allowed")
    except HTTPException:
        raise
    except Exception:
        # DNS failure — let the downstream request fail naturally
        pass

    return url
