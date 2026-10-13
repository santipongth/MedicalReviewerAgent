from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.types import Send

from app.graph.nodes.stub_result import stub_found, stub_result
from app.graph.progress import progress_writer
from app.graph.state import ReviewState
from app.schemas.review import ReviewOptions


async def plan_queries(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "planning", "topic": state["topic"]})
    return {}


def make_wait(seconds: float):
    """Load tests: the stub review takes about as long as a real one, without calling any model."""
    async def wait(state: ReviewState) -> dict:
        if seconds > 0:
            get_stream_writer()({"type": "reading", "ref": "P1", "title": "simulated paper"})
            await asyncio.sleep(seconds)
        return {}
    return wait


async def finalize(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "synthesizing"})
    opts = ReviewOptions.clamped(state.get("options"))
    return {
        "result": {
            "summary": f"Stub review for: {state['topic']}",
            "language": state["language"],
            "review_type": opts.review_type,
            # Plan 27: a quick stub answer cites nothing (the stub reads no paper)
            "mode": opts.mode, "quick": {"refs": [], "papers_read": 0} if opts.mode == "quick" else None,
            "papers": [],
            "comparison": [],
            "citations": None,
        }
    }


# ---- Realistic timed stub (STUB_DELAY_SECONDS > 0): the real event sequence on a scaled timeline ----

MAX_CANDIDATES = ReviewOptions.bound("candidate_limit")
MAX_KEPT = ReviewOptions.bound("max_papers")
STUB_DIRECTIONS = ("positive", "positive", "null", "negative", "mixed", "unclear", "positive")
STUB_DESIGNS = ("rct", "cohort", "sr_ma_rct", "case_control", "cohort")


@dataclass(frozen=True)
class StubTimeline:
    """Share of the total delay each phase takes (sums to 1.0). `screen` is per batch (batches run in
    parallel); `read` is the whole reading phase, spread over papers behind the LLM semaphore."""

    delay: float
    guard: float = 0.03
    refine: float = 0.07
    plan: float = 0.05
    search: float = 0.08
    enrich: float = 0.05
    screen: float = 0.10
    select: float = 0.02
    read: float = 0.35
    normalize: float = 0.05
    write_synthesis: float = 0.12  # silent, the longest single node
    localize: float = 0.05
    finalize: float = 0.03

    def seconds(self, phase: str, rng: random.Random) -> float:
        return getattr(self, phase) * self.delay * rng.uniform(0.8, 1.2)


def _rng(source: dict[str, Any], *key: Any) -> random.Random:
    """Deterministic per review (and per node/item), so a run can be replayed."""
    return random.Random(":".join(str(k) for k in (source.get("review_id", ""), *key)))


def _candidates(state: ReviewState) -> int:
    return min(ReviewOptions.clamped(state.get("options")).candidate_limit, MAX_CANDIDATES)


def _kept(state: ReviewState) -> int:
    return min(ReviewOptions.clamped(state.get("options")).max_papers, MAX_KEPT)


def make_phase(name: str, timeline: StubTimeline, emit):
    """A node that reports `emit(state)` (a list of progress payloads), then waits its phase share."""
    async def node(state: ReviewState) -> dict:
        writer = progress_writer()
        for event in emit(state):
            writer(event)
        await asyncio.sleep(timeline.seconds(name, _rng(state, name)))
        return {}
    node.__name__ = name
    return node


