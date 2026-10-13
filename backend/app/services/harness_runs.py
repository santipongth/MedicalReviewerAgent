"""Cochrane harness runs started from the admin console (Plan 23c). The API side checks that a run can start
(harness_state), records it (start_run: one active run; a typed cap between one review's own cap and
HARNESS_MAX_USD) and cancels it; the harness worker (app/worker/harness.py) claims, updates and finishes it. Nothing
here spends money: the worker never starts a review whose own cap does not fit in what is left
(run_all strict_cap)."""
from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import HarnessRun
from app.evals import models as eval_models
from app.evals.freeze import _selected, entry_options
from app.evals.models import Manifest, ManifestEntry, load_manifest
from app.evals.results import list_results
from app.schemas.review import ReviewOptions
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.budget import review_cost_cap
from app.services.review_service import Conflict, NotFound, ServiceError, Unprocessable

WORKER_KEY = "mra:harness:worker"
WORKER_TTL_SECONDS = 90
DEFAULT_CAP_USD = 1.0
REPEATS_MAX = 2
LABEL_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
OUT_FIELDS = ("id", "run_id", "prompt_version", "status", "max_usd", "spent_usd", "repeats", "strata", "max_reviews",
              "compare_run", "planned", "done", "failed", "skipped", "created_by", "created_at", "started_at",
              "finished_at", "error", "report", "config")


class HarnessUnavailable(ServiceError):
    status_code = 503

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("the harness cannot start a run now: " + ", ".join(reasons))
        self.reasons = reasons


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_usd: float = Field(gt=0, allow_inf_nan=False)
    repeats: int = Field(2, ge=1, le=REPEATS_MAX)
    strata: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=20)
    max_reviews: int | None = Field(None, ge=1, le=1000)
    compare_run: str | None = Field(None, max_length=129, pattern=LABEL_PATTERN)
    confirm: Literal[True]


def selection(manifest: Manifest, strata: list[str], max_reviews: int | None) -> list[ManifestEntry]:
    """The checked reviews of the chosen strata (all when empty) that have a frozen pool, in manifest order."""
    entries = [e for e in _selected(manifest, None) if (not strata or e.stratum in strata)
               and eval_models.fixture_path(manifest.pool_version, e.id).exists()]
    return entries[:max_reviews] if max_reviews else entries


def per_review_cap(settings: Settings, entries: list[ManifestEntry]) -> float:
    return max((review_cost_cap(settings, ReviewOptions.clamped(entry_options(e))) for e in entries), default=0.0)


def run_out(row: HarnessRun) -> dict[str, Any]:
    return {k: getattr(row, k) for k in OUT_FIELDS}


def _manifest() -> Manifest | None:
    try:
        return load_manifest()
    except (OSError, ValueError, yaml.YAMLError):
        return None


