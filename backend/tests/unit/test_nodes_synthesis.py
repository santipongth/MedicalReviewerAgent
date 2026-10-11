import json
import re
import time

import pytest
from langgraph.types import Send

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.synthesis import (
    CERTAINTY_SENTENCE,
    make_explain_conflict,
    make_finalize,
    make_localize,
    make_normalize_outcomes,
    make_write_synthesis,
    route_conflicts,
)
from app.graph.schemas import (
    Candidate,
    ConflictNote,
    OutcomeCluster,
    OutcomeClusters,
    OutcomeMember,
    SynthesisNarrative,
    TranslationBatch,
    TranslationItem,
)
from app.services.llm import LLMError, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM, to_thai


def card(outcome="CRC incidence", direction="positive", design="cohort", n=1000, rob="moderate"):
    return {"study_design": design, "population": "adults with T2D", "sample_size": n, "sample_size_quote": None,
            "intervention_or_exposure": "metformin", "comparator": "sulfonylurea",
            "outcomes": [{"outcome": outcome, "result": "lower risk 0.80", "evidence_quote": "q",
                          "effect_size": "HR 0.80", "effect_measure": "HR", "effect_value": 0.8, "ci_lower": 0.7,
                          "ci_upper": 0.9, "p_value": 0.01, "direction": direction}],
            "key_findings": ["lower CRC"], "limitations": ["observational"], "funding_or_conflicts": None,
            "risk_of_bias": rob, "overall_direction": direction}


def paper(ref, c=None, error=None):
    cand = Candidate(title=f"Paper {ref}", doi=f"10.1/{ref}", year=2020).model_dump()
    return {"ref": ref, "candidate": cand, "relevance": 90, "screen_reason": "ok",
            "card": c, "error": error,
            "verification": {"numbers_verified": 4, "numbers_total": 4, "agreement": 1.0, "escalated": False,
                             "repaired": False, "uncertain": False}}


def unexpected(name):
    return FakeStructuredLLM(name, lambda s, u: AssertionError(f"{name} must not be called"))


def deps(**roles):
    u = unexpected("u")
    base = {"guard": u, "planner": u, "screener": u, "extractor": u, "synthesizer": u,
            "harness": HarnessSpec(max_repairs=1)}
    return GraphDeps(settings=Settings(_env_file=None), llms=LLMs(**{**base, **roles}))


def items_in(user):
    return json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))


def thai(system, user):
    return TranslationBatch(items=[TranslationItem(id=i["id"], text=to_thai(i["text"])) for i in items_in(user)])


def state(papers, **extra):
    return {"topic": "เมตฟอร์มิน", "english_topic": "metformin and CRC", "language": "th", "papers": papers,
            "question": {"refined_question": "Does metformin reduce CRC incidence in adults with T2D?",
                         "sub_questions": ["Is it safe?"]}, **extra}


# ---- normalize_outcomes + matrix ------------------------------------------------------------
async def test_normalizer_clusters_are_validated_and_build_the_matrix():
    papers = [paper("P1", card("CRC incidence")), paper("P2", card("incident colorectal cancer", "negative"))]
    clusters = OutcomeClusters(clusters=[OutcomeCluster(canonical="Colorectal cancer incidence", members=[
        OutcomeMember(ref="P1", outcome="CRC incidence"),
        OutcomeMember(ref="P2", outcome="incident colorectal cancer")])])
    norm = FakeStructuredLLM("qwen", lambda s, u: clusters)
    out = await make_normalize_outcomes(deps(normalizer=norm))(state(papers))
    m = out["matrix"]
    assert [r["outcome"] for r in m["rows"]] == ["Colorectal cancer incidence"]
    assert m["conflicts"][0]["refs"] == ["P1", "P2"]
    assert m["grade"]["level"] in ("very_low", "low")
    q = out["quality"][0]
    assert q["stage"] == "normalize" and q["fallback"] is False and q["seconds"] >= 0
    assert "CRC incidence" in norm.calls[0][1] and "incident colorectal cancer" in norm.calls[0][1]


async def test_invalid_clusters_fall_back_to_deterministic_grouping():
    papers = [paper("P1", card("CRC incidence")), paper("P2", card("crc incidence"))]
    bad = OutcomeClusters(clusters=[OutcomeCluster(canonical="x", members=[OutcomeMember(ref="P9", outcome="y")])])
    out = await make_normalize_outcomes(deps(normalizer=FakeStructuredLLM("qwen", lambda s, u: bad)))(state(papers))
    assert out["quality"][0]["fallback"] is True
    assert len(out["matrix"]["rows"]) == 1 and len(out["matrix"]["rows"][0]["cells"]) == 2
    assert out["matrix"]["consensus"][0]["refs"] == ["P1", "P2"]


