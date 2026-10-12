import asyncio
import os
import sys

import pytest

if sys.platform == "win32":
    # psycopg async (integration tests, LangGraph Postgres checkpointer) refuses the Proactor loop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def pytest_collection_modifyitems(config, items):
    if os.environ.get("MRA_INTEGRATION") == "1":
        return
    skip = pytest.mark.skip(reason="integration test; set MRA_INTEGRATION=1 with docker compose up")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


from sqlalchemy.ext.asyncio import create_async_engine

from app.db.models import Base
from app.db.session import make_session_factory


@pytest.fixture
async def session_factory(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


import fakeredis.aioredis


@pytest.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


import httpx

from app.config import Settings
from app.main import AppDeps, create_app
from app.services.events import EventSink


class FakeJobQueue:
    def __init__(self) -> None:
        self.enqueued: list[str] = []
        self.aborted: list[str] = []
        self.checkpoint_deletes: list[str] = []

    async def enqueue_review(self, review_id) -> bool:
        self.enqueued.append(str(review_id))
        return True

    async def abort_review(self, review_id) -> bool:
        self.aborted.append(str(review_id))
        return True

    async def enqueue_checkpoint_delete(self, review_id) -> bool:
        self.checkpoint_deletes.append(str(review_id))
        return True


@pytest.fixture
def queue():
    return FakeJobQueue()


@pytest.fixture
def test_settings():
    return Settings(_env_file=None, ratelimit_storage_uri="memory://")


@pytest.fixture
async def app(session_factory, redis, queue, test_settings, monkeypatch):
    import app.api.admin as admin_api
    import app.api.ratelimit as rl

    rl.limiter.reset()
    # The sign-in semaphore is per process and binds to the first event loop that waits on it; each test has its own.
    monkeypatch.setattr(admin_api, "VERIFY_SLOTS", asyncio.Semaphore(admin_api.VERIFY_CONCURRENCY))
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    deps = AppDeps(session_factory=session_factory, redis=redis, queue=queue, event_sink=sink)
    application = create_app(test_settings, deps=deps)
    application.state.deps.service.url_check = fake_public_url  # unit tests never do real DNS
    return application


async def fake_public_url(url: str) -> bool:
    """Offline stand-in for is_public_http_url: example.org hosts are public, everything else is not."""
    return httpx.URL(url).host.endswith("example.org")


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


from tests.fake_anthropic import FakeAnthropicServer


@pytest.fixture
def fake_anthropic():
    server = FakeAnthropicServer().start()
    yield server
    server.stop()


def pytest_runtest_setup(item):
    if "live" in item.keywords and not (os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")):
        pytest.skip("live test: set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY)")


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    """argon2's defaults cost tens of milliseconds per hash; unit tests use the cheapest valid parameters."""
    from argon2 import PasswordHasher

    from app.services import admin_auth

    monkeypatch.setattr(admin_auth, "HASHER", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
