"""Plan 20 Task 10, items 3-5 (and the no-pool summary of item 1): reports of the same trial, GRADE with one study
per outcome, and splits between systematic reviews and primary studies. The cards follow the re-run results in
.superpowers/audit/rerun (SGLT2i/HF meta-analysis 525618cb, metformin/CRC SLR aa628aed)."""
from __future__ import annotations

from app.graph.nodes.synthesis import (
    NO_POOL_ANSWER,
    _consensus_statement,
    _deterministic_explanation_th,
    _render_th,
    _templated,
    make_finalize,
    make_normalize_outcomes,
    make_pool_effects,
    make_write_synthesis,
    route_conflicts,
)
from app.graph.schemas import Candidate, SynthesisNarrative
from app.harness.grade import grade_baseline, rationale_problems, reconcile_rationale
from app.harness.matrix import build_matrix, classify_row, fallback_clusters
from app.harness.trials import registry_ids, related_reports, trial_acronyms
from tests.fakes import FakeStructuredLLM
from tests.unit.test_design_grade_conflicts import out
from tests.unit.test_nodes_synthesis import deps, state


def report(ref, title, abstract, category="rct", outcomes=None, n=None, authors=("Anker SD",), year=2021,
           pub_types=("Randomized Controlled Trial",)):
    cand = Candidate(title=title, abstract=abstract, doi=f"10.1/{ref}", year=year, authors=list(authors),
                     pub_types=list(pub_types)).model_dump()
    card = {"study_design": category, "design_category": category, "population": "adults with heart failure",
            "sample_size": n, "sample_size_quote": None, "intervention_or_exposure": "empagliflozin",
            "comparator": "placebo", "outcomes": outcomes or [out("HF hospitalization", "positive", "HR", 0.73, 0.61,
                                                                  0.88)],
            "key_findings": [], "limitations": [], "funding_or_conflicts": None, "risk_of_bias": "low",
            "overall_direction": "positive"}
    return {"ref": ref, "candidate": cand, "relevance": 90, "screen_reason": "ok", "card": card, "error": None,
            "verification": {"numbers_verified": 3, "numbers_total": 3, "agreement": 1.0, "escalated": False,
                             "repaired": False, "uncertain": False}}


PRIMARY = report("P1", "Empagliflozin in Heart Failure with a Preserved Ejection Fraction",
                 "In this double-blind trial, we randomly assigned 5988 patients ... (Funded by Boehringer Ingelheim "
                 "and Eli Lilly; EMPEROR-Preserved ClinicalTrials.gov number, NCT03057951.)", n=5988)
COMMENTARY = report("P2", "EMPEROR-Preserved: SGLT2 inhibitors breakthrough in the management of heart failure with "
                          "preserved ejection fraction", "Empagliflozin reduced the risk by 29% in the trial.",
                    outcomes=[out("HF hospitalization", "positive", "other")], authors=("Hussain A",),
                    pub_types=("discussion",))
SUBGROUP = report("P7", "Efficacy of empagliflozin in heart failure with preserved ejection fraction according to "
                        "frailty status", "In the EMPEROR-Preserved trial, frail patients ...",
                  outcomes=[out("HF hospitalization", "positive", "HR")], n=5988, year=2024)
DAPA_HF = report("P3", "Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction",
                 "In this phase 3, placebo-controlled trial ... (Funded by AstraZeneca; DAPA-HF ClinicalTrials.gov "
                 "number, NCT03036124.)", n=4744, outcomes=[out("Worsening HF or CV death", "positive", "HR", 0.74,
                                                               0.65, 0.85)], authors=("McMurray JJV",), year=2019)
DELIVER = report("P4", "Dapagliflozin in Heart Failure with Mildly Reduced or Preserved Ejection Fraction",
                 "Unlike the DAPA-HF trial and the EMPEROR-Preserved trial, the DELIVER trial enrolled ...", n=6263,
                 outcomes=[out("Worsening HF or CV death", "positive", "HR", 0.82, 0.73, 0.92)],
                 authors=("Solomon SD",), year=2022)


