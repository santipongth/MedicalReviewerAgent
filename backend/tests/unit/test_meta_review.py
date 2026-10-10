"""Plan 14b Task 4: the meta_analysis review type (pool_effects node, GRADE-lite, no pooled numbers in prose,
Markdown section, stub). SLR stays as before."""
import math
from types import SimpleNamespace

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.graph import prompts
from app.graph.graph import build_graph, initial_state
from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import CERTAINTY_SENTENCE
from app.graph.schemas import SynthesisNarrative
from app.harness.grade import apply_meta_grade, grading_pools
from app.harness.meta import (
    pool_outcomes,
    pooled_number_strings,
    pools_for_prompt,
    primary_outcome,
    strip_pooled_numbers,
)
from app.schemas.review import REVIEW_TYPES, ReviewOptions
from app.services.report import POOLED_HEADING, render_csv, render_markdown
from tests.fakes import FakeStructuredLLM, to_thai
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
                           "One cohort reported HR 0.80 [P4]. "
                           "Some cohorts disagree [P3]."),
        evidence_strength="low", evidence_rationale="Observational cohorts [P1]. Pooled estimate 0.800 [P2].",
        research_gaps=["RCTs", "Confirm the pooled 0.80 in trials"])


# ---- types and options -------------------------------------------------------------------
def test_meta_is_a_review_type():
    assert "meta_analysis" in REVIEW_TYPES
    assert ReviewOptions(review_type="meta_analysis").review_type == "meta_analysis"
    assert ReviewOptions.clamped({"review_type": "meta_analysis"}).review_type == "meta_analysis"


# ---- prompts: SLR pins are in test_prompts_by_type; meta only appends blocks ---------------------------
def test_meta_prompts_equal_slr_except_plan_extract_and_narrative():
    for builder in (prompts.refine_system, prompts.critique_system, prompts.screen_system):
        assert builder("meta_analysis") == builder("slr")
    for builder, base in ((prompts.extract_system, prompts.EXTRACT_SYSTEM),
                          (prompts.narrative_system, prompts.NARRATIVE_SYSTEM),
                          (prompts.plan_system, prompts.PLAN_SYSTEM)):
        system = builder("meta_analysis")
        assert system.startswith(base) and system[len(base):].startswith(prompts.OVERRIDE_LEAD)
    assert "adjusted" in prompts.extract_system("meta_analysis")
    # audit I-24: only the system's pooled_analysis numbers are withheld; SR cards' own estimates may be stated
    narrative = prompts.narrative_system("meta_analysis")
    assert "do not state the numbers of pooled_analysis" in narrative and "systematic-review card" in narrative
    # audit I-9: the planner is asked for more queries and the major trial names
    assert "acronyms" in prompts.plan_system("meta_analysis") and "never invent a trial name" in prompts.plan_system(
        "meta_analysis")


def test_meta_narrative_user_is_graded_and_carries_pools():
    kwargs = {"question": "Q?", "sub_questions": ["a"], "papers": [{"ref": "P1"}],
              "matrix": {"rows": [], "consensus": []}, "conflict_notes": [], "baseline": {"level": "low", "factors": ["f"]}}
    slr = prompts.narrative_user(**kwargs)
    assert prompts.narrative_user(**kwargs, pooled_analysis=[{"x": 1}]) == slr  # ignored outside meta
    meta = prompts.narrative_user(**kwargs, review_type="meta_analysis", pooled_analysis=[{"estimate": 0.8}])
    assert '"pooled_analysis": [{"estimate": 0.8}]' in meta and "GRADE-lite baseline: low" in meta
    assert "no pooled_analysis estimate" in meta


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
    assert "do not state the numbers of pooled_analysis" in system
    assert '"pooled_analysis": [{"outcome": "Colorectal cancer incidence"' in user and '"estimate": 0.8' in user
    # the post-check removed every sentence restating a pooled number, and counted them
    s = r["synthesis_en"]
    # (Plan 19: the summary lacked low-certainty wording, so the fixed GRADE sentence is appended)
    assert s["executive_summary"] == ("Metformin is associated with lower CRC risk [P1, P2]. "
                                      "One cohort reported HR 0.80 [P4]. Some cohorts disagree [P3]. "
                                      + CERTAINTY_SENTENCE[s["evidence_strength"]])
    # (Plan 19: the rationale never named the inconsistency downgrade, so the factor is appended in code)
    assert s["evidence_rationale"] == ("Observational cohorts [P1]. GRADE-lite downgrades: inconsistency: studies "
                                       "on opposite sides of no effect for the primary outcome Colorectal cancer "
                                       "incidence.")
    assert r["quality"]["prose_check"]["rationale_fixed"] == "appended"
    assert s["research_gaps"] == ["RCTs"]
    stage = next(q for q in values["quality"] if q["stage"] == "pooled_numbers")
    assert stage == {"stage": "pooled_numbers", "removed": 3, "kept_single_study": 1}
    assert r["quality"]["pooled_numbers"] == {"removed": 3, "kept_single_study": 1}  # carried into result.quality
    assert meta["grade"]["design_group"] == "observational"
    # still graded like an SLR, and conflicts are still explained
    assert s["evidence_strength"] is not None and s["grade_baseline"] is not None
    assert len(deps.llms.conflict_explainer.calls) == 1


