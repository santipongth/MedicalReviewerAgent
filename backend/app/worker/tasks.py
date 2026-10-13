from __future__ import annotations

import uuid

import orjson
from arq import Retry

from app.config import get_settings
from app.db.models import ApiKey
from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.services.pipeline_version import pipeline_version
from app.services.sources import effective_sources
from app.services.urlsafety import is_public_http_url
from app.services.webhook import DeliveryOutcome, deliver, sign
from app.worker.llm_reload import refresh_llms
from app.worker.runner import ReviewRunner
from app.worker.runtime_reload import refresh_runtime

log = get_logger(__name__)


def run_version(ctx: dict) -> str | None:
    """The pipeline version of what this worker runs now (Plan 30): its loaded LLM config, glossary and sources, the
    labels the API reads at admission. None outside a reloading worker (tests, the harness job): the key is kept."""
    if "llm_lock" not in ctx:
        return None
    base = ctx.get("base_settings") or ctx["settings"]
    sources = ctx.get("sources") or effective_sources(base, {})
    return pipeline_version(base.prompt_version, llm=ctx.get("llm_version") or "file",
                            glossary=ctx.get("glossary_version") or "file", sources=sources, base=base)


def _runner(ctx: dict) -> ReviewRunner:
    queue = ctx.get("queue")
    notify = queue.enqueue_webhook if queue is not None else None
    # The graph and the version are read together, with no await between them: the version names that graph.
    return ReviewRunner(ctx["session_factory"], ctx["event_sink"], ctx["graph"], notify=notify,
                        capacity=ctx.get("capacity"), settings=ctx.get("settings") or get_settings(),
                        pipeline_version=run_version(ctx))


async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review (the runner resumes when a checkpoint exists). Saved settings and glossary (Plan 23c),
    then a saved LLM configuration (Plan 23b), are picked up first, so the review runs on the newest of each; the
    result is cached under the version that ran (Plan 30)."""
    if "llm_lock" in ctx:
        await refresh_runtime(ctx)
        await refresh_llms(ctx)
    status = await _runner(ctx).run(uuid.UUID(review_id))
    return {"review_id": review_id, "status": status}


async def resume_review(ctx: dict, review_id: str) -> dict:
    """Kept for jobs enqueued under the old name; identical to run_review."""
    return await run_review(ctx, review_id)


async def delete_checkpoint(ctx: dict, review_id: str) -> dict:
    """Drop the LangGraph thread of a review an admin deleted (Plan 23a)."""
    checkpointer = getattr(ctx["graph"], "checkpointer", None)
    if checkpointer is None:
        return {"deleted": False}
    await checkpointer.adelete_thread(review_id)
    return {"deleted": True}


async def deliver_webhook(ctx: dict, review_id: str) -> dict:
    """POST the signed completion notice; retried by arq on network errors and 5xx."""
    settings = ctx["settings"]
    async with ctx["session_factory"]() as session:
        review = await ReviewRepository(session).get(uuid.UUID(review_id))
        key = await session.get(ApiKey, review.api_key_id) if review and review.api_key_id else None
    if review is None or not review.callback_url or key is None or key.revoked_at is not None:
        return {"delivered": False, "outcome": "skipped"}
    body = orjson.dumps({"review_id": review_id, "status": review.status,
                         "result_url": f"{settings.public_base_url.rstrip('/')}/api/v1/reviews/{review_id}"})
    outcome = await deliver(ctx["webhook_http"], url=review.callback_url, body=body, signature=sign(body, key.key_hash),
                            url_check=ctx.get("webhook_url_check", is_public_http_url),
                            allow_http=settings.webhook_allow_http)
    job_try = int(ctx.get("job_try", 1))
    if outcome == DeliveryOutcome.retry and job_try < settings.webhook_max_tries:
        raise Retry(defer=job_try * 10)
    if outcome != DeliveryOutcome.ok:
        log.warning("webhook_not_delivered", review_id=review_id, outcome=outcome.value, tries=job_try)
        return {"delivered": False, "outcome": outcome.value}
    return {"delivered": True}
