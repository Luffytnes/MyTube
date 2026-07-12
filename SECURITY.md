# Security Policy

## Intended use

MyTube is designed for **personal, self-hosted use on a trusted local network**.  
It is **not** designed to be exposed directly to the internet without additional protection.

| Exposure | Recommendation |
|---|---|
| `localhost` only | ✅ Safe |
| Trusted home LAN | ✅ Safe |
| Tailscale / WireGuard private tunnel | ✅ Safe |
| Reverse proxy with strong authentication | ⚠️ Proceed with caution |
| Port 54321 open on the internet | ❌ Do not do this |

## Known limitations

- **No built-in authentication** — anyone who can reach port 54321 can use the application, including VPN configuration and IPTV credential endpoints.
- **SSRF protection** is applied to the HTTP proxy endpoints (`/api/hls-proxy`, `/api/iptv/proxy`, `/api/iptv/icon`) to block requests to private/loopback addresses, but it is not exhaustive.

## Reporting a vulnerability

If you discover a security issue, please **do not open a public GitHub issue**.  
Instead, use [GitHub Private Vulnerability Reporting](https://github.com/Luffytnes/MyTube/security/advisories/new).

I will try to respond within 7 days.
