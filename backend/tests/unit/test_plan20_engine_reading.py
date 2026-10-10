"""Plan 20 Task 10, items 6-8: themes compare nothing and stay on focus, scoping cards carry no direction, design
labels of the mammography re-run (33d01df9), and the top-level verification_rate."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.db.repositories import ReviewRepository
from app.graph import prompts
from app.graph.nodes.reading import make_read_paper
from app.graph.nodes.screening import make_select_top, names_focus
from app.graph.schemas import Candidate, OutcomeResult, PaperCard
from app.harness.comparison import intervention_lexicon
from app.harness.design import check_design_consistency, strip_directions, strip_non_quantitative
from app.schemas.review import ReviewOut, verification_rate_of
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_reading import deps as reading_deps
from tests.unit.test_nodes_screening import deps as screening_deps


def theme(comparison, matches=True, direction="unclear", measure="none"):
    return OutcomeResult(outcome="Stigma", result="Insulin was linked to failure.", evidence_quote="q",
                         effect_size=None, effect_measure=measure, effect_value=None, ci_lower=None, ci_upper=None,
                         p_value=None, direction=direction, comparison=comparison, matches_question=matches)


def qcard(category="qualitative", outcomes=None, design="qualitative interview study"):
    return PaperCard(study_design=design, design_category=category, population="adults with T2D", sample_size=None,
                     sample_size_quote=None, intervention_or_exposure="insulin initiation", comparator=None,
                     outcomes=outcomes or [theme("patients with stigma vs patients without stigma (implied within "
                                                 "cohort)", matches=False, direction="positive")],
                     key_findings=[], limitations=[], funding_or_conflicts=None, risk_of_bias="unclear",
                     overall_direction="positive")


# ---- item 6: themes compare nothing ------------------------------------------------------------------------------
def test_qualitative_and_mixed_cards_never_carry_a_comparison():
    for category in ("qualitative", "mixed_methods"):
        stripped = strip_non_quantitative(qcard(category))
        o = stripped.outcomes[0]
        assert o.comparison is None and o.matches_question is True and o.direction == "unclear"
        assert stripped.overall_direction == "unclear"
    rct = qcard("rct", outcomes=[theme("insulin vs oral agents", measure="HR")])
    assert strip_non_quantitative(rct) is rct


async def test_read_paper_strips_an_invented_theme_comparison_and_counts_no_other_comparison():
    abstract = ("We interviewed 20 adults with type 2 diabetes about starting insulin. Themes: stigma, fear of "
                "injections and trust in clinicians. Insulin was linked to failure by several participants.")
    extractor = FakeStructuredLLM("e", lambda s, u: qcard())
    payload = {"paper": {"ref": "P1", "relevance": 90, "reason": "r", "uncertain": False,
                         "candidate": Candidate(title="Starting insulin: a qualitative study", doi="10.1/q",
                                                abstract=abstract).model_dump()},
               "plan": {}, "question": "Experiences of insulin initiation?", "language": "en",
               "review_type": "narrative", "qualitative": True}
    out = await make_read_paper(reading_deps(extractor))(payload)
    o = out["papers"][0]["card"]["outcomes"][0]
    assert o["comparison"] is None and o["matches_question"] is True
    assert out["quality"][0]["other_comparisons"] == 0


def test_qualitative_prompt_blocks_carry_the_focus_and_no_comparison_rules():
    assert "Focus:" in prompts.screen_system("narrative", qualitative=True)
    assert "Focus:" not in prompts.screen_system("slr")  # SLR prompts unchanged (pinned)
    assert "comparison null" in prompts.extract_system("narrative", qualitative=True)


QUESTION = {"intervention_or_exposure": "Initiation of insulin therapy",
            "key_terms": [{"term": "insulin initiation", "mesh": "Insulin", "synonyms": ["starting insulin"]}]}


def test_focus_lexicon_matches_insulin_but_not_other_care():
    lexicon = intervention_lexicon(QUESTION)
    assert names_focus({"title": "Barriers to starting insulin", "abstract": ""}, lexicon)
    assert not names_focus({"title": "Experiences of real-time continuous glucose monitoring",
                            "abstract": "Adults with type 2 diabetes described rtCGM use."}, lexicon)


def _cand(i, title):
    return Candidate(title=title, doi=f"10.1/{i}", abstract="Adults with type 2 diabetes were interviewed.").model_dump()


async def test_themes_review_drops_papers_that_never_name_the_focus():
    candidates = [_cand(0, "Paper 0 on insulin initiation experiences"), _cand(1, "Paper 1 on starting insulin"),
                  _cand(2, "Paper 2 on fear of insulin injections"), _cand(3, "Paper 3 on diet and exercise adherence"),
                  _cand(4, "Paper 4 on continuous glucose monitoring")]
    screened = [{"key": c["key"], "relevance": 85, "include": True, "reason": "r", "uncertain": False}
                for c in candidates]
    select = make_select_top(screening_deps(FakeStructuredLLM("s", lambda s, u: None)))
    themes = await select({"candidates": candidates, "screened": screened, "question": QUESTION,
                           "options": {"review_type": "narrative", "study_types": ["Qualitative", "Mixed methods"]}})
    assert [s["candidate"]["title"][:7] for s in themes["selected"]] == ["Paper 0", "Paper 1", "Paper 2"]
    assert themes["selection_stats"]["off_focus"] == 2
    # recall elsewhere is untouched: no ticked themes types, no focus filter
    other = await select({"candidates": candidates, "screened": screened, "question": QUESTION,
                          "options": {"review_type": "narrative"}})
    assert len(other["selected"]) == 5 and "off_focus" not in other["selection_stats"]
    # never fewer than 3 papers
    few = await select({"candidates": candidates[2:], "screened": screened[2:], "question": QUESTION,
                        "options": {"review_type": "narrative", "study_types": ["Qualitative"]}})
    assert len(few["selected"]) == 3


# ---- item 7: scoping cards carry no direction, and the mammography design labels ---------------------------------
def test_scoping_cards_lose_every_direction():
    card = qcard("cohort", outcomes=[theme(None, direction="positive", measure="other")])
    stripped = strip_directions(card)
    assert stripped.overall_direction == "unclear" and stripped.outcomes[0].direction == "unclear"
    assert strip_directions(stripped) is stripped


async def test_read_paper_in_a_scoping_review_reports_no_direction():
    from tests.unit.test_nodes_reading import card, payload
    out = await make_read_paper(reading_deps(FakeStructuredLLM("e", lambda s, u: card())))(
        {**payload(), "review_type": "scoping"})
    c = out["papers"][0]["card"]
    assert c["overall_direction"] == "unclear" and {o["direction"] for o in c["outcomes"]} == {"unclear"}
    assert c["outcomes"][0]["effect_value"] == 0.8  # the verified numbers stay


def pcard(design, category, quote=None):
    return PaperCard(study_design=design, design_category=category, population="women screened", sample_size=None,
                     sample_size_quote=quote, intervention_or_exposure="AI", comparator=None,
                     outcomes=[theme(None, measure="other")], key_findings=[], limitations=[],
                     funding_or_conflicts=None, risk_of_bias="moderate", overall_direction="positive")


MAMMO_P1 = ("Standalone AI for Breast Cancer Detection at Screening Digital Mammography and Digital Breast "
            "Tomosynthesis: A Systematic Review and Meta-Analysis")
MAMMO_P1_ABSTRACT = ("Sixteen retrospective studies were included. Pooled sensitivity and specificity of standalone AI "
                     "were compared with radiologists. Prospective randomized trials are needed.")
MAMMO_P2 = ("Artificial intelligence-supported double reading in European population breast cancer screening: A "
            "systematic review and meta-analysis of prospective programs")
MAMMO_P8 = ("Artificial intelligence for breast cancer detection in screening mammography in Sweden: a prospective, "
            "population-based, paired-reader, non-inferiority study")


def test_reviews_of_diagnostic_accuracy_studies_are_not_reviews_of_rcts():
    card, fix = check_design_consistency(pcard("Systematic review and meta-analysis", "sr_ma_rct",
                                               "16 studies that include 1 108 328 examinations"), [], MAMMO_P1,
                                         MAMMO_P1_ABSTRACT)
    assert card.design_category == "sr_ma_observational" and fix["from"] == "sr_ma_rct"
    # the programmes review: one randomised trial among prospective programmes is a mixed review
    card, _ = check_design_consistency(pcard("Systematic review and meta-analysis of prospective programs",
                                             "sr_ma_rct"), [], MAMMO_P2,
                                       "Four prospective programs and one randomised controlled trial were pooled.")
    assert card.design_category == "sr_ma_mixed"
    # without any trial wording: observational
    card, _ = check_design_consistency(pcard("Systematic review and meta-analysis of prospective programs",
                                             "sr_ma_rct"), [], MAMMO_P2, "Five programmes were pooled.")
    assert card.design_category == "sr_ma_observational"


def test_a_real_review_of_rcts_keeps_its_label():
    sr = pcard("Systematic review and meta-analysis of randomized controlled trials", "sr_ma_rct")
    assert check_design_consistency(sr, [], "SGLT2 inhibitors in HF: a meta-analysis", "") == (sr, None)
    sr2 = pcard("Systematic review and meta-analysis", "sr_ma_rct")
    assert check_design_consistency(sr2, [], "SGLT2 inhibitors in HF: a meta-analysis",
                                    "Five trials enrolling 21,947 patients were included.") == (sr2, None)


def test_a_paired_reader_screening_study_is_not_an_rct():
    abstract = ("All screening examinations were read by AI and radiologists. This study is registered with "
                "ClinicalTrials.gov, NCT04778670.")
    card, fix = check_design_consistency(pcard("prospective, population-based, paired-reader, non-inferiority study",
                                               "rct"), [], MAMMO_P8, abstract)
    assert card.design_category == "cohort" and fix["reason"] == "a paired or single-arm design with no randomisation"
    single = pcard("single-arm phase 2 trial", "rct")
    assert check_design_consistency(single, [], "Drug X in cancer", "Patients received drug X.")[0].design_category \
        == "non_randomized_trial"
    # explicit randomisation keeps the label
    randomised = pcard("paired-reader study", "rct")
    assert check_design_consistency(randomised, [], "AI in screening",
                                    "Women were randomly assigned to AI-supported or standard reading.") == (
        randomised, None)
    assert check_design_consistency(randomised, ["Randomized Controlled Trial"], "t", "") == (randomised, None)


# ---- item 8: verification_rate at the top level -----------------------------------------------------------------
def test_review_out_fills_the_verification_rate_from_the_result():
    base = {"id": uuid.uuid4(), "topic": "t", "language": "en", "status": "done", "created_at": datetime.now(UTC),
            "finished_at": None, "options": {}, "error": None, "cost_usd": 0.0, "started_at": None}
    assert ReviewOut.model_validate({**base, "result": {"quality": {"verification_rate": 0.84}}}).verification_rate \
        == 0.84
    assert ReviewOut.model_validate({**base, "result": None}).verification_rate is None
    assert verification_rate_of({"quality": {"verification_rate": None}}) is None
    assert verification_rate_of({"quality": "broken"}) is None


async def test_get_review_returns_the_top_level_verification_rate(client, session_factory):
    created = (await client.post("/api/v1/reviews", json={"topic": "sglt2 heart failure"})).json()
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(uuid.UUID(created["review_id"]), status="done",
                                         finished_at=datetime.now(UTC),
                                         result={"quality": {"verification_rate": 0.971}})
    got = (await client.get(f"/api/v1/reviews/{created['review_id']}")).json()
    assert got["verification_rate"] == 0.971