def test_summarize_quality_carries_the_latest_pooled_numbers_stage():
    from app.harness.quality import summarize_quality
    q = summarize_quality([{"stage": "pooled_numbers", "removed": 1, "kept_single_study": 0},
                           {"stage": "pooled_numbers", "removed": 2, "kept_single_study": 1}], None)
    assert q["pooled_numbers"] == {"removed": 2, "kept_single_study": 1}
    assert "pooled_numbers" not in summarize_quality([{"stage": "narrative", "seconds": 1.0}], None)


async def test_meta_outcome_display_is_localized():
    deps = make_deps()
    values, _, _ = await run_graph(deps, META, language="th", thread="m2")
    [pool] = values["result"]["meta_analysis"]["pools"]
    assert pool["outcome"] == "Colorectal cancer incidence"
    assert pool["outcome_display"] == to_thai("Colorectal cancer incidence")


async def test_slr_run_has_no_meta_and_an_unchanged_path():
    deps = make_deps()
    values, events, nodes = await run_graph(deps, SLR, thread="s1")
    r = values["result"]
    assert r["meta_analysis"] is None and "pool_effects" not in nodes
    assert "pooled" not in [e["type"] for e in events]
    assert not any(q["stage"] in ("pool", "pooled_numbers") for q in values["quality"])
    assert "pooled_numbers" not in values["result"]["quality"]  # SLR result.quality keeps its shape
    system, user = deps.llms.synthesizer.calls[0][:2]
    assert system == prompts.narrative_system("slr") and "pooled_analysis" not in user


async def test_pooling_failure_never_fails_the_review(monkeypatch):
    from app.harness import grade

    def boom(matrix, papers):
        raise ValueError("bad")

    monkeypatch.setattr(grade, "pool_outcomes", boom)
    values, _, _ = await run_graph(make_deps(), META, thread="m3")
    r = values["result"]
    assert r["meta_analysis"] is None and "pooling failed: ValueError" in r["errors"]
    assert r["synthesis"]["executive_summary"]


@pytest.mark.parametrize("target", ["primary_outcome", "grading_pools", "apply_meta_grade"])
async def test_a_failure_after_pooling_is_also_soft(monkeypatch, target):
    from app.harness import grade

    def boom(*args, **kwargs):
        raise KeyError("i2")

    monkeypatch.setattr(grade, target, boom)
    values, events, _ = await run_graph(make_deps(), META, thread=f"m4-{target}")
    r = values["result"]
    assert r["meta_analysis"] is None and "pooling failed: KeyError" in r["errors"]
    assert "pooled" not in [e["type"] for e in events]


# ---- GRADE-lite ------------------------------------------------------------------------------
def pool(i2=0.0, lo=-0.3, hi=-0.1, outcome="Mortality", group="rct"):
    return {"outcome": outcome, "i2": i2, "k": 3, "design_group": group,
            "pooled": {"y_ci_lower": lo, "y_ci_upper": hi}}


def test_grading_uses_the_rct_pools_when_any_exist():
    pools = [pool(), pool(i2=70.0, lo=-0.2, hi=0.3, group="observational"), pool(outcome="Other", i2=99.0)]
    group, chosen = grading_pools(pools, "Mortality")
    assert group == "rct" and chosen == [pools[0]]
    base = {"level": "high", "factors": []}
    g, reasons = apply_meta_grade(base, chosen, "Mortality", group)
    assert g["level"] == "high" and reasons == []  # the heterogeneous observational pool does not count


def test_grading_falls_back_to_observational_and_names_the_group():
    pools = [pool(i2=70.0, group="observational"), pool(group="observational", lo=-0.1, hi=-0.05)]
    group, chosen = grading_pools(pools, "Mortality")
    assert group == "observational" and chosen == pools
    g, reasons = apply_meta_grade({"level": "low", "factors": []}, chosen, "Mortality", group)
    assert g["level"] == "very_low"
    assert reasons == [("inconsistency: substantial heterogeneity (I2 >= 50%) in the pooled analysis of "
                        "Mortality (observational studies)")]
    assert grading_pools(pools, "Unknown") == (None, [])
    assert grading_pools([], None) == (None, [])


