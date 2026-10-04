from __future__ import annotations

from typing import ClassVar

import httpx
from arq import cron
from arq.connections import RedisSettings
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis

from app.config import get_settings
from app.db.session import make_engine, make_session_factory
from app.graph.factory import build_graph_deps, close_graph_deps
from app.graph.graph import build_graph
from app.logging import configure_logging, get_logger
from app.services.events import EventSink
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.model_catalog import OpenRouterCatalog
from app.services.queue import ArqJobQueue
from app.worker.sweep import sweep_stale
from app.worker.tasks import deliver_webhook, resume_review, run_review

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
    ctx["http"] = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    catalog = None
    if settings.graph_mode != "stub":
        try:  # OpenRouter catalog: picks the structured-output method per model and prices; optional
            catalog = await OpenRouterCatalog(ctx["http"]).load()
        except Exception as exc:  # noqa: BLE001 - offline catalog only degrades to json_schema defaults
            log.warning("openrouter_catalog_unavailable", error=str(exc))
    ctx["graph_deps"] = build_graph_deps(settings, ctx["http"], ctx["events_redis"], catalog)
    ctx["graph"] = build_graph(ctx["graph_deps"], checkpointer=AsyncPostgresSaver(pool))
    ctx["queue"] = ArqJobQueue(ctx["redis"])  # arq's own pool: enqueue webhook deliveries
    ctx["webhook_http"] = httpx.AsyncClient(timeout=settings.webhook_timeout_seconds, follow_redirects=False)
    log.info("worker_started", max_jobs=settings.max_concurrent_reviews_per_worker, graph_mode=settings.graph_mode,
             llm_preset=getattr(ctx["graph_deps"].llms, "preset", None))


async def shutdown(ctx: dict) -> None:
    await close_graph_deps(ctx["graph_deps"])
    await ctx["http"].aclose()
    await ctx["webhook_http"].aclose()
    await ctx["pg_pool"].close()
    await ctx["events_redis"].aclose()
    await ctx["engine"].dispose()


class WorkerSettings:
    functions: ClassVar[list] = [run_review, resume_review, deliver_webhook]
    cron_jobs: ClassVar[list] = [
        cron(sweep_stale, name="sweep_stale", minute=set(range(0, 60, 5)), run_at_startup=True)
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().max_concurrent_reviews_per_worker
    job_timeout = 1800
    # A cancelled job (worker shutdown/restart) is re-run by arq; the runner resumes from the
    # LangGraph checkpoint, so a retry never redoes finished nodes. Ordinary exceptions are
    # caught by the runner and recorded as status=error, so they are never retried.
    retry_jobs = True
    max_tries = 3
    allow_abort_jobs = True
    health_check_interval = 30
    # Results live in Postgres; keeping arq results would block re-enqueueing the same job id.
    keep_result = 0
