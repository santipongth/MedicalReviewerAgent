import asyncio
import os
import uuid

import pytest
from arq import create_pool
from arq.connections import RedisSettings
from arq.worker import Worker
from redis.asyncio import Redis

from app.config import Settings, get_settings
from app.db.models import Base
from app.db.repositories import EventRepository, ReviewRepository
from app.db.session import make_engine, make_session_factory
from app.services.queue import ArqJobQueue
from app.worker import settings as worker_settings

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test"
)
TEST_REDIS = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")


@pytest.fixture
async def pg_session_factory():
    engine = make_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


async def test_worker_runs_job_with_postgres_checkpointer(pg_session_factory, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("REDIS_URL", TEST_REDIS)
    monkeypatch.setenv("GRAPH_MODE", "stub")  # plumbing test: never calls an LLM
    get_settings.cache_clear()
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    conninfo = Settings(_env_file=None, database_url=TEST_DB).checkpoint_conninfo
    async with AsyncPostgresSaver.from_conn_string(conninfo) as saver:
        await saver.setup()

    async with pg_session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(
            topic="integration topic", language="en", options={}, cache_key=str(uuid.uuid4())
        )

    redis_settings = RedisSettings.from_dsn(TEST_REDIS)
    pool = await create_pool(redis_settings)
    await pool.flushdb()
    assert await ArqJobQueue(pool).enqueue_review(review.id) is True
    assert await ArqJobQueue(pool).enqueue_review(review.id) is False  # same _job_id → deduped

    worker = Worker(
        functions=worker_settings.WorkerSettings.functions,
        on_startup=worker_settings.startup,
        on_shutdown=worker_settings.shutdown,
        redis_settings=redis_settings,
        burst=True,
        max_jobs=2,
        job_timeout=120,
        retry_jobs=False,
    )
    await asyncio.wait_for(worker.main(), timeout=90)
    await worker.close()

    async with pg_session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "done"
    assert got.result["summary"] == "Stub review for: integration topic"
    assert [e.type for e in events] == ["started", "planning", "synthesizing", "done"]

    live = Redis.from_url(TEST_REDIS, decode_responses=True)
    entries = await live.xrange(f"review:{review.id}:events")
    assert [e[1]["type"] for e in entries][-1] == "done"
    await live.aclose()
    await pool.aclose()
    get_settings.cache_clear()
