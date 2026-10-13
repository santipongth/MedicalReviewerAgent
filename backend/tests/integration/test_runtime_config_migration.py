import json
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

pytestmark = pytest.mark.integration

BEFORE_RUNTIME = "f2a4c6e8b0d1"  # the revision the runtime-config migration (b3d5f7a9c1e2) builds on
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
INSERT_RUN = ("INSERT INTO harness_runs (run_id, prompt_version, status, active, max_usd, spent_usd, repeats, planned,"
              " done, failed, skipped, strata, created_by, config) VALUES (:r, 'pv', 'queued', 1, 1.0, 0, 1, 1, 0, 0,"
              " 0, '[]'::jsonb, 'owner', '{}'::jsonb)")


def test_runtime_tables_migration_constraints_and_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert {"config_versions", "harness_runs"} <= set(inspect(engine).get_table_names())
        doc = {"terms": [{"en": "placebo", "th": "ยาหลอก", "abbr": None, "note": None}]}
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO config_versions (kind, version, created_by, source, document, changes) "
                              "VALUES ('glossary', 1, 'owner', 'edit', CAST(:d AS JSONB), '{}'::jsonb)"),
                         {"d": json.dumps(doc, ensure_ascii=False)})
            assert conn.execute(text("SELECT document FROM config_versions")).scalar_one() == doc
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("INSERT INTO config_versions (kind, version, created_by, source, document, changes) "
                              "VALUES ('glossary', 1, 'x', 'edit', '{}'::jsonb, '{}'::jsonb)"))
        with engine.begin() as conn:
            conn.execute(text(INSERT_RUN), {"r": "a"})
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text(INSERT_RUN), {"r": "b"})  # a second active run
        command.downgrade(cfg, BEFORE_RUNTIME)  # pinned, so a later migration cannot change what this undoes
        tables = set(inspect(engine).get_table_names())
        assert not {"config_versions", "harness_runs"} & tables
        assert "llm_config_versions" in tables  # 23b's table: the downgrade stopped at BEFORE_RUNTIME
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == BEFORE_RUNTIME
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
