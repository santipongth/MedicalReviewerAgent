from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import ClassVar

from arq.connections import RedisSettings
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis

from app.config import get_settings
from app.db.repositories import ReviewRepository
from app.db.session import make_engine, make_session_factory
from app.graph.graph import GraphDeps, build_graph
from app.logging import configure_logging, get_logger
from app.services.events import EventSink
from app.services.queue import review_job_id
from app.worker.tasks import resume_review, run_review

log = get_logger(__name__)


async def startup(ctx: dict) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    ctx["settings"] = settings
    engine = make_engine(settings.database_url)
    ctx["engine"] = engine
    ctx["session_factory"] = make_session_factory(engine)
    ctx["events_redis"] = Redis.from_url(settings.redis_url, decode_responses=True)
    ctx["event_sink"] = EventSink(
        ctx["session_factory"], ctx["events_redis"], settings.event_stream_ttl_seconds
    )
    pool = AsyncConnectionPool(
        settings.checkpoint_conninfo,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0},
        min_size=1,
        max_size=settings.max_concurrent_reviews_per_worker + 2,
        open=False,
    )
    await pool.open()
    ctx["pg_pool"] = pool
    ctx["graph"] = build_graph(GraphDeps(settings=settings), checkpointer=AsyncPostgresSaver(pool))
    await _requeue_stale_running(ctx)
    log.info("worker_started", max_jobs=settings.max_concurrent_reviews_per_worker)


async def _requeue_stale_running(ctx: dict) -> None:
    settings = ctx["settings"]
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.stale_running_minutes)
    async with ctx["session_factory"]() as session:
        stale = await ReviewRepository(session).list_stale_running(older_than=cutoff)
    for review in stale:
        job = await ctx["redis"].enqueue_job(
            "resume_review", str(review.id), _job_id=review_job_id(review.id)
        )
        log.info("requeued_stale_review", review_id=str(review.id), enqueued=job is not None)


async def shutdown(ctx: dict) -> None:
    await ctx["pg_pool"].close()
    await ctx["events_redis"].aclose()
    await ctx["engine"].dispose()


class WorkerSettings:
    functions: ClassVar[list] = [run_review, resume_review]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().max_concurrent_reviews_per_worker
    job_timeout = 1800
    max_tries = 2
    retry_jobs = False
    allow_abort_jobs = True
    health_check_interval = 30
    keep_result = 3600
