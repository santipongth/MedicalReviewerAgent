"""Plan 19 Task 1 (audit I-1, I-5): numbers are checked against the abstract window the quote aligns to, number
formats are normalised on both sides, equality is strict, and fields are nulled one at a time."""
from __future__ import annotations

import pytest

from app.graph.nodes.reading import make_read_paper
from app.graph.schemas import OutcomeResult, PaperCard
from app.harness.verify import (
    card_problems,
    null_unverified_numbers,
    numbers_in,
    outcome_problems,
    quote_window,
)
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM
from tests.unit import test_nodes_reading as reading

MINUS, EN_DASH, MIDDOT, THIN, NBSP = chr(0x2212), chr(0x2013), chr(0x00B7), chr(0x2009), chr(0x00A0)


def outcome(quote, effect=None, lo=None, hi=None, p=None, measure="HR", name="CRC incidence", result="lower"):
    return OutcomeResult(outcome=name, result=result, evidence_quote=quote, effect_size=None,
                         effect_measure=measure if effect is not None else "none", effect_value=effect,
                         ci_lower=lo, ci_upper=hi, p_value=p, direction="positive")


def card(outcomes, n=None, n_quote=None):
    return PaperCard(study_design="cohort", population="adults", sample_size=n, sample_size_quote=n_quote,
                     intervention_or_exposure="metformin", comparator="none", outcomes=outcomes, key_findings=[],
                     limitations=[], funding_or_conflicts=None, risk_of_bias="moderate", overall_direction="positive")


# ---- I-1: the number must be in the abstract window, not just in the model's quote -------------------------------
AUDIT_SOURCE = ("Results: Metformin use was associated with a lower risk of colorectal cancer "
                "(HR 0.86, 95% CI 0.77-0.96; p = 0.008) over a median follow-up of 5 years.")


def test_audit_case_altered_digit_in_quote_and_field_fails():
    # the model copied the sentence but changed 0.86 to 0.80 in both its quote and its field
    o = outcome("lower risk of colorectal cancer (HR 0.80, 95% CI 0.77-0.96; p = 0.008)", 0.80, 0.77, 0.96, 0.008)
    assert quote_window(o.evidence_quote, AUDIT_SOURCE, 90) is not None  # the fuzzy locate still succeeds
    problems = outcome_problems(o, AUDIT_SOURCE, 90)
    assert problems == [("CRC incidence: effect_value 0.8 does not appear in the paper text where evidence_quote is "
                         "found; copy numbers exactly as reported")]
    fixed, verified, total = null_unverified_numbers(card([o]), AUDIT_SOURCE, 90)
    assert fixed.outcomes[0].effect_value is None and fixed.outcomes[0].effect_measure == "none"
    assert fixed.outcomes[0].p_value == 0.008  # the verified p-value stays
    assert (verified, total) == (0, 1)


def test_number_elsewhere_in_the_abstract_does_not_verify_the_window():
    source = ("Overall mortality was lower (HR 0.80, 95% CI 0.70-0.91). "
              "Metformin use was associated with a lower risk of colorectal cancer (HR 0.86, 95% CI 0.77-0.96).")
    o = outcome("associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.77-0.96)", 0.80, 0.77, 0.96)
    assert any("effect_value 0.8 does not appear in the paper text" in p for p in outcome_problems(o, source, 90))


def test_the_faithful_quote_verifies():
    o = outcome("lower risk of colorectal cancer (HR 0.86, 95% CI 0.77-0.96; p = 0.008)", 0.86, 0.77, 0.96, 0.008)
    assert outcome_problems(o, AUDIT_SOURCE, 90) == []


def test_field_value_missing_from_quote_is_reported_against_the_quote():
    o = outcome("lower risk of colorectal cancer (HR 0.86, 95% CI 0.77-0.96; p = 0.008)", 0.75, 0.77, 0.96)
    assert any("effect_value 0.75 does not appear in evidence_quote" in p for p in outcome_problems(o, AUDIT_SOURCE, 90))


