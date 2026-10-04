from __future__ import annotations

import json

from app.services.fulltext import FullText


class FullTextCache:
    def __init__(self, redis, *, ttl_days: int = 30, miss_ttl_hours: int = 24) -> None:
        self.redis = redis
        self.ttl = ttl_days * 86400
        self.miss_ttl = miss_ttl_hours * 3600

    async def get(self, paper_key: str) -> FullText | None:
        raw = await self.redis.get(f"fulltext:v1:{paper_key}")
        return FullText(**json.loads(raw)) if raw else None

    async def put(self, paper_key: str, ft: FullText) -> None:
        payload = json.dumps({"source": ft.source, "text": ft.text, "url": ft.url}, ensure_ascii=False)
        await self.redis.set(f"fulltext:v1:{paper_key}", payload, ex=self.ttl)

    async def is_miss(self, paper_key: str) -> bool:
        return bool(await self.redis.exists(f"fulltext:miss:v1:{paper_key}"))

    async def mark_miss(self, paper_key: str) -> None:
        await self.redis.set(f"fulltext:miss:v1:{paper_key}", "1", ex=self.miss_ttl)
