"""Plan 14b Task 4: the meta_analysis review type (pool_effects node, GRADE-lite, no pooled numbers in prose,
Markdown section, stub). SLR stays as before."""
import math
from types import SimpleNamespace

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.graph import prompts
from app.graph.graph import build_graph, initial_state
from app.graph.nodes.stub_result import stub_result
from app.graph.schemas import SynthesisNarrative
from app.harness.grade import apply_meta_grade
from app.harness.meta import (
    pool_outcomes,
    pooled_number_strings,
    pools_for_prompt,
    primary_outcome,
    strip_pooled_numbers,
)
from app.schemas.review import REVIEW_TYPES, ReviewOptions
from app.services.report import POOLED_HEADING, render_csv, render_markdown
from tests.fakes import FakeStructuredLLM
from tests.unit.test_review_graph import make_deps

META = {"max_papers": 8, "candidate_limit": 20, "review_type": "meta_analysis"}
SLR = {"max_papers": 8, "candidate_limit": 20}


async def run_graph(deps, options, language="en", thread="m1"):
    graph = build_graph(deps, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": thread}}
    events, nodes = [], []
    async for mode, chunk in graph.astream(initial_state(thread, "metformin and colorectal cancer", language, options),
                                           config, stream_mode=["custom", "updates"], durability="sync"):
        if mode == "custom":
            events.append(chunk)
        else:
            nodes += list(chunk)
    return (await graph.aget_state(config)).values, events, nodes


def summary_with_pooled(system, user):
    return SynthesisNarrative(
        executive_summary=("Metformin is associated with lower CRC risk [P1, P2]. "
                           "The pooled HR was 0.80 (95% CI 0.77 to 0.83) across cohorts [P1]. "
                           "Some cohorts disagree [P3]."),
        evidence_strength="low", evidence_rationale="Observational cohorts [P1]. Pooled estimate 0.800 [P2].",
        research_gaps=["RCTs", "Confirm the pooled 0.80 in trials"])


# ---- types and options -------------------------------------------------------------------
def test_meta_is_a_review_type():
    assert "meta_analysis" in REVIEW_TYPES
    assert ReviewOptions(review_type="meta_analysis").review_type == "meta_analysis"
    assert ReviewOptions.clamped({"review_type": "meta_analysis"}).review_type == "meta_analysis"


# ---- prompts: SLR pins are in test_prompts_by_type; meta only appends blocks ---------------------------
def test_meta_prompts_equal_slr_except_extract_and_narrative():
    for builder in (prompts.refine_system, prompts.critique_system, prompts.plan_system, prompts.screen_system):
        assert builder("meta_analysis") == builder("slr")
    for builder, base in ((prompts.extract_system, prompts.EXTRACT_SYSTEM),
                          (prompts.narrative_system, prompts.NARRATIVE_SYSTEM)):
        system = builder("meta_analysis")
        assert system.startswith(base) and system[len(base):].startswith(prompts.OVERRIDE_LEAD)
    assert "adjusted" in prompts.extract_system("meta_analysis")
    assert "do not state pooled numbers" in prompts.narrative_system("meta_analysis")


def test_meta_narrative_user_is_graded_and_carries_pools():
    kwargs = {"question": "Q?", "sub_questions": ["a"], "papers": [{"ref": "P1"}],
              "matrix": {"rows": [], "consensus": []}, "conflict_notes": [], "baseline": {"level": "low", "factors": ["f"]}}
    slr = prompts.narrative_user(**kwargs)
    assert prompts.narrative_user(**kwargs, pooled_analysis=[{"x": 1}]) == slr  # ignored outside meta
    meta = prompts.narrative_user(**kwargs, review_type="meta_analysis", pooled_analysis=[{"estimate": 0.8}])
    assert '"pooled_analysis": [{"estimate": 0.8}]' in meta and "GRADE-lite baseline: low" in meta
    assert "no pooled estimate" in meta


# ---- graph ---------------------------------------------------------------------------------
async def test_meta_run_pools_grades_and_strips_pooled_numbers():
    deps = make_deps()
    deps.llms.synthesizer = FakeStructuredLLM("syn", summary_with_pooled)
    values, events, nodes = await run_graph(deps, META)
    r = values["result"]
    assert r["review_type"] == "meta_analysis" and "pool_effects" in nodes
    meta = r["meta_analysis"]
    [pool] = meta["pools"]
    assert pool["measure"] == "HR" and pool["design_group"] == "observational" and pool["k"] == 8
    assert pool["outcome"] == pool["outcome_display"] == "Colorectal cancer incidence"
    assert pool["pooled"]["est"] == pytest.approx(0.8)
    assert pool["i2"] == 0.0 and meta["grade"]["primary_outcome"] == "Colorectal cancer incidence"
    assert meta["grade"]["reasons"] == []  # I2 0 and the CI excludes 1
    [pooled_event] = [e for e in events if e["type"] == "pooled"]
    assert pooled_event == {"type": "pooled", "pools": 1, "k_total": 8}
    types = [e["type"] for e in events]
    assert types.index("synthesizing") < types.index("pooled") < types.index("finalizing")
    # the synthesizer saw the pools as rounded data and the meta block
    system, user = deps.llms.synthesizer.calls[0][:2]
    assert "do not state pooled numbers" in system
    assert '"pooled_analysis": [{"outcome": "Colorectal cancer incidence"' in user and '"estimate": 0.8' in user
    # the post-check removed every sentence restating a pooled number, and counted them
    s = r["synthesis_en"]
    assert s["executive_summary"] == "Metformin is associated with lower CRC risk [P1, P2]. Some cohorts disagree [P3]."
    assert s["evidence_rationale"] == "Observational cohorts [P1]."
    assert s["research_gaps"] == ["RCTs"]
    stage = next(q for q in values["quality"] if q["stage"] == "pooled_numbers")
    assert stage["removed"] == 3
    # still graded like an SLR, and conflicts are still explained
    assert s["evidence_strength"] is not None and s["grade_baseline"] is not None
    assert len(deps.llms.conflict_explainer.calls) == 1


async def test_meta_outcome_display_is_localized():
    deps = make_deps()
    values, _, _ = await run_graph(deps, META, language="th", thread="m2")
    [pool] = values["result"]["meta_analysis"]["pools"]
    assert pool["outcome"] == "Colorectal cancer incidence"
    assert pool["outcome_display"] == "TH Colorectal cancer incidence"


async def test_slr_run_has_no_meta_and_an_unchanged_path():
    deps = make_deps()
    values, events, nodes = await run_graph(deps, SLR, thread="s1")
    r = values["result"]
    assert r["meta_analysis"] is None and "pool_effects" not in nodes
    assert "pooled" not in [e["type"] for e in events]
    assert not any(q["stage"] in ("pool", "pooled_numbers") for q in values["quality"])
    system, user = deps.llms.synthesizer.calls[0][:2]
    assert system == prompts.narrative_system("slr") and "pooled_analysis" not in user


async def test_pooling_failure_never_fails_the_review(monkeypatch):
    from app.graph.nodes import synthesis

    def boom(matrix, papers):
        raise ValueError("bad")

    monkeypatch.setattr(synthesis, "pool_outcomes", boom)
    values, _, _ = await run_graph(make_deps(), META, thread="m3")
    r = values["result"]
    assert r["meta_analysis"] is None and "pooling failed: ValueError" in r["errors"]
    assert r["synthesis"]["executive_summary"]


# ---- GRADE-lite ------------------------------------------------------------------------------
def pool(i2=0.0, lo=-0.3, hi=-0.1, outcome="Mortality"):
    return {"outcome": outcome, "i2": i2, "k": 3, "pooled": {"y_ci_lower": lo, "y_ci_upper": hi}}


def test_meta_grade_downgrades_inconsistency_and_imprecision():
    base = {"level": "high", "factors": ["start high: 3/3 randomized studies"]}
    same, reasons = apply_meta_grade(base, [pool()], "Mortality")
    assert same["level"] == "high" and reasons == []
    g, reasons = apply_meta_grade(base, [pool(i2=50.0)], "Mortality")
    assert g["level"] == "moderate" and reasons == [
        "inconsistency: substantial heterogeneity (I2 >= 50%) in the pooled analysis of Mortality"]
    g, reasons = apply_meta_grade(base, [pool(lo=-0.2, hi=0.05)], "Mortality")
    assert g["level"] == "moderate" and reasons == ["imprecision: the pooled 95% CI for Mortality includes no effect"]
    g, reasons = apply_meta_grade(base, [pool(), pool(i2=80.0, lo=-0.1, hi=0.2)], "Mortality")
    assert g["level"] == "low" and len(reasons) == 2 and g["factors"][-2:] == reasons
    assert base["level"] == "high" and len(base["factors"]) == 1  # not mutated


def test_meta_grade_does_not_double_downgrade_a_domain():
    base = {"level": "low", "factors": ["start high", "inconsistency: 1 outcome(s) with conflicting directions",
                                        "imprecision: total sample size 120"]}
    g, reasons = apply_meta_grade(base, [pool(i2=90.0, lo=-0.1, hi=0.1)], "Mortality")
    assert g["level"] == "low"
    assert all("already downgraded" in r for r in reasons) and len(reasons) == 2


def test_meta_grade_floor_and_no_pools():
    g, _ = apply_meta_grade({"level": "very_low", "factors": []}, [pool(i2=90.0, lo=-1, hi=1)], "Mortality")
    assert g["level"] == "very_low"
    assert apply_meta_grade({"level": "low", "factors": []}, [], None) == ({"level": "low", "factors": []}, [])


def test_null_on_the_ratio_scale_is_one():
    rows = [{"outcome": "Mortality", "cells": [
        {"ref": f"P{i}", "effect_measure": "RR", "effect_value": v, "ci_lower": lo, "ci_upper": hi,
         "design_category": "rct", "pooled": False} for i, (v, lo, hi) in
        enumerate([(0.9, 0.7, 1.2), (1.05, 0.8, 1.4), (0.95, 0.75, 1.2)], start=1)]}]
    meta = pool_outcomes({"rows": rows}, [])
    [p] = meta["pools"]
    assert p["pooled"]["ci_lower"] < 1 < p["pooled"]["ci_upper"]
    _, reasons = apply_meta_grade({"level": "high", "factors": []}, meta["pools"], "Mortality")
    assert reasons == ["imprecision: the pooled 95% CI for Mortality includes no effect"]


def test_primary_outcome_matches_the_question_else_largest_k():
    meta = {"pools": [{"outcome": "All-cause mortality", "k": 3}, {"outcome": "Colorectal cancer incidence", "k": 4},
                      {"outcome": "All-cause mortality", "k": 3}]}
    assert primary_outcome(meta, ["colorectal cancer incidence"]) == "Colorectal cancer incidence"
    assert primary_outcome(meta, ["quality of life"]) == "All-cause mortality"  # 6 studies over two pools
    assert primary_outcome(meta, None) == "All-cause mortality"
    assert primary_outcome({"pools": []}, ["x"]) is None


# ---- the post-check --------------------------------------------------------------------------
def test_pooled_number_strings_and_strip():
    meta = {"pools": [{"pooled": {"est": 0.8012, "ci_lower": 0.7234, "ci_upper": 0.8876}},
                      {"pooled": {"est": -1.5, "ci_lower": -2.25, "ci_upper": -0.75}}]}
    strings = pooled_number_strings(meta)
    assert {"0.80", "0.801", "0.72", "0.723", "0.89", "0.888", "1.50", "1.500", "2.25", "0.75"} <= strings
    text = ("A lower risk [P1]. Pooled HR 0.80 [P2]! The CI was 0.723-0.888. A trial reported HR 10.80 [P3]. "
            "MD was -1.50 points? Another 0.805 value [P4].")
    out, removed = strip_pooled_numbers(text, strings)
    assert out == "A lower risk [P1]. A trial reported HR 10.80 [P3]. Another 0.805 value [P4]."
    assert removed == 3
    assert strip_pooled_numbers("No numbers [P1].", strings) == ("No numbers [P1].", 0)
    assert strip_pooled_numbers("Pooled 0.80 [P1].", set()) == ("Pooled 0.80 [P1].", 0)


def test_pools_for_prompt_rounds_like_the_ui():
    meta = {"pools": [{"outcome": "o", "measure": "HR", "design_group": "rct", "k": 3,
                       "studies": [{"ref": "P1"}, {"ref": "P2"}, {"ref": "P3"}],
                       "pooled": {"est": 0.80123, "ci_lower": 0.7234, "ci_upper": 0.8876}, "i2": 61.6, "tau2": 0.01234}]}
    assert pools_for_prompt(meta) == [{"outcome": "o", "measure": "HR", "design_group": "rct", "k": 3,
                                       "refs": ["P1", "P2", "P3"], "estimate": 0.8, "ci_lower": 0.72,
                                       "ci_upper": 0.89, "i2_percent": 62, "tau2": 0.012}]
    assert pools_for_prompt(None) == []


# ---- stub and exports --------------------------------------------------------------------------
def test_stub_meta_result_is_computed_by_meta_py():
    r = stub_result("t", "en", "meta_analysis")
    meta = r["meta_analysis"]
    [p] = meta["pools"]
    assert p["design_group"] == "observational" and p["measure"] == "HR" and p["k"] == 3
    assert [s["ref"] for s in p["studies"]] == ["P3", "P4", "P7"]
    by_ref = {x["ref"]: x for x in r["papers"]}
    for s in p["studies"]:  # each input is the paper's verified card value
        o = by_ref[s["ref"]]["card"]["outcomes"][0]
        assert (s["effect"], s["ci_lower"], s["ci_upper"]) == (o["effect_value"], o["ci_lower"], o["ci_upper"])
        assert str(o["effect_value"]) in o["evidence_quote"]
        assert by_ref[s["ref"]]["card"]["design_category"] == "cohort"
    expected = pool_outcomes({"rows": r["synthesis"]["comparison"]}, r["papers"])["pools"][0]["pooled"]
    assert p["pooled"] == expected
    assert math.isclose(sum(s["weight"] for s in p["studies"]), 100.0)
    assert {(e["ref"], e["reason"]) for e in meta["excluded"]} >= {("P1", "too_few_studies"), ("P2", "too_few_studies")}
    assert [x["ref"] for x in meta["reference"]] == ["P5"]
    assert meta["grade"]["primary_outcome"] == "Primary outcome"
    assert r["stats"]["selected"] == len(r["papers"]) == 7
    assert r["synthesis"]["evidence_strength"] == "low"
    for rt in ("slr", "narrative", "scoping"):
        other = stub_result("t", "en", rt)
        assert other["meta_analysis"] is None and len(other["papers"]) == 6
        assert "design_category" not in other["synthesis"]["comparison"][0]["cells"][0]


async def test_timed_stub_emits_pooled_for_meta_only():
    from tests.unit.test_stub_timeline import REAL_KEYS
    from tests.unit.test_stub_timeline import run as run_stub

    events, _, final = await run_stub(options={"review_type": "meta_analysis"}, delay=0.2)
    seq = [e["type"] for _, e in events]
    [pooled] = [e for _, e in events if e["type"] == "pooled"]
    assert pooled == {"type": "pooled", "pools": 1, "k_total": 3}
    assert set(pooled) - {"type"} == REAL_KEYS["pooled"]
    assert seq.index("synthesizing") < seq.index("pooled") < seq.index("finalizing")
    assert final.values["result"]["meta_analysis"]["pools"][0]["k"] == 3
    events, _, _ = await run_stub(delay=0.2, review_id="r2")
    assert "pooled" not in [e["type"] for _, e in events]


def test_cache_key_differs_by_review_type():
    from app.schemas.review import compute_cache_key
    slr = ReviewOptions(review_type="slr").model_dump()
    meta = ReviewOptions(review_type="meta_analysis").model_dump()
    assert compute_cache_key("t", "en", slr, "v") != compute_cache_key("t", "en", meta, "v")


def md_review(result):
    return SimpleNamespace(topic="t", status="done", error=None, result=result)


def test_markdown_pooled_section():
    r = stub_result("t", "en", "meta_analysis")
    md = render_markdown(md_review(r))
    assert "**Review type:** Meta-analysis" in md and POOLED_HEADING in md
    p = r["meta_analysis"]["pools"][0]
    est = p["pooled"]
    line = next(x for x in md.splitlines() if x.startswith("- **Primary outcome**"))
    assert line.startswith(f"- **Primary outcome** — HR, observational studies, k=3: {est['est']:.2f} "
                           f"(95% CI {est['ci_lower']:.2f} to {est['ci_upper']:.2f}) _(computed)_; "
                           f"I² {p['i2']:.0f}%, τ² {p['tau2']:.3f}. Inputs: P3 0.84 [0.72, 0.98] w ")
    assert "P4 1.22 [1.01, 1.47]" in line and "P7 0.88 [0.79, 0.99]" in line
    assert md.index("## Comparison") < md.index(POOLED_HEADING)
    assert "DerSimonian-Laird random effects" in md


def test_markdown_meta_without_pools_and_slr_without_section():
    r = stub_result("t", "en", "meta_analysis")
    r["meta_analysis"] = {**r["meta_analysis"], "pools": []}
    assert "nothing was pooled" in render_markdown(md_review(r))
    slr = render_markdown(md_review(stub_result("t", "en", "slr")))
    assert "Pooled analysis" not in slr
    r["meta_analysis"] = None  # a failed pooling step
    assert "Pooled analysis" not in render_markdown(md_review(r))


def test_csv_is_per_paper_only():
    r = stub_result("t", "en", "meta_analysis")
    csv_text = render_csv(r)
    assert "pooled" not in csv_text.lower() and "DerSimonian" not in csv_text
    assert csv_text.count("\n") == 1 + len(r["papers"])  # header + one outcome per stub paper