# ---- I-5: formats are normalised on both sides --------------------------------------------------------------------
@pytest.mark.parametrize(("text", "expected"), [
    ("P = .003", [0.003]),
    ("p<.001", [0.001]),
    ("in 111 725 women", [111725]),
    (f"in 111{THIN}725 women", [111725]),
    (f"in 111{NBSP}725 women", [111725]),
    ("1,234 adults", [1234]),
    ("HR 0,85 (0,71-0,90)", [0.85, 0.71, 0.90]),
    (f"change {MINUS}0.5 mmHg", [-0.5]),
    (f"HR 0{MIDDOT}85", [0.85]),
    (f"95% CI 0.71{EN_DASH}0.90", [95, 0.71, 0.90]),
    (f"CI 0.71 {EN_DASH} 0.90", [0.71, 0.90]),  # a spaced dash after a number is a range, not a minus
    ("MD -0.5 (-0.9 - -0.1)", [-0.5, -0.9, -0.1]),
    (f"({EN_DASH}0.5 to {EN_DASH}0.1)", [-0.5, -0.1]),
    ("rate 12.5%", [12.5]),
    ("in 1 651 452 patients", [1651452]),
    ("T2D in 2019", [2019]),
])
def test_number_formats(text, expected):
    assert numbers_in(text) == [float(x) for x in expected]


@pytest.mark.parametrize(("source", "quote", "fields"), [
    ("was noninferior (P = .003) to the radiologist screening sensitivity",
     "was noninferior (P = .003) to the radiologist", {"p_value": 0.003}),
    ("adherence was lower in depressed patients (p<.001) at three months",
     "lower in depressed patients (p<.001) at three months", {"p_value": 0.001}),
    ("Lower risk of colorectal cancer (HR 0,85; 95% CI 0,71-0,90) in users",
     "Lower risk of colorectal cancer (HR 0,85; 95% CI 0,71-0,90)",
     {"effect_value": 0.85, "ci_lower": 0.71, "ci_upper": 0.9}),
    (f"Lower risk of colorectal cancer (HR 0{MIDDOT}85; 95% CI 0{MIDDOT}71{EN_DASH}0{MIDDOT}90) in users",
     "Lower risk of colorectal cancer (HR 0.85; 95% CI 0.71-0.90)",
     {"effect_value": 0.85, "ci_lower": 0.71, "ci_upper": 0.9}),
    (f"HbA1c changed by {MINUS}0.5% (95% CI {MINUS}0.7 to {MINUS}0.3) with the drug",
     "HbA1c changed by -0.5% (95% CI -0.7 to -0.3)", {"effect_value": -0.5, "ci_lower": -0.7, "ci_upper": -0.3}),
    (f"lower risk of colorectal cancer (HR 0.80, 95% CI 0.71{EN_DASH}0.90) in users",
     "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90)",
     {"effect_value": 0.8, "ci_lower": 0.71, "ci_upper": 0.9}),
])
def test_formats_verify_against_the_window(source, quote, fields):
    measure = "MD" if fields.get("effect_value", 1) < 0 else "HR"
    o = OutcomeResult(outcome="x", result="r", evidence_quote=quote, effect_size=None,
                      effect_measure=measure if "effect_value" in fields else "none",
                      effect_value=fields.get("effect_value"), ci_lower=fields.get("ci_lower"),
                      ci_upper=fields.get("ci_upper"), p_value=fields.get("p_value"), direction="positive")
    assert outcome_problems(o, source, 90) == []


@pytest.mark.parametrize(("source", "n"), [
    ("The study sample comprised 114 421 screenings in 114 421 women.", 114421),
    (f"The study sample comprised 114{THIN}421 screenings in 114{THIN}421 women.", 114421),
    ("We enrolled 1,234 adults with type 2 diabetes in a cohort.", 1234),
])
def test_spaced_and_comma_thousands_verify_a_sample_size(source, n):
    quote = source.rstrip(".")
    assert card_problems(card([], n=n, n_quote=quote), source, 90) == []


# ---- strict equivalence ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize(("source_number", "value", "ok"), [
    ("0.80", 0.8, True),     # decided: 0.8 == 0.80 (same value; the model's JSON float cannot keep the trailing zero)
    ("0.8", 0.8, True),
    ("0.86", 0.8, False),    # a changed digit never passes
    ("0.804", 0.8, False),   # no rounding tolerance
    ("10.80", 0.8, False),   # never inside a longer number
    ("0.805", 0.8, False),
    ("1,234", 234.0, False),
    ("111 725", 725.0, False),
    ("111 725", 111.0, False),
])
def test_equivalence_is_exact(source_number, value, ok):
    source = f"The adjusted estimate was {source_number} in the treated group of this cohort."
    o = outcome(f"The adjusted estimate was {source_number} in the treated group", value, measure="other")
    assert (outcome_problems(o, source, 90) == []) is ok