def test_several_measures_in_the_chosen_group_any_counts():
    pools = [pool(), pool(lo=-0.1, hi=0.2)]  # e.g. HR and OR pools of the same RCT outcome
    group, chosen = grading_pools(pools, "Mortality")
    _, reasons = apply_meta_grade({"level": "high", "factors": []}, chosen, "Mortality", group)
    assert reasons == ["imprecision: the pooled 95% CI for Mortality (RCTs) includes no effect"]


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
    assert {"0.8", ".80", ".8", "1.5", "0.75", ".75"} <= strings  # trimmed and leading-dot forms
    assert not any(s.isdigit() or s.endswith(".") for s in strings)  # never a bare integer such as "1"
    text = ("A lower risk [P1]. Pooled HR 0.80 [P2]! The CI was 0.723-0.888. A trial reported HR 10.80 [P3]. "
            "MD was -1.50 points? Another 0.805 value [P4].")
    out, removed, single = strip_pooled_numbers(text, strings)
    assert out == "A lower risk [P1]. A trial reported HR 10.80 [P3]. Another 0.805 value [P4]."
    assert (removed, single) == (3, 0)
    assert strip_pooled_numbers("No numbers [P1].", strings) == ("No numbers [P1].", 0, 0)
    assert strip_pooled_numbers("Pooled 0.80 [P1].", set()) == ("Pooled 0.80 [P1].", 0, 0)


STRINGS = pooled_number_strings({"pools": [{"pooled": {"est": 0.80, "ci_lower": 0.71, "ci_upper": 0.90}}]})


@pytest.mark.parametrize(("sentence", "kept"), [
    ("One cohort reported HR 0.80 [P3].", True),                      # single study, no pooled wording
    ("One cohort reported HR 0.8 (0.71-0.90) [P3].", True),
    ("The pooled HR 0.80 [P3] favoured metformin.", False),           # pooled wording despite one ref
    ("Overall, risk fell (HR 0.8) [P3].", False),
    ("Combined estimates gave .80 [P3].", False),
    ("In the meta-analysis HR was 0.90 [P3].", False),
    ("The aggregate HR was 0.71 [P3].", False),
    ("HR 0.80 across studies [P1, P2].", False),                      # two refs
    ("HR 0.80 [P1] and [P2].", False),
    ("Risk was lower, HR 0.8.", False),                                # no citation
    ("Risk was lower, HR 0.85 [P1, P2].", True),                       # not a pooled number
])
def test_post_check_precision_rule(sentence, kept):
    out, removed, single = strip_pooled_numbers(sentence, STRINGS)
    assert (out == sentence) is kept
    assert removed == (0 if kept else 1)
    assert single == (1 if kept and "0.8" in sentence and "0.85" not in sentence else 0)


@pytest.mark.parametrize("text", [
    "Smith et al. reported a pooled HR of 0.80 in trials.",
    "Metformin vs. placebo gave a pooled HR of 0.80 overall.",
    "Doses (e.g. 1 g) gave a pooled HR of 0.80.",
])
def test_abbreviations_do_not_split_a_sentence(text):
    out, removed, _ = strip_pooled_numbers(f"Lower risk [P1]. {text} More trials are needed [P2].", STRINGS)
    assert out == "Lower risk [P1]. More trials are needed [P2]." and removed == 1


def test_splitter_splits_before_an_uppercase_word_or_a_citation():
    out, removed, _ = strip_pooled_numbers("The pooled HR was 0.80. [P1] Then stable [P2]. Done [P3].", STRINGS)
    assert out == "[P1] Then stable [P2]. Done [P3]." and removed == 1


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
    assert meta["grade"]["design_group"] == "observational"  # no RCT pool for the stub's primary outcome
    from app.graph.nodes.stub_result import STUB_BASELINE
    grade, reasons = apply_meta_grade(STUB_BASELINE, meta["pools"], "Primary outcome", "observational")
    assert meta["grade"]["reasons"] == reasons and reasons  # P4 disagrees: heterogeneous and/or imprecise
    assert r["synthesis"]["evidence_strength"] == r["synthesis"]["grade_baseline"] == grade["level"]
    assert r["stats"]["selected"] == r["stats"]["extracted"] == len(r["papers"]) == 7
    assert len(r["citations"]["coverage"]) == 7
    for rt in ("slr", "narrative", "scoping"):
        other = stub_result("t", "en", rt)
        assert other["meta_analysis"] is None and len(other["papers"]) == 6
        if rt == "slr":
            assert other["synthesis"]["evidence_strength"] == "low"
            assert other["synthesis"]["evidence_rationale"] == "Simulated data."
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
    assert line.endswith(".") and " Warnings: small number of studies (k<5)" in line
    assert ("substantial heterogeneity (I² ≥ 50%)" in line) == ("high_heterogeneity" in p["warnings"])
    assert "abstract_only" not in md and "small_k" not in md
    assert md.index("## Comparison") < md.index(POOLED_HEADING)
    assert "DerSimonian-Laird random effects" in md