# ---- item 3: reports of the same trial -------------------------------------------------------------------------
def test_trial_names_and_registry_numbers_are_read_from_title_and_abstract():
    assert trial_acronyms(COMMENTARY["candidate"]["title"], COMMENTARY["candidate"]["abstract"]) == [
        "EMPEROR-Preserved"]
    assert trial_acronyms(PRIMARY["candidate"]["title"], PRIMARY["candidate"]["abstract"]) == ["EMPEROR-Preserved"]
    assert registry_ids("", PRIMARY["candidate"]["abstract"]) == ["NCT03057951"]
    assert trial_acronyms("COVID-19 study of NHANES data", "The GLP-1 study and the HFpEF trials.") == []


def test_commentary_and_subgroup_are_related_reports_of_the_primary_trial():
    links = related_reports([PRIMARY, COMMENTARY, DAPA_HF, DELIVER, SUBGROUP])
    assert links == {"P2": {"primary": "P1", "reason": "same trial (EMPEROR-Preserved)"},
                     "P7": {"primary": "P1", "reason": "same trial (EMPEROR-Preserved)"}}
    # DELIVER names two other trials: a paper naming several trials never links them together
    assert "P4" not in links and "P3" not in links


def test_the_primary_report_is_chosen_whatever_the_ref_order():
    first = report("P1", "EMPEROR-Preserved: a commentary", "On the EMPEROR-Preserved trial.", category="narrative_review",
                   pub_types=("comment",))
    primary = {**PRIMARY, "ref": "P5"}
    assert related_reports([first, primary]) == {"P1": {"primary": "P5", "reason": "same trial (EMPEROR-Preserved)"}}


def test_near_identical_titles_with_the_same_first_author_and_sample_are_one_report():
    a = report("P1", "Metformin and colorectal cancer in diabetes: a cohort study", "A", category="cohort",
               authors=("Lee JH",), year=2020, n=12000)
    b = report("P2", "Metformin and colorectal cancer in diabetes - a cohort study.", "B", category="cohort",
               authors=("Lee J",), year=2021, n=12000)
    other_author = report("P3", "Metformin and colorectal cancer in diabetes: a cohort study", "C", category="cohort",
                          authors=("Kim S",), year=2020, n=12000)
    links = related_reports([a, b, other_author])
    assert set(links) == {"P2"}
    assert links["P2"]["reason"] == "near-identical title, same first author, same sample size"
    # a different (or unreported) sample size: two studies
    assert related_reports([a, {**b, "card": {**b["card"], "sample_size": 9000}}]) == {}
    assert related_reports([a, {**b, "card": {**b["card"], "sample_size": None}}]) == {}


def test_companion_papers_of_two_populations_never_merge():  # Task 10 review finding 3
    men = report("P1", "Metformin use and colorectal cancer risk in men with type 2 diabetes: a cohort study", "A",
                 category="cohort", authors=("Lee JH",), year=2020, n=5000)
    women = report("P2", "Metformin use and colorectal cancer risk in women with type 2 diabetes: a cohort study",
                   "B", category="cohort", authors=("Lee JH",), year=2020, n=5000)
    korea = report("P3", "Metformin use and colorectal cancer risk in Korea: a cohort study", "C", category="cohort",
                   authors=("Lee JH",), year=2020, n=5000)
    japan = report("P4", "Metformin use and colorectal cancer risk in Japan: a cohort study", "D", category="cohort",
                   authors=("Lee JH",), year=2021, n=5000)
    assert related_reports([men, women, korea, japan]) == {}


def test_systematic_reviews_are_never_grouped():
    sr = report("P9", "SGLT2 inhibitors in HFpEF: a meta-analysis", "Including the EMPEROR-Preserved trial ...",
                category="sr_ma_rct")
    assert related_reports([PRIMARY, sr]) == {}


