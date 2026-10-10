"""Plan 19 Task 2 (audit I-2a/b/c, I-14): comparison-aware evidence, grounded prose numbers, measure names and
populations, and GRADE certainty wording. The fixtures are the audit's real failures (runs 84edcb5d, SLR metformin
and CRC; 91b5b764, meta-analysis SGLT2i and HF)."""
import copy
import json
import re

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.graph.graph import build_graph, initial_state
from app.graph.nodes.synthesis import (
    CERTAINTY_SENTENCE,
    OTHER_COMPARISONS_ONLY_FACTOR,
    PROSE_REMOVED,
    _card_strings,
    _evidence,
    make_explain_conflict,
    make_normalize_outcomes,
    make_write_synthesis,
    route_conflicts,
)
from app.graph.schemas import (
    Candidate,
    ConflictNote,
    NarrativeNoGrade,
    OutcomeResult,
    PaperCard,
    SynthesisNarrative,
)
from app.harness.comparison import (
    answers_question,
    intervention_lexicon,
    question_card,
    settle_comparisons,
)
from app.harness.prose import ProseContext, context_numbers, fix_prose, paper_facts, prose_problems
from app.harness.quality import summarize_quality
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_synthesis import deps, state
from tests.unit.test_review_graph import QUESTION, make_deps


# ---- fixtures: the audit's cards ----------------------------------------------------------------
def outcome(name, measure, value, lo, hi, *, direction="positive", comparison=None, matches=True, result=None):
    return {"outcome": name, "result": result or f"{name} result", "evidence_quote": "q", "effect_size": None,
            "effect_measure": measure, "effect_value": value, "ci_lower": lo, "ci_upper": hi, "p_value": None,
            "direction": direction, "comparison": comparison, "matches_question": matches}


def card(outcomes, *, design="cohort", population="Patients with type 2 diabetes", intervention="Metformin therapy",
         n=None):
    return {"study_design": design, "design_category": design, "population": population, "sample_size": n,
            "sample_size_quote": None, "intervention_or_exposure": intervention, "comparator": "other therapies",
            "outcomes": outcomes, "key_findings": [], "limitations": [], "funding_or_conflicts": None,
            "risk_of_bias": "moderate", "overall_direction": "positive"}


def paper(ref, c, title=None, year=2020):
    cand = Candidate(title=title or f"Paper {ref}", doi=f"10.1/{ref}", year=year).model_dump()
    return {"ref": ref, "candidate": cand, "relevance": 90, "screen_reason": "ok", "card": c, "error": None,
            "verification": {"numbers_verified": 1, "numbers_total": 1, "agreement": None, "escalated": False,
                             "repaired": False, "uncertain": False}}


# 84edcb5d: metformin and colorectal cancer (SLR). P3 is GLP-1RA vs insulin, coded positive for metformin.
SLR_PAPERS = [
    paper("P1", card([outcome("Incidence of colorectal cancer", "OR", 0.78, 0.7, 0.87,
                              comparison="metformin vs non-metformin users")], design="sr_ma_mixed"),
          "Metformin therapy and risk of colorectal adenomas and colorectal cancer in type 2 diabetes"),
    paper("P2", card([outcome("Incidence of colorectal cancer", "RR", 0.63, 0.47, 0.84,
                              comparison="metformin vs other antidiabetic therapies")], design="sr_ma_observational"),
          "Reduced risk of colorectal cancer with metformin therapy in patients with type 2 diabetes"),
    paper("P3", card([outcome("colorectal cancer incidence", "HR", 0.54, 0.46, 0.64, comparison="GLP-1RAs vs insulin",
                              matches=False,
                              result="GLP-1RAs compared with insulin were associated with a significant risk "
                                     "reduction in colorectal cancer (HR 0.54; 95% CI 0.46-0.64).")],
                     population="1,651,452 patients with type 2 diabetes", intervention="Prescription of GLP-1RAs"),
          "Glucagon-Like Peptide 1 Receptor Agonists and 13 Obesity-Associated Cancers in Patients With Type 2 Diabetes"),
    paper("P4", card([outcome("Incidence of colorectal cancer", "RR", 0.75, 0.66, 0.86,
                              comparison="metformin vs non-metformin treatment",
                              result="25% lower CRC incidence among diabetic patients treated with metformin")],
                     design="sr_ma_mixed"),
          "Reduced colorectal cancer incidence in type 2 diabetic patients treated with metformin: a meta-analysis"),
]
SLR_SUMMARY_1 = ("Systematic reviews and meta-analyses indicate that metformin use is associated with a significantly "
                 "reduced risk of colorectal cancer incidence in patients with type 2 diabetes, with pooled odds ratios "
                 "ranging from 0.63 to 0.78 compared to non-metformin users or other therapies [P1, P2, P4].")

