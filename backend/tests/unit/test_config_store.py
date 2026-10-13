import json

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import AdminAudit, ConfigVersion, HarnessRun
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import (
    DocKind,
    DocumentError,
    get_version,
    list_versions,
    mirror_version,
    newest,
    publish,
    read_active,
    reconcile_mirror,
    reset_to_seed,
    restore_version,
    save_version,
    version_out,
)
from app.services.review_service import Conflict, NotFound

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
SETTINGS = Settings(_env_file=None)


def _validate(raw, settings):
    if not isinstance(raw, dict) or not isinstance(raw.get("n"), int):
        raise DocumentError([{"field": "n", "message": "n: must be a whole number"}])
    return {"n": raw["n"]}, (["big"] if raw["n"] > 9 else [])


DEMO = DocKind(name="demo", redis_key="mra:demo:active", validate=_validate,
               summarize=lambda old, new: {"n": f"{(old or {}).get('n')} → {new['n']}"},
               seed=lambda: {"n": 0}, mirror=lambda doc: {"n": doc["n"]})
OTHER = DocKind(name="other", redis_key="mra:other:active", validate=_validate,
                summarize=lambda old, new: {}, seed=lambda: {"n": 0}, mirror=lambda doc: {})


async def save(session_factory, kind, n, base, **kw):
    async with session_factory() as s, s.begin():
        return await save_version(s, OWNER, kind, {"n": n}, settings=SETTINGS, base_version=base, **kw)


async def test_an_unknown_source_is_refused_before_anything_is_written(session_factory):
    with pytest.raises(ValueError, match="unknown source"):
        await save(session_factory, DEMO, 1, None, source="import")
    async with session_factory() as s:
        assert await newest(s, DEMO) is None
        assert (await s.execute(select(AdminAudit))).scalars().all() == []


async def test_versions_count_per_kind_and_a_stale_base_is_a_conflict(session_factory):
    a1 = await save(session_factory, DEMO, 1, None)
    b1 = await save(session_factory, OTHER, 5, None)
    a2 = await save(session_factory, DEMO, 2, a1.version, note="n" * 600)
    assert (a1.version, b1.version, a2.version) == (1, 1, 2)
    assert len(a2.note) == 500 and a2.source == "edit" and a2.changes == {"n": "1 → 2"}
    with pytest.raises(Conflict):
        await save(session_factory, DEMO, 3, None)
    with pytest.raises(Conflict):
        await save(session_factory, DEMO, 3, a1.version)
    async with session_factory() as s:
        assert (await newest(s, DEMO)).version == 2 and (await newest(s, OTHER)).version == 1


async def test_invalid_documents_leave_no_row_and_no_audit(session_factory):
    for raw in ({"n": "x"}, ["n"], None):
        with pytest.raises(DocumentError) as info:
            async with session_factory() as s, s.begin():
                await save_version(s, OWNER, DEMO, raw, settings=SETTINGS, base_version=None)
        assert info.value.errors[0]["field"] == "n" and str(info.value) == "n: must be a whole number"
    async with session_factory() as s:
        assert (await s.execute(select(ConfigVersion))).first() is None
        assert (await s.execute(select(AdminAudit))).first() is None


async def test_a_document_the_json_column_cannot_hold_is_refused(session_factory):
    nan = DocKind(name="nan", redis_key="mra:nan:active", validate=lambda raw, settings: ({"x": float("nan")}, []),
                  summarize=lambda old, new: {}, seed=dict, mirror=lambda doc: {})
    with pytest.raises(DocumentError, match="cannot be stored as JSON"):
        async with session_factory() as s, s.begin():
            await save_version(s, OWNER, nan, {}, settings=SETTINGS, base_version=None)
    async with session_factory() as s:
        assert (await s.execute(select(ConfigVersion))).first() is None


