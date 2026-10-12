import json
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import get_settings
from tests.llm_helpers import MINIMAL

pytestmark = pytest.mark.integration

BEFORE_LLM_VERSIONS = "e1f3a5c7b9d2"  # the revision the llm_config_versions migration (f2a4c6e8b0d1) builds on
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")


def test_llm_versions_migration_and_jsonb_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert "llm_config_versions" in inspect(engine).get_table_names()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO llm_config_versions (created_by, source, config, changes) "
                              "VALUES ('owner', 'edit', CAST(:c AS JSONB), '{}'::jsonb)"), {"c": json.dumps(MINIMAL)})
            stored = conn.execute(text("SELECT config FROM llm_config_versions")).scalar_one()
        assert stored == MINIMAL
        command.downgrade(cfg, BEFORE_LLM_VERSIONS)  # pinned, so a later migration cannot change what this undoes
        assert "llm_config_versions" not in inspect(engine).get_table_names()
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
