"""Plan 19 task 3: study types match synonyms, refinement fallbacks are reported, designs are enforced."""
import hashlib

import pytest

from app.graph import prompts
from app.graph.nodes.intake import make_refine_question
from app.graph.nodes.screening import make_screen_batch, make_select_top, route_to_screening
from app.graph.schemas import ScreenBatch, ScreenDecision
from app.harness.question import question_problems
from app.harness.study_types import allowed_designs, design_allowed, design_matches
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_screening import cands, deps, payload
from tests.unit.test_question import STATE, deps_with, good_question


@pytest.mark.parametrize("study_type,designs", [
    ("RCT", ["Randomized controlled trials"]), ("RCT", ["randomised controlled trial"]),
    ("RCT", ["RCT", "cohort"]), ("Cohort", ["prospective cohort studies"]),
    ("Case-control", ["case control study"]), ("Cross-sectional", ["cross sectional surveys"]),
    ("Non-randomized trial", ["Non-randomised trial"]), ("Non-randomized trial", ["quasi-experimental study"]),
    ("Non-randomized trial", ["single-arm trial"]), ("Qualitative", ["qualitative interview study"]),
    ("Mixed methods", ["mixed-methods study"]), ("Systematic review", ["systematic reviews"]),
    ("Meta-analysis", ["meta-analyses of RCTs"]),
])
def test_synonyms_satisfy_the_canonical_name(study_type, designs):
    assert design_matches(study_type, designs)
    q = good_question(study_designs=designs)
    assert not any("study_designs" in p for p in question_problems(q, {"study_types": [study_type]}))


def test_non_randomized_does_not_satisfy_rct():
    assert not design_matches("RCT", ["non-randomised trial", "quasi-randomized study"])
    assert not design_matches("RCT", ["quasi-RCT", "non-RCT", "meta-analysis of RCTs", "systematic review of RCTs"])
    assert design_matches("RCT", ["randomised and non-randomised studies"])
    assert design_matches("RCT", ["RCTs"]) and not design_matches("RCT", ["cohort", "ARCTIC study"])
    assert not design_matches("RCT", ["cohort"])


async def test_ticking_rct_no_longer_breaks_refinement():  # audit I-3 (meta run)
    refiner = FakeStructuredLLM("ds", lambda s, u: good_question(study_designs=["Randomized controlled trials"]))
    state = {**STATE, "language": "en", "options": {"study_types": ["RCT"]}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False)))(state)
    assert out["question"] is not None and out["quality"][0]["fallback"] is False
    assert out["errors"] == [] and len(refiner.calls) == 1


async def test_missing_requested_type_is_added_in_code_and_reported():
    refiner = FakeStructuredLLM("ds", lambda s, u: good_question(study_designs=["cohort"]))
    state = {**STATE, "language": "en", "options": {"study_types": ["RCT", "Other: Delphi study"]}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False)))(state)
    assert out["question"]["study_designs"] == ["cohort", "RCT"]  # PICO kept; "Other" never enforced
    assert out["quality"][0]["study_designs_added"] == ["RCT"]
    assert any("RCT" in e and "added" in e for e in out["errors"])


async def test_refinement_fallback_is_reported_in_errors_and_quality():
    refiner = FakeStructuredLLM("ds", lambda s, u: good_question(outcomes=[]))
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(max_repairs=1, escalate_on=[])))(STATE)
    assert out["question"] is None and out["quality"][0]["fallback"] is True
    assert out["errors"] and "fell back" in out["errors"][0] and "outcomes" in out["errors"][0]


ITEMS = [("C1", {"title": "T", "year": 2020, "journal": "J", "pub_types": ["RCT"], "abstract": "Abs"}),
         ("C2", {"title": "U"})]
PLAN = {"population": "P", "inclusion_criteria": ["a"]}


def test_screen_prompt_carries_the_constraint_only_when_ticked():
    plain = prompts.screen_user(english_topic="Q?", plan=PLAN, items=ITEMS)
    assert "Study design preference" not in plain
    ticked = prompts.screen_user(english_topic="Q?", plan=PLAN, items=ITEMS, study_types=["RCT"])
    assert "these designs: RCT, i.e. design_guess rct" in ticked
    assert "Do not exclude a paper only because of its design" in ticked
    sr = prompts.screen_user(english_topic="Q?", plan=PLAN, items=[], study_types=["Systematic review"])
    assert "sr_ma_mixed, sr_ma_observational, sr_ma_rct" in sr


def test_slr_pins_unchanged_when_nothing_is_ticked():
    assert hashlib.sha256(prompts.screen_system("slr").encode()).hexdigest() == \
        "b5c17e3a4db2afe4da614f31d2bc63613f25b142392f5b2b90840c6dd3fadfb2"
    same = prompts.screen_user(english_topic="Q?", plan=PLAN, items=ITEMS)
    assert prompts.screen_user(english_topic="Q?", plan=PLAN, items=ITEMS, study_types=[]) == same
    assert prompts.screen_user(english_topic="Q?", plan=PLAN, items=ITEMS, study_types=None) == same


