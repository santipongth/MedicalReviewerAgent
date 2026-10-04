from app.graph.schemas import OutcomeResult, PaperCard
from app.harness.verify import (
    card_problems,
    check_citations,
    compare_cards,
    null_unverified_numbers,
    numbers_in,
    numbers_preserved,
    outcome_problems,
    quote_found,
    strip_unknown_citations,
)

SOURCE = (
    "## Methods\nWe enrolled 1,234 adults with type 2 diabetes (n = 1234). "
    "## Results\nMetformin use was associated with a lower risk of colorectal cancer "
    "(HR 0·80, 95% CI 0.71–0.90; p = 0.003). Adenoma recurrence did not differ (OR 1.05, 95% CI 0.88-1.25)."
)


def outcome(**kw):
    base = {"outcome": "CRC incidence", "result": "lower risk", "evidence_quote":
            "lower risk of colorectal cancer (HR 0·80, 95% CI 0.71–0.90; p = 0.003)",
            "effect_size": "HR 0.80 (0.71-0.90)", "effect_measure": "HR", "effect_value": 0.8,
            "ci_lower": 0.71, "ci_upper": 0.9, "p_value": 0.003, "direction": "positive"}
    base.update(kw)
    return OutcomeResult(**base)


def card(outcomes=None, **kw):
    base = {"study_design": "cohort", "population": "adults with T2D", "sample_size": 1234,
            "sample_size_quote": "We enrolled 1,234 adults with type 2 diabetes",
            "intervention_or_exposure": "metformin", "comparator": "no metformin",
            "outcomes": outcomes if outcomes is not None else [outcome()], "key_findings": ["lower CRC risk"],
            "limitations": ["observational"], "funding_or_conflicts": None, "risk_of_bias": "moderate",
            "overall_direction": "positive"}
    base.update(kw)
    return PaperCard(**base)


def test_numbers_in_handles_unicode_dots_dashes_and_thousands():
    assert numbers_in("HR 0·80, 95% CI 0.71–0.90; p = 0.003; n = 1,234") == [0.8, 95.0, 0.71, 0.9, 0.003, 1234.0]
    assert numbers_in("change −1.5 mmHg") == [-1.5]


def test_quote_found_tolerates_whitespace_and_punctuation_only():
    assert quote_found("lower risk of colorectal  cancer (HR 0.80, 95% CI 0.71-0.90", SOURCE, 90)
    assert not quote_found("higher risk of colorectal cancer (HR 1.40, 95% CI 1.2-1.6)", SOURCE, 90)
    assert not quote_found("short", SOURCE, 90)


def test_verified_outcome_has_no_problems():
    assert outcome_problems(outcome(), SOURCE, 90) == []
    assert card_problems(card(), SOURCE, 90) == []


def test_hallucinated_number_is_reported():
    problems = outcome_problems(outcome(effect_value=0.75), SOURCE, 90)
    assert any("effect_value 0.75" in p for p in problems)


def test_quote_not_in_source_is_reported():
    problems = outcome_problems(outcome(evidence_quote="HR 0.80 (95% CI 0.71-0.90) for CRC in the trial"), SOURCE, 90)
    assert any("not found" in p for p in problems)


def test_numeric_sanity_rules():
    assert any("ci_lower" in p for p in outcome_problems(outcome(ci_lower=0.95, ci_upper=0.9), SOURCE, 90))
    assert any("ratio" in p for p in outcome_problems(outcome(effect_value=-0.8), SOURCE, 90))
    assert any("p_value" in p for p in outcome_problems(outcome(p_value=3.0), SOURCE, 90))
    no_measure = outcome_problems(outcome(effect_measure="none"), SOURCE, 90)
    assert any("effect_measure" in p for p in no_measure)


def test_sample_size_needs_supporting_quote():
    assert any("sample_size" in p for p in card_problems(card(sample_size=999), SOURCE, 90))
    assert any("sample_size" in p for p in card_problems(card(sample_size_quote=None), SOURCE, 90))


def test_null_unverified_numbers_keeps_text_and_counts():
    bad = card(outcomes=[outcome(), outcome(outcome="adenoma", effect_value=2.5, ci_lower=2.0, ci_upper=3.0,
                                            evidence_quote="made up quote that is not in the paper text at all")],
               sample_size=999)
    fixed, verified, total = null_unverified_numbers(bad, SOURCE, 90)
    assert (verified, total) == (1, 3)  # outcome 1 verified; outcome 2 and sample_size not
    assert fixed.outcomes[0].effect_value == 0.8
    assert fixed.outcomes[1].effect_value is None and fixed.outcomes[1].effect_measure == "none"
    assert fixed.outcomes[1].result == "lower risk" and fixed.sample_size is None


def test_compare_cards_agreement_and_disagreement():
    same, disagreements = compare_cards(card(), card())
    assert same == 1.0 and disagreements == []
    other = card(outcomes=[outcome(effect_value=1.3, direction="negative")], overall_direction="negative")
    score, disagreements = compare_cards(card(), other)
    assert score < 0.5 and any("direction" in d for d in disagreements)


def test_citation_check_and_strip():
    text = "Lower risk [P1, P3]; no effect [P9] and [P2]."
    assert check_citations(text, {"P1", "P2", "P3"}) == ["unknown citation P9"]
    assert strip_unknown_citations(text, {"P1", "P2", "P3"}) == "Lower risk [P1, P3]; no effect and [P2]."


def test_numbers_preserved_between_source_and_translation():
    assert numbers_preserved("HR 0.80 (95% CI 0.71-0.90)", "HR 0.80 (ช่วงความเชื่อมั่น 95% 0.71-0.90)")
    assert not numbers_preserved("HR 0.80 (95% CI 0.71-0.90)", "HR 0.8 (95% CI 0.71-0.95)")