async def test_no_extracted_papers_gives_empty_matrix_without_llm():
    out = await make_normalize_outcomes(deps(normalizer=unexpected("qwen")))(state([paper("P1", None, "x")]))
    assert out["matrix"]["rows"] == [] and out["matrix"]["grade"]["level"] == "very_low"


# ---- conflicts ---------------------------------------------------------------------------------
def test_route_conflicts_fans_out_one_send_per_conflict():
    papers = [paper("P1", card()), paper("P2", card(direction="negative")), paper("P3", card())]
    matrix = {"rows": [], "consensus": [], "conflicts": [
        {"outcome": "CRC incidence", "refs": ["P1", "P2", "P3"], "directions": {"positive": ["P1", "P3"],
                                                                               "negative": ["P2"]}}]}
    sends = route_conflicts(state(papers, matrix=matrix))
    assert len(sends) == 1 and isinstance(sends[0], Send) and sends[0].node == "explain_conflict"
    assert [p["ref"] for p in sends[0].arg["papers"]] == ["P1", "P2", "P3"]
    assert sends[0].arg["question"].startswith("Does metformin")
    assert route_conflicts(state(papers, matrix={**matrix, "conflicts": []})) == "write_synthesis"


def conflict_payload():
    return {"conflict": {"outcome": "CRC incidence", "refs": ["P1", "P2"],
                         "directions": {"positive": ["P1"], "negative": ["P2"]}},
            "papers": [{"ref": "P1", "card": card()}, {"ref": "P2", "card": card(direction="negative")}],
            "question": "Q?"}


async def test_conflict_explanation_with_unknown_citation_is_repaired():
    answers = iter([
        ConflictNote(outcome="CRC incidence", refs=["P1", "P2"], likely_reasons=["dose"],
                     explanation="[P1] vs [P7] differ."),
        ConflictNote(outcome="CRC incidence", refs=["P1", "P2"], likely_reasons=["dose", "follow-up"],
                     explanation="[P1] used higher doses than [P2]."),
    ])
    llm = FakeStructuredLLM("ds", lambda s, u: next(answers))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    note = out["conflict_notes"][0]
    assert "unknown citation P7" in llm.calls[1][1]
    assert note["likely_reasons"] == ["dose", "follow-up"] and note["refs"] == ["P1", "P2"]
    assert out["quality"][0]["stage"] == "conflict"


async def test_conflict_explainer_failure_gives_deterministic_note():
    llm = FakeStructuredLLM("ds", lambda s, u: LLMError("down"))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    note = out["conflict_notes"][0]
    assert note["outcome"] == "CRC incidence" and "[P1]" in note["explanation"] and "[P2]" in note["explanation"]
    assert out["quality"][0]["fallback"] is True


# ---- narrative + card localization -------------------------------------------------------
def matrix_for(papers):
    rows = [{"outcome": "CRC incidence", "cells": [
        {"ref": p["ref"], "finding": "lower risk 0.80", "direction": "positive", "effect_measure": "HR",
         "effect_value": 0.8, "ci_lower": 0.7, "ci_upper": 0.9} for p in papers]}]
    return {"rows": rows, "consensus": [{"outcome": "CRC incidence", "direction": "positive",
                                         "refs": [p["ref"] for p in papers]}],
            "conflicts": [], "grade": {"level": "low", "factors": ["start low"]}}


def narrative(summary="Metformin lowers CRC risk [P1, P2].", strength="moderate"):
    return SynthesisNarrative(executive_summary=summary, evidence_strength=strength,
                              evidence_rationale="observational [P1]", research_gaps=["RCTs"])