async def test_related_reports_leave_the_evidence_and_are_linked_in_the_result():
    papers = [PRIMARY, COMMENTARY, DAPA_HF, DELIVER, SUBGROUP]
    st = state(papers, language="en", options={"review_type": "meta_analysis", "study_types": ["RCT"]},
               question={"refined_question": "Do SGLT2 inhibitors reduce HF hospitalization?",
                         "outcomes": ["HF hospitalization"]})
    norm = await make_normalize_outcomes(deps())(st)
    m = norm["matrix"]
    rows = {r["outcome"]: [c["ref"] for c in r["cells"]] for r in m["rows"]}
    assert rows["HF hospitalization"] == ["P1"]  # was P1, P2 and P7: one trial counted three times
    # no "3 studies report the same direction" for one trial
    assert [c["outcome"] for c in m["consensus"]] == ["Worsening HF or CV death"]
    assert any(f.startswith("inconsistency not assessable: one study") for f in m["grade"]["factors"])
    assert m["grade"]["level"] == "moderate" and m["grade"]["k"] == 1
    st["matrix"] = m
    final = (await make_finalize(deps())({**st, "synthesis": None}))["result"]
    by_ref = {p["ref"]: p for p in final["papers"]}
    assert by_ref["P1"]["related_reports"] == ["P2", "P7"] and by_ref["P1"]["related_to"] is None
    assert by_ref["P2"]["related_to"] == "P1" and by_ref["P2"]["related_reason"] == "same trial (EMPEROR-Preserved)"
    assert final["stats"]["related_reports"] == 2


def test_markdown_labels_a_related_report():
    from types import SimpleNamespace

    from app.graph.nodes.stub_result import stub_result
    from app.services.report import render_markdown
    r = stub_result("t", "en", "slr")
    r["papers"][1] |= {"related_to": "P1", "related_reason": "same trial (EMPEROR-Preserved)"}
    md = render_markdown(SimpleNamespace(topic="t", status="done", error=None, result=r))
    line = next(x for x in md.splitlines() if x.startswith("- [P2]"))
    assert line.endswith("Related report of [P1] (same trial (EMPEROR-Preserved)), not counted again.")
    assert "Related report" not in next(x for x in md.splitlines() if x.startswith("- [P1]"))


async def test_scoping_keeps_every_report():
    st = state([PRIMARY, COMMENTARY], language="en", options={"review_type": "scoping"})
    final = (await make_finalize(deps())({**st, "synthesis": None}))["result"]
    assert final["stats"]["related_reports"] == 0


# ---- item 4: GRADE with one study per outcome --------------------------------------------------------------------
SGLT2_RATIONALE = ("The evidence is based on three randomized controlled trials with low risk of bias that consistently "
                   "demonstrate a reduction in heart failure hospitalization or related worsening events. The results "
                   "are precise with narrow confidence intervals and show consistent directionality across different "
                   "SGLT2 inhibitors and patient subgroups.")  # verbatim from the re-run


def test_one_trial_per_outcome_is_not_high_and_the_rationale_cannot_claim_three_trials():
    papers = [PRIMARY, DAPA_HF, DELIVER]
    g = grade_baseline(papers, build_matrix(papers, fallback_clusters(papers)), ["HF hospitalization"])
    assert g["level"] == "moderate" and g["k"] == 1 and g["studies"] == 3
    assert ("imprecision: one study for the primary outcome HF hospitalization (k = 1): its estimate is not "
            "replicated by another study, so the certainty is capped at moderate") in g["factors"]
    problems = rationale_problems(SGLT2_RATIONALE, g["factors"], g["k"], g["studies"])
    assert any("consistency across studies" in p for p in problems)
    # "three" is the number of graded trials here, so the count passes; with only the one trial it does not
    assert any("counts 3 studies" in p for p in rationale_problems(SGLT2_RATIONALE, g["factors"], 1, 1))
    text, how = reconcile_rationale(SGLT2_RATIONALE, g["factors"], g["k"], g["studies"])
    assert "consistent" not in text and how in ("replaced", "appended")


