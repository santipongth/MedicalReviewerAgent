import asyncio
import json

import pytest

from app.config import Settings
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.services.admin_auth import AdminPrincipal
from app.services.budget import worst_case_review_cap
from app.services.capacity import Capacity
from app.services.config_store import DocumentError, newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.runtime_config import RuntimeConfig, load_runtime
from app.services.runtime_settings import (
    BY_NAME,
    SETTINGS_KIND,
    SPECS,
    apply_overrides,
    coerce,
    summarize_settings,
    validate_settings,
)

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
BASE = Settings(_env_file=None)


def test_the_editable_list_is_fixed_and_holds_nothing_sensitive():
    assert [s.name for s in SPECS] == [
        "review_rate_limit", "api_key_rate_limit", "paper_search_rate_limit", "sse_max_per_ip",
        "max_queued_reviews", "max_reviews_per_day", "max_usd_per_day", "review_cost_base_usd",
        "review_cost_per_paper_usd", "review_cost_per_candidate_usd", "max_cost_per_review_usd",
        "llm_concurrency", "result_cache_ttl_seconds"]
    for spec in SPECS:
        assert spec.name in Settings.model_fields
        assert not any(w in spec.name for w in ("secret", "salt", "_url", "proxy", "password", "admin", "turnstile",
                                                "harness"))


@pytest.mark.parametrize("name, value, expected", [
    ("review_rate_limit", " 10/hour ", "10/hour"),
    ("max_queued_reviews", 80, 80),
    ("max_queued_reviews", 80.0, 80),
    ("max_usd_per_day", 25, 25.0),
    ("result_cache_ttl_seconds", 0, 0),
])
def test_values_are_coerced(name, value, expected):
    got = coerce(BY_NAME[name], value)
    assert got == expected and type(got) is type(expected)


@pytest.mark.parametrize("name, value", [
    ("review_rate_limit", "5 per hour"), ("review_rate_limit", "0/hour"), ("review_rate_limit", 5),
    ("max_queued_reviews", 0), ("max_queued_reviews", 1001), ("max_queued_reviews", 2.5),
    ("max_queued_reviews", True), ("max_queued_reviews", "50"), ("max_usd_per_day", float("inf")),
    ("max_usd_per_day", float("nan")), ("llm_concurrency", 65),
    ("max_usd_per_day", 10**400), ("review_cost_base_usd", -10**400),
])
def test_bad_values_are_refused(name, value):
    with pytest.raises(ValueError):
        coerce(BY_NAME[name], value)


def test_validation_names_fields_and_never_echoes_a_bad_name():
    with pytest.raises(DocumentError) as info:
        validate_settings({"values": {"max_queued_reviews": 0, "database_url": "x", "\ud800": 1}}, BASE)
    assert [e["field"] for e in info.value.errors] == ["max_queued_reviews", "database_url", None]
    assert all("\ud800" not in e["message"] for e in info.value.errors)
    for raw in (None, [], {"values": []}, {"values": {}, "extra": 1}):
        with pytest.raises(DocumentError):
            validate_settings(raw, BASE)


def test_a_daily_budget_below_one_review_is_refused_and_a_tight_one_warns():
    worst = worst_case_review_cap(BASE)
    with pytest.raises(DocumentError, match="no review could be admitted") as info:
        validate_settings({"values": {"max_usd_per_day": round(worst / 2, 2)}}, BASE)
    assert info.value.errors[0]["field"] == "max_usd_per_day"
    doc, warnings = validate_settings({"values": {"max_usd_per_day": round(worst * 2, 2), "llm_concurrency": 8}}, BASE)
    assert doc == {"values": {"max_usd_per_day": round(worst * 2, 2), "llm_concurrency": 8}}
    assert any("daily budget" in w for w in warnings) and any("llm_concurrency" in w for w in warnings)
    assert validate_settings({"values": {}}, BASE) == ({"values": {}}, [])


def test_overrides_apply_and_bad_stored_values_are_skipped():
    s = apply_overrides(BASE, {"max_queued_reviews": 80, "review_rate_limit": "9/hour", "gone_setting": 1,
                               "sse_max_per_ip": "lots"})
    assert (s.max_queued_reviews, s.review_rate_limit, s.sse_max_per_ip) == (80, "9/hour", BASE.sse_max_per_ip)
    assert BASE.max_queued_reviews == 50 and apply_overrides(BASE, {}) is BASE


def test_change_summary_says_env_for_unset_values():
    assert summarize_settings({"values": {"max_queued_reviews": 50}}, {"values": {"review_rate_limit": "9/hour"}}) == {
        "max_queued_reviews": "50 → env", "review_rate_limit": "env → 9/hour"}
    assert SETTINGS_KIND.seed() == {"values": {}}
    assert SETTINGS_KIND.mirror({"values": {"max_queued_reviews": 1}}) == {"values": {"max_queued_reviews": 1}}