async def test_narrative_citation_check_repairs_then_strips_and_clamps_grade():
    papers = [paper("P1", card()), paper("P2", card())]
    answers = iter([narrative("Lower risk [P9].", "high"), narrative("Lower risk [P1, P9].", "high")])
    synth = FakeStructuredLLM("ds", lambda s, u: next(answers))
    out = await make_write_synthesis(deps(synthesizer=synth))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en"))
    s = out["synthesis"]
    assert "unknown citation P9" in synth.calls[1][1]
    # still invalid after repair → unknown refs stripped; no "probably" → the moderate GRADE sentence is appended
    assert s["executive_summary"] == "Lower risk [P1]. " + CERTAINTY_SENTENCE["moderate"]
    assert s["evidence_strength"] == "moderate" and s["grade_baseline"] == "low"  # high clamped to baseline+1
    assert s["comparison"][0]["outcome"] == "CRC incidence"
    assert s["consensus"][0]["refs"] == ["P1", "P2"]
    q = {e["stage"]: e for e in out["quality"]}
    assert q["narrative"]["citation_fixes"] == 1 and q["narrative"]["seconds"] >= 0
    assert out["localized_cards"] is None  # English review: nothing to translate


async def test_narrative_prompt_carries_question_matrix_and_baseline():
    papers = [paper("P1", card())]
    synth = FakeStructuredLLM("ds", lambda s, u: narrative("Lower [P1]."))
    await make_write_synthesis(deps(synthesizer=synth))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en"))
    system, user = synth.calls[0]
    assert "Does metformin reduce CRC incidence" in user and "Is it safe?" in user
    assert "GRADE-lite baseline: low" in user and user.index("<evidence>") < user.index("Checklist")
    assert "Thai" not in system


async def test_cards_are_localized_in_parallel_and_keep_numbers():
    papers = [paper("P1", card())]
    loc = FakeStructuredLLM("qwen", thai)
    out = await make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: narrative("A [P1].")),
                                          localizer=loc))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[]))
    lc = out["localized_cards"]["P1"]
    assert lc["outcomes"][0]["result"] == to_thai("lower risk 0.80")
    assert lc["outcomes"][0]["evidence_quote"] == "q" and lc["outcomes"][0]["effect_value"] == 0.8
    assert lc["population"] == to_thai("adults with T2D") and lc["key_findings"] == [to_thai("lower CRC")]
    entry = next(e for e in out["quality"] if e["stage"] == "localize_cards")
    assert entry["retried"] == entry["untranslated"] == entry["kept_english"] == 0  # the main path, no retry
    assert len(loc.calls) == 1
    # synthesis itself stays English here
    assert out["synthesis"]["executive_summary"] == "A [P1]. " + CERTAINTY_SENTENCE["moderate"]


async def test_narrative_failure_keeps_table_with_fallback_summary():
    papers = [paper("P1", card())]
    out = await make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: LLMError("x"))))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en"))
    assert out["synthesis"]["comparison"][0]["cells"][0]["ref"] == "P1"
    assert "failed" in out["synthesis"]["executive_summary"] and "synthesis failed" in out["errors"][0]


async def test_no_papers_gives_localized_explicit_message_without_llm():
    out = await make_write_synthesis(deps(synthesizer=unexpected("ds")))(
        state([], matrix={"rows": [], "consensus": [], "conflicts": [], "grade": {"level": "very_low"}},
              conflict_notes=[]))
    assert "ไม่พบ" in out["synthesis_display"]["executive_summary"]
    assert out["synthesis"]["evidence_strength"] == "very_low"


# ---- localize ------------------------------------------------------------------------------
async def test_localize_translates_synthesis_and_maps_cells_from_localized_cards():
    papers = [paper("P1", card())]
    writer = make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: narrative("A [P1]."))))
    english = (await writer(state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en")))["synthesis"]
    localized_cards = {"P1": {**card(), "outcomes": [{**card()["outcomes"][0], "result": "ความเสี่ยงต่ำลง 0.80"}]}}
    out = await make_localize(deps(localizer=FakeStructuredLLM("qwen", thai)))(
        state(papers, synthesis=english, localized_cards=localized_cards))
    d = out["synthesis_display"]
    assert d["executive_summary"] == to_thai("A [P1]. " + CERTAINTY_SENTENCE["moderate"])
    assert d["research_gaps"] == [to_thai("RCTs")]
    assert d["comparison"][0]["outcome"] == to_thai("CRC incidence")
    assert d["comparison"][0]["cells"][0]["finding"] == "ความเสี่ยงต่ำลง 0.80"
    q = out["quality"][0]
    assert q["stage"] == "localize" and q["kept_english"] == q["untranslated"] == q["retried"] == 0
    assert q["citations_restored"] == 0


async def test_card_localization_reports_untranslated_items_after_one_retry():
    papers = [paper("P1", card())]
    def echo_english(system, user):  # the localizer echoes its input, as Qwen did in the audit runs
        return TranslationBatch(items=[TranslationItem(id=i["id"], text=i["text"]) for i in items_in(user)])

    echo = FakeStructuredLLM("qwen", echo_english)
    out = await make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: narrative("A [P1].")),
                                          localizer=echo))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[]))
    entry = next(e for e in out["quality"] if e["stage"] == "localize_cards")
    assert entry["retried"] == entry["untranslated"] > 0 and entry["kept_english"] == 0


