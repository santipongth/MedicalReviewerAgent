import asyncio
import os

import pytest
from sqlalchemy import func, select

from app.config import Settings
from app.db.models import AdminAudit, Base, LlmConfigVersion
from app.db.session import make_engine, make_session_factory
from app.services import llm_store
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import save_version
from app.services.review_service import Conflict
from tests.llm_helpers import MINIMAL, with_model, write_yaml

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture
async def pg_session_factory():
    engine = make_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


async def test_two_saves_from_the_same_base_cannot_both_win(pg_session_factory, tmp_path, monkeypatch):
    real_newest = llm_store._newest

    async def newest_then_linger(session):
        row = await real_newest(session)
        await asyncio.sleep(0.3)  # keeps the gap between the base check and the insert open for the other save
        return row

    monkeypatch.setattr(llm_store, "_newest", newest_then_linger)
    settings = Settings(_env_file=None, llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))

    async def save(model):
        async with pg_session_factory() as session, session.begin():
            return await save_version(session, OWNER, with_model(MINIMAL, "cheap", "guard", model),
                                      settings=settings, base_version=None)

    results = await asyncio.gather(save("vendor/a"), save("vendor/b"), return_exceptions=True)

    winners = [r for r in results if isinstance(r, LlmConfigVersion)]
    losers = [r for r in results if isinstance(r, Conflict)]
    assert (len(winners), len(losers)) == (1, 1), results
    async with pg_session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(LlmConfigVersion)) == 1
        assert await session.scalar(select(func.count()).select_from(AdminAudit)) == 1
