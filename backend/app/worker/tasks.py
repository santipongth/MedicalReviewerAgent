from __future__ import annotations

import uuid

from app.worker.runner import ReviewRunner


def _runner(ctx: dict) -> ReviewRunner:
    return ReviewRunner(ctx["session_factory"], ctx["event_sink"], ctx["graph"])


async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review (the runner resumes when a checkpoint exists)."""
    status = await _runner(ctx).run(uuid.UUID(review_id))
    return {"review_id": review_id, "status": status}


async def resume_review(ctx: dict, review_id: str) -> dict:
    """Kept for jobs enqueued under the old name; identical to run_review."""
    return await run_review(ctx, review_id)
