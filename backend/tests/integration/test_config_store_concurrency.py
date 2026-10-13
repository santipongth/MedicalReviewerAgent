import asyncio
import os

import pytest
from sqlalchemy import func, select

from app.config import Settings
from app.db.models import AdminAudit, Base, ConfigVersion
from app.db.session import make_engine, make_session_factory
from app.services import config_store
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import DocKind, save_version
from app.services.review_service import Conflict

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
OWNER = AdminPrincipal(kind="user", id=None, label="owner")
# The settings kind (app.services.runtime_settings) arrives with Plan 23c Task 3; the store is generic, so this test
# saves a document of a stand-in kind of the same shape.
VALUES_KIND = DocKind(name="settings", redis_key="mra:settings:active",
                      validate=lambda raw, settings: ({"values": dict(raw["values"])}, []),
                      summarize=lambda old, new: {"values": sorted(new["values"])},
                      seed=lambda: {"values": {}}, mirror=lambda doc: {"values": doc["values"]})


@pytest.fixture
async def pg_session_factory():
    engine = make_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


async def test_two_saves_from_the_same_base_cannot_both_win(pg_session_factory, monkeypatch):
    real_newest = config_store.newest

    async def newest_then_linger(session, kind):
        row = await real_newest(session, kind)
        await asyncio.sleep(0.3)  # keeps the gap between the base check and the insert open for the other save
        return row

    monkeypatch.setattr(config_store, "newest", newest_then_linger)

    async def save(n):
        async with pg_session_factory() as session, session.begin():
            return await save_version(session, OWNER, VALUES_KIND, {"values": {"max_queued_reviews": n}},
                                      settings=Settings(_env_file=None), base_version=None)

    results = await asyncio.gather(save(60), save(70), return_exceptions=True)

    winners = [r for r in results if isinstance(r, ConfigVersion)]
    losers = [r for r in results if isinstance(r, Conflict)]
    assert (len(winners), len(losers)) == (1, 1), results
    async with pg_session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(ConfigVersion)) == 1
        assert await session.scalar(select(func.count()).select_from(AdminAudit)) == 1
