"""Plan 22a: the Cochrane sampling frame (Europe PMC), a seeded draw per stratum, and an LLM eligibility check of
each abstract (intervention review, GRADE reported, >= 3 RCTs for the primary outcome, a stated search date). Every
checked record is kept with its reason; the owner checks the list before freezing."""
from __future__ import annotations

import json
import random
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.evals import models
from app.evals.models import Manifest, ManifestEntry, Stratum, write_json_atomic
from app.graph.nodes.intake import harness_runner

_CD = re.compile(r"(CD\d{6})", re.IGNORECASE)
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_PUB = re.compile(r"\.pub(\d+)$", re.IGNORECASE)


class CochraneEligibility(BaseModel):
    eligible: bool
    reason: str  # why not eligible ("" when eligible)
    question: str  # the review question as a one-sentence English question (population, intervention, comparator)
    primary_outcome: str
    search_date: str | None  # YYYY-MM-DD of the latest search as stated in the abstract, or null if not stated
    review_type: Literal["slr", "meta_analysis"]  # meta_analysis when the primary outcome was pooled
    rct_count: int | None
    grade_reported: bool


SYSTEM = """You screen Cochrane review abstracts for a benchmark. Decide eligibility:
- an intervention review (not diagnostic accuracy, prognosis, methodology or an overview of reviews);
- certainty of evidence reported with GRADE for the primary outcome;
- at least 3 randomised controlled trials contribute to the primary outcome.
Extract: the review question as one English sentence (population, intervention, comparator); the primary outcome;
the date of the latest search as YYYY-MM-DD exactly as stated (use the last day of the month when only month and year
are given; null when the abstract states no search date - never guess); review_type "meta_analysis" when the primary
outcome was pooled in a meta-analysis, else "slr"; the number of RCTs for the primary outcome (null if not stated)."""


def cochrane_id(doi: str) -> str:
    m = _CD.search(doi or "")
    return m.group(1).upper() if m else ""


def frame_query(manifest: Manifest, stratum: Stratum) -> str:
    return (f'JOURNAL:"Cochrane Database Syst Rev" AND PUB_YEAR:[{manifest.year_from} TO {manifest.year_to}] '
            f"AND ({stratum.query})")


async def frame(http, base_url: str, manifest: Manifest, stratum: Stratum) -> tuple[list[dict[str, Any]], int]:
    """All records of the stratum query and Europe PMC's hitCount from the first page."""
    query = frame_query(manifest, stratum)
    out: list[dict[str, Any]] = []
    hit_count = 0
    cursor = "*"
    while True:
        resp = await http.get(f"{base_url.rstrip('/')}/search", params={
            "query": query, "format": "json", "resultType": "core", "pageSize": 1000, "cursorMark": cursor},
            retries=6)  # ~30 s of backoff: Europe PMC answers 503 in bursts
        resp.raise_for_status()
        body = resp.json()
        if cursor == "*":
            hit_count = int(body.get("hitCount") or 0)
        page = (body.get("resultList") or {}).get("result") or []
        out.extend(page)
        nxt = body.get("nextCursorMark")
        if not page or not nxt or nxt == cursor:
            return out, hit_count
        cursor = nxt


def cochrane_version(doi: str) -> int:
    """The pubN of a Cochrane DOI (10.1002/14651858.CD012345.pub3 -> 3); no .pub suffix counts as version 1."""
    m = _PUB.search(doi or "")
    return int(m.group(1)) if m else 1


def latest_per_review(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One record per Cochrane id: the highest pubN (first seen on a tie). Order follows first appearance."""
    best: dict[str, dict[str, Any]] = {}
    for r in records:
        cid = cochrane_id(r.get("doi", ""))
        if not cid:
            continue
        if cid not in best or cochrane_version(r["doi"]) > cochrane_version(best[cid]["doi"]):
            best[cid] = r
    return list(best.values())


def _exclusion(v: Any) -> str:
    """Why a judged record is out; '' when it is eligible. A value that is not the schema counts as no answer."""
    if not isinstance(v, CochraneEligibility):
        return "model gave no answer"
    if not v.eligible:
        return v.reason or "not eligible"
    if not v.search_date or not _DATE.fullmatch(v.search_date):
        return "no search date"
    return ""


async def select(deps, http, base_url: str, manifest: Manifest,
                 on_entry: Callable[[Manifest, ManifestEntry], None] | None = None) -> Manifest:
    """`on_entry` sees the manifest after every judged record (the CLI saves it), so an interrupted run resumes with
    `select --continue` and, because the draw order ignores what is already taken, ends with the same entries."""
    runner = harness_runner(deps)
    judge = deps.llms.with_schema("planner", CochraneEligibility)
    reviews = list(manifest.reviews)
    judged = {e.id for e in reviews}  # a review lands in the first stratum that reaches it
    for stratum in manifest.strata:
        # a top-up (select --continue) starts from the stratum's eligible entries already in the manifest; a full
        # stratum is not fetched again, so its committed frame file keeps documenting the draw its entries came from
        eligible = sum(1 for e in reviews if e.stratum == stratum.name and e.status == "eligible")
        if eligible >= manifest.per_stratum:
            continue
        found, hit_count = await frame(http, base_url, manifest, stratum)
        deduped = latest_per_review(found)
        # sorted first: Europe PMC's relevance order drifts over time, the seeded draw must not
        records = sorted(deduped, key=lambda r: cochrane_id(r["doi"]))
        random.Random(f"{manifest.seed}:{stratum.name}").shuffle(records)
        draw = [cochrane_id(r["doi"]) for r in records]
        frame_path = models.EVAL_ROOT / "frames" / f"{stratum.name}.json"
        # a resumed stratum must follow the draw its entries came from, or the frame file stops documenting them
        if (any(e.stratum == stratum.name for e in reviews) and frame_path.exists()
                and json.loads(frame_path.read_text(encoding="utf-8")).get("ids_in_draw_order") != draw):
            raise ValueError(f"draw order of {stratum.name} changed since its entries were drawn (Europe PMC "
                             "records changed); rebuild with select --force")
        write_json_atomic(frame_path, {
            "query": frame_query(manifest, stratum), "run_date": datetime.now(UTC).isoformat(timespec="seconds"),
            "hit_count": hit_count, "collected": len(deduped),
            "ids_in_draw_order": draw})
        for r in records:
            if eligible >= manifest.per_stratum:
                break
            if cochrane_id(r["doi"]) in judged:  # here (a resumed run) or in an earlier stratum
                continue
            user = f"Title: {r.get('title', '')}\nAbstract: {r.get('abstractText', '')}"
            res = await runner.call(judge, SYSTEM, user, schema=CochraneEligibility)
            v = res.value
            base = {"id": cochrane_id(r["doi"]), "pmid": str(r.get("pmid") or ""), "doi": r.get("doi", ""),
                    "stratum": stratum.name, "title": r.get("title", "")}
            reason = _exclusion(v)
            if reason:
                entry = ManifestEntry(**base, status="excluded", exclusion_reason=reason)
            else:
                eligible += 1
                entry = ManifestEntry(**base, question=v.question, review_type=v.review_type,
                                      primary_outcome=v.primary_outcome, search_date=v.search_date,
                                      year_to=int(v.search_date[:4]))
            reviews.append(entry)
            judged.add(entry.id)
            if on_entry is not None:
                on_entry(manifest.model_copy(update={"reviews": list(reviews)}), entry)
    return manifest.model_copy(update={"reviews": reviews})
