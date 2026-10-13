"""Plan 25: the deterministic half of sentence support (app.harness.support): claims, abstract sentences, the
scorer, judge answers and the badge rule. No LLM."""
import json

from app.graph.schemas import SupportBatch, SupportVerdict
from app.harness import support as sp
from app.harness.prose import prose_context, unverified_numbers

ABSTRACT = (
    "Background: Colorectal cancer is common in adults with type 2 diabetes. "
    "Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based cohort.\n"
    "Results: Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90). "
    "Sulfonylureas showed no association with colorectal cancer, e.g. in older adults. "
    "Conclusions: Metformin may lower colorectal cancer risk."
)


def card(value=0.8):
    return {"study_design": "cohort", "population": "adults with type 2 diabetes", "sample_size": 1234,
            "intervention_or_exposure": "metformin", "comparator": "no metformin",
            "outcomes": [{"outcome": "CRC incidence", "result": "lower risk", "effect_size": f"HR {value}",
                          "effect_measure": "HR", "effect_value": value, "ci_lower": 0.71, "ci_upper": 0.9,
                          "p_value": None, "direction": "positive", "matches_question": True,
                          "comparison": "metformin vs no metformin"}],
            "key_findings": [], "risk_of_bias": "moderate", "overall_direction": "positive"}


def ctx(values=(), **cards):
    return prose_context([{"ref": ref, "title": f"Paper {ref}", "year": 2020, "card": c} for ref, c in cards.items()],
                         values=values)


def test_markers_are_the_groups_the_report_links():
    text = "A [P1]. B [P2, P10] and [P3-P5]; C [P2,P4]."
    assert sp.markers(text) == [["P1"], ["P2", "P10"], ["P2", "P4"]]  # a range is no link in the report
    assert sp.markers("") == [] and sp.markers(None) == []


def test_summary_claims_tie_each_marker_to_its_sentence():
    text = ("Metformin is associated with lower CRC risk [P1, P2]. One cohort found the opposite [P3], unlike "
            "trials [P4]. Dose effects were not studied. Results vs. placebo were similar. [P5] Follow-up was short.")
    claims = sp.summary_claims(text)
    assert [(c.id, c.markers, c.refs) for c in claims] == [
        ("s0", [0], ["P1", "P2"]), ("s1", [1, 2], ["P3", "P4"]), ("s2", [3], ["P5"])]
    assert claims[1].text == "One cohort found the opposite [P3], unlike trials [P4]."
    # "vs." never ends a sentence; a group after the full stop belongs to the sentence before it
    assert claims[2].text == "Results vs. placebo were similar. [P5]"
    assert all(c.where == "summary" and c.finding is None for c in claims)


def test_finding_claims_keep_the_index_and_skip_empty_findings():
    claims = sp.finding_claims([{"statement": "Lower risk.", "refs": ["P1", "P1", "P2"]},
                                {"statement": "", "refs": ["P3"]}, {"statement": "No refs.", "refs": []},
                                {"statement": "Harms unclear.", "refs": ["P4"]}])
    assert [(c.id, c.finding, c.refs) for c in claims] == [("k0", 0, ["P1", "P2"]), ("k3", 3, ["P4"])]
    assert all(c.where == "key_finding" and c.markers is None for c in claims)


def test_abstract_sentences_are_verbatim_and_split_at_labels_and_lines():
    sentences = sp.abstract_sentences(ABSTRACT)
    assert sentences[1] == ("Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based "
                            "cohort.")
    assert sentences[2].startswith("Results: Metformin use") and sentences[2].endswith("(HR 0.80, 95% CI 0.71-0.90).")
    assert sentences[3] == "Sulfonylureas showed no association with colorectal cancer, e.g. in older adults."
    assert all(s in ABSTRACT for s in sentences)
    assert sp.abstract_sentences("Short. Too short.") == [] and sp.abstract_sentences(None) == []