# 91b5b764: SGLT2 inhibitors and HF hospitalisation (meta). P2 is EMPEROR-Preserved; P5's HR 1.33 is the
# association of an eGFR decline with outcomes, not drug vs placebo.
HF = "SGLT2 inhibitors"
META_PAPERS = [
    paper("P1", card([outcome("worsening heart failure", "HR", 0.74, 0.65, 0.85, comparison="dapagliflozin vs placebo")],
                     design="rct", intervention="dapagliflozin",
                     population="Patients with New York Heart Association class II, III, or IV heart failure and an "
                                "ejection fraction of 40% or less"),
          "Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction", 2019),
    paper("P2", card([outcome("hospitalization for heart failure", "HR", 0.73, 0.61, 0.88,
                              comparison="empagliflozin vs placebo")], design="rct", intervention="empagliflozin",
                     population="patients with class II-IV heart failure and an ejection fraction of more than 40%"),
          "Empagliflozin in Heart Failure with a Preserved Ejection Fraction", 2021),
    paper("P5", card([outcome("Cardiovascular death or heart failure event", "HR", 1.33, 1.1, 1.62, direction="mixed",
                              comparison="initial eGFR decline >10% vs <=10% (placebo group)", matches=False),
                      outcome("Renal outcomes", "HR", 0.94, 0.49, 1.82, direction="null",
                              comparison="initial eGFR decline >10% vs <=10% (dapagliflozin group)", matches=False)],
                     design="rct", intervention="Dapagliflozin 10 mg per day",
                     population="Patients with heart failure with mildly reduced ejection fraction (HFmrEF) or "
                                "preserved ejection fraction (HFpEF)"),
          "Decline in Estimated Glomerular Filtration Rate After Dapagliflozin in Heart Failure With Mildly Reduced or "
          "Preserved Ejection Fraction", 2023),
]
META_SUMMARY_1 = ("SGLT2 inhibitors reduce the risk of heart failure hospitalization and cardiovascular death in "
                  "patients with reduced ejection fraction, as demonstrated by dapagliflozin [P1] and empagliflozin [P2].")


def ctx(papers, texts=(), values=()):
    return ProseContext(facts=paper_facts(papers), allowed=context_numbers(texts, values), max_count=len(papers))


# ---- (a) schema ---------------------------------------------------------------------------------
def test_outcome_schema_requires_comparison_fields_but_old_outcomes_still_load():
    schema = PaperCard.model_json_schema()["$defs"]["OutcomeResult"]
    assert {"comparison", "matches_question"} <= set(schema["required"])
    assert "default" not in schema["properties"]["comparison"]
    assert "default" not in schema["properties"]["matches_question"]
    old = {k: v for k, v in outcome("x", "HR", 0.8, 0.7, 0.9).items() if k not in ("comparison", "matches_question")}
    o = OutcomeResult.model_validate(old)
    assert o.matches_question is True and o.comparison is None
    assert answers_question(old) and not answers_question({**old, "matches_question": False})


