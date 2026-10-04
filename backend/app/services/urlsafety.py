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
