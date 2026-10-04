from app.graph.schemas import MAX_OUTCOMES, PaperCard


def outcome(name, quote):
    return {"outcome": name, "result": "lower", "evidence_quote": quote, "effect_size": None, "effect_measure": "none",
            "effect_value": None, "ci_lower": None, "ci_upper": None, "p_value": None, "direction": "positive"}


def card(outcomes, **kw):
    base = {"study_design": "RCT", "design_category": "rct", "population": "adults after MI", "sample_size": 4745,
            "sample_size_quote": "A total of 4745 patients were enrolled", "intervention_or_exposure": "colchicine",
            "comparator": "placebo", "outcomes": outcomes, "key_findings": ["fewer ischemic events"],
            "limitations": ["abstract only"], "funding_or_conflicts": None, "risk_of_bias": "low",
            "overall_direction": "positive"}
    return {**base, **kw}


def test_outcomes_the_abstract_does_not_report_are_dropped_not_fatal():
    # measured: the model lists every outcome of interest and sets evidence_quote null for the unreported ones
    c = PaperCard.model_validate(card([outcome("MACE", "The primary end point occurred in 5.5%"),
                                       outcome("All-cause mortality", None), outcome("GI events", "  ")]))
    assert [o.outcome for o in c.outcomes] == ["MACE"]


def test_a_card_with_no_quoted_outcome_still_keeps_its_design_and_sample_size():
    c = PaperCard.model_validate(card([outcome("MACE", None)], key_findings=None, limitations=None))
    assert c.outcomes == [] and c.sample_size == 4745 and c.key_findings == [] and c.limitations == []


def test_at_most_six_outcomes_are_kept_in_the_models_order():
    c = PaperCard.model_validate(card([outcome(f"o{i}", f"quote {i}") for i in range(9)]))
    assert MAX_OUTCOMES == 6 and [o.outcome for o in c.outcomes] == [f"o{i}" for i in range(6)]