def test_the_scorer_ranks_by_content_words_and_numbers():
    sentences = sp.abstract_sentences(ABSTRACT)
    best = sp.best_sentences("Metformin was associated with a lower colorectal cancer risk (HR 0.80) [P1].", sentences)
    assert best[0][0].startswith("Results: Metformin use") and best[0][1] > best[1][1]
    assert len(best) == sp.CANDIDATES
    # numbers count: the same words with the right hazard ratio beat the conclusion sentence
    assert sp.score("lower colorectal cancer HR 0.80", sentences[2]) > sp.score("lower colorectal cancer HR 0.80",
                                                                                   sentences[4])
    assert sp.score("", sentences[0]) == 0.0
    assert sp.content_words("Studies [P1] reported lower risks in patients") == {"lower", "risk"}


def test_unverified_numbers_follow_the_prose_rule():
    c = ctx(P1=card(), P2=card(0.9))
    assert unverified_numbers("Metformin lowered risk (HR 0.80).", ["P1"], c) == []
    assert unverified_numbers("Metformin lowered risk (HR 0.80).", ["P2"], c) == ["0.80"]
    assert unverified_numbers("Risk fell (HR 0.77) in adults with type 2 diabetes.", ["P1"], c) == ["0.77"]


def test_claim_checks_flag_unverified_and_pooled_numbers():
    c = ctx(values=["0.84"], P1=card(), P2=card(0.9))  # the pooled value, as write_synthesis admits it
    pooled = sp.pooled_keys({"0.84", ".84"})
    ok, = sp.summary_claims("Metformin lowered risk (HR 0.80) [P1].")
    bad, = sp.summary_claims("Metformin lowered risk (HR 0.80) [P2].")
    pool, = sp.summary_claims("Pooled, risk was lower (0.84) [P1, P2].")
    words, = sp.summary_claims("Metformin lowered risk [P1].")
    assert sp.claim_checks(ok, c, pooled) == (True, False)
    assert sp.claim_checks(bad, c, pooled) == (False, False)
    assert sp.claim_checks(pool, c, pooled) == (True, True)  # admitted as a pooled value, but computed
    assert sp.claim_checks(words, c, pooled) == (True, False)


def test_pairs_skip_papers_without_abstract_not_evidence_and_computed_claims():
    claims = sp.summary_claims("Lower risk [P1, P2, P3]. Pooled 0.84 [P1].") + sp.finding_claims(
        [{"statement": "Metformin lowers risk.", "refs": ["P1"]}])
    pairs = sp.build_pairs(claims, {"P1": ABSTRACT, "P2": None, "P3": ABSTRACT}, skip={"P3", "s1"})
    assert [(p.id, p.claim.id, p.ref) for p in pairs] == [("c1", "s0", "P1"), ("c2", "k0", "P1")]
    items = sp.judge_items(pairs)
    assert items[0] == {"id": "c1", "paper": "P1", "claim": "Lower risk [P1, P2, P3].",
                        "candidates": [s for s, _ in pairs[0].candidates]}
    assert all(s in ABSTRACT for s in items[0]["candidates"])


def test_the_judge_schema_is_strict_compatible():
    schema = SupportBatch.model_json_schema()
    verdict = schema["$defs"]["SupportVerdict"]
    assert set(verdict["required"]) == {"id", "label", "sentence"} and "default" not in json.dumps(schema)
    assert verdict["properties"]["label"]["enum"] == list(sp.LABELS)


def _pairs():
    claims = sp.summary_claims("Metformin lowers colorectal cancer risk [P1, P2].")
    return sp.build_pairs(claims, {"P1": ABSTRACT, "P2": ABSTRACT}, skip=set())


def test_verdict_problems_ask_for_one_valid_verdict_per_id():
    pairs = _pairs()
    good = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=1),
                                  SupportVerdict(id="c2", label="unsupported", sentence=None)])
    assert sp.verdict_problems(good, pairs) == []
    bad = SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=3),
                                 SupportVerdict(id="c1", label="supported", sentence=1),
                                 SupportVerdict(id="c9", label="supported", sentence=1)])
    problems = sp.verdict_problems(bad, pairs)
    assert any("c1: sentence must name" in p for p in problems)
    assert any("c1 answered twice" in p for p in problems)
    assert any("unknown id c9" in p for p in problems)
    assert any("missing verdicts for c2" in p for p in problems)
    assert sp.verdict_problems("not a batch", pairs) == [
        "answer with a JSON object that has a `verdicts` list (id, label, sentence)"]