# ---- (a) evidence view ----------------------------------------------------------------------------
async def test_glp1_vs_insulin_stays_out_of_the_matrix_consensus_and_grade():
    st = state(copy.deepcopy(SLR_PAPERS), language="en")
    assert [p["ref"] for p in _evidence(st)] == ["P1", "P2", "P4"]
    out = await make_normalize_outcomes(deps())(st)
    m = out["matrix"]
    refs = {c["ref"] for row in m["rows"] for c in row["cells"]}
    assert "P3" not in refs and refs == {"P1", "P2", "P4"}
    assert all("P3" not in c["refs"] for c in m["consensus"]) and m["conflicts"] == []
    assert "graded from pooled evidence: 3 systematic review(s)" in m["grade"]["factors"][0]  # P3 not counted
    # the stored card keeps the other comparison, flagged
    assert st["papers"][2]["card"]["outcomes"][0]["matches_question"] is False


def test_egfr_association_stays_out_of_conflicts_and_pools():
    papers = copy.deepcopy(META_PAPERS)
    st = state(papers, options={"review_type": "meta_analysis"})
    assert [p["ref"] for p in _evidence(st)] == ["P1", "P2"]  # every P5 outcome is another comparison
    matrix = {"rows": [], "consensus": [], "conflicts": [
        {"outcome": "x", "refs": ["P1", "P5"], "directions": {"positive": ["P1"], "mixed": ["P5"]}}]}
    [send] = route_conflicts(state(papers, matrix=matrix))
    assert [p["ref"] for p in send.arg["papers"]] == ["P1"]


def test_question_card_keeps_matching_outcomes_and_drops_papers_with_none():
    mixed = card([outcome("a", "HR", 0.8, 0.7, 0.9), outcome("b", "HR", 1.3, 1.1, 1.6, matches=False)])
    assert [o["outcome"] for o in question_card(mixed)["outcomes"]] == ["a"]
    assert question_card(card([outcome("b", "HR", 1.3, 1.1, 1.6, matches=False)])) is None
    assert question_card(card([])) is not None  # no outcomes: kept as before
    unflagged = card([outcome("a", "HR", 0.8, 0.7, 0.9)])
    assert question_card(unflagged) is unflagged


async def test_only_other_comparisons_is_graded_very_low_with_its_own_factor():
    papers = [paper("P1", card([outcome("x", "HR", 0.54, 0.46, 0.64, matches=False)]))]
    out = await make_normalize_outcomes(deps())(state(papers))
    assert out["matrix"]["rows"] == []
    assert out["matrix"]["grade"] == {"level": "very_low", "factors": [OTHER_COMPARISONS_ONLY_FACTOR]}


def test_comparison_text_is_localized_with_the_card():
    strings = _card_strings("P3", SLR_PAPERS[2]["card"])
    assert strings["P3.outcomes.0.comparison"] == "GLP-1RAs vs insulin"


# ---- (a) deterministic backstop -----------------------------------------------------------------
METFORMIN_Q = {"intervention_or_exposure": "Long-term metformin therapy",
               "key_terms": [{"term": "metformin", "synonyms": ["biguanide", "Glucophage"], "mesh": "Metformin"},
                             {"term": "colorectal cancer", "synonyms": ["CRC"], "mesh": "Colorectal Neoplasms"}]}
SGLT2_Q = {"intervention_or_exposure": "SGLT2 inhibitors",
           "key_terms": [{"term": "SGLT2 inhibitors", "synonyms": ["dapagliflozin", "empagliflozin"], "mesh": None}]}


def pc(intervention, comparison, matches=True):
    return PaperCard.model_validate(card([outcome("crc", "HR", 0.54, 0.46, 0.64, comparison=comparison,
                                                  matches=matches)], intervention=intervention))


def test_lexicon_takes_synonyms_only_from_the_intervention_key_term():
    lex = intervention_lexicon(METFORMIN_Q)
    assert {"metfo", "bigua", "gluco"} <= lex and "color" not in lex and "crc" not in lex
    assert {"sglt2", "dapag", "empag"} <= intervention_lexicon(SGLT2_Q)
    assert intervention_lexicon(None) == set() and intervention_lexicon({"intervention_or_exposure": ""}) == set()


