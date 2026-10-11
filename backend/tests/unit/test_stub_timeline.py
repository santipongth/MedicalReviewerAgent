"""GRAPH_MODE=stub with STUB_DELAY_SECONDS>0 emits the real event sequence on a scaled timeline."""
import time
from typing import get_args

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state
from app.graph.nodes.stubs import StubTimeline
from app.graph.schemas import DesignCategory, Direction

DELAY = 0.6

# Mirrors docs/api.md (payload keys besides `type`).
REAL_KEYS = {
    "checking_topic": set(),
    "refining": set(),
    "question_refined": {"interpretation", "refined_question", "sub_questions", "assumptions"},
    "planning": {"queries"},
    "searching": {"found", "queries", "failed"},
    "enriching": {"candidates"},
    "citations_fetched": {"edges", "covered", "total"},
    "screening": {"batch"},
    "screened": {"kept", "total"},
    "reading": {"ref", "title"},
    "extracted": {"ref", "ok", "verified", "uncertain", "direction", "design"},
    "synthesizing": {"papers"},
    "pooled": {"pools", "k_total"},
    "localizing": set(),
    "finalizing": set(),
}


async def run(language="en", review_id="r1", concurrency=16, options=None, delay=DELAY):
    settings = Settings(_env_file=None, graph_mode="stub", stub_delay_seconds=delay, llm_concurrency=concurrency)
    graph = build_graph(GraphDeps(settings=settings), checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": review_id}}
    state = initial_state(review_id, "metformin colorectal cancer", language, options or {})
    events, started = [], time.perf_counter()
    async for mode, chunk in graph.astream(state, config, stream_mode=["custom"], durability="sync"):
        events.append((time.perf_counter() - started, chunk))
    return events, time.perf_counter() - started, await graph.aget_state(config)


def types(events):
    return [e["type"] for _, e in events]


async def test_event_types_arrive_in_pipeline_order():
    events, _, final = await run(language="th")
    seq = types(events)
    assert seq.count("screening") == 12 and seq.count("reading") == 30 and seq.count("extracted") == 30
    # order-insensitive inside a fan-out, ordered between phases
    collapsed = [t for i, t in enumerate(seq) if i == 0 or seq[i - 1] != t]
    assert collapsed[:7] == ["checking_topic", "refining", "question_refined", "planning", "searching",
                             "enriching", "screening"]
    assert seq.index("screened") > max(i for i, t in enumerate(seq) if t == "screening")
    last_reading = max(i for i, t in enumerate(seq) if t == "reading")
    first_reading = min(i for i, t in enumerate(seq) if t == "reading")
    assert first_reading > seq.index("screened")
    assert seq[-3:] == ["synthesizing", "localizing", "finalizing"]
    assert seq.index("synthesizing") > max(i for i, t in enumerate(seq) if t == "extracted")
    assert last_reading < seq.index("synthesizing")
    assert final.values["result"]["summary"].startswith("Stub review for:")
    # six studies plus a further report of P1's trial (Plan 20 Task 11)
    assert len(final.values["result"]["papers"]) == 7 and final.values["result"]["review_type"] == "slr"


async def test_payload_keys_match_the_real_events():
    events, _, _ = await run(language="th")
    for _, e in events:
        assert set(e) - {"type"} == REAL_KEYS[e["type"]], e
    by = {e["type"]: e for _, e in events}
    assert by["searching"]["found"] >= by["enriching"]["candidates"] >= by["screened"]["total"] >= by["screened"]["kept"]
    assert by["enriching"]["candidates"] == 120 and by["screened"] == {"type": "screened", "kept": 30, "total": 120}
    assert len(by["planning"]["queries"]) == 4
    assert len(by["question_refined"]["sub_questions"]) == 2 and len(by["question_refined"]["assumptions"]) == 1
    assert by["synthesizing"]["papers"] == sum(1 for _, e in events if e["type"] == "extracted" and e["ok"])


async def test_stub_prisma_counts_are_consistent_with_the_pool():
    for options in ({}, {"max_papers": 50}, {"max_papers": 10, "candidate_limit": 30}):
        events, _, final = await run(options=options, delay=0.1)
        by = {e["type"]: e for _, e in events}
        r = final.values["result"]
        found = by["searching"]["found"]
        assert found >= by["screened"]["total"] >= by["screened"]["kept"]
        assert r["stats"]["found"] == found and sum(r["methods"]["sources"].values()) == found
        assert r["stats"]["found"] >= r["stats"]["unique"] >= r["stats"]["candidates"] >= r["stats"]["selected"]


async def test_extracted_carries_valid_direction_and_design_only_when_ok():
    events, _, _ = await run(language="en")
    extracted = [e for _, e in events if e["type"] == "extracted"]
    assert extracted and any(e["ok"] for e in extracted) and any(not e["ok"] for e in extracted)
    for e in extracted:
        if e["ok"]:
            assert e["direction"] in get_args(Direction) and e["design"] in get_args(DesignCategory), e
        else:
            assert e["direction"] is None and e["design"] is None, e


async def test_localizing_only_for_thai():
    th, _, _ = await run(language="th")
    en, _, _ = await run(language="en")
    assert "localizing" in types(th) and "localizing" not in types(en)


async def test_options_scale_candidates_and_kept():
    events, _, _ = await run(options={"max_papers": 10, "candidate_limit": 30})
    seq = types(events)
    by = {e["type"]: e for _, e in events}
    assert by["screened"] == {"type": "screened", "kept": 10, "total": 30}
    assert seq.count("screening") == 3 and seq.count("reading") == 10


async def test_fifty_papers_emit_fifty_extracted_events_within_the_delay():
    events, total, _ = await run(options={"max_papers": 50}, delay=1.0)
    by = {e["type"]: e for _, e in events}
    assert types(events).count("extracted") == 50
    assert by["screened"] == {"type": "screened", "kept": 50, "total": 120}
    assert 0.8 <= total <= 1.2 + 0.1  # spec 1 +/- 0.2, plus 0.1s for Windows timer jitter


async def test_reads_are_staggered_behind_the_semaphore():
    events, _, _ = await run(concurrency=4)
    t = [at for at, e in events if e["type"] == "extracted"]
    assert max(t) - min(t) > 0.30 * StubTimeline(DELAY).read * DELAY


async def test_total_duration_tracks_the_delay():
    _, total, _ = await run()
    # asyncio.sleep can wake up to one clock tick (~16 ms on Windows) early, so keep a tolerance.
    assert total >= 0.9 * DELAY - 0.02


async def test_same_review_id_same_sequence():
    a, _, _ = await run(review_id="same")
    b, _, _ = await run(review_id="same")
    # extracted order depends on timing jitter that is seeded; refs ok/verified are deterministic
    assert sorted(map(repr, (e for _, e in a))) == sorted(map(repr, (e for _, e in b)))


def test_phase_shares_sum_to_one():
    tl = StubTimeline(10.0)
    total = sum(getattr(tl, n) for n in ("guard", "refine", "plan", "search", "enrich", "screen", "select",
                                         "read", "normalize", "write_synthesis", "localize", "finalize"))
    assert abs(total - 1.0) < 1e-9


async def test_read_phase_tracks_its_share_when_kept_is_below_concurrency():
    delay = 2.0
    events, _, _ = await run(concurrency=16, options={"max_papers": 10, "candidate_limit": 30}, delay=delay)
    first_reading = min(at for at, e in events if e["type"] == "reading")
    last_extracted = max(at for at, e in events if e["type"] == "extracted")
    share = StubTimeline(delay).read * delay
    # one round behind the pool: each paper sleeps share * U(0.7, 1.3)
    assert 0.65 * share <= last_extracted - first_reading <= 1.35 * share + 0.05


async def test_timed_stub_result_is_representative_and_carries_review_type():
    _, _, final = await run(options={"review_type": "scoping"}, delay=0.1)
    r = final.values["result"]
    assert r["review_type"] == "scoping"
    assert len(r["papers"]) == 6 and len(r["synthesis"]["comparison"]) == 2
    assert sum(r["stats"]["excluded_screening"].values()) == 112 and r["stats"]["non_research"] == 4
    assert r["stats"]["excluded_selection"] == {"narrative_excluded": 0, "over_limit": 2, "study_design_relaxed": 0,
                                                "study_design_corrected": 0, "low_relevance": 0, "off_focus": 0}
    assert r["question"]["key_terms"][0].keys() == {"term", "synonyms", "mesh"}
    card = r["papers"][0]["card"]
    assert {"population", "intervention_or_exposure", "comparator", "key_findings", "limitations",
            "risk_of_bias"} <= set(card)
    assert r["synthesis"]["comparison"][0]["cells"][0]["direction"] in get_args(Direction)
    again = (await run(options={"review_type": "scoping"}, delay=0.1))[2].values["result"]
    assert again == r  # deterministic


@pytest.mark.parametrize("review_type", ["slr", "scoping", "meta_analysis"])
@pytest.mark.parametrize("candidates", [20, 120])
@pytest.mark.parametrize("max_papers", [5, 30, 50])
def test_stub_prisma_flow_balances_exactly(max_papers, candidates, review_type):
    from app.graph.nodes.stub_result import stub_result
    from app.schemas.review import ReviewOptions
    opts = ReviewOptions(max_papers=max_papers, candidate_limit=max(candidates, max_papers))
    r = stub_result("statins", "en", review_type, opts)
    st = r["stats"]
    excl, sel = st["excluded_screening"], st["excluded_selection"]
    assert st["screened"] == opts.candidate_limit
    assert st["selected"] == st["extracted"] == len(r["papers"])  # the illustrative paper list is fixed
    assert st["screened"] - sum(excl.values()) - sum(sel.values()) == st["selected"]
    assert all(v >= 0 for v in (*excl.values(), *sel.values(), st["found"], st["unique"], st["with_abstract"],
                                st["non_research"], st["year_excluded"], st["no_abstract"]))
    assert sum(r["methods"]["sources"].values()) == st["found"] >= st["unique"] >= st["candidates"] >= st["selected"]