async def test_restore_and_reset_append_copies_with_audit_rows(session_factory):
    v1 = await save(session_factory, DEMO, 1, None)
    v2 = await save(session_factory, DEMO, 2, v1.version)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, DEMO, 1, settings=SETTINGS, base_version=v2.version)
    assert (v3.version, v3.source, v3.restored_from, v3.document) == (3, "restore", 1, {"n": 1})
    assert v3.note == "restored from version 1"
    async with session_factory() as s, s.begin():
        v4 = await reset_to_seed(s, OWNER, DEMO, settings=SETTINGS, base_version=v3.version)
    assert (v4.source, v4.document, v4.note) == ("reset", {"n": 0}, "reset to the default")
    with pytest.raises(NotFound):
        async with session_factory() as s, s.begin():
            await restore_version(s, OWNER, DEMO, 99, settings=SETTINGS, base_version=v4.version)
    async with session_factory() as s:
        audits = list((await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars())
    assert [a.action for a in audits] == ["demo.save", "demo.save", "demo.restore", "demo.reset"]
    assert audits[0].target_type == "demo" and audits[0].target_id == "1"
    assert audits[1].before == {"version": 1} and audits[1].after == {"version": 2, "n": "1 → 2"}


async def test_history_pages_newest_first_within_a_kind(session_factory):
    base = None
    for n in range(3):
        base = (await save(session_factory, DEMO, n, base)).version
    await save(session_factory, OTHER, 7, None)
    async with session_factory() as s:
        page, cursor = await list_versions(s, DEMO, limit=2)
        rest, end = await list_versions(s, DEMO, before=cursor, limit=2)
        with pytest.raises(NotFound):
            await get_version(s, OTHER, 2)
    assert [r.version for r in page + rest] == [3, 2, 1] and end is None
    out = version_out(page[0])
    assert out["version"] == 3 and out["kind"] == "demo" and "document" not in out


async def test_publish_only_moves_forward(session_factory, redis):
    v1 = await save(session_factory, DEMO, 1, None)
    v2 = await save(session_factory, DEMO, 2, v1.version)
    assert await publish(redis, DEMO, v2) is True
    assert await publish(redis, DEMO, v1) is True  # an older publish arriving late changes nothing
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 2, "n": 2}
    assert mirror_version(await redis.get(DEMO.redis_key)) == 2
    assert mirror_version(None) is None and mirror_version("not json") is None
    assert mirror_version('{"version": true}') is None and mirror_version("[1]") is None


async def test_read_active_uses_redis_then_the_db_then_the_seed(session_factory, redis):
    seed = await read_active(session_factory, redis, DEMO)
    assert (seed.version, seed.mirror) == (None, {"n": 0}) and await redis.get(DEMO.redis_key) is None
    await save(session_factory, DEMO, 4, None)
    miss = await read_active(session_factory, redis, DEMO)  # nothing published: the DB, then cached with NX
    assert (miss.version, miss.mirror) == (1, {"n": 4})
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 4}
    await redis.set(DEMO.redis_key, json.dumps({"version": 7, "n": 9}))
    assert (await read_active(session_factory, redis, DEMO)).version == 7


async def test_reconcile_repairs_a_lost_publish_and_a_mirror_the_db_does_not_have(session_factory, redis):
    assert await reconcile_mirror(redis, session_factory, DEMO) is None
    await redis.set(DEMO.redis_key, json.dumps({"version": 5, "n": 1}))  # a DB restored from an older backup
    assert await reconcile_mirror(redis, session_factory, DEMO) is None and await redis.get(DEMO.redis_key) is None
    await save(session_factory, DEMO, 1, None)  # saved, never published
    assert await reconcile_mirror(redis, session_factory, DEMO) == 1
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 1}
    await redis.set(DEMO.redis_key, json.dumps({"version": 9, "n": 7}))  # above the DB's newest
    assert await reconcile_mirror(redis, session_factory, DEMO) == 1
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 1}


async def test_read_active_survives_redis_being_down(session_factory):
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("redis down")

        async def set(self, *_, **__):
            raise ConnectionError("redis down")

    await save(session_factory, DEMO, 3, None)
    active = await read_active(session_factory, DeadRedis(), DEMO)
    assert (active.version, active.mirror) == (1, {"n": 3})


async def test_one_active_harness_run_at_a_time(session_factory):
    def run(run_id):
        return HarnessRun(run_id=run_id, prompt_version="pv", status="queued", active=1, max_usd=1.0, repeats=1,
                          planned=2, created_by="owner")

    async with session_factory() as s, s.begin():
        s.add(run("console-1"))
    with pytest.raises(IntegrityError):
        async with session_factory() as s, s.begin():
            s.add(run("console-2"))
    async with session_factory() as s, s.begin():
        first = (await s.execute(select(HarnessRun))).scalar_one()
        first.active, first.status = None, "done"
    async with session_factory() as s, s.begin():
        s.add(run("console-2"))
    async with session_factory() as s:
        rows = list((await s.execute(select(HarnessRun).order_by(HarnessRun.id))).scalars())
    assert [(r.run_id, r.active, r.spent_usd, r.strata, r.done) for r in rows] == [
        ("console-1", None, 0.0, [], 0), ("console-2", 1, 0.0, [], 0)]