async def test_capacity_checks_against_the_settings_it_is_given(redis):
    cap = Capacity(redis, BASE)
    assert cap.worst_case_cap() == worst_case_review_cap(BASE)
    assert await cap.check(queued=1) is None
    refusal = await cap.check(queued=1, settings=apply_overrides(BASE, {"max_queued_reviews": 1}))
    assert refusal is not None and refusal.reason == "queue_full"


async def save(session_factory, kind, raw):
    async with session_factory() as s, s.begin():
        current = await newest(s, kind)
        return await save_version(s, OWNER, kind, raw, settings=BASE,
                                  base_version=current.version if current else None)


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


async def test_runtime_config_caches_for_the_ttl_and_follows_a_publish(session_factory, redis):
    clock = Clock()
    rc = RuntimeConfig(BASE, session_factory, redis, ttl=5.0, clock=clock)
    assert await rc.settings() is BASE and await rc.settings_version() is None and await rc.glossary_label() == "file"
    row = await save(session_factory, SETTINGS_KIND, {"values": {"max_queued_reviews": 80}})
    await publish(redis, SETTINGS_KIND, row)
    assert (await rc.settings()).max_queued_reviews == 50  # still cached
    clock.now = 5.1
    assert (await rc.settings()).max_queued_reviews == 80 and await rc.settings_version() == 1
    g = await save(session_factory, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    await publish(redis, GLOSSARY_KIND, g)
    rc.invalidate()
    assert await rc.glossary_label() == "1"


async def test_runtime_config_keeps_the_last_values_when_everything_is_down(session_factory, redis):
    clock = Clock()
    rc = RuntimeConfig(BASE, session_factory, redis, ttl=5.0, clock=clock)
    row = await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 9}})
    await publish(redis, SETTINGS_KIND, row)
    assert (await rc.settings()).sse_max_per_ip == 9

    class Down:
        async def get(self, *_):
            raise ConnectionError("down")

        async def set(self, *_, **__):
            raise ConnectionError("down")

    def broken_factory():
        raise OSError("db down")

    rc.redis, rc.session_factory = Down(), broken_factory
    clock.now = 10.0
    assert (await rc.settings()).sse_max_per_ip == 9  # the last values it knew
    assert await RuntimeConfig(BASE, broken_factory, Down(), clock=clock).settings() is BASE  # none known yet: env