def test_markdown_warning_labels():
    from app.services.report import WARNING_LABEL, _warnings
    assert _warnings(["abstract_only", "ci_assumed_95", "adjustment_unknown"]) == ""
    assert _warnings(["abstract_only", "small_k", "high_heterogeneity", "duplicate_cohort_skipped",
                      "other_measures_not_pooled", "md_units_assumed_equal"]) == (
        " Warnings: " + "; ".join(WARNING_LABEL[c] for c in ("small_k", "high_heterogeneity", "duplicate_cohort_skipped",
                                                             "other_measures_not_pooled", "md_units_assumed_equal")) + ".")


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


# ---- review fixes: I2 / tau2 / RD-percent restatements, verification gate, as-reported export ----------------
from app.harness.meta import pooled_extra_patterns

HET = {"pools": [{"measure": "HR", "i2": 84.3, "tau2": 0.1234,
                  "pooled": {"est": 0.8, "ci_lower": 0.71, "ci_upper": 0.9}}]}
RD = {"pools": [{"measure": "RD", "i2": 0.0, "tau2": 0.0,
                 "pooled": {"est": 0.05, "ci_lower": 0.01, "ci_upper": 0.093}}]}


def _strip(text, meta):
    always, numeric = pooled_extra_patterns(meta)
    return strip_pooled_numbers(text, pooled_number_strings(meta), always, numeric)


@pytest.mark.parametrize("sentence", [
    "Heterogeneity was substantial (I² 84%) [P1, P2].",
    "I2 = 84% across cohorts [P1].",
    "Heterogeneity was high (84%) [P1].",
    "Between-study variance was low (τ² 0.12) [P1].",
    "Tau2 was 0.123 [P1, P2].",
    "Inconsistency I^2 of 84.3 percent [P1].",
])
def test_post_check_strips_i2_and_tau2_restatements_even_with_one_citation(sentence):
    out, removed, _ = _strip(f"Lower risk [P1]. {sentence} More trials [P2].", HET)
    assert out == "Lower risk [P1]. More trials [P2]." and removed == 1


@pytest.mark.parametrize("sentence", [
    "A trial enrolled 84 patients [P1].",              # a bare 84 is not an I2 restatement
    "The cohort had I2 values reported by authors [P1].",
    "Mean age 0.12 years [P1].",
    "Heterogeneity of populations was noted [P1].",
])
def test_post_check_i2_tau2_patterns_only_match_next_to_their_label(sentence):
    assert _strip(sentence, HET) == (sentence, 0, 0)


def test_post_check_strips_rd_restated_as_a_percent():
    out, removed, _ = _strip("The pooled risk difference was 5% [P1, P2]. Risk fell by 9.3% overall. "
                             "One trial found a 5% reduction [P3]. Rates were 15% vs 20% [P1, P2].", RD)
    assert out == "One trial found a 5% reduction [P3]. Rates were 15% vs 20% [P1, P2]."
    assert removed == 2
    # a ratio measure never produces percent patterns
    assert pooled_extra_patterns(HET)[1] == []


async def test_pooling_is_skipped_when_quotes_were_not_verified():
    from app.services.llm_config import HarnessSpec

    deps = make_deps()
    deps.llms.harness = HarnessSpec(verify_quotes=False)
    values, events, _ = await run_graph(deps, META, thread="m-noverify")
    r = values["result"]
    assert r["meta_analysis"] is None
    assert "pooling skipped: study numbers were not verified" in r["errors"]
    assert "pooled" not in [e["type"] for e in events]
    assert any(q.get("stage") == "pool" and q.get("skipped") for q in values["quality"])
    assert r["synthesis"]["executive_summary"]


def test_markdown_prints_verified_inputs_as_reported_and_computed_values_at_two_decimals():
    r = stub_result("t", "en", "meta_analysis")
    for s in r["meta_analysis"]["pools"][0]["studies"]:
        if s["ref"] == "P3":
            s["effect"], s["ci_lower"], s["ci_upper"] = 0.785, 0.612, 1.004
    md = render_markdown(md_review(r))
    assert "P3 0.785 [0.612, 1.004]" in md
    est = r["meta_analysis"]["pools"][0]["pooled"]
    assert f"{est['est']:.2f} (95% CI" in md
