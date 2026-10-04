from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.services.queue import review_job_id

log = get_logger(__name__)


async def sweep_stale(ctx: dict) -> int:
    """arq cron: re-enqueue reviews stuck in queued/running (lost enqueue, dead worker).

    Uses the review's fixed job id, so a job that is still waiting or running is not
    duplicated (arq returns None). The runner resumes from the checkpoint.
    """
    settings = ctx["settings"]
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.stale_running_minutes)
    async with ctx["session_factory"]() as session:
        stale = await ReviewRepository(session).list_stale(older_than=cutoff)
    requeued = 0
    for review in stale:
        job = await ctx["redis"].enqueue_job(
            "run_review", str(review.id), _job_id=review_job_id(review.id)
        )
        requeued += job is not None
        log.info("sweep_stale_review", review_id=str(review.id), enqueued=job is not None)
    return requeued
