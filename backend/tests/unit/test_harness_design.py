from app.graph.schemas import OutcomeResult, PaperCard
from app.harness.design import design_problems, infer_design_category
from app.harness.grade import grade_baseline, is_randomized


def card(design="Retrospective cohort study (Kaiser Permanente)", category="cohort", **kw):
    outcome = OutcomeResult(outcome="CRC", result="lower", evidence_quote="q", effect_size=None, effect_measure="none",
                            effect_value=None, ci_lower=None, ci_upper=None, p_value=None, direction="positive")
    base = {"study_design": design, "design_category": category, "population": "adults", "sample_size": None,
            "sample_size_quote": None, "intervention_or_exposure": "metformin", "comparator": None,
            "outcomes": [outcome], "key_findings": [], "limitations": [], "funding_or_conflicts": None,
            "risk_of_bias": "moderate", "overall_direction": "positive"}
    return PaperCard(**{**base, **kw})


def test_publication_types_contradicting_the_category_are_problems():
    assert any("Randomized Controlled Trial" in p for p in design_problems(card(), ["Randomized Controlled Trial"]))
    assert any("Meta-Analysis" in p for p in design_problems(card(), ["Journal Article", "Meta-Analysis"]))
    assert design_problems(card(category="sr_ma_rct"), ["Meta-Analysis", "Systematic Review"]) == []
    assert design_problems(card(category="rct"), ["Randomized Controlled Trial", "Journal Article"]) == []
    assert design_problems(card(category=None), []) == []  # missing → inferred in code, no extra LLM round


def test_free_text_designs_map_to_categories():
    assert infer_design_category("Retrospective cohort study (Kaiser Permanente Northern California)") == "cohort"
    assert infer_design_category("Systematic review and meta-analysis of randomized controlled trials") == "sr_ma_rct"
    assert infer_design_category("Meta-analysis of observational studies") == "sr_ma_observational"
    assert infer_design_category("Systematic Review and Meta-Analysis") == "sr_ma_mixed"
    assert infer_design_category("Randomized, double-blind, placebo-controlled trial") == "rct"
    assert infer_design_category("Nested case-control study") == "case_control"
    assert infer_design_category("Mendelian randomization study") == "mendelian_randomization"
    assert infer_design_category("Review") == "narrative_review"
    assert infer_design_category("Target trial emulation cohort") == "cohort"
    assert infer_design_category("something else") is None


def test_grade_starts_high_for_randomized_categories_and_legacy_text_still_works():
    cards = [card(category="rct").model_dump(), card(category="sr_ma_rct").model_dump(),
             card(category="cohort").model_dump()]
    grade = grade_baseline([{"card": c} for c in cards], {"conflicts": []})
    assert grade["factors"][0].startswith("start high")
    legacy = {"study_design": "Systematic review and meta-analysis of randomized trials"}  # stored before categories
    assert is_randomized(legacy) is True
    assert is_randomized({"study_design": "Randomized trial", "design_category": "cohort"}) is False  # category wins


def test_settle_fills_missing_categories_and_lets_publication_types_win():
    from app.harness.design import settle_design_category
    assert settle_design_category(card(category=None), []).design_category == "cohort"  # from the free text
    assert settle_design_category(card(design="odd", category=None), []).design_category == "other"
    assert settle_design_category(card(category="cohort"), ["Randomized Controlled Trial"]).design_category == "rct"
    pooled = settle_design_category(card(design="Meta-analysis of cohort studies", category="cohort"), ["Meta-Analysis"])
    assert pooled.design_category == "sr_ma_observational"


def test_designs_that_only_mention_a_trial_are_not_randomized():
    assert infer_design_category("Prospective cohort nested in a randomized trial") == "cohort"
    assert infer_design_category("Observational analysis of RCT participants") == "cohort"
    assert infer_design_category("Post hoc secondary analysis of a randomised trial") == "cohort"
    assert infer_design_category("Review of randomised controlled trials") == "narrative_review"
    assert infer_design_category("Systematic review of non-randomized trials") == "sr_ma_observational"
