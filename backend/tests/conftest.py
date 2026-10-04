import os

import pytest


def pytest_collection_modifyitems(config, items):
    if os.environ.get("MRA_INTEGRATION") == "1":
        return
    skip = pytest.mark.skip(reason="integration test; set MRA_INTEGRATION=1 with docker compose up")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.db.models import Base  # noqa: E402
from app.db.session import make_session_factory  # noqa: E402


@pytest.fixture
async def session_factory(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


import fakeredis.aioredis  # noqa: E402


@pytest.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


import httpx  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import AppDeps, create_app  # noqa: E402
from app.services.events import EventSink  # noqa: E402


class FakeJobQueue:
    def __init__(self) -> None:
        self.enqueued: list[str] = []

    async def enqueue_review(self, review_id) -> bool:
        self.enqueued.append(str(review_id))
        return True


@pytest.fixture
def queue():
    return FakeJobQueue()


@pytest.fixture
def test_settings():
    return Settings(_env_file=None, ratelimit_storage_uri="memory://")


@pytest.fixture
async def app(session_factory, redis, queue, test_settings):
    import app.api.ratelimit as rl

    rl.limiter.reset()
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    deps = AppDeps(session_factory=session_factory, redis=redis, queue=queue, event_sink=sink)
    return create_app(test_settings, deps=deps)


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
