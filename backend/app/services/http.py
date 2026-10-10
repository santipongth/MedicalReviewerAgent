from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

RETRY_STATUSES = {429, 500, 502, 503, 504}
DEFAULT_MIN_INTERVAL = {"www.ebi.ac.uk": 0.2}


class HttpClient:
    """Shared outbound client: per-host minimum spacing + retry with exponential backoff."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        user_agent: str = "MedicalReviewerAgent/0.1 (+literature review)",
        min_interval: dict[str, float] | None = None,
        retries: int = 3,
        backoff: float = 0.5,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ) -> None:
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": user_agent},
            follow_redirects=True,
            transport=transport,
        )
        self._min_interval = dict(min_interval or {})
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self.retries = retries
        self.backoff = backoff
        self._sleep = sleep

    async def _throttle(self, host: str) -> None:
        interval = self._min_interval.get(host)
        if not interval:
            return
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = self._last.get(host, 0.0) + interval - time.monotonic()
            if wait > 0:
                await self._sleep(wait)
            self._last[host] = time.monotonic()

    async def get(
        self, url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None,
        timeout: float | None = None, retries: int | None = None,
    ) -> httpx.Response:
        host = httpx.URL(url).host
        retries = self.retries if retries is None else retries
        for attempt in range(retries + 1):
            await self._throttle(host)
            try:
                kwargs: dict[str, Any] = {"params": params, "headers": headers}
                if timeout is not None:
                    kwargs["timeout"] = timeout
                resp = await self._client.get(url, **kwargs)
            except httpx.TransportError:
                if attempt == retries:
                    raise
            else:
                if resp.status_code not in RETRY_STATUSES or attempt == retries:
                    return resp
            await self._sleep(self.backoff * 2**attempt)
        raise AssertionError("unreachable")

    async def aclose(self) -> None:
        await self._client.aclose()
