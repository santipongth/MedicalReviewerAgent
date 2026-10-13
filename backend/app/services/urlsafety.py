from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable

import httpx

Resolver = Callable[[str], Awaitable[list[str]]]


async def _system_resolve(host: str) -> list[str]:
    infos = await asyncio.to_thread(socket.getaddrinfo, host, None)
    return list({info[4][0] for info in infos})


async def is_public_http_url(url: str, resolver: Resolver | None = None) -> bool:
    """True only for http(s) URLs whose host resolves exclusively to public addresses.

    Guards outbound calls to user-supplied URLs (webhook callbacks) against SSRF."""
    try:
        parsed = httpx.URL(url)
    except Exception:  # noqa: BLE001 - an unparsable URL is simply not public
        return False
    if parsed.scheme not in ("http", "https") or not parsed.host:
        return False
    try:
        addresses = await (resolver or _system_resolve)(parsed.host)
    except OSError:
        return False
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)


def is_allowed_host(url: str, domain: str) -> bool:
    """True only for an https URL on `domain` or one of its subdomains, with no user info and the default port.

    Guards outbound calls whose URL comes from a third-party response (ThaiJO's article_url, Plan 24): such a URL
    must not make the server call any other host."""
    try:
        parsed = httpx.URL(url)
        # httpx IDNA-decodes the host lazily, so every access stays inside the try (malformed punycode raises)
        host = (parsed.host or "").lower().removesuffix(".")
        scheme, userinfo, port = parsed.scheme, parsed.userinfo, parsed.port
    except Exception:  # noqa: BLE001 - an unparsable URL is never allowed
        return False
    domain = domain.lower().removesuffix(".")
    if not host or "" in host.split("."):
        return False
    return (scheme == "https" and not userinfo and port in (None, 443)
            and (host == domain or host.endswith(f".{domain}")))