def make_timed_nodes(timeline: StubTimeline, settings) -> dict[str, Any]:
    pool = asyncio.Semaphore(max(1, settings.llm_concurrency))  # shared per process, like LimitedLLM
    batch_size = max(1, settings.screen_batch_size)

    async def refine_question(state: ReviewState) -> dict:
        topic = state["topic"]
        writer = progress_writer()
        writer({"type": "refining"})
        await asyncio.sleep(timeline.seconds("refine", _rng(state, "refine")) * 0.5)
        writer({"type": "question_refined", "interpretation": f"Evidence on {topic}",
                "refined_question": f"What does the published evidence say about {topic}?",
                "sub_questions": [f"How effective is the intervention for {topic}?",
                                  f"What harms or limitations are reported for {topic}?"],
                "assumptions": ["Original studies and pooled analyses are both considered."]})
        await asyncio.sleep(timeline.seconds("refine", _rng(state, "refine2")) * 0.5)
        return {}

    def plan_events(state: ReviewState) -> list[dict]:
        topic = state["topic"]
        return [{"type": "planning", "queries": [f"{topic} randomized controlled trial", f"{topic} cohort study",
                                                  f"{topic} systematic review meta-analysis", f"{topic} outcomes"]}]

    async def enrich(state: ReviewState) -> dict:
        n = _candidates(state)
        progress_writer()({"type": "enriching", "candidates": n})
        await asyncio.sleep(timeline.seconds("enrich", _rng(state, "enrich")))
        return {"candidates": [{"key": f"C{i + 1}"} for i in range(n)]}

    def route_to_screening(state: ReviewState) -> list[Send] | str:
        cands = state.get("candidates") or []
        if not cands:
            return "normalize_outcomes"
        return [Send("screen_batch", {"review_id": state.get("review_id", ""), "start": i,
                                      "batch": cands[i : i + batch_size]})
                for i in range(0, len(cands), batch_size)]

    async def screen_batch(payload: dict[str, Any]) -> dict:
        progress_writer()({"type": "screening", "batch": len(payload["batch"])})
        await asyncio.sleep(timeline.seconds("screen", _rng(payload, "screen", payload["start"])))
        return {"screened": [{"key": c["key"]} for c in payload["batch"]]}

    async def select_top(state: ReviewState) -> dict:
        kept = _kept(state)
        progress_writer()({"type": "screened", "kept": kept, "total": len(state.get("candidates") or []),
                           "requested": ReviewOptions.clamped(state.get("options")).max_papers})
        await asyncio.sleep(timeline.seconds("select", _rng(state, "select")))
        return {"selected": [{"ref": f"P{i + 1}"} for i in range(kept)]}

    def route_to_reading(state: ReviewState) -> list[Send] | str:
        selected = state.get("selected") or []
        if not selected:
            return "normalize_outcomes"
        common = {"review_id": state.get("review_id", ""), "topic": state["topic"], "kept": len(selected),
                  "review_type": ReviewOptions.clamped(state.get("options")).review_type}
        return [Send("read_paper", {"index": i + 1, **common}) for i in range(len(selected))]

    async def read_paper(payload: dict[str, Any]) -> dict:
        i, kept = payload["index"], payload["kept"]
        ref = f"P{i}"
        progress_writer()({"type": "reading", "ref": ref, "title": f"Simulated study {i}: {payload['topic']}"[:140]})
        rng = _rng(payload, "read", i)
        # Papers run in ceil(kept/concurrency) rounds behind the pool, so the whole phase lasts ~`read * delay`
        # (also when kept < concurrency: one round, each paper takes the whole share).
        rounds = math.ceil(kept / max(1, settings.llm_concurrency))
        per_paper = timeline.read * timeline.delay / max(1, rounds)
        async with pool:
            await asyncio.sleep(per_paper * rng.uniform(0.7, 1.3))
        ok = i % 11 != 0
        extracted = {"type": "extracted", "ref": ref, "ok": ok, "verified": (i % 4) if ok else 0,
                     "uncertain": i % 7 == 0, "direction": STUB_DIRECTIONS[i % 7] if ok else None,
                     "design": STUB_DESIGNS[i % 5] if ok else None}
        if payload.get("review_type") == "scoping":  # same as the real reader: no direction for scoping
            del extracted["direction"]
        progress_writer()(extracted)
        return {"papers": [{"ref": ref, "ok": ok}]}

    async def normalize_outcomes(state: ReviewState) -> dict:
        ok_count = sum(1 for p in state.get("papers") or [] if p.get("ok"))
        opts = ReviewOptions.clamped(state.get("options"))
        review_type = opts.review_type
        final = stub_result(state["topic"], state["language"], review_type, opts)  # the result finalize will return
        if state.get("selected") and final["citations"] is not None:  # a quick answer fetches no citations (Plan 27)
            c = final["citations"]
            progress_writer()({"type": "citations_fetched", "edges": len(c["edges"]),
                               "covered": sum(1 for v in c["coverage"].values() if v), "total": len(c["coverage"])})
        progress_writer()({"type": "synthesizing", "papers": ok_count})
        if review_type == "meta_analysis" and ok_count:  # same event as the real pool_effects node
            meta = final["meta_analysis"]
            progress_writer()({"type": "pooled", "pools": len(meta["pools"]),
                               "k_total": sum(p["k"] for p in meta["pools"])})
        await asyncio.sleep(timeline.seconds("normalize", _rng(state, "normalize")))
        return {}

    async def localize(state: ReviewState) -> dict:
        if state.get("language") == "th":
            progress_writer()({"type": "localizing"})
        await asyncio.sleep(timeline.seconds("localize", _rng(state, "localize")))
        return {}

    async def finalize_timed(state: ReviewState) -> dict:
        progress_writer()({"type": "finalizing"})
        await asyncio.sleep(timeline.seconds("finalize", _rng(state, "finalize")))
        opts = ReviewOptions.clamped(state.get("options"))
        return {"result": stub_result(state["topic"], state["language"], opts.review_type, opts)}

    return {
        "topic_guard": make_phase("guard", timeline, lambda s: [{"type": "checking_topic"}]),
        "refine_question": refine_question,
        "plan_queries": make_phase("plan", timeline, plan_events),
        "search": make_phase("search", timeline,
                             lambda s: [{"type": "searching", "found": stub_found(_candidates(s)), "queries": 4,
                                                  "failed": 0}]),
        "enrich": enrich,
        "screen_batch": screen_batch,
        "select_top": select_top,
        "read_paper": read_paper,
        "normalize_outcomes": normalize_outcomes,
        "write_synthesis": make_phase("write_synthesis", timeline, lambda s: []),
        "localize": localize,
        "finalize": finalize_timed,
        "route_to_screening": route_to_screening,
        "route_to_reading": route_to_reading,
    }