async def test_localize_is_skipped_for_english_and_when_already_localized():
    english = {"executive_summary": "x"}
    out = await make_localize(deps(localizer=unexpected("qwen")))(state([], synthesis=english, language="en"))
    assert out["synthesis_display"] == english
    assert await make_localize(deps(localizer=unexpected("qwen")))(
        state([], synthesis=english, synthesis_display={"executive_summary": "ไม่พบ"})) == {}


# ---- finalize -------------------------------------------------------------------------------
QUALITY = [
    {"stage": "refine", "seconds": 2.0, "fallback": False, "critique_applied": True},
    {"stage": "plan", "seconds": 1.0}, {"stage": "search", "seconds": 3.0}, {"stage": "enrich", "seconds": 1.5},
    {"stage": "screen", "seconds": 4.0, "borderline": 2, "disagreements": 1, "escalated": 1},
    {"stage": "screen", "seconds": 5.0, "borderline": 0, "disagreements": 0, "escalated": 0},
    {"stage": "read", "ref": "P1", "seconds": 10.0, "numbers_verified": 3, "numbers_total": 4, "agreement": 1.0,
     "escalated": False, "repaired": True, "uncertain": False},
    {"stage": "read", "ref": "P2", "seconds": 20.0, "numbers_verified": 1, "numbers_total": 0, "agreement": 0.5,
     "escalated": True, "repaired": False, "uncertain": True},
    {"stage": "normalize", "seconds": 1.0, "fallback": False},
    {"stage": "narrative", "seconds": 6.0, "citation_fixes": 1},
    {"stage": "localize", "seconds": 2.0, "kept_english": 1, "untranslated": 1, "retried": 2,
     "citations_restored": 0},
    {"stage": "localize_cards", "seconds": 3.0, "kept_english": 0, "untranslated": 2, "retried": 5,
     "citations_restored": 1},
]


async def test_finalize_builds_result_with_question_quality_and_both_languages():
    papers = [paper("P2", card()), paper("P1", card()), paper("P1", None, "retry dup")]
    question = {"question_type": "therapy", "interpretation": "i", "refined_question": "RQ?",
                "population": "adults", "intervention_or_exposure": "metformin", "comparator": "none",
                "outcomes": ["CRC"], "study_designs": ["cohort"], "timeframe": None, "sub_questions": ["s"],
                "key_terms": [], "assumptions": ["a"], "ambiguities": ["b"]}
    st = state(
        papers, question=question,
        question_display={"interpretation": "ตีความ", "refined_question": "คำถาม?", "sub_questions": ["ย่อย"],
                          "assumptions": ["สมมติ"]},
        synthesis={"executive_summary": "EN"}, synthesis_display={"executive_summary": "TH"},
        localized_cards={"P1": {**card(), "population": "ผู้ใหญ่"}},
        plan={"queries": ["q1"]}, candidates=[{}] * 20, screened=[{"key": str(i)} for i in range(20)],
        selected=[{}, {}], search_stats={"found": 40, "unique": 25, "with_abstract": 22}, errors=["e"],
        started_at=time.time() - 30, quality=QUALITY)
    d = deps()
    d.llms.preset, d.llms.models = "budget", {"extractor": "openrouter:deepseek/deepseek-v4-pro"}
    r = (await make_finalize(d)(st))["result"]
    assert r["summary"] == "TH" and r["synthesis"]["executive_summary"] == "TH"
    assert r["synthesis_en"]["executive_summary"] == "EN"
    assert [p["ref"] for p in r["papers"]] == ["P1", "P2"]
    assert r["papers"][0]["card"]["population"] == "ผู้ใหญ่"
    assert r["papers"][0]["card_en"]["population"] == "adults with T2D"
    assert r["papers"][0]["verification"]["numbers_total"] == 4
    assert r["stats"] == {"found": 40, "unique": 25, "with_abstract": 22, "candidates": 20, "screened": 20, "selected": 2,
                          "extracted": 2, "non_research": 0, "year_excluded": 0, "no_abstract": 0,
                          "excluded_screening": {},
                          # selection stats from before Plan 21 carry no requested/eligible: null, never a guess
                          "excluded_selection": {"narrative_excluded": 0, "over_limit": 0, "requested": None,
                                                 "eligible": None, "study_design_relaxed": 0,
                                                 "study_design_corrected": 0, "low_relevance": 0, "off_focus": 0},
                          "related_reports": 0}  # Plan 20 Task 10
    assert r["question"]["refined_question"] == "คำถาม?" and r["question"]["english"]["refined_question"] == "RQ?"
    assert r["question"]["pico"]["population"] == "adults" and r["question"]["original_topic"] == "เมตฟอร์มิน"
    assert r["question"]["ambiguities"] == ["b"] and r["question"]["refined"] is True
    qa = r["quality"]
    assert qa["numbers_verified"] == 4 and qa["numbers_total"] == 4 and qa["verification_rate"] == 1.0
    assert qa["papers_uncertain"] == 1 and qa["extraction_escalations"] == 1 and qa["agreement_mean"] == 0.75
    assert qa["screen_disagreements"] == 1 and "fulltext_timeouts" not in qa and qa["citation_fixes"] == 1
    assert qa["localization_kept_english"] == 1 and qa["question_critique_applied"] is True
    assert qa["localize"] == {"untranslated": 3, "retried": 7, "citations_restored": 1}
    t = qa["timings"]
    assert t["refine"] == 2.0 and t["screen"] == 5.0 and t["read_max"] == 20.0 and t["read_mean"] == 15.0
    assert t["narrative"] == 6.0 and 29 <= t["total"] <= 60
    assert r["llm_preset"] == "budget" and r["models"]["extractor"].endswith("deepseek-v4-pro")
    assert r["queries"] == ["q1"] and r["errors"] == ["e"]


