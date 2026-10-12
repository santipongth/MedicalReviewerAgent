from __future__ import annotations

import uuid
from typing import Protocol

from arq.connections import ArqRedis
from arq.jobs import Job


def review_job_id(review_id: uuid.UUID | str) -> str:
    return f"review:{review_id}"


class JobQueue(Protocol):
    async def enqueue_review(self, review_id: uuid.UUID) -> bool: ...

    async def abort_review(self, review_id: uuid.UUID) -> bool: ...


class ArqJobQueue:
    def __init__(self, pool: ArqRedis) -> None:
        self.pool = pool

    async def enqueue_review(self, review_id: uuid.UUID) -> bool:
        job = await self.pool.enqueue_job(
            "run_review", str(review_id), _job_id=review_job_id(review_id)
        )
        return job is not None

    async def enqueue_webhook(self, review_id: uuid.UUID) -> bool:
        job = await self.pool.enqueue_job("deliver_webhook", str(review_id), _job_id=f"webhook:{review_id}")
        return job is not None

    async def enqueue_checkpoint_delete(self, review_id: uuid.UUID) -> bool:
        """A deleted review's LangGraph thread is dropped by a worker, which owns the checkpointer (Plan 23a)."""
        job = await self.pool.enqueue_job("delete_checkpoint", str(review_id), _job_id=f"checkpoint-delete:{review_id}")
        return job is not None

    async def abort_review(self, review_id: uuid.UUID) -> bool:
        """Ask arq to abort the job (a running job gets CancelledError). Results are not kept
        (keep_result=0), so confirmation cannot be awaited; the request itself is what counts."""
        try:
            return await Job(review_job_id(review_id), self.pool).abort(timeout=0.5, poll_delay=0.1)
        except TimeoutError:
            return True
