import uuid
from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.services.admin_dashboard import build_dashboard
from app.services.capacity import Capacity
from tests.admin_helpers import admin_headers

NOW = datetime(2026, 10, 12, 15, 0, tzinfo=UTC)
A = "openrouter:qwen/qwen3.5-flash-02-23"


async def make(session_factory, status, cost, *, ago: timedelta, synthesizer: str | None = None):
    async with session_factory() as s, s.begin():
        r = await ReviewRepository(s).create(topic="t", language="th", options={}, cache_key=str(uuid.uuid4()))
        r.status, r.cost_usd, r.created_at = status, cost, NOW - ago
        r.model_versions = {"synthesizer": synthesizer} if synthesizer else None


async def test_empty_window_is_zero_filled(session_factory, redis):
    s = Settings(_env_file=None)
    d = await build_dashboard(session_factory, Capacity(redis, s), s, days=3, now=NOW)
    assert [p["date"] for p in d["per_day"]] == ["2026-10-10", "2026-10-11", "2026-10-12"]
    assert all(p == {"date": p["date"], "by_status": {}, "cost_usd": 0.0} for p in d["per_day"])
    assert d["since"] == "2026-10-10" and d["days"] == 3
    assert d["totals"] == {"reviews": 0, "by_status": {}, "cost_usd": 0.0, "avg_cost_done_usd": None}
    assert d["error_rate_7d"] is None and d["by_model"] == []


async def test_tallies_error_rate_and_cost_by_synthesizer(session_factory, redis):
    await make(session_factory, "done", 0.1, ago=timedelta(hours=1), synthesizer=A)
    await make(session_factory, "error", 0.02, ago=timedelta(hours=2), synthesizer=A)
    await make(session_factory, "rejected", 0.0, ago=timedelta(hours=3))
    await make(session_factory, "done", 0.2, ago=timedelta(days=1))
    await make(session_factory, "error", 0.05, ago=timedelta(days=5), synthesizer=A)  # in the week, not the window
    await make(session_factory, "done", 9.0, ago=timedelta(days=10), synthesizer=A)  # outside both
    s = Settings(_env_file=None)
    d = await build_dashboard(session_factory, Capacity(redis, s), s, days=3, now=NOW)
    today, yesterday = d["per_day"][-1], d["per_day"][-2]
    assert today["by_status"] == {"done": 1, "error": 1, "rejected": 1} and today["cost_usd"] == 0.12
    assert yesterday["by_status"] == {"done": 1} and yesterday["cost_usd"] == 0.2
    assert d["totals"]["reviews"] == 4 and d["totals"]["by_status"] == {"done": 2, "error": 1, "rejected": 1}
    assert d["totals"]["cost_usd"] == 0.32 and d["totals"]["avg_cost_done_usd"] == 0.15
    assert d["error_rate_7d"] == 0.5  # 2 errors / (2 done + 2 errors) in the last 7 days; rejections never count
    assert d["by_model"] == [{"synthesizer": "unknown", "reviews": 2, "cost_usd": 0.2},
                             {"synthesizer": A, "reviews": 2, "cost_usd": 0.12}]


async def test_route_reports_capacity_with_caps_from_settings(client, session_factory, app):
    headers = await admin_headers(client, session_factory)
    capacity = app.state.deps.service.capacity
    await capacity.note_review()
    await capacity.note_cost(0.4)
    await make(session_factory, "queued", 0.0, ago=timedelta(minutes=1))
    d = (await client.get("/api/v1/admin/dashboard", params={"days": 7}, headers=headers)).json()
    s = app.state.deps.service.settings
    assert len(d["per_day"]) == 7
    assert d["capacity"] == {"accepting": True, "reason": None, "queued": 1, "running": 0,
                             "max_queued_reviews": s.max_queued_reviews, "reviews_today": 1,
                             "max_reviews_per_day": s.max_reviews_per_day, "usd_today": 0.4,
                             "max_usd_per_day": s.max_usd_per_day}
    for bad in (0, 91):
        assert (await client.get("/api/v1/admin/dashboard", params={"days": bad}, headers=headers)).status_code == 422
