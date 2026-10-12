import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import Settings
from app.db.models import AdminAudit, LlmConfigVersion
from app.services.admin_auth import AdminPrincipal
from app.services.llm_config import LLMConfigError
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    active_version_id,
    list_versions,
    load_effective,
    loaded_workers,
    publish_version,
    report_loaded,
    reset_to_file,
    restore_version,
    save_version,
    summarize_change,
    version_out,
)
from app.services.review_service import Conflict, NotFound
from tests.llm_helpers import MINIMAL, with_model, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))


async def save(session_factory, settings, raw, base, **kw):
    async with session_factory() as s, s.begin():
        return await save_version(s, OWNER, raw, settings=settings, base_version=base, **kw)


async def test_the_file_is_effective_until_a_version_exists(session_factory, settings):
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert (eff.source, eff.version, eff.label, eff.active_id) == ("file", None, "file", "file")
    assert eff.resolve().preset == "cheap"
    row = await save(session_factory, settings, {**MINIMAL, "active_preset": "better"}, None, note="try better")
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert (eff.source, eff.version, eff.label) == ("db", row.id, f"db:{row.id}")
    assert eff.resolve().preset == "better"


async def test_llm_preset_applies_only_to_the_file(session_factory, settings):
    settings.llm_preset = "better"
    async with session_factory() as s:
        assert (await load_effective(s, settings)).resolve().preset == "better"
    await save(session_factory, settings, MINIMAL, None)
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert eff.resolve().preset == "cheap" and eff.env_preset == "better"


async def test_a_stale_base_is_a_conflict_and_an_empty_table_takes_null(session_factory, settings):
    first = await save(session_factory, settings, MINIMAL, None)
    with pytest.raises(Conflict):
        await save(session_factory, settings, MINIMAL, None)  # someone saved meanwhile
    second = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/x"), first.id)
    with pytest.raises(Conflict):
        await save(session_factory, settings, MINIMAL, first.id)
    assert second.id == first.id + 1


async def test_invalid_documents_are_refused_and_leave_no_row(session_factory, settings):
    broken = {**MINIMAL, "active_preset": "missing"}
    no_active = {**MINIMAL, "presets": {"better": MINIMAL["presets"]["better"]}}  # deleted the active preset
    for raw in (broken, no_active, {"presets": {}}, ["not", "a", "mapping"]):
        with pytest.raises(LLMConfigError):
            await save(session_factory, settings, raw, None)
    async with session_factory() as s:
        assert (await s.execute(select(LlmConfigVersion))).first() is None


async def test_save_writes_a_change_summary_and_one_audit_row(session_factory, settings):
    raw = with_model({**MINIMAL, "active_preset": "better"}, "cheap", "synthesizer", "vendor/big")
    row = await save(session_factory, settings, raw, None, note="n" * 600)
    assert len(row.note) == 500 and row.source == "edit" and row.created_by == "owner"
    assert row.changes == {"active_preset": "cheap → better",
                           "roles": {"cheap.synthesizer": "vendor/cheap → vendor/big"}}
    async with session_factory() as s:
        [audit] = list((await s.execute(select(AdminAudit))).scalars())
    assert audit.action == "llm_config.save" and audit.target_type == "llm_config"
    assert audit.target_id == str(row.id) and audit.before == {"version": None}
    assert audit.after["version"] == row.id and audit.after["active_preset"] == "cheap → better"


def test_summarize_change_cases():
    old = MINIMAL
    new = {**with_model(MINIMAL, "better", "guard", "vendor/g"), "harness": {"max_repairs": 1}}
    new["presets"]["fresh"] = new["presets"].pop("cheap")
    new["presets"]["better"]["planner"] = {"model": "vendor/better", "max_tokens": 9}
    assert summarize_change(old, new) == {
        "presets_added": ["fresh"], "presets_removed": ["cheap"],
        "roles": {"better.guard": "vendor/better → vendor/g", "better.planner": "settings changed"},
        "sections": ["harness"],
    }
    assert summarize_change(MINIMAL, MINIMAL) == {}


async def test_restore_and_reset_append_copies(session_factory, settings):
    v1 = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/a"), None)
    v2 = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/b"), v1.id)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, v1.id, settings=settings, base_version=v2.id)
    assert (v3.source, v3.restored_from, v3.config) == ("restore", v1.id, v1.config)
    assert v3.note == f"restored from version {v1.id}"
    async with session_factory() as s, s.begin():
        v4 = await reset_to_file(s, OWNER, settings=settings, base_version=v3.id)
    assert v4.source == "file" and v4.config == MINIMAL and v4.note == "reset to llm.yaml"
    with pytest.raises(NotFound):
        async with session_factory() as s, s.begin():
            await restore_version(s, OWNER, 999, settings=settings, base_version=v4.id)
    async with session_factory() as s:
        actions = [a.action for a in (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars()]
    assert actions == ["llm_config.save", "llm_config.save", "llm_config.restore", "llm_config.reset"]


async def test_history_pages_newest_first(session_factory, settings):
    base = None
    for i in range(3):
        base = (await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", f"vendor/{i}"), base)).id
    async with session_factory() as s:
        page, cursor = await list_versions(s, limit=2)
        rest, end = await list_versions(s, before=cursor, limit=2)
    assert [r.id for r in page + rest] == [3, 2, 1] and end is None
    out = version_out(page[0])
    assert out["id"] == 3 and out["active_preset"] == "cheap" and "config" not in out


async def test_active_version_id_uses_redis_then_the_db(session_factory, settings, redis):
    assert await active_version_id(session_factory, redis) == "file"
    row = await save(session_factory, settings, MINIMAL, None)
    await redis.delete(LLM_VERSION_KEY)
    assert await active_version_id(session_factory, redis) == str(row.id)  # miss → DB, then cached
    assert await redis.get(LLM_VERSION_KEY) == str(row.id)
    await publish_version(redis, 42)
    assert await active_version_id(session_factory, redis) == "42"


async def test_active_version_id_survives_redis_being_down(session_factory, settings):
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("redis down")

        async def set(self, *_ , **__):
            raise ConnectionError("redis down")

    row = await save(session_factory, settings, MINIMAL, None)
    assert await active_version_id(session_factory, DeadRedis()) == str(row.id)


async def test_loaded_workers_report_and_expire(redis):
    await report_loaded(redis, "host:1", "3", "cheap")
    await report_loaded(redis, "host:2", "2", "cheap", error="boom")
    stale = {"version": "1", "preset": "cheap", "loaded_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
             "error": None}
    await redis.hset(LOADED_KEY, "host:3", json.dumps(stale))
    rows = await loaded_workers(redis)
    assert [(r["worker"], r["version"], r["error"]) for r in rows] == [("host:1", "3", None), ("host:2", "2", "boom")]
