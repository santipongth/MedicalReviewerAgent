from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import TERMINAL_STATUSES
from app.db.repositories import ReviewRepository
from app.graph.graph import initial_state
from app.logging import get_logger
from app.services.events import EventSink

log = get_logger(__name__)


class ReviewRunner:
    """Drives one review through the graph and bridges progress into the EventSink."""

    def __init__(self, session_factory: async_sessionmaker, event_sink: EventSink, graph) -> None:
        self.session_factory = session_factory
        self.event_sink = event_sink
        self.graph = graph

    async def run(self, review_id: uuid.UUID, *, resume: bool = False) -> str:
        async with self.session_factory() as session, session.begin():
            repo = ReviewRepository(session)
            review = await repo.get(review_id)
            if review is None:
                return "missing"
            if review.status in TERMINAL_STATUSES:
                return review.status
            await repo.update(review_id, status="running", started_at=datetime.now(UTC), error=None)
            topic, language, options = review.topic, review.language, dict(review.options or {})

        await self.event_sink.emit(review_id, "started", {"resume": resume})
        config = {"configurable": {"thread_id": str(review_id)}}
        state_input = None if resume else initial_state(str(review_id), topic, language, options)

        try:
            async for mode, chunk in self.graph.astream(
                state_input, config, stream_mode=["custom", "updates"], durability="sync"
            ):
                if mode == "custom" and isinstance(chunk, dict):
                    payload = {k: v for k, v in chunk.items() if k != "type"}
                    await self.event_sink.emit(
                        review_id, str(chunk.get("type", "progress")), payload
                    )
            snapshot = await self.graph.aget_state(config)
            values = snapshot.values
        except asyncio.CancelledError:
            await self._finish(review_id, "cancelled", error="cancelled")
            await self.event_sink.emit(review_id, "cancelled", {})
            raise
        except Exception as exc:
            log.exception("review_failed", review_id=str(review_id))
            message = f"{type(exc).__name__}: {exc}"
            await self._finish(review_id, "error", error=message)
            await self.event_sink.emit(review_id, "error", {"message": message})
            return "error"

        cost = float(values.get("cost_usd", 0.0))
        await self._finish(review_id, "done", result=values.get("result"), cost_usd=cost)
        await self.event_sink.emit(review_id, "done", {"cost_usd": cost})
        return "done"

    async def _finish(self, review_id: uuid.UUID, status: str, **fields) -> None:
        async with self.session_factory() as session, session.begin():
            await ReviewRepository(session).update(
                review_id, status=status, finished_at=datetime.now(UTC), **fields
            )
