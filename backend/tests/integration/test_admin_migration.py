import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import get_settings

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
ADMIN_TABLES = {"admin_users", "admin_audit"}
BEFORE_ADMIN = "d4a8e2f61c37"  # the revision the admin migration (e1f3a5c7b9d2) builds on


def test_admin_migration_upgrades_and_downgrades(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:  # the test database only: start from an empty schema
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert ADMIN_TABLES <= set(inspect(engine).get_table_names())
        command.downgrade(cfg, BEFORE_ADMIN)
        assert not ADMIN_TABLES & set(inspect(engine).get_table_names())
        command.upgrade(cfg, "head")
        assert ADMIN_TABLES <= set(inspect(engine).get_table_names())
    finally:
        get_settings.cache_clear()
        engine.dispose()