async def test_finalize_without_refined_question_uses_topic():
    r = (await make_finalize(deps())(
        {"topic": "t", "english_topic": "T", "language": "en", "papers": [], "question": None,
         "synthesis": {"executive_summary": "none"}}))["result"]
    assert r["question"]["refined"] is False and r["question"]["refined_question"] == "T"
    assert r["quality"]["verification_rate"] is None and r["quality"]["timings"]["total"] is None


async def test_missing_optional_roles_use_deterministic_paths():
    papers = [paper("P1", card()), paper("P2", card(direction="negative"))]
    out = await make_normalize_outcomes(deps())(state(papers))
    assert out["matrix"]["conflicts"]
    note = await make_explain_conflict(deps())(conflict_payload())
    assert "[P1]" in note["conflict_notes"][0]["explanation"]


@pytest.mark.parametrize("language", ["en", "th"])
async def test_localize_without_localizer_keeps_english(language):
    out = await make_localize(deps())(state([], synthesis={"executive_summary": "x"}, language=language))
    assert out["synthesis_display"] == {"executive_summary": "x"}


def test_quality_reports_snippet_only_candidates_excluded():
    from app.harness.quality import summarize_quality
    q = summarize_quality([{"stage": "enrich", "snippet_only": 4, "seconds": 1.0}], None)
    assert q["snippet_only_excluded"] == 4
    assert summarize_quality([], None)["snippet_only_excluded"] == 0


async def test_narrative_reviews_stay_listed_but_out_of_the_evidence():
    review = {**card("CRC incidence", "negative"), "design_category": "narrative_review"}
    papers = [paper("P1", card("CRC incidence")), paper("P2", card("CRC incidence")), paper("P3", review)]
    out = await make_normalize_outcomes(deps())(state(papers))  # no normalizer: deterministic grouping
    m = out["matrix"]
    assert [c["ref"] for c in m["rows"][0]["cells"]] == ["P1", "P2"]  # the review adds no cell...
    assert m["conflicts"] == []  # ...and no conflict
    r = (await make_finalize(deps())(state(papers, synthesis={"executive_summary": "EN"})))["result"]
    listed = {p["ref"]: p for p in r["papers"]}
    assert listed["P3"]["card"]["design_category"] == "narrative_review"  # still listed, labelled as a review


