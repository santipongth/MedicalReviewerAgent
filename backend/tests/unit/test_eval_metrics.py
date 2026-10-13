import pytest

from app.evals.metrics import aggregate, review_metrics, wilson
from app.evals.models import Manifest, PrimaryMatch, RunRecord
from app.evals.report import render_report


def rec(i, repeat, status="done", direction="positive", th=None, en=None, verified=(3, 4), started="2026-10-10T08:00"):
    result = None
    if status == "done":
        en = en or {"executive_summary": "Versus placebo the hazard ratio was 0.80 [P1].", "comparison": [],
                    "consensus": [], "conflicts": [], "evidence_rationale": "", "research_gaps": [], "answer": "Yes."}
        th = th or {**en, "executive_summary": "เทียบกับยาหลอก อัตราส่วนอันตราย 0.80 [P1]", "answer": "ใช่"}
        result = {"synthesis_en": en, "synthesis": th, "papers": [{}, {}],
                  "quality": {"numbers_verified": verified[0], "numbers_total": verified[1],
                              "localize": {"untranslated": 0, "numbers_rejected": 1, "citations_rejected": 0}}}
    return RunRecord(id=f"CD{i}", repeat=repeat, run_id="r", prompt_version="p", git_sha="s", preset="budget",
                     models={}, started_at=started, elapsed_s=10.0, cost_usd=0.02, status=status,
                     error="" if status == "done" else "boom", citations={"proposed": 10, "stripped": 1},
                     primary_match=PrimaryMatch(row_index=0, outcome="death", verdict="consensus",
                                                direction=direction) if status == "done" else None,
                     result=result)


def test_wilson_bounds():
    lo, hi = wilson(45, 60)
    assert 0.62 < lo < 0.65 and 0.84 < hi < 0.86 and wilson(0, 0) == (0.0, 0.0)


def test_review_metrics_reads_quality_glossary_and_direction():
    m = review_metrics(rec(1, 1), "cv")
    assert (m.numbers_verified, m.numbers_total, m.numbers_rejected) == (3, 4, 1)
    assert ("hazard ratio", False) in m.glossary and ("placebo", True) in m.glossary
    assert m.primary_direction == "consensus:positive" and m.answer_present and m.thai_share_min > 0
    assert m.started_at == "2026-10-10T08:00"


def test_aggregate_keeps_failures_in_denominators_and_pairs_stability():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv"),
            review_metrics(rec(2, 1), "cv"), review_metrics(rec(2, 2, direction="negative"), "cv"),
            review_metrics(rec(3, 1, status="error"), "cv"), review_metrics(rec(3, 2, status="error"), "cv")]
    a = aggregate(rows)
    assert a["n_runs"] == 6 and a["n_failed"] == 2
    assert a["answer_rate"][0] == pytest.approx(4 / 6)
    assert a["stability_pairs"] == 3 and a["stability_missing"] == 0
    # CD1 agrees; CD2 flips direction; CD3 has two failed runs, which count as disagreement.
    assert a["stability"][0] == pytest.approx(1 / 3)
    assert a["glossary_top_misses"][0][0] == "hazard ratio"


def test_failed_pair_disagrees_and_done_none_pair_agrees():
    failed = [review_metrics(rec(1, 1, status="error"), "cv"), review_metrics(rec(1, 2), "cv")]
    assert aggregate(failed)["stability"][0] == 0.0
    no_row = []
    for rep in (1, 2):
        r = rec(2, rep)
        r.primary_match = None  # done, but no comparison row for the primary outcome
        no_row.append(review_metrics(r, "cv"))
    assert [m.primary_direction for m in no_row] == ["none", "none"]
    assert aggregate(no_row)["stability"][0] == 1.0


def test_stability_missing_counts_ids_without_both_repeats():
    a = aggregate([review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv"),
                   review_metrics(rec(2, 1), "cv")])
    assert a["stability_missing"] == 1 and a["stability_pairs"] == 1


def test_empty_rate_is_none_and_prints_dash():
    a = aggregate([])
    assert a["answer_rate"] is None and a["stability"] is None and a["below_min_share"] is None
    md = render_report("p", "r", Manifest(seed=1), [], {})
    assert "0.0% (0.0%" not in md and "| Number verification rate (done runs) | – |" in md


