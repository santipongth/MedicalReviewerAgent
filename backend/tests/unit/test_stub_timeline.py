"""GRAPH_MODE=stub with STUB_DELAY_SECONDS>0 emits the real event sequence on a scaled timeline."""
import time

from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state
from app.graph.nodes.stubs import StubTimeline

DELAY = 0.6

# Mirrors docs/api.md (payload keys besides `type`).
REAL_KEYS = {
    "checking_topic": set(),
    "refining": set(),
    "question_refined": {"interpretation", "refined_question", "sub_questions", "assumptions"},
    "planning": {"queries"},
    "searching": {"found", "queries", "failed"},
    "enriching": {"candidates"},
    "screening": {"batch"},
    "screened": {"kept", "total"},
    "reading": {"ref", "title"},
    "extracted": {"ref", "ok", "verified", "uncertain"},
    "synthesizing": {"papers"},
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
    assert seq.count("screening") == 6 and seq.count("reading") == 30 and seq.count("extracted") == 30
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
    assert final.values["result"]["papers"] == []


async def test_payload_keys_match_the_real_events():
    events, _, _ = await run(language="th")
    for _, e in events:
        assert set(e) - {"type"} == REAL_KEYS[e["type"]], e
    by = {e["type"]: e for _, e in events}
    assert by["searching"] == {"type": "searching", "found": 87, "queries": 4, "failed": 0}
    assert by["enriching"]["candidates"] == 60 and by["screened"] == {"type": "screened", "kept": 30, "total": 60}
    assert len(by["planning"]["queries"]) == 4
    assert len(by["question_refined"]["sub_questions"]) == 2 and len(by["question_refined"]["assumptions"]) == 1
    assert by["synthesizing"]["papers"] == sum(1 for _, e in events if e["type"] == "extracted" and e["ok"])


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
