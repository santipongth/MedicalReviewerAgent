"""Plan 22a: freeze each manifest review's candidate pool once (intake + retrieval, with the Cochrane year cutoff)."""
from __future__ import annotations

from datetime import UTC, datetime

from app.evals import models
from app.evals.leakage import drop_target
from app.evals.models import Fixture, Manifest, ManifestEntry
from app.graph.graph import build_freeze_graph, initial_state
from app.services.sources import effective_sources


def freeze_engines(deps) -> list[str]:
    """The sources a frozen pool was searched with: the SearXNG engines, plus thaijo when it was on (Plan 24). Plan
    23d: the deps' sources (the console's set from the DB; env with --config-file, or when the deps carry none)."""
    sources = deps.sources if deps.sources is not None else effective_sources(deps.settings, {})
    engines = [e.strip() for e in sources.engines.split(",") if e.strip()]
    return engines + (["thaijo"] if sources.thaijo else [])


def entry_options(entry: ManifestEntry) -> dict:
    return {"review_type": entry.review_type, "max_papers": 30, "candidate_limit": 120}


async def freeze_one(deps, entry: ManifestEntry, *, pool_version: str, git_sha: str, engines: list[str]) -> Fixture:
    base = {"id": entry.id, "pool_version": pool_version, "frozen_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "git_sha": git_sha, "prompt_version": deps.settings.prompt_version, "engines": engines,
            "year_to": entry.year_to or 9999, "pmid": entry.pmid, "title": entry.title, "topic": entry.question}
    if entry.year_to is None:  # never freeze without a cutoff
        return Fixture(**base, english_topic=None, question=None, plan=None, candidates=[], search_stats={},
                       status="error", error="no year_to (search date) in manifest")
    state = {**initial_state(f"freeze-{entry.id}", entry.question, "en", entry_options(entry)),
             "eval_year_to": entry.year_to}
    try:
        values = await build_freeze_graph(deps).ainvoke(state, {"configurable": {"thread_id": f"freeze-{entry.id}"}})
    except Exception as exc:  # noqa: BLE001 - recorded, stays in the denominators
        return Fixture(**base, english_topic=None, question=None, plan=None, candidates=[], search_stats={},
                       status="error", error=f"{type(exc).__name__}: {exc}")
    status = "rejected" if values.get("rejected") else "ok"
    candidates, removed = drop_target(values.get("candidates") or [], entry.id, entry.pmid, entry.title)
    return Fixture(**base, english_topic=values.get("english_topic"), question=values.get("question"),
                   plan=values.get("plan"), candidates=candidates,
                   search_stats={**(values.get("search_stats") or {}), "target_removed": removed}, status=status,
                   error=str(values.get("rejected") or ""))


def _selected(manifest: Manifest, ids: list[str] | None) -> list[ManifestEntry]:
    return [e for e in manifest.reviews
            if e.status == "eligible" and e.checked_by_owner and (ids is None or e.id in ids)]


async def freeze_all(deps, manifest: Manifest, *, ids: list[str] | None, force: bool, git_sha: str,
                     engines: list[str]) -> list[Fixture]:
    out: list[Fixture] = []
    for entry in _selected(manifest, ids):
        path = models.fixture_path(manifest.pool_version, entry.id)
        if path.exists() and not force:
            out.append(models.read_model(path, Fixture))
            continue
        fx = await freeze_one(deps, entry, pool_version=manifest.pool_version, git_sha=git_sha, engines=engines)
        models.write_json_atomic(path, fx)
        out.append(fx)
    return out