def test_pool_stats_and_untranslated_totals_are_pooled_over_done_runs():
    r = rec(1, 1)
    r.result["stats"] = {"found": 40, "with_abstract": 30}
    r.result["quality"]["localize"]["untranslated"] = 2
    a = aggregate([review_metrics(r, "cv"), review_metrics(rec(1, 2, status="error"), "cv")])
    # The mean is over done runs only: the failed run neither adds nor dilutes it.
    assert a["pool_found_mean"] == 40.0 and a["pool_with_abstract_mean"] == 30.0
    assert a["untranslated_total"] == 2


def test_dropped_thai_keys_are_counted_not_scored():
    en = {"executive_summary": "Versus placebo.", "comparison": [], "consensus": [], "conflicts": [],
          "evidence_rationale": "", "research_gaps": ["gap one", "gap two"], "answer": "Yes."}
    th = {**en, "executive_summary": "เทียบกับยาหลอก", "answer": "ใช่", "research_gaps": ["ช่องว่างหนึ่ง"]}
    m = review_metrics(rec(1, 1, en=en, th=th), "cv")
    assert m.thai_keys_dropped == 1
    assert m.thai_share_min > 0.5  # the dropped gap is not scored as a 0 share


def test_report_has_placeholders_and_compare_column():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv")]
    md = render_report("p2", "r", Manifest(seed=1), rows, {"preset": "budget", "models": {}, "git_sha": "s"},
                       compare={"label": "p1", "aggregate": aggregate(rows), "rows": rows})
    assert "รอคำตอบมาตรฐาน (Plan 22b)" in md and "| p1 |" in md and "Glossary consistency" in md


def test_compare_lists_changed_primary_verdict():
    this = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(2, 1), "cv")]
    other = [review_metrics(rec(1, 1, direction="negative"), "cv"), review_metrics(rec(2, 1), "cv")]
    md = render_report("p2", "r", Manifest(seed=1), this, {},
                       compare={"label": "p1", "aggregate": aggregate(other), "rows": other})
    assert "## Primary-outcome verdict changed vs p1" in md
    assert "- CD1: consensus:negative → consensus:positive" in md
    assert "CD2:" not in md.split("## Primary-outcome verdict changed vs p1")[1].split("## By stratum")[0]


def test_stratum_table_has_new_columns():
    md = render_report("p", "r", Manifest(seed=1), [review_metrics(rec(1, 1), "cv")], {})
    assert "| Stratum | Runs | Failed | Verification | Glossary | Answer | Thai share mean | Cost mean |" in md
    assert "| cv | 1 | 0 |" in md


def test_support_rates_count_evidence_citations_of_done_runs():
    r = rec(1, 1)
    cite = lambda label, verified=False, not_evidence=False: {"ref": "P1", "label": label, "verified": verified,
                                                               "not_evidence": not_evidence}
    r.result["support"] = {"judge": "ok", "markers": [["P1"]], "claims": [
        {"id": "s0", "citations": [cite("supported", True), cite("partial"), cite(None)]},
        {"id": "k0", "citations": [cite("unsupported"), cite(None, not_evidence=True)]}]}
    m = review_metrics(r, "cv")
    assert (m.support_citations, m.support_judged, m.support_supported, m.support_verified) == (4, 3, 1, 1)
    a = aggregate([m, review_metrics(rec(1, 2), "cv"), review_metrics(rec(2, 1, status="error"), "cv")])
    assert a["support_rate"][0] == pytest.approx(1 / 3) and a["support_verified_rate"][0] == pytest.approx(1 / 4)
    md = render_report("p", "r", Manifest(seed=1), [m], {})
    assert "| Sentence support: supported / judged citations | 33.3% (" in md
    assert "| Citations with the ตรวจแล้ว badge | 25.0% (" in md
    assert aggregate([review_metrics(rec(1, 2), "cv")])["support_rate"] is None  # results before Plan 25


def test_header_has_date_range_and_batch_cost():
    rows = [review_metrics(rec(1, 1, started="2026-10-09T08:00"), "cv"),
            review_metrics(rec(1, 2, started="2026-10-11T08:00"), "cv")]
    md = render_report("p", "r", Manifest(seed=1), rows, {})
    assert "2026-10-09T08:00 … 2026-10-11T08:00" in md and "batch cost $0.04" in md