def test_rationale_counts_and_consistency_rules():
    factors = ["start high: randomized evidence", "inconsistency not assessable: one study for X", "x"]
    assert rationale_problems("One large trial at low risk of bias [P1].", factors, 1, 4) == []
    assert rationale_problems("Results are consistent with the systematic review [P2].", factors, 1, 4) == []
    assert rationale_problems("Four trials were graded; 5,988 patients in one trial.", factors, 1, 4) == []
    assert rationale_problems("A phase 3 trial.", factors, 1, 4) == []
    assert rationale_problems("Two trials agree.", factors, 1, 4)
    assert rationale_problems("Effects were consistent across trials.", factors, 1, 4)
    text, how = reconcile_rationale("One trial at low risk of bias. Effects were consistent across trials.",
                                    factors, 1, 4)
    assert (text, how) == ("One trial at low risk of bias.", "trimmed")


def test_two_trials_on_the_primary_outcome_keep_high():
    emperor_r = report("P5", "Cardiovascular and Renal Outcomes with Empagliflozin in Heart Failure",
                       "(EMPEROR-Reduced ClinicalTrials.gov number, NCT03057977.)", n=3730,
                       outcomes=[out("HF hospitalization", "positive", "HR", 0.70, 0.58, 0.85)])
    papers = [PRIMARY, emperor_r]
    g = grade_baseline(papers, build_matrix(papers, fallback_clusters(papers)), ["HF hospitalization"])
    assert g["level"] == "high" and g["k"] == 2


async def test_write_synthesis_trims_an_overclaiming_rationale():
    papers = [PRIMARY, DAPA_HF]
    narrative = SynthesisNarrative(executive_summary="Empagliflozin probably reduces HF hospitalization [P1].",
                                   evidence_strength="moderate", evidence_rationale=(
                                       "One randomized trial at low risk of bias [P1]. The effects were consistent "
                                       "across trials."), research_gaps=[])
    synth = FakeStructuredLLM("s", lambda s, u: narrative)
    st = state(papers, language="en", conflict_notes=[], question={"refined_question": "q?",
                                                                   "outcomes": ["HF hospitalization"]})
    st["matrix"] = (await make_normalize_outcomes(deps())(st))["matrix"]
    res = await make_write_synthesis(deps(synthesizer=synth))(st)
    rationale = res["synthesis"]["evidence_rationale"]
    assert "consistent across trials" not in rationale and rationale.startswith("One randomized trial")
    assert next(q for q in res["quality"] if q["stage"] == "prose_check")["rationale_fixed"] in ("trimmed",
                                                                                                "appended")


# ---- item 5: splits between systematic reviews and primary studies ---------------------------------------------
def cell(ref, direction, value=None, lo=None, hi=None, pooled=False, measure="HR"):
    return {"ref": ref, "direction": direction, "effect_measure": measure, "effect_value": value, "ci_lower": lo,
            "ci_upper": hi, "pooled": pooled}


METFORMIN_ROW = [cell("P1", "positive", 0.89, 0.81, 0.99, True, "OR"), cell("P2", "positive", 0.75, 0.66, 0.86, True,
                                                                           "RR"),
                 cell("P3", "positive", 0.64, 0.54, 0.76, True, "RR"), cell("P4", "positive", 0.63, 0.47, 0.84, True,
                                                                           "RR"),
                 cell("P6", "positive", 0.78, 0.70, 0.87, True, "OR"), cell("P7", "null", 1.05, 0.85, 1.30),
                 cell("P12", "null", None, measure="none")]  # verbatim from the re-run (aa628aed)


def test_metformin_null_cohorts_against_significant_reviews_is_a_review_discordant_conflict():
    v = classify_row(METFORMIN_ROW)
    assert v["verdict"] == "conflict" and v["review_discordant"] is True
    assert v["directions"] == {"null": ["P7", "P12"], "positive": ["P1", "P2", "P3", "P4", "P6"]}
    assert v["refs"] == ["P1", "P2", "P3", "P4", "P6", "P7", "P12"]


