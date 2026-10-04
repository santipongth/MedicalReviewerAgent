from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings
from redis.asyncio import Redis

from app.config import Settings
from app.db.session import make_engine, make_session_factory
from app.runtime import AppDeps
from app.services.europepmc import EuropePmcClient
from app.services.events import EventSink
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.paper_search import PaperSearch
from app.services.queue import ArqJobQueue
from app.services.searxng import SearxngClient


async def build_runtime_deps(settings: Settings) -> AppDeps:
    engine = make_engine(settings.database_url, pool_size=settings.db_pool_size,
                         max_overflow=settings.db_max_overflow)
    session_factory = make_session_factory(engine)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    deps = AppDeps(
        session_factory=session_factory,
        redis=redis,
        queue=ArqJobQueue(arq_pool),
        event_sink=EventSink(session_factory, redis, settings.event_stream_ttl_seconds),
    )
    http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    deps.papers = PaperSearch(
        SearxngClient(http, settings.searxng_url, settings.searxng_engines, timeout=settings.searxng_timeout_seconds),
        EuropePmcClient(http, settings.europepmc_url))
    deps.engine = engine  # type: ignore[attr-defined]
    deps.arq_pool = arq_pool  # type: ignore[attr-defined]
    deps.http = http  # type: ignore[attr-defined]
    return deps


async def close_runtime_deps(deps: AppDeps) -> None:
    await deps.arq_pool.aclose()  # type: ignore[attr-defined]
    await deps.http.aclose()  # type: ignore[attr-defined]
    await deps.redis.aclose()
    await deps.engine.dispose()  # type: ignore[attr-defined]