def test_backstop_flags_another_drug_the_model_called_matching():
    flagged, n = settle_comparisons(pc("Prescription of GLP-1RAs", "GLP-1RAs vs insulin"), METFORMIN_Q)
    assert n == 1 and flagged.outcomes[0].matches_question is False


@pytest.mark.parametrize("intervention,comparison,question", [
    ("Metformin therapy", "metformin vs sulfonylureas", METFORMIN_Q),  # names the intervention
    ("Prescription of GLP-1RAs", "GLP-1RAs vs metformin", METFORMIN_Q),  # the comparison names it
    ("Dapagliflozin 10 mg", "dapagliflozin vs placebo", SGLT2_Q),  # a drug of the class, by key-term synonym
    ("Prescription of GLP-1RAs", None, METFORMIN_Q),  # no comparison text: the model's flag stands
    ("Prescription of GLP-1RAs", "GLP-1RAs vs insulin", None),  # no refined question: nothing to judge
])
def test_backstop_is_conservative(intervention, comparison, question):
    card_, n = settle_comparisons(pc(intervention, comparison), question)
    assert n == 0 and card_.outcomes[0].matches_question is True


def test_backstop_never_flips_to_matching_and_scoping_always_matches():
    card_, n = settle_comparisons(pc("Metformin therapy", "metformin vs placebo", matches=False), METFORMIN_Q)
    assert n == 0 and card_.outcomes[0].matches_question is False
    card_, n = settle_comparisons(pc("GLP-1RAs", "GLP-1RAs vs insulin", matches=False), METFORMIN_Q, "scoping")
    assert n == 0 and card_.outcomes[0].matches_question is True


# ---- (b) numbers --------------------------------------------------------------------------------
def test_numbers_must_trace_to_the_cited_cards():
    c = ctx(SLR_PAPERS, texts=["Does metformin reduce colorectal cancer in type 2 diabetes?"])
    text = ("Metformin was associated with a risk ratio of 0.63 [P2]. "  # P2's verified estimate
            "This is a 37% lower risk [P2]. "  # derived (1 - 0.63): not on the card
            "P4 reported 0.63 as well [P4]. "  # another paper's number
            "One review found a 25% lower incidence [P4]. "  # from P4's verified result text
            "Three of 4 reviews included patients with type 2 diabetes (95% CI reported) [P1, P2, P4]. "  # count
            "Overall 0.78 was the largest estimate.")  # uncited: checked against every card
    fixed, counts = fix_prose(text, c)
    assert fixed == ("Metformin was associated with a risk ratio of 0.63 [P2]. "
                     "One review found a 25% lower incidence [P4]. "
                     "Three of 4 reviews included patients with type 2 diabetes (95% CI reported) [P1, P2, P4]. "
                     "Overall 0.78 was the largest estimate.")
    assert counts == {"numbers_removed": 2}
    problems = prose_problems(text, c, "executive_summary")
    assert len(problems) == 2 and "states 37" in problems[0] and "(P2)" in problems[0]
    assert "states 0.63" in problems[1] and "(P4)" in problems[1]


def test_counts_are_not_percentages_and_context_numbers_are_allowed():
    c = ctx(SLR_PAPERS[:2], texts=["type 2 diabetes"], values=[216, "0.81"])
    assert fix_prose("Of 216 records, 2 reviews were analysed [P1, P2].", c)[1] == {}
    assert fix_prose("A pooled estimate of 0.81 was computed [P1, P2].", c)[1] == {}  # a pooled value
    four = ctx(SLR_PAPERS)
    assert fix_prose("Three of the 4 reviews agree [P1, P2].", four)[1] == {}  # a count of studies
    assert fix_prose("About 3% of patients stopped [P2].", four)[1] == {"numbers_removed": 1}  # 3% is no count
    assert fix_prose("It included 13 cancers [P3].", ctx(SLR_PAPERS))[1] == {}  # P3's title


