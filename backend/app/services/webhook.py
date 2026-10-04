"""Signed webhook delivery for keyed reviews.

Body: {"review_id", "status", "result_url"}; header X-Signature: sha256=<hex HMAC-SHA256(body, secret)>,
where secret = SHA-256 hex digest of the caller's API key (the client derives it; we store only that hash).
Only HTTPS URLs whose host resolves to public addresses are called, redirects are never followed."""
from __future__ import annotations

import enum
import hashlib
import hmac
from collections.abc import Awaitable, Callable

import httpx

from app.services.urlsafety import is_public_http_url

UrlCheck = Callable[[str], Awaitable[bool]]


class DeliveryOutcome(enum.StrEnum):
    ok = "ok"
    retry = "retry"  # network error or 5xx/429: worth another attempt
    failed = "failed"  # 3xx/4xx: the receiver rejected it
    blocked = "blocked"  # not https or not a public host


def sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def callback_url_problem(url: str, *, allow_http: bool = False,
                               url_check: UrlCheck = is_public_http_url) -> str | None:
    scheme = httpx.URL(url).scheme
    if scheme != "https" and not (allow_http and scheme == "http"):
        return "callback_url must use https"
    if not await url_check(url):
        return "callback_url must resolve to a public internet address"
    return None


async def deliver(client: httpx.AsyncClient, *, url: str, body: bytes, signature: str,
                  url_check: UrlCheck = is_public_http_url, allow_http: bool = False) -> DeliveryOutcome:
    if await callback_url_problem(url, allow_http=allow_http, url_check=url_check):  # DNS may have changed
        return DeliveryOutcome.blocked
    try:
        resp = await client.post(url, content=body, follow_redirects=False,
                                 headers={"Content-Type": "application/json", "X-Signature": signature,
                                          "User-Agent": "MedicalReviewerAgent-Webhook/1"})
    except httpx.HTTPError:
        return DeliveryOutcome.retry
    if resp.status_code < 300:
        return DeliveryOutcome.ok
    if resp.status_code >= 500 or resp.status_code == 429:
        return DeliveryOutcome.retry
    return DeliveryOutcome.failed
