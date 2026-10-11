import pytest

from app.evals.metrics import aggregate, review_metrics, wilson
from app.evals.models import Manifest, PrimaryMatch, RunRecord
from app.evals.report import render_report


def rec(i, repeat, status="done", direction="positive", th=None, en=None, verified=(3, 4)):
    result = None
    if status == "done":
        en = en or {"executive_summary": "Versus placebo the hazard ratio was 0.80 [P1].", "comparison": [],
                    "consensus": [], "conflicts": [], "evidence_rationale": "", "research_gaps": [], "answer": "Yes."}
        th = th or {**en, "executive_summary": "เทียบกับยาหลอก อัตราส่วนอันตราย 0.80 [P1]", "answer": "ใช่"}
        result = {"synthesis_en": en, "synthesis": th, "papers": [{}, {}],
                  "quality": {"numbers_verified": verified[0], "numbers_total": verified[1],
                              "localize": {"untranslated": 0, "numbers_rejected": 1, "citations_rejected": 0}}}
    return RunRecord(id=f"CD{i}", repeat=repeat, run_id="r", prompt_version="p", git_sha="s", preset="budget",
                     models={}, started_at="t", elapsed_s=10.0, cost_usd=0.02, status=status,
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


def test_aggregate_keeps_failures_in_denominators_and_pairs_stability():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv"),
            review_metrics(rec(2, 1), "cv"), review_metrics(rec(2, 2, direction="negative"), "cv"),
            review_metrics(rec(3, 1, status="error"), "cv"), review_metrics(rec(3, 2, status="error"), "cv")]
    a = aggregate(rows)
    assert a["n_runs"] == 6 and a["n_failed"] == 2
    assert a["answer_rate"][0] == pytest.approx(4 / 6)
    assert a["stability_pairs"] == 3 and a["stability"][0] == pytest.approx(2 / 3)  # failed pair agrees (none = none)
    assert a["glossary_top_misses"][0][0] == "hazard ratio"


def test_report_has_placeholders_and_compare_column():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv")]
    md = render_report("p2", "r", Manifest(seed=1), rows, {"preset": "budget", "models": {}, "git_sha": "s"},
                       compare={"label": "p1", "aggregate": aggregate(rows)})
    assert "รอคำตอบมาตรฐาน (Plan 22b)" in md and "| p1 |" in md and "Glossary consistency" in md