def test_usable_verdicts_drop_repeats_unknown_ids_and_missing_sentences():
    pairs = _pairs()
    value = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=2),
                                   SupportVerdict(id="c1", label="partial", sentence=1),
                                   SupportVerdict(id="c2", label="partial", sentence=None),
                                   SupportVerdict(id="c7", label="supported", sentence=1)])
    assert sp.verdicts(value, pairs) == {}
    value = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=2),
                                   SupportVerdict(id="c2", label="unsupported", sentence=2)])
    assert sp.verdicts(value, pairs) == {"c1": ("supported", 1), "c2": ("unsupported", None)}
    assert sp.verdicts(None, pairs) == {}


def test_a_repeated_id_is_dropped_whatever_the_first_answer_was():
    pairs = _pairs()
    invalid_first = SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=3),
                                           SupportVerdict(id="c1", label="supported", sentence=1),
                                           SupportVerdict(id="c2", label="unsupported", sentence=None)])
    assert sp.verdicts(invalid_first, pairs) == {"c2": ("unsupported", None)}
    valid_twice = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=1),
                                         SupportVerdict(id="c1", label="unsupported", sentence=None)])
    assert "c1" not in sp.verdicts(valid_twice, pairs)


def test_a_missing_candidate_is_unjudged_and_evidence_is_what_the_judge_read():
    pair = _pairs()[0]
    one = sp.Pair(id=pair.id, claim=pair.claim, ref="P1", candidates=pair.candidates[:1])
    kw = {"numbers_checked": True, "computed": False, "not_evidence": False}
    for bad in (1, -1):
        c = sp.citation(one, "P1", ("supported", bad), **kw)
        assert c["label"] is None and c["verified"] is False and c["evidence"] == one.candidates[0][0]
    long = "Metformin lowered colorectal cancer risk " + "x" * 600
    big = sp.Pair(id="c1", claim=pair.claim, ref="P1", candidates=[(long, 0.5)])
    c = sp.citation(big, "P1", ("supported", 0), **kw)
    assert c["evidence"] == sp.judge_items([big])[0]["candidates"][0] and len(c["evidence"]) == sp.MAX_SENTENCE_CHARS


def test_a_long_run_of_spaces_splits_in_linear_time():
    import time
    start = time.perf_counter()
    sp.abstract_sentences("Methods: " + " " * 20000 + "We followed adults for years.")
    assert time.perf_counter() - start < 0.5


def test_the_badge_needs_supported_checked_numbers_no_pool_and_evidence():
    pair = _pairs()[0]
    first, second = pair.candidates[0][0], pair.candidates[1][0]
    kw = {"numbers_checked": True, "computed": False, "not_evidence": False}
    c = sp.citation(pair, "P1", ("supported", 1), **kw)
    assert c == {"ref": "P1", "label": "supported", "evidence": second, "score": pair.candidates[1][1],
                 "not_evidence": False, "verified": True}
    assert sp.citation(pair, "P1", ("partial", 0), **kw)["verified"] is False
    unsupported = sp.citation(pair, "P1", ("unsupported", None), **kw)
    assert unsupported["evidence"] == first and unsupported["verified"] is False  # the closest sentence, shown as such
    assert sp.citation(pair, "P1", None, **kw) | {"evidence": None} == {
        "ref": "P1", "label": None, "evidence": None, "score": pair.candidates[0][1], "not_evidence": False,
        "verified": False}
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"numbers_checked": False}))["verified"] is False
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"computed": True}))["verified"] is False
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"not_evidence": True}))["verified"] is False
    assert sp.citation(None, "P3", None, **kw) == {"ref": "P3", "label": None, "evidence": None, "score": None,
                                                   "not_evidence": False, "verified": False}