# ---- field-by-field nulling -----------------------------------------------------------------------------------------
SOURCE = ("Results: Metformin use was associated with a lower risk of colorectal cancer "
          "(HR 0.80, 95% CI 0.71-0.90; p = 0.003). We enrolled 1,234 adults.")
QUOTE = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003)"


def test_bad_p_value_blanks_only_the_p_value():
    quote = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.03)"  # model typo in p only
    fixed, verified, total = null_unverified_numbers(card([outcome(quote, 0.8, 0.71, 0.9, 0.03)]), SOURCE, 90)
    o = fixed.outcomes[0]
    assert (o.effect_value, o.ci_lower, o.ci_upper, o.p_value, o.effect_measure) == (0.8, 0.71, 0.9, None, "HR")
    assert (verified, total) == (1, 1)


def test_bad_ci_bound_blanks_the_ci_but_keeps_effect_and_p():
    o = outcome(QUOTE, 0.8, 0.71, 0.95, 0.003)
    o = o.model_copy(update={"effect_size": "HR 0.80 (0.71-0.95)"})
    fixed, verified, total = null_unverified_numbers(card([o]), SOURCE, 90)
    f = fixed.outcomes[0]
    assert (f.effect_value, f.ci_lower, f.ci_upper, f.p_value) == (0.8, None, None, 0.003)
    assert f.effect_size is None and f.effect_measure == "HR"
    assert (verified, total) == (1, 1)


def test_bad_effect_blanks_effect_and_its_ci_but_keeps_p():
    fixed, verified, total = null_unverified_numbers(card([outcome(QUOTE, 0.75, 0.71, 0.9, 0.003)]), SOURCE, 90)
    f = fixed.outcomes[0]
    assert (f.effect_value, f.ci_lower, f.ci_upper, f.p_value, f.effect_measure) == (None, None, None, 0.003, "none")
    assert (verified, total) == (0, 1)


def test_quote_not_found_blanks_every_number():
    o = outcome("an invented sentence with HR 0.80 (0.71-0.90; p = 0.003)", 0.8, 0.71, 0.9, 0.003)
    fixed, verified, total = null_unverified_numbers(card([o], n=1234, n_quote="We enrolled 1,234 adults"), SOURCE, 90)
    f = fixed.outcomes[0]
    assert (f.effect_value, f.ci_lower, f.ci_upper, f.p_value) == (None, None, None, None)
    assert fixed.sample_size == 1234 and (verified, total) == (1, 2)


def test_result_text_with_an_altered_number_is_masked_not_replaced_by_an_altered_quote():
    quote = "lower risk of colorectal cancer (HR 0.88, 95% CI 0.71-0.90; p = 0.003)"
    o = outcome(quote, None, result="HR 0.88 in users")
    fixed, _, _ = null_unverified_numbers(card([o]), SOURCE, 90)
    assert fixed.outcomes[0].result == "HR [unverified] in users"


async def test_reading_keeps_a_verified_effect_when_only_the_p_value_fails():
    quote = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.03)"
    bad_p = reading.card(quote=quote).model_copy(deep=True)
    bad_p.outcomes[0].p_value = 0.03
    llm = FakeStructuredLLM("ds", lambda s, u: bad_p)
    out = await make_read_paper(reading.deps(llm, harness=HarnessSpec(dual_extraction=False, max_repairs=1,
                                                                     escalate_on=[])))(reading.payload())
    entry = out["papers"][0]
    o = entry["card"]["outcomes"][0]
    assert (o["effect_value"], o["ci_lower"], o["ci_upper"], o["p_value"]) == (0.8, 0.71, 0.9, None)
    v = entry["verification"]
    assert (v["numbers_verified"], v["numbers_total"], v["unverified"]) == (2, 2, [])


async def test_reading_counts_and_unverified_list_stay_consistent():
    bad = reading.card(effect=0.5).model_copy(deep=True)
    llm = FakeStructuredLLM("ds", lambda s, u: bad)
    out = await make_read_paper(reading.deps(llm, harness=HarnessSpec(dual_extraction=False, max_repairs=1,
                                                                     escalate_on=[])))(reading.payload())
    v = out["papers"][0]["verification"]
    assert v["numbers_total"] - v["numbers_verified"] == len(v["unverified"]) == 1
    assert v["unverified"] == [{"field": "effect", "outcome": "CRC incidence"}]