def test_a_count_above_the_paper_count_is_not_a_count():
    c = ctx(SLR_PAPERS[:2])
    assert fix_prose("Seven cohorts with 3 sites [P1].", c)[1] == {"numbers_removed": 1}


def test_nothing_is_invented_when_every_sentence_fails():
    assert fix_prose("A 37% reduction [P2].", ctx(SLR_PAPERS)) == ("", {"numbers_removed": 1})


# ---- (b) measure names --------------------------------------------------------------------------
def test_audit_odds_ratios_for_rrs_is_corrected():
    fixed, counts = fix_prose(SLR_SUMMARY_1, ctx(SLR_PAPERS, texts=["type 2 diabetes"]))
    # 0.63 is P2's RR, 0.78 is P1's OR: the two estimates share no measure, so the neutral name is used
    assert "pooled effect estimates ranging from 0.63 to 0.78" in fixed and "odds" not in fixed
    assert counts == {"measures_fixed": 1}
    [problem] = prose_problems(SLR_SUMMARY_1, ctx(SLR_PAPERS, texts=["type 2 diabetes"]))
    assert 'calls the estimate "odds ratios"' in problem


@pytest.mark.parametrize("text,expected", [
    ("Two reviews reported odds ratios of 0.63 and 0.75 [P2, P4].",
     "Two reviews reported risk ratios of 0.63 and 0.75 [P2, P4]."),
    ("The OR was 0.63 [P2].", "The RR was 0.63 [P2]."),
    ("ORs of 0.63 and 0.75 [P2, P4].", "RRs of 0.63 and 0.75 [P2, P4]."),
    ("Hazard ratio data favoured metformin [P2].", "Risk ratio data favoured metformin [P2]."),  # no number: P2 = RR
    ("The OR was 0.78 and the RR 0.63 [P1, P2].", "The OR was 0.78 and the RR 0.63 [P1, P2]."),  # both right
])
def test_measure_names_follow_the_cards(text, expected):
    assert fix_prose(text, ctx(SLR_PAPERS))[0] == expected


@pytest.mark.parametrize("text", ["Time in the OR was shorter [P2].", "HR monitoring was routine [P2].",
                                  "Each MD reviewed the charts [P4]."])
def test_a_bare_abbreviation_without_an_estimate_is_not_a_measure(text):
    assert fix_prose(text, ctx(SLR_PAPERS)) == (text, {})


def test_a_measure_is_not_judged_when_the_cards_report_none():
    blanked = [paper("P7", card([outcome("CRC", "none", None, None, None)]))]
    assert fix_prose("The hazard ratio favoured metformin [P7].", ctx(blanked))[1] == {}


# ---- (b) populations ----------------------------------------------------------------------------
def test_audit_hfref_claim_from_an_hfpef_trial_is_removed():
    c = ctx(META_PAPERS)
    fixed, counts = fix_prose(META_SUMMARY_1 + " Empagliflozin lowered HF hospitalisation [P2].", c)
    assert fixed == "Empagliflozin lowered HF hospitalisation [P2]." and counts == {"population_removed": 1}
    [problem] = prose_problems(META_SUMMARY_1, c)
    assert "ascribes reduced ejection fraction to [P2]" in problem


@pytest.mark.parametrize("text", [
    "Dapagliflozin helped patients with reduced ejection fraction [P1].",  # P1 is HFrEF (title and EF <= 40%)
    "No association was seen in preserved or mildly reduced ejection fraction [P5].",  # P5 is HFmrEF/HFpEF
    "Benefit was seen in both reduced and preserved ejection fraction [P1, P2].",  # names both: a comparison
    "Benefit in reduced ejection fraction was large.",  # cites nothing: not judged
])
def test_population_claims_that_match_the_cards_stay(text):
    assert fix_prose(text, ctx(META_PAPERS))[1] == {}