def test_repair_clusters_fixes_a_near_miss_instead_of_discarding_it():
    from app.harness.matrix import repair_clusters, validate_clusters
    papers = [paper("P1", card("CRC incidence")), paper("P2", card("incident colorectal cancer")),
              paper("P3", card("crc incidence")), paper("P4", card("CRC mortality"))]
    near_miss = OutcomeClusters(clusters=[
        OutcomeCluster(canonical="Colorectal cancer incidence", members=[
            OutcomeMember(ref="P1", outcome="CRC incidence"), OutcomeMember(ref="P2", outcome="incident colorectal cancer"),
            OutcomeMember(ref="P2", outcome="incident colorectal cancer"),  # duplicate
            OutcomeMember(ref="P9", outcome="made up")]),                     # unknown
        OutcomeCluster(canonical=" ", members=[OutcomeMember(ref="P4", outcome="CRC mortality")])])  # empty name
    fixed, repairs, kept = repair_clusters(near_miss, papers)                 # P3 "crc incidence" is missing
    assert validate_clusters(fixed, papers) == [] and kept == 3 and repairs == 4
    names = {c.canonical: sorted(m.ref for m in c.members) for c in fixed.clusters}
    assert names == {"Colorectal cancer incidence": ["P1", "P2", "P3"], "CRC mortality": ["P4"]}


async def test_normalize_keeps_a_repaired_llm_clustering():
    papers = [paper("P1", card("CRC incidence")), paper("P2", card("incident colorectal cancer")),
              paper("P3", card("crc incidence"))]
    partial = OutcomeClusters(clusters=[OutcomeCluster(canonical="Colorectal cancer incidence", members=[
        OutcomeMember(ref="P1", outcome="CRC incidence")])])
    norm = FakeStructuredLLM("qwen", lambda s, u: partial)  # P2 always missing → validation never passes
    out = await make_normalize_outcomes(deps(normalizer=norm))(state(papers))
    q = out["quality"][0]
    # P3's "crc incidence" is pre-clustered with P1 in code, so the model sees 2 pairs; the missing P2 is repaired
    assert q["fallback"] is False and q["corrections"] == 1 and q["pairs"] == 3 and q["sent"] == 2
    rows = {r["outcome"]: sorted(c["ref"] for c in r["cells"]) for r in out["matrix"]["rows"]}
    assert rows == {"Colorectal cancer incidence": ["P1", "P3"], "incident colorectal cancer": ["P2"]}


def test_quality_reports_normalization_corrections():
    from app.harness.quality import summarize_quality
    assert summarize_quality([{"stage": "normalize", "corrections": 3, "fallback": False}], None)[
        "normalization_corrections"] == 3


def test_consensus_statement_names_the_dissenting_studies():
    from app.graph.nodes.synthesis import _clusters
    matrix = {"consensus": [{"outcome": "CRC incidence", "direction": "positive", "refs": ["P1", "P2", "P3"],
                             "dissent": {"null": ["P4"]}}], "conflicts": []}
    consensus, conflicts = _clusters(matrix, [])
    assert consensus[0].refs == ["P1", "P2", "P3"] and conflicts == []
    assert "3 of 4 studies" in consensus[0].explanation and "[P4]" in consensus[0].explanation


def test_dissent_counts_distinct_studies_when_one_paper_reports_two_directions():
    from app.graph.nodes.synthesis import _consensus_explanation
    from app.harness.matrix import build_matrix

    def two(ref, d1, d2):
        c = card("CRC incidence", d1)
        c["outcomes"].append({**c["outcomes"][0], "outcome": "CRC incidence (women)", "direction": d2})
        return paper(ref, c)
    papers = [paper(f"P{i}", card("CRC incidence")) for i in range(1, 4)] + [two("P4", "positive", "null")]
    clusters = OutcomeClusters(clusters=[OutcomeCluster(canonical="CRC incidence", members=[
        *[OutcomeMember(ref=f"P{i}", outcome="CRC incidence") for i in range(1, 5)],
        OutcomeMember(ref="P4", outcome="CRC incidence (women)")])])
    m = build_matrix(papers, clusters)
    c = m["consensus"][0]
    assert c["refs"] == ["P1", "P2", "P3", "P4"] and c["dissent"] == {}  # P4 is not both a supporter and a dissenter
    assert _consensus_explanation({"outcome": "CRC", "refs": ["P1", "P2", "P3"], "dissent": {"null": ["P4"]}})         .endswith("[P4] shows no significant association.")


def test_narrative_prompt_prefers_pooled_estimates():
    from app.graph.prompts import NARRATIVE_SYSTEM
    assert "pooled" in NARRATIVE_SYSTEM and "independent" in NARRATIVE_SYSTEM


