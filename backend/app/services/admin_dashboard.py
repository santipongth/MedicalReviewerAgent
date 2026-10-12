"""Admin dashboard numbers (Plan 23a). One window of review rows is aggregated in Python, which keeps one code path
for Postgres and sqlite (the window is at most 90 days of a small service). Days are UTC, like the daily caps.
Cost is stored per review, so `by_model` is "cost of reviews whose synthesizer was X", not a per-model bill."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import select

from app.db.models import Review
from app.db.repositories import ReviewRepository

WEEK = timedelta(days=7)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _money(value: float) -> float:
    return round(value, 4)


async def build_dashboard(session_factory, capacity, settings, *, days: int,
                          now: datetime | None = None) -> dict[str, Any]:
    now = _utc(now or datetime.now(UTC))
    first_day = now.date() - timedelta(days=days - 1)
    since = datetime.combine(first_day, time.min, tzinfo=UTC)
    week_ago = now - WEEK
    async with session_factory() as session:
        rows = (await session.execute(
            select(Review.created_at, Review.status, Review.cost_usd, Review.model_versions)
            .where(Review.created_at >= min(since, week_ago)))).all()
        repo = ReviewRepository(session)
        queued, running = await repo.count_by_status("queued"), await repo.count_by_status("running")

    per_day: dict = {first_day + timedelta(days=i): {"by_status": Counter(), "cost_usd": 0.0} for i in range(days)}
    totals: Counter = Counter()
    week: Counter = Counter()
    cost_total = done_cost = 0.0
    by_model: dict[str, dict[str, Any]] = defaultdict(lambda: {"reviews": 0, "cost_usd": 0.0})
    for created, status, cost, models in rows:
        created, cost = _utc(created), float(cost or 0.0)
        if created >= week_ago:
            week[status] += 1
        day = per_day.get(created.date()) if created >= since else None
        if day is None:
            continue
        day["by_status"][status] += 1
        day["cost_usd"] += cost
        totals[status] += 1
        cost_total += cost
        if status == "done":
            done_cost += cost
        model = by_model[(models or {}).get("synthesizer") or "unknown"]
        model["reviews"] += 1
        model["cost_usd"] += cost

    judged = week["done"] + week["error"]
    refusal = await capacity.check(queued=queued, running=running) if capacity is not None else None
    return {
        "days": days,
        "since": first_day.isoformat(),
        "per_day": [{"date": d.isoformat(), "by_status": dict(v["by_status"]), "cost_usd": _money(v["cost_usd"])}
                    for d, v in sorted(per_day.items())],
        "totals": {"reviews": sum(totals.values()), "by_status": dict(totals), "cost_usd": _money(cost_total),
                   "avg_cost_done_usd": _money(done_cost / totals["done"]) if totals["done"] else None},
        "error_rate_7d": round(week["error"] / judged, 4) if judged else None,
        "by_model": sorted(({"synthesizer": k, "reviews": v["reviews"], "cost_usd": _money(v["cost_usd"])}
                            for k, v in by_model.items()), key=lambda m: (-m["cost_usd"], m["synthesizer"])),
        "capacity": {
            "accepting": refusal is None, "reason": refusal.reason if refusal else None,
            "queued": queued, "running": running, "max_queued_reviews": settings.max_queued_reviews,
            "reviews_today": await capacity.reviews_today() if capacity is not None else 0,
            "max_reviews_per_day": settings.max_reviews_per_day,
            "usd_today": _money(await capacity.usd_today()) if capacity is not None else 0.0,
            "max_usd_per_day": settings.max_usd_per_day,
        },
    }