def test_diabetes_type_and_age_groups_are_checked():
    t1 = [paper("P1", card([], population="adults with type 1 diabetes"), "Insulin pumps in type 1 diabetes")]
    review = ["Do insulin pumps help in type 1 or type 2 diabetes?"]  # the question's numbers are context
    assert fix_prose("It helped in type 2 diabetes [P1].", ctx(t1, review))[1] == {"population_removed": 1}
    assert fix_prose("It helped in type 1 diabetes [P1].", ctx(t1, review))[1] == {}
    kids = [paper("P1", card([], population="children aged 6-12 years"))]
    assert fix_prose("Adults benefited [P1].", ctx(kids))[1] == {"population_removed": 1}
    assert fix_prose("Children aged 6-12 years benefited [P1].", ctx(kids))[1] == {}


# ---- (b) conflict explanations ------------------------------------------------------------------
def conflict_payload():
    briefs = [{"ref": p["ref"], "title": p["candidate"]["title"], "year": 2020, "card": p["card"]}
              for p in SLR_PAPERS[:2]]
    return {"conflict": {"outcome": "CRC incidence", "refs": ["P1", "P2"],
                         "directions": {"positive": ["P1"], "null": ["P2"]}},
            "papers": briefs, "question": "Does metformin reduce CRC in type 2 diabetes?"}


async def test_conflict_explanation_is_repaired_then_fixed():
    bad = "[P1] reported an RR of 0.78 while [P2] found 0.55. Doses differed [P1, P2]."
    llm = FakeStructuredLLM("c", lambda s, u: ConflictNote(outcome="x", refs=["P1"], likely_reasons=["dose"],
                                                           explanation=bad))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    assert len(llm.calls) == 2 and "states 0.55" in llm.calls[1][1] and '"RR"' in llm.calls[1][1]
    note = out["conflict_notes"][0]
    assert note["explanation"] == "Doses differed [P1, P2]."  # the sentence with 0.55 is removed
    entry = out["quality"][0]
    assert entry["prose_numbers_removed"] == 1 and entry["fallback"] is False


async def test_conflict_explanation_emptied_by_the_check_falls_back_to_the_deterministic_note():
    llm = FakeStructuredLLM("c", lambda s, u: ConflictNote(outcome="x", refs=["P1"], likely_reasons=["dose"],
                                                           explanation="[P1] found a 22% lower risk."))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    assert out["conflict_notes"][0]["explanation"].startswith("Studies report different directions")
    assert out["quality"][0]["fallback"] is True


# ---- (b)+(c) narrative ----------------------------------------------------------------------------
def slr_state(**extra):
    papers = copy.deepcopy(SLR_PAPERS)
    matrix = {"rows": [], "consensus": [], "conflicts": [],
              "grade": {"level": "low", "factors": ["start low: 3/3 non-randomized studies"]}}
    return state(papers, matrix=matrix, conflict_notes=[], language="en", **extra)


def narrative(summary, rationale="Observational evidence [P1].", strength="low"):
    return SynthesisNarrative(executive_summary=summary, evidence_strength=strength, evidence_rationale=rationale,
                              research_gaps=["RCTs"])


async def test_narrative_repairs_then_fixes_numbers_measures_and_appends_certainty():
    answer = narrative(SLR_SUMMARY_1 + " This means a 37% reduction [P2].",
                       rationale="The rating is low because of 5 cohorts with a 12% loss [P1].")
    synth = FakeStructuredLLM("s", lambda s, u: answer)
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state())
    assert len(synth.calls) == 2  # one repair with the prose problems
    repair = synth.calls[1][1]
    assert 'calls the estimate "odds ratios"' in repair and "states 37" in repair and "evidence_rationale" in repair
    s = out["synthesis"]
    assert "pooled effect estimates ranging from 0.63 to 0.78" in s["executive_summary"]
    assert "37%" not in s["executive_summary"]
    assert s["executive_summary"].endswith(CERTAINTY_SENTENCE["low"])  # "may" was missing
    assert s["evidence_rationale"] == "start low: 3/3 non-randomized studies"  # emptied → GRADE-lite factors
    q = next(e for e in out["quality"] if e["stage"] == "prose_check")
    assert q == {"stage": "prose_check", "numbers_removed": 2, "measures_fixed": 1, "population_removed": 0,
                 "certainty_added": 1}