async def test_finalize_carries_review_type():
    base = {"topic": "t", "english_topic": "T", "language": "en", "papers": [], "question": None,
            "synthesis": {"executive_summary": "none"}}
    r = (await make_finalize(deps())({**base, "options": {"review_type": "scoping"}}))["result"]
    assert r["review_type"] == "scoping"
    assert (await make_finalize(deps())(base))["result"]["review_type"] == "slr"


# ---- review types ---------------------------------------------------------------------------
def test_scoping_skips_conflict_explanation_and_counts_narrative_reviews():
    from app.graph.nodes.synthesis import _evidence
    papers = [paper("P1", card()), paper("P2", {**card(direction="negative"), "design_category": "narrative_review"})]
    matrix = {"rows": [], "consensus": [], "conflicts": [
        {"outcome": "x", "refs": ["P1", "P2"], "directions": {"positive": ["P1"], "negative": ["P2"]}}]}
    scoping = state(papers, matrix=matrix, options={"review_type": "scoping"})
    assert route_conflicts(scoping) == "write_synthesis"
    assert [p["ref"] for p in _evidence(scoping)] == ["P1", "P2"]
    assert [p["ref"] for p in _evidence(state(papers, options={"review_type": "narrative"}))] == ["P1"]
    assert isinstance(route_conflicts(state(papers, matrix=matrix, options={"review_type": "narrative"})), list)


@pytest.mark.parametrize("rt", ["narrative", "scoping"])
async def test_ungraded_synthesis_has_no_strength_and_a_fixed_rationale(rt):
    from app.graph.schemas import NarrativeNoGrade
    papers = [paper("P1", card())]
    synth = FakeStructuredLLM("ds", lambda s, u: NarrativeNoGrade(executive_summary="Themes [P1].",
                                                                  research_gaps=["RCTs"]))
    out = await make_write_synthesis(deps(synthesizer=synth))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options={"review_type": rt}))
    s = out["synthesis"]
    assert s["evidence_strength"] is None and s["grade_baseline"] is None
    assert s["evidence_rationale"] == f"Certainty of evidence is not graded in a {rt} review."
    assert s["research_gaps"] == ["RCTs"] and s["comparison"][0]["outcome"] == "CRC incidence"
    assert "override any conflicting rule" in synth.calls[0][0]


async def test_ungraded_synthesis_citation_check_and_fallback():
    from app.graph.schemas import NarrativeNoGrade
    papers = [paper("P1", card())]
    answers = iter([NarrativeNoGrade(executive_summary="x [P9].", research_gaps=[]),
                    NarrativeNoGrade(executive_summary="x [P1, P9].", research_gaps=["g [P9]"])])
    synth = FakeStructuredLLM("ds", lambda s, u: next(answers))
    st = state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options={"review_type": "scoping"})
    out = await make_write_synthesis(deps(synthesizer=synth))(st)
    assert "unknown citation P9" in synth.calls[1][1]
    assert out["synthesis"]["executive_summary"] == "x [P1]." and out["synthesis"]["research_gaps"] == ["g"]
    out = await make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: LLMError("x"))))(st)
    assert out["synthesis"]["evidence_strength"] is None and "failed" in out["synthesis"]["executive_summary"]


async def test_ungraded_no_papers_message_is_not_very_low():
    out = await make_write_synthesis(deps(synthesizer=unexpected("ds")))(
        state([], matrix={"rows": [], "consensus": [], "conflicts": []}, conflict_notes=[],
              options={"review_type": "scoping"}))
    assert out["synthesis"]["evidence_strength"] is None


@pytest.mark.parametrize("rt", ["narrative", "scoping"])
async def test_non_slr_narrative_prompt_has_no_grade_text(rt):
    from app.graph.schemas import NarrativeNoGrade
    papers = [paper("P1", card())]
    synth = FakeStructuredLLM("ds", lambda s, u: NarrativeNoGrade(executive_summary="A [P1].", research_gaps=[]))
    out = await make_write_synthesis(deps(synthesizer=synth))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options={"review_type": rt}))
    system, user = synth.calls[0]
    assert "GRADE" not in user and "evidence_strength" not in user and "one level" not in user
    assert "evidence_rationale" not in system.split("override any conflicting rule")[1]
    assert (out["synthesis"]["consensus"] == []) == (rt == "scoping")
