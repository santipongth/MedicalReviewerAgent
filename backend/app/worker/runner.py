from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import TERMINAL_STATUSES, ReviewStatus
from app.db.repositories import ReviewRepository
from app.graph.graph import initial_state
from app.logging import get_logger
from app.services.budget import ReviewBudget, use_budget
from app.services.events import EventSink

log = get_logger(__name__)


class ReviewRunner:
    """Drives one review through the graph and bridges progress into the EventSink.

    Idempotent per review: if the review's LangGraph thread already has a checkpoint (worker
    restart, arq retry, stale-sweep re-enqueue) it resumes from it instead of starting over,
    so finished nodes are not re-run and add-reducers are not double-counted.
    """

    def __init__(self, session_factory: async_sessionmaker, event_sink: EventSink, graph, notify=None,
                 capacity=None, cost_cap_usd: float | None = None) -> None:
        self.cost_cap_usd = cost_cap_usd  # per-review LLM spend cap (None → uncapped)
        self.capacity = capacity  # app.services.capacity.Capacity: finished reviews count toward the daily spend
        self.session_factory = session_factory
        self.event_sink = event_sink
        self.graph = graph
        self.notify = notify  # async (review_id) -> None: enqueue the webhook for reviews with a callback_url

    async def _notify(self, review_id: uuid.UUID, has_callback: bool) -> None:
        if has_callback and self.notify is not None:
            try:
                await self.notify(review_id)
            except Exception:  # noqa: BLE001 - a webhook problem never changes the review outcome
                log.warning("webhook_enqueue_failed", review_id=str(review_id))

    async def _has_checkpoint(self, config: dict) -> bool:
        if getattr(self.graph, "checkpointer", None) is None:
            return False
        snapshot = await self.graph.aget_state(config)
        return bool(snapshot.values)

    async def run(self, review_id: uuid.UUID) -> str:
        async with self.session_factory() as session, session.begin():
            repo = ReviewRepository(session)
            review = await repo.get(review_id)
            if review is None:
                return "missing"
            if review.status in TERMINAL_STATUSES:
                return review.status
            now = datetime.now(UTC)
            first_start = review.started_at  # kept across resumes so elapsed_s counts from the first start
            if first_start is not None and first_start.tzinfo is None:
                first_start = first_start.replace(tzinfo=UTC)
            await repo.update(review_id, status="running", started_at=first_start or now, error=None)
            topic, language, options = review.topic, review.language, dict(review.options or {})
            has_callback = bool(review.callback_url)
        t0 = time.monotonic() - ((now - first_start).total_seconds() if first_start else 0.0)

        async def emit(event_type: str, payload: dict) -> None:
            await self.event_sink.emit(review_id, event_type,
                                       {**payload, "elapsed_s": round(time.monotonic() - t0, 2)})

        config = {"configurable": {"thread_id": str(review_id)}}
        resume = await self._has_checkpoint(config)
        await emit("started", {"resume": resume})
        state_input = None if resume else initial_state(str(review_id), topic, language, options)

        # Every LLM call of this run (any node or branch) is charged to this review's budget.
        budget = ReviewBudget(cap_usd=self.cost_cap_usd) if self.cost_cap_usd else None
        try:
            with use_budget(budget):
                async for mode, chunk in self.graph.astream(
                    state_input, config, stream_mode=["custom", "updates"], durability="sync"
                ):
                    if mode == "custom" and isinstance(chunk, dict):
                        payload = {k: v for k, v in chunk.items() if k != "type"}
                        await emit(str(chunk.get("type", "progress")), payload)
            snapshot = await self.graph.aget_state(config)
            values = snapshot.values
        except asyncio.CancelledError:
            # Cancelled by the user (DELETE → arq abort): the API already recorded it; do nothing more.
            # Otherwise worker shutdown / restart: hand the review back to the queue (arq re-runs the job
            # with retry_jobs=True; the stale sweep is the backstop).
            if await self._set_status(review_id, "queued"):
                await emit("interrupted", {"will_resume": True})
            raise
        except Exception as exc:
            log.exception("review_failed", review_id=str(review_id))
            message = f"{type(exc).__name__}: {exc}"
            if not await self._finish(review_id, "error", error=message):
                return ReviewStatus.cancelled.value
            await emit("error", {"message": message})
            await self._notify(review_id, has_callback)
            return "error"

        cost = float(values.get("cost_usd", 0.0))
        await self._note_cost(cost)
        if values.get("rejected"):
            reason = str(values["rejected"])
            if not await self._finish(review_id, "rejected", error=reason, cost_usd=cost):
                return ReviewStatus.cancelled.value
            await emit("rejected", {"reason": reason})
            await self._notify(review_id, has_callback)
            return "rejected"
        result = values.get("result") or {}
        if not await self._finish(review_id, "done", result=result, cost_usd=cost,
                                  prompt_version=result.get("prompt_version"), model_versions=result.get("models")):
            return ReviewStatus.cancelled.value
        await emit("done", {"cost_usd": cost})
        await self._notify(review_id, has_callback)
        return "done"

    async def _note_cost(self, cost: float) -> None:
        if self.capacity is None:
            return
        try:
            await self.capacity.note_cost(cost)
        except Exception:  # noqa: BLE001 - the budget counter must never fail a finished review
            log.warning("capacity_cost_failed")

    async def _set_status(self, review_id: uuid.UUID, status: str) -> bool:
        async with self.session_factory() as session, session.begin():
            return await ReviewRepository(session).update_unless(review_id, {ReviewStatus.cancelled.value},
                                                                 status=status)

    async def _finish(self, review_id: uuid.UUID, status: str, **fields) -> bool:
        """False when the review was cancelled meanwhile: a cancellation is never overwritten."""
        async with self.session_factory() as session, session.begin():
            return await ReviewRepository(session).update_unless(
                review_id, {ReviewStatus.cancelled.value}, status=status, finished_at=datetime.now(UTC), **fields)