@pytest.mark.parametrize("strength,summary,added", [
    ("low", "Metformin may reduce CRC incidence [P1, P2].", 0),
    ("moderate", "Metformin probably reduces CRC incidence [P1, P2].", 0),
    ("very_low", "The evidence is very uncertain about metformin and CRC [P1, P2].", 0),
    ("very_low", "Metformin may reduce CRC incidence [P1, P2].", 1),  # "may" is not very-low wording
    ("high", "Metformin reduces CRC incidence [P1, P2].", 0),  # high needs no hedge
])
async def test_certainty_wording_matches_the_grade(strength, summary, added):
    st = slr_state()
    st["matrix"]["grade"]["level"] = strength
    synth = FakeStructuredLLM("s", lambda s, u: narrative(summary, strength=strength))
    out = await make_write_synthesis(deps(synthesizer=synth))(st)
    s = out["synthesis"]
    assert s["evidence_strength"] == strength
    expected = summary + (" " + CERTAINTY_SENTENCE[strength] if added else "")
    assert s["executive_summary"] == expected
    assert next(e for e in out["quality"] if e["stage"] == "prose_check")["certainty_added"] == added


async def test_summary_emptied_by_the_check_is_withheld_not_invented():
    synth = FakeStructuredLLM("s", lambda s, u: narrative("A 37% reduction [P2]."))
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state())
    assert out["synthesis"]["executive_summary"] == PROSE_REMOVED


async def test_ungraded_reviews_are_checked_but_get_no_certainty_sentence():
    synth = FakeStructuredLLM("s", lambda s, u: NarrativeNoGrade(
        executive_summary="Reviews report odds ratios of 0.63 [P2]. Cohorts differ [P1, P3].", research_gaps=[]))
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state(options={"review_type": "narrative"}))
    assert out["synthesis"]["executive_summary"] == "Reviews report risk ratios of 0.63 [P2]. Cohorts differ [P1, P3]."
    assert next(e for e in out["quality"] if e["stage"] == "prose_check")["certainty_added"] == 0


def test_quality_summarizes_prose_check_and_other_comparisons():
    entries = [{"stage": "read", "numbers_verified": 1, "numbers_total": 1, "other_comparisons": 2,
                "comparison_backstop": 1},
               {"stage": "read", "numbers_verified": 1, "numbers_total": 1},
               {"stage": "conflict", "prose_numbers_removed": 1, "prose_measures_fixed": 2},
               {"stage": "prose_check", "numbers_removed": 9},
               {"stage": "prose_check", "numbers_removed": 1, "measures_fixed": 1, "population_removed": 1,
                "certainty_added": 1}]
    q = summarize_quality(entries, None)
    assert q["other_comparisons"] == 2 and q["comparison_backstop"] == 1
    assert q["prose_check"] == {"numbers_removed": 1, "measures_fixed": 1, "population_removed": 1,
                                "certainty_added": 1, "conflict_sentences_removed": 1, "conflict_measures_fixed": 2}
    assert "prose_check" not in summarize_quality([], None)


# ---- graph: comparison-aware evidence and grounded prose end to end ---------------------------------
ABSTRACT = ("Methods: We enrolled 1,234 adults with type 2 diabetes in a population-based cohort. Results: Metformin use "
            "was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003). Compared "
            "with insulin, sulfonylurea use was associated with a higher risk of colorectal cancer (HR 1.30, 95% CI "
            "1.10-1.50).")