async def test_load_runtime_reads_the_db(session_factory):
    rt = await load_runtime(session_factory, BASE)
    assert (rt.settings, rt.settings_version, rt.glossary) == (BASE, "env", SEED_GLOSSARY)
    await save(session_factory, SETTINGS_KIND, {"values": {"llm_concurrency": 4}})
    await save(session_factory, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    rt = await load_runtime(session_factory, BASE)
    assert rt.settings.llm_concurrency == 4 and rt.settings_version == "1"
    assert rt.glossary == ActiveGlossary(1, "placebo = ยาหลอก")


async def test_capacity_follows_the_cost_values_of_the_settings_it_is_given(redis):
    cap = Capacity(redis, BASE)
    pricey = apply_overrides(BASE, {"review_cost_base_usd": 0.5, "max_cost_per_review_usd": 2.0,
                                    "max_usd_per_day": 2.0})
    assert worst_case_review_cap(pricey) > worst_case_review_cap(BASE)
    # two reviews already queued: 3 x the worst case must fit. 3 x 0.40 fits in $2, 3 x 0.86 does not.
    assert await cap.check(queued=2, settings=BASE.model_copy(update={"max_usd_per_day": 2.0})) is None
    refusal = await cap.check(queued=2, settings=pricey)
    assert refusal is not None and refusal.reason == "daily_budget"
    assert cap.worst_case_cap(pricey) == worst_case_review_cap(pricey) != cap.worst_case_cap()


def test_the_daily_budget_is_checked_against_the_merged_settings():
    assert validate_settings({"values": {"max_usd_per_day": 1}}, BASE)[0] == {"values": {"max_usd_per_day": 1.0}}
    with pytest.raises(DocumentError, match="no review could be admitted") as info:
        validate_settings({"values": {"max_usd_per_day": 1, "max_cost_per_review_usd": 2,
                                      "review_cost_base_usd": 1}}, BASE)
    assert info.value.errors[0]["field"] == "max_usd_per_day"


def test_a_zero_per_review_cap_is_refused_without_echoing_values():
    zero = {"review_cost_base_usd": 0, "review_cost_per_paper_usd": 0, "review_cost_per_candidate_usd": 0}
    with pytest.raises(DocumentError) as info:
        validate_settings({"values": zero}, BASE)
    assert info.value.errors == [{"field": "review_cost_base_usd", "message": (
        "the per-review cap would be $0 — at least one cost value must be above 0")}]
    zero_in_env = BASE.model_copy(update={name: 0.0 for name in zero})
    with pytest.raises(DocumentError, match="above 0"):  # the merge counts: nothing in the document sets a cost
        validate_settings({"values": {"max_queued_reviews": 5}}, zero_in_env)
    validate_settings({"values": {**zero, "review_cost_per_paper_usd": 0.001}}, BASE)  # one cost above 0 is enough


def test_values_that_are_not_a_mapping_leave_the_env_settings_alone():
    for bad in ([1, 2], "oops", 7, None, ()):
        assert apply_overrides(BASE, bad) is BASE


async def test_a_hand_written_mirror_with_odd_values_never_raises(session_factory, redis):
    clock = Clock()
    rc = RuntimeConfig(BASE, session_factory, redis, ttl=5.0, clock=clock)
    key = SETTINGS_KIND.redis_key
    await redis.set(key, json.dumps({"version": 3, "values": [1, 2]}))
    assert await rc.settings() is BASE and await rc.settings_version() == 3
    clock.now = 6.0
    await redis.set(key, json.dumps({"version": 4, "values": "oops"}))
    assert await rc.settings() is BASE and await rc.settings_version() == 4
    clock.now = 12.0
    await redis.set(key, json.dumps({"version": 5, "values": {"max_queued_reviews": 77}}))
    assert (await rc.settings()).max_queued_reviews == 77


async def test_an_invalidate_during_a_refresh_is_not_undone_by_it(session_factory, redis):
    """The refresh read the mirror before a save; the save then published and invalidated. Storing that old read would
    keep the old settings for a whole TTL in the process that saved."""
    started, release = asyncio.Event(), asyncio.Event()
    reads = []

    class Gated:
        async def get(self, key):
            value = await redis.get(key)  # read first: what a refresh that began before the save sees
            reads.append(key)
            started.set()
            await release.wait()
            return value

        def __getattr__(self, name):
            return getattr(redis, name)

    rc = RuntimeConfig(BASE, session_factory, Gated(), ttl=5.0, clock=Clock())
    refresh = asyncio.create_task(rc.settings())
    await started.wait()
    row = await save(session_factory, SETTINGS_KIND, {"values": {"max_queued_reviews": 80}})
    await publish(redis, SETTINGS_KIND, row)
    rc.invalidate()
    release.set()
    await refresh
    before = len(reads)
    assert (await rc.settings()).max_queued_reviews == 80 and await rc.settings_version() == 1
    assert len(reads) > before  # it read again instead of trusting the refresh that was overtaken


async def test_a_failed_refresh_is_not_retried_within_the_ttl(session_factory):
    clock = Clock()
    calls = {"redis": 0, "db": 0}

    class Down:
        async def get(self, *_):
            calls["redis"] += 1
            raise ConnectionError("down")

    def broken_factory():
        calls["db"] += 1
        raise OSError("db down")

    rc = RuntimeConfig(BASE, broken_factory, Down(), ttl=5.0, clock=clock)
    for _ in range(3):
        assert await rc.settings() is BASE and await rc.glossary_label() == "file"
    assert calls == {"redis": 1, "db": 1}
    clock.now = 5.1
    assert await rc.settings() is BASE
    assert calls == {"redis": 2, "db": 2}


async def test_a_hung_read_is_bounded_and_keeps_the_last_values(session_factory, redis, monkeypatch):
    """The app sets no Redis or DB client timeouts and every hot path asks RuntimeConfig, so one hung read must not
    stall them: it counts as a failed read (last values kept, the TTL advances, nothing raised)."""
    from app.services import runtime_config

    monkeypatch.setattr(runtime_config, "RUNTIME_READ_TIMEOUT_SECONDS", 0.25)  # room for a slow but live read
    clock = Clock()
    hang = {"on": False, "calls": 0}

    class Hangs:
        async def get(self, key):
            hang["calls"] += 1
            if hang["on"]:
                await asyncio.sleep(30)
            return await redis.get(key)

        def __getattr__(self, name):
            return getattr(redis, name)

    rc = RuntimeConfig(BASE, session_factory, Hangs(), ttl=5.0, clock=clock)
    row = await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 9}})
    await publish(redis, SETTINGS_KIND, row)
    assert (await rc.settings()).sse_max_per_ip == 9

    hang["on"], hang["calls"] = True, 0
    clock.now = 10.0
    started = asyncio.get_running_loop().time()
    assert (await asyncio.wait_for(rc.settings(), timeout=2)).sse_max_per_ip == 9  # the last values it knew
    assert asyncio.get_running_loop().time() - started < 1.0
    assert await rc.settings_version() == 1 and await rc.glossary_label() == "file"
    assert hang["calls"] == 1  # the failed read advanced the TTL: callers do not each wait the bound again

    # none known yet: env
    fresh = RuntimeConfig(BASE, session_factory, Hangs(), ttl=5.0, clock=clock)
    assert await asyncio.wait_for(fresh.settings(), timeout=2) is BASE

    hang["on"] = False
    clock.now = 20.0
    assert (await rc.settings()).sse_max_per_ip == 9 and hang["calls"] >= 2  # it reads again after the TTL