def test_without_a_real_split_the_consensus_stands_flagged():
    v = classify_row([cell("P1", "positive", 0.8, pooled=True), cell("P2", "null", 0.9), cell("P3", "null", 1.1)])
    assert v["verdict"] == "consensus" and v["review_discordant"] is True and v["discordant_reviews"] == ["P1"]
    c = {"outcome": "CVD", **v}
    assert _consensus_statement(c).endswith("; systematic reviews disagree")
    assert _consensus_statement(c, "CVD", "th").endswith("แต่การทบทวนวรรณกรรมอย่างเป็นระบบให้ผลต่างออกไป")


def test_a_directional_consensus_against_a_significant_review_is_a_conflict():
    v = classify_row([cell("P1", "negative", 1.3, pooled=True), cell("P2", "positive", 0.8),
                      cell("P3", "positive", 0.7)])
    assert v["verdict"] == "conflict" and v["review_discordant"] is True
    assert v["directions"] == {"positive": ["P2", "P3"], "negative": ["P1"]}


def test_review_discordant_conflicts_are_explained_and_never_downgrade():
    from tests.unit.test_design_grade_conflicts import ev
    papers = [ev("P1", "sr_ma_observational", [out("CRC", "positive", "RR", 0.64, 0.54, 0.76)], n=90000),
              ev("P7", "cohort", [out("CRC", "null", "HR", 1.05, 0.85, 1.30)], n=50000),
              ev("P12", "cohort", [out("CRC", "null")], n=40000)]
    m = build_matrix(papers, fallback_clusters(papers))
    [c] = m["conflicts"]
    assert c["review_discordant"] and m["consensus"] == []
    g = grade_baseline(papers, m, ["CRC"])
    assert g["level"] == "low"  # no inconsistency downgrade for a review-vs-primary split
    assert any(f.startswith("minor inconsistency: systematic reviews and primary studies point different ways")
               for f in g["factors"])
    sends = route_conflicts({"matrix": m, "papers": papers, "options": {"review_type": "slr"},
                             "question": {"refined_question": "q"}, "topic": "t"})
    assert [s.arg["conflict"]["outcome"] for s in sends] == ["CRC"]  # the explainer runs for it
    statement = "CRC: systematic reviews and primary studies disagree"
    synthesis = {"conflicts": [{"statement": statement, "refs": c["refs"],
                                "explanation": "x", "likely_reasons": []}]}
    templated = _templated(synthesis, m)
    assert templated["conflicts.0.statement"][0] == "conflict_statement"
    th = _render_th(templated, {"CRC": "มะเร็ง"})
    assert th["conflicts.0.statement"] == "มะเร็ง: ผลของการทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิไม่สอดคล้องกัน"
    assert _deterministic_explanation_th(c, "CRC").startswith("การทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิ")


# ---- item 1: a meta-analysis without pools says so in the summary ----------------------------------------------
async def test_no_pool_meta_summary_states_that_pooling_was_not_possible():
    papers = [PRIMARY, DAPA_HF]
    narrative = SynthesisNarrative(executive_summary="Empagliflozin probably reduces HF hospitalization [P1].",
                                   evidence_strength="moderate", evidence_rationale="One trial [P1].",
                                   research_gaps=[])
    st = state(papers, language="en", conflict_notes=[], options={"review_type": "meta_analysis"},
               question={"refined_question": "q?", "outcomes": ["HF hospitalization"]})
    st["matrix"] = (await make_normalize_outcomes(deps())(st))["matrix"]
    st |= await make_pool_effects(deps())(st)
    assert st["meta_analysis"]["pools"] == []
    res = await make_write_synthesis(deps(synthesizer=FakeStructuredLLM("s", lambda s, u: narrative)))(st)
    assert res["synthesis"]["executive_summary"].startswith(NO_POOL_ANSWER)
    assert res["synthesis"]["answer"].startswith(NO_POOL_ANSWER)