def two_outcome_card(system, user):
    return PaperCard(
        study_design="cohort", population="adults with type 2 diabetes", sample_size=1234,
        sample_size_quote="We enrolled 1,234 adults with type 2 diabetes", intervention_or_exposure="metformin",
        comparator="no metformin",
        outcomes=[
            OutcomeResult(outcome="colorectal cancer incidence", result="lower risk",
                          evidence_quote="lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003)",
                          effect_size="HR 0.80 (0.71-0.90)", effect_measure="HR", effect_value=0.8, ci_lower=0.71,
                          ci_upper=0.9, p_value=0.003, direction="positive", comparison="metformin vs no metformin",
                          matches_question=True),
            OutcomeResult(outcome="colorectal cancer with sulfonylurea", result="higher risk with sulfonylurea",
                          evidence_quote="sulfonylurea use was associated with a higher risk of colorectal cancer "
                                         "(HR 1.30, 95% CI 1.10-1.50)",
                          effect_size="HR 1.30 (1.10-1.50)", effect_measure="HR", effect_value=1.3, ci_lower=1.1,
                          ci_upper=1.5, p_value=None, direction="negative", comparison="sulfonylurea vs insulin",
                          matches_question=False)],
        key_findings=[], limitations=[], funding_or_conflicts=None, design_category="cohort",
        risk_of_bias="moderate", overall_direction="positive")


async def test_graph_keeps_other_comparisons_out_of_the_evidence_and_grounds_the_prose():
    results = [Candidate(title=f"Paper {i} about metformin and colorectal cancer", doi=f"10.1/{i}",
                         abstract=f"Paper {i}. {ABSTRACT}", engines=["pubmed"]) for i in range(4)]
    deps_ = make_deps(results=results, extractor=FakeStructuredLLM("ext", two_outcome_card))
    deps_.llms.synthesizer = FakeStructuredLLM("syn", lambda s, u: SynthesisNarrative(
        executive_summary=("Metformin is associated with a lower CRC risk, with odds ratios of 0.80 [P1, P2]. "
                           "Sulfonylureas showed HR 1.30 versus insulin, another comparison [P1]. "
                           "Risk fell by 20% [P1]."),
        evidence_strength="low", evidence_rationale="Observational cohorts [P1].", research_gaps=["RCTs"]))
    graph = build_graph(deps_, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "cmp"}}
    async for _ in graph.astream(initial_state("cmp", "metformin and CRC", "en", {"max_papers": 4,
                                                                                    "candidate_limit": 10}),
                                 config, stream_mode=["updates"], durability="sync"):
        pass
    r = (await graph.aget_state(config)).values["result"]
    # the sulfonylurea-vs-insulin estimates are verified and kept on every card, flagged
    other = r["papers"][0]["card_en"]["outcomes"][1]
    assert other["matches_question"] is False and other["comparison"] == "sulfonylurea vs insulin"
    assert other["effect_value"] == 1.3
    # ... but they make no row cell, no conflict and no grade input (else 4 negative vs 4 positive would conflict)
    cells = [c for row in r["synthesis"]["comparison"] for c in row["cells"]]
    assert len(cells) == 4 and all(c["effect_value"] == 0.8 for c in cells)
    assert r["synthesis"]["conflicts"] == [] and deps_.llms.conflict_explainer.calls == []
    assert r["quality"]["other_comparisons"] == 4 and r["quality"]["comparison_backstop"] == 0
    # the prose: the measure is corrected, the derived 20% sentence removed, the certainty sentence appended
    summary = r["synthesis"]["executive_summary"]
    assert "hazard ratios of 0.80" in summary and "HR 1.30" in summary and "20%" not in summary
    assert summary.endswith(CERTAINTY_SENTENCE["low"])
    assert r["quality"]["prose_check"] == {"numbers_removed": 1, "measures_fixed": 1, "population_removed": 0,
                                           "certainty_added": 1, "conflict_sentences_removed": 0,
                                           "conflict_measures_fixed": 0}
    assert len(deps_.llms.synthesizer.calls) == 2  # the narrative got one repair round with the problems
    assert "Other comparisons" in deps_.llms.synthesizer.calls[0][0]
    # the extractor was asked for the comparison
    assert "matches_question" in deps_.llms.extractor.calls[0][0]
    assert json.loads(json.dumps(r))  # the result stays JSON-serializable
    assert QUESTION.intervention_or_exposure == "metformin"  # the backstop had a lexicon and left these alone
    assert re.search(r"\bmay\b", summary)