def test_route_passes_canonical_study_types_only():
    state = {"candidates": cands(3), "plan": {}, "topic": "t", "english_topic": "m", "language": "en",
             "options": {"study_types": ["RCT", "Other: Delphi"]}}
    assert route_to_screening(state)[0].arg["study_types"] == ["RCT"]
    assert route_to_screening({**state, "options": {}})[0].arg["study_types"] == []


async def test_screen_batch_sends_the_constraint_to_the_model():
    seen = []

    def respond(system, user):
        seen.append(user)
        return ScreenBatch(decisions=[ScreenDecision(ref=f"C{i + 1}", relevance=90, include=True, reason="r")
                                      for i in range(2)])
    d = deps(FakeStructuredLLM("g", respond))
    await make_screen_batch(d)({**payload(2), "study_types": ["RCT"]})
    await make_screen_batch(d)(payload(2))
    assert "these designs: RCT" in seen[0] and "Study design preference" not in seen[1]


def _screened(candidates, designs):
    return [{"key": c["key"], "relevance": 90 - i, "include": True, "reason": "r", "uncertain": False, "design": g}
            for i, (c, g) in enumerate(zip(candidates, designs, strict=True))]


def _select(state):
    return make_select_top(deps(FakeStructuredLLM("g", lambda s, u: None)))(state)


async def test_select_top_excludes_non_matching_designs_with_study_design_reason():
    c = cands(7)
    designs = ["rct", "sr_ma_rct", "rct", "cohort", "rct", None, "narrative_review"]
    out = await _select({"candidates": c, "screened": _screened(c, designs), "options": {"study_types": ["RCT"]}})
    assert [s["candidate"]["key"] for s in out["selected"]] == [c[i]["key"] for i in (0, 2, 4, 5)]  # unknown stays
    assert out["selection_stats"]["excluded_screening"] == {"study_design": 3}
    assert out["quality"][0]["study_design_excluded"] == 3


async def test_select_top_admits_reviews_only_when_ticked():
    c = cands(4)
    designs = ["rct", "sr_ma_rct", "sr_ma_observational", "rct"]
    out = await _select({"candidates": c, "screened": _screened(c, designs),
                         "options": {"study_types": ["RCT", "Meta-analysis"]}})
    assert len(out["selected"]) == 4


async def test_select_top_keeps_mismatches_last_and_flagged_when_too_few_match():
    c = cands(4)
    out = await _select({"candidates": c, "screened": _screened(c, ["cohort", "rct", "cohort", "cohort"]),
                         "options": {"study_types": ["RCT"]}})
    assert out["selected"][0]["candidate"]["key"] == c[1]["key"] and not out["selected"][0]["uncertain"]
    assert all(s["uncertain"] for s in out["selected"][1:]) and len(out["selected"]) == 4
    assert out["selection_stats"]["study_design_relaxed"] == 3
    assert out["selection_stats"]["excluded_screening"] == {}


async def test_select_top_ignores_other_entries_and_empty_selection():
    c = cands(3)
    for opts in ({}, {"study_types": ["Other: Delphi study"]}):
        out = await _select({"candidates": c, "screened": _screened(c, ["cohort", "rct", "case_series"]),
                             "options": opts})
        assert len(out["selected"]) == 3
    assert allowed_designs({"study_types": ["Other: x"]}) == frozenset()
    assert design_allowed("cohort", frozenset())


async def test_narrative_and_scoping_do_not_enforce_study_types():
    c = cands(4)
    for rt in ("narrative", "scoping"):
        out = await _select({"candidates": c, "screened": _screened(c, ["cohort", "cohort", "rct", "case_series"]),
                             "options": {"review_type": rt, "study_types": ["RCT"]}})
        assert len(out["selected"]) == 4 and out["selection_stats"]["excluded_screening"] == {}
    state = {"candidates": c, "plan": {}, "topic": "t", "english_topic": "m", "language": "en",
             "options": {"review_type": "scoping", "study_types": ["RCT"]}}
    assert route_to_screening(state)[0].arg["study_types"] == []
    assert route_to_screening({**state, "options": {"review_type": "meta_analysis", "study_types": ["RCT"]}}
                              )[0].arg["study_types"] == ["RCT"]


async def test_select_top_does_not_mutate_state_entries():
    c = cands(3)
    screened = _screened(c, ["cohort", "rct", "cohort"])
    await _select({"candidates": c, "screened": screened, "options": {"study_types": ["RCT"]}})
    assert all("design_mismatch" not in d for d in screened)


async def test_relaxed_count_reaches_result_stats():
    from app.graph.nodes.synthesis import make_finalize
    from tests.unit.test_nodes_synthesis import deps as synth_deps
    c = cands(4)
    sel = await _select({"candidates": c, "screened": _screened(c, ["cohort", "rct", "cohort", "cohort"]),
                         "options": {"study_types": ["RCT"]}})
    state = {"topic": "t", "english_topic": "T", "language": "en", "papers": [], "question": None,
             "synthesis": {"executive_summary": "none"}, "selection_stats": sel["selection_stats"]}
    r = (await make_finalize(synth_deps())(state))["result"]
    assert r["stats"]["excluded_selection"]["study_design_relaxed"] == 3
