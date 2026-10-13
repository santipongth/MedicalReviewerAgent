"""Plan 30: ghost workers, the sources a review searched, the sign-in race, queue positions in one clock tick, and the
eval writers."""
import json
import os
from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.evals import models
from app.graph.nodes.retrieval import make_search
from app.services.admin_auth import set_password
from app.services.llm_store import LOADED_KEY, LOADED_MAX_AGE, loaded_workers, report_loaded
from app.services.sources import effective_sources
from tests.unit.test_admin_api_auth import attempt, count, create_admin
from tests.unit.test_sources_propagation import deps_with


# ---- D1: workers that stopped reporting -----------------------------------------------------------------------------
async def test_a_worker_silent_for_three_minutes_is_not_listed_and_is_removed(redis):
    await report_loaded(redis, "live:1", "3", "cheap")
    old = {"version": "2", "preset": "cheap", "error": None,
           "loaded_at": (datetime.now(UTC) - LOADED_MAX_AGE - timedelta(seconds=1)).isoformat()}
    recent = {**old, "loaded_at": (datetime.now(UTC) - LOADED_MAX_AGE + timedelta(seconds=30)).isoformat()}
    await redis.hset(LOADED_KEY, mapping={"gone:1": json.dumps(old), "slow:1": json.dumps(recent),
                                          "junk:1": "not json", "odd:1": json.dumps(["a", "list"])})
    assert LOADED_MAX_AGE == timedelta(minutes=3)
    assert [r["worker"] for r in await loaded_workers(redis)] == ["live:1", "slow:1"]
    assert set(await redis.hkeys(LOADED_KEY)) == {"live:1", "slow:1"}  # the ghosts are gone from the hash


# ---- D4: the sources a review searched ------------------------------------------------------------------------------
async def test_the_search_records_env_only_engines_with_the_catalog_sources():
    env = Settings(_env_file=None, searxng_engines="pubmed,plos", thaijo_enabled=False)
    sources = effective_sources(env, {})
    assert sources.extras == ("plos",)
    deps = deps_with(sources)
    out = await make_search(deps)({"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}})
    assert out["quality"][0]["sources"] == [*sources.enabled, "plos"]


# ---- E1/E2: a password set while the sign-in checks the old one ----------------------------------------------------
async def test_a_password_changed_while_the_password_is_checked_does_not_get_in(app, client, session_factory,
                                                                               monkeypatch, redis):
    import app.api.admin as admin_api

    real_verify = admin_api.verify_password

    async def change_meanwhile(stored, password):
        result = await real_verify(stored, password)
        async with session_factory() as s, s.begin():
            await set_password(s, "owner", "an entirely new passphrase 42")
        return result

    await create_admin(session_factory)
    monkeypatch.setattr(admin_api, "verify_password", change_meanwhile)
    r = await attempt(client)
    assert r.status_code == 401 and "set-cookie" not in r.headers
    assert await count(session_factory, "admin.login") == 0 and await redis.keys("mra:admin:session:*") == []


# ---- F1: queue positions of reviews created in the same clock tick -------------------------------------------------
async def test_reviews_created_in_one_tick_get_distinct_positions(session_factory):
    tick = datetime.now(UTC)
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        made = [await repo.create(topic=f"t{i}", language="en", options={}, cache_key=f"k{i}") for i in range(3)]
        for r in made:
            await repo.update(r.id, created_at=tick)
    async with session_factory() as s:
        repo = ReviewRepository(s)
        positions = [await repo.queue_position(await repo.get(r.id)) for r in made]
    assert sorted(positions) == [1, 2, 3]
    by_id = sorted(made, key=lambda r: r.id)
    assert [positions[made.index(r)] for r in by_id] == [1, 2, 3]  # ties go by id


# ---- F3: the eval writers ----------------------------------------------------------------------------------------
def test_a_failed_replace_leaves_no_temporary_file(tmp_path, monkeypatch):
    def locked(src, dst):
        raise PermissionError("the file is open in another process")

    monkeypatch.setattr(os, "replace", locked)
    target = tmp_path / "runs" / "x.json"
    with pytest.raises(PermissionError):
        models.write_json_atomic(target, {"a": 1})
    assert list(target.parent.iterdir()) == []


def test_an_empty_gold_file_is_no_gold_record(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    (tmp_path / "gold").mkdir()
    (tmp_path / "gold" / "CD000001.yaml").write_text("", encoding="utf-8")
    assert models.load_gold("CD000001") is None
    assert models.load_gold("CD000002") is None  # no file