async def _worker(redis) -> dict | None:
    try:
        raw = await redis.get(WORKER_KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001 - an unreachable Redis reads as "no worker"
        return None


async def harness_state(session_factory, redis, settings: Settings) -> dict[str, Any]:
    manifest = _manifest()
    reasons: list[str] = []
    strata: list[dict[str, Any]] = []
    selected = present = 0
    cap = 0.0
    if manifest is None:
        reasons.append("no_manifest")
    else:
        checked, ready = _selected(manifest, None), selection(manifest, [], None)
        names = [s.name for s in manifest.strata] or sorted({e.stratum for e in checked})
        strata = [{"name": n, "selected": sum(e.stratum == n for e in checked),
                   "with_fixtures": sum(e.stratum == n for e in ready)} for n in names]
        selected, present, cap = len(checked), len(ready), per_review_cap(settings, ready)
        if not ready:
            reasons.append("no_fixtures")
    if settings.graph_mode == "stub":
        reasons.append("stub_mode")
    worker = await _worker(redis)
    if worker is None:
        reasons.append("no_worker")
    async with session_factory() as session:
        active = (await session.execute(select(HarnessRun).where(HarnessRun.active.is_not(None)))).scalar_one_or_none()
        last = (await session.execute(
            select(HarnessRun).where(HarnessRun.status.in_(("done", "stopped")), HarnessRun.done + HarnessRun.failed > 0)
            .order_by(HarnessRun.id.desc()).limit(1))).scalar_one_or_none()
    if active is not None:
        reasons.append("active_run")
    return {"available": not reasons, "reasons": reasons, "prompt_version": settings.prompt_version,
            "pool_version": manifest.pool_version if manifest else None, "strata": strata,
            "fixtures": {"selected": selected, "present": present}, "worker": worker,
            "ceiling_usd": settings.harness_max_usd, "default_usd": DEFAULT_CAP_USD,
            "per_review_cap_usd": round(cap, 4),
            "typical_review_usd": round(last.spent_usd / (last.done + last.failed), 4) if last else None,
            "active": run_out(active) if active else None}


async def start_run(session_factory, redis, settings: Settings, actor: AdminPrincipal, body: StartBody, *,
                    ip_hash: str | None = None) -> HarnessRun:
    """Checks every rule, then records the run (queued, active) with its audit row. The caller enqueues it."""
    state = await harness_state(session_factory, redis, settings)
    if "active_run" in state["reasons"]:
        raise Conflict("a harness run is already queued or running")
    if state["reasons"]:
        raise HarnessUnavailable(state["reasons"])
    manifest = load_manifest()
    if set(body.strata) - {s["name"] for s in state["strata"]}:
        raise Unprocessable("unknown strata: pick from the list")
    entries = selection(manifest, body.strata, body.max_reviews)
    if not entries:
        raise Unprocessable("nothing to run: no checked review in the chosen strata has a frozen pool")
    cap, ceiling = per_review_cap(settings, entries), settings.harness_max_usd
    if body.max_usd > ceiling:
        raise Unprocessable(f"the cap is above the ceiling of ${ceiling:.2f} (HARNESS_MAX_USD)")
    if body.max_usd < cap:
        raise Unprocessable(f"the cap must cover at least one review's own cap (${cap:.2f})")
    if body.compare_run and body.compare_run not in {r["label"] for r in list_results()}:
        raise Unprocessable("the comparison run has no run files")
    now = datetime.now(UTC)
    run_id = f"console-{now:%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"  # the suffix keeps two starts in one second apart
    row = HarnessRun(run_id=run_id, prompt_version=settings.prompt_version, status="queued", active=1,
                     max_usd=body.max_usd, spent_usd=0.0, repeats=body.repeats,
                     strata=sorted(set(body.strata)), max_reviews=body.max_reviews, compare_run=body.compare_run,
                     planned=len(entries) * body.repeats, done=0, failed=0, skipped=0,
                     created_by=actor.label[:64], created_at=now, config={})
    try:
        async with session_factory() as session, session.begin():
            session.add(row)
            await session.flush()
            await record(session, actor, "harness.start", target_type="harness_run", target_id=row.id,
                         after={"run_id": row.run_id, "max_usd": row.max_usd, "repeats": row.repeats,
                                "strata": row.strata, "max_reviews": row.max_reviews, "planned": row.planned},
                         ip_hash=ip_hash)
    except IntegrityError as exc:  # another start won the one active slot
        raise Conflict("a harness run is already queued or running") from exc
    return row


async def cancel_run(session_factory, actor: AdminPrincipal, run_pk: int, *,
                     ip_hash: str | None = None) -> HarnessRun:
    """Graceful: a running batch stops before its next review; a queued run is over at once. Clears a stuck row."""
    async with session_factory() as session, session.begin():
        row = await session.get(HarnessRun, run_pk)
        if row is None:
            raise NotFound("harness run not found")
        if row.active is None:
            raise Conflict(f"the run is already {row.status}")
        before = row.status
        row.status, row.active = "cancelled", None
        if before == "queued":
            row.finished_at = datetime.now(UTC)
        await record(session, actor, "harness.cancel", target_type="harness_run", target_id=row.id,
                     before={"status": before}, after={"status": "cancelled"}, ip_hash=ip_hash)
    return row


async def list_runs(session_factory, *, before: int | None = None,
                    limit: int = 20) -> tuple[list[HarnessRun], int | None]:
    stmt = select(HarnessRun).order_by(HarnessRun.id.desc()).limit(limit + 1)
    if before is not None:
        stmt = stmt.where(HarnessRun.id < before)
    async with session_factory() as session:
        rows = list((await session.execute(stmt)).scalars())
    return rows[:limit], (rows[limit - 1].id if len(rows) > limit else None)


async def get_run(session_factory, run_pk: int) -> HarnessRun:
    async with session_factory() as session:
        row = await session.get(HarnessRun, run_pk)
    if row is None:
        raise NotFound("harness run not found")
    return row


async def finish(session_factory, run_pk: int, *, status: str, summary=None, report: str | None = None,
                 error: str | None = None) -> None:
    """The run's end: counts, report and error; the active slot is freed; a cancelled run stays cancelled."""
    values: dict[str, Any] = {"active": None, "finished_at": datetime.now(UTC), "report": report,
                              "error": error[:500] if error else None}
    if summary is not None:
        values |= {"spent_usd": round(summary.spent, 6), "done": summary.done, "failed": summary.failed,
                   "skipped": summary.skipped}
    async with session_factory() as session, session.begin():
        current = await session.scalar(select(HarnessRun.status).where(HarnessRun.id == run_pk))
        if current is None:
            return
        if current != "cancelled":
            values["status"] = status
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(**values))


async def claim(session_factory, run_pk: int) -> HarnessRun | None:
    """queued → running; a retry after a shutdown finds it queued again. None, with the row untouched, when the run
    is missing, holds no active slot, or is not queued (cancelled, errored, finished or already running): a job can
    outlive its row (an enqueue that raised after Redis took the job leaves a job for a row already marked error, and
    cancelling a queued run frees its slot at once)."""
    async with session_factory() as session, session.begin():
        row = await session.get(HarnessRun, run_pk)
        if row is None or row.active is None or row.status != "queued":
            return None
        row.status = "running"
        row.started_at = row.started_at or datetime.now(UTC)
    return row


async def set_config(session_factory, run_pk: int, config: dict[str, str]) -> None:
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(config=config))


async def progress(session_factory, run_pk: int, summary) -> None:
    """Counts and spend after each record; never the status, so a cancel is not overwritten."""
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(
            spent_usd=round(summary.spent, 6), done=summary.done, failed=summary.failed, skipped=summary.skipped))


async def run_stopped(session_factory, run_pk: int) -> bool:
    """True once the run is no longer running (the admin cancelled it): the batch stops before its next review."""
    async with session_factory() as session:
        status = await session.scalar(select(HarnessRun.status).where(HarnessRun.id == run_pk))
    return status != "running"


async def requeue(session_factory, run_pk: int) -> None:
    """Worker shutdown: a running run goes back to queued; arq retries the job and run_all skips finished files."""
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk, HarnessRun.status == "running")
                              .values(status="queued"))
