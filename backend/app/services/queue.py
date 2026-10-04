from __future__ import annotations

import uuid
from typing import Protocol

from arq.connections import ArqRedis


def review_job_id(review_id: uuid.UUID | str) -> str:
    return f"review:{review_id}"


class JobQueue(Protocol):
    async def enqueue_review(self, review_id: uuid.UUID) -> bool: ...


class ArqJobQueue:
    def __init__(self, pool: ArqRedis) -> None:
        self.pool = pool

    async def enqueue_review(self, review_id: uuid.UUID) -> bool:
        job = await self.pool.enqueue_job(
            "run_review", str(review_id), _job_id=review_job_id(review_id)
        )
        return job is not None
