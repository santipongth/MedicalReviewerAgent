"""Cloudflare Turnstile check for anonymous submissions from the web app. Off unless TURNSTILE_SECRET is set;
API keys and MCP clients never need it."""
from __future__ import annotations

import httpx

SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class TurnstileUnavailable(Exception):
    pass


async def verify_turnstile(secret: str, token: str | None, ip: str, *, timeout: float = 5.0) -> bool:
    """True when Cloudflare accepts the token. A missing token is rejected without a network call; an unreachable
    or broken siteverify raises TurnstileUnavailable (never a silent pass)."""
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(SITEVERIFY, data={"secret": secret, "response": token, "remoteip": ip})
            resp.raise_for_status()
            return bool(resp.json().get("success"))
    except (httpx.HTTPError, ValueError) as exc:
        raise TurnstileUnavailable(f"{type(exc).__name__}") from exc