# ---- real fixtures from the audit runs (abstract excerpts, quotes as stored; all were blanked before Plan 19) -------
# 4f33f660 P26, Endocr Pract 2009 (PMID 19211396): JAMA-style "P = .02" blanked the OR and its CI.
P26 = ("Negative attitudes toward insulin were very common, particularly in patients with less education and poorer "
       "diabetes-related knowledge (odds ratio, 6.2; 95% confidence interval, 1.04-47.3; P = .02). Even when they "
       "received precise recommendations, 12 patients (41%) did not adhere to insulin treatment. Patients who did not "
       "adhere to therapy were most commonly women and were depressed (P = .05).")
# f78b2184 P2, Radiology 2022 (PMID 35438561): "P = .02", "P < .001" and "111 725" blanked sensitivity and specificity.
P2 = ("The study sample comprised 114 421 screenings for breast cancer in 114 421 women, resulting in 791 screen-detected, "
      "327 interval, and 1473 long-term cancers and 2107 false-positive screenings. The AI-based screening sensitivity "
      "was 69.7% (779 of 1118; 95% CI: 66.9, 72.4) and was noninferior (P = .02) to the radiologist screening "
      "sensitivity of 70.8% (791 of 1118; 95% CI: 68.0, 73.5). The AI-based screening specificity was 98.6% "
      "(111 725 of 113 303; 95% CI: 98.5, 98.7), which was higher (P < .001) than the radiologist specificity of "
      "98.1% (111 196 of 113 303; 95% CI: 98.1, 98.2).")
# f78b2184 P5, Radiology 2023 (PMID 37219445): AUCs blanked through "P = .002".
P5 = ("Pooled AUCs were significantly higher for standalone AI than radiologists in the six reader studies on digital "
      "mammography (0.87 vs 0.81, P = .002), but not for historic cohort studies (0.89 vs 0.96, P = .152).")


@pytest.mark.parametrize(("source", "o"), [
    (P26, outcome("Negative attitudes toward insulin were very common, particularly in patients with less education "
                  "and poorer diabetes-related knowledge (odds ratio, 6.2; 95% confidence interval, 1.04-47.3; "
                  "P = .02).", 6.2, 1.04, 47.3, 0.02, measure="OR")),
    (P26, outcome("Patients who did not adhere to therapy were most commonly women and were depressed (P = .05).",
                  p=0.05)),
    (P2, outcome("The AI-based screening sensitivity was 69.7% (779 of 1118; 95% CI: 66.9, 72.4) and was "
                 "noninferior (P = .02) to the radiologist screening sensitivity of 70.8% (791 of 1118; 95% CI: "
                 "68.0, 73.5).", 69.7, 66.9, 72.4, 0.02, measure="other")),
    (P2, outcome("The AI-based screening specificity was 98.6% (111 725 of 113 303; 95% CI: 98.5, 98.7), which was "
                 "higher (P < .001) than the radiologist specificity of 98.1% (111 196 of 113 303; 95% CI: 98.1, "
                 "98.2).", 98.6, 98.5, 98.7, 0.001, measure="other")),
    (P5, outcome("Pooled AUCs were significantly higher for standalone AI than radiologists in the six reader studies "
                 "on digital mammography (0.87 vs 0.81, P = .002)", 0.87, p=0.002, measure="other")),
    (P5, outcome("but not for historic cohort studies (0.89 vs 0.96, P = .152)", 0.89, p=0.152, measure="other")),
])
def test_audit_fixtures_now_verify(source, o):
    assert outcome_problems(o, source, 90) == []
    fixed, verified, total = null_unverified_numbers(card([o]), source, 90)
    assert fixed.outcomes[0] == o and (verified, total) == (1, 1)


def test_audit_fixture_sample_size_with_spaced_thousands():
    c = card([], n=114421, n_quote="The study sample comprised 114 421 screenings for breast cancer in 114 421 women")
    assert card_problems(c, P2, 90) == []


def test_audit_fixture_digit_swap_in_a_real_abstract_still_fails():
    o = outcome("The AI-based screening specificity was 98.6% (111 725 of 113 303; 95% CI: 98.5, 98.7)",
                98.8, 98.5, 98.7, measure="other")
    o = o.model_copy(update={"evidence_quote": o.evidence_quote.replace("98.6%", "98.8%")})
    assert any("effect_value 98.8" in p for p in outcome_problems(o, P2, 90))
