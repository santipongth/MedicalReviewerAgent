import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

pytestmark = pytest.mark.integration

BEFORE_KEYS = "b3d5f7a9c1e2"  # the revision the provider-keys migration (c6e8a0b2d4f6) builds on
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
INSERT = ("INSERT INTO llm_provider_keys (provider, ciphertext, last4, bound_origin, revision, updated_by) "
          "VALUES (:p, 'gAAAA', 'abcd', 'https://api.deepseek.com', :r, 'owner')")


def test_provider_keys_migration_and_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert "llm_provider_keys" in set(inspect(engine).get_table_names())
        with engine.begin() as conn:
            conn.execute(text(INSERT), {"p": "deepseek", "r": 1})
            conn.execute(text("UPDATE llm_provider_keys SET ciphertext = NULL, last4 = NULL, bound_origin = NULL, "
                              "revision = 2 WHERE provider = 'deepseek'"))  # a tombstone
            assert conn.execute(text("SELECT max(revision) FROM llm_provider_keys")).scalar_one() == 2
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text(INSERT), {"p": "deepseek", "r": 3})  # one row per provider
        command.downgrade(cfg, BEFORE_KEYS)  # pinned, so a later migration cannot change what this undoes
        tables = set(inspect(engine).get_table_names())
        assert "llm_provider_keys" not in tables and "config_versions" in tables
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == BEFORE_KEYS
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
