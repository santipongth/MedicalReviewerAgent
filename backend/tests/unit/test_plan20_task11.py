"""Plan 20 Task 11: the engine fields the report shows. Review-discordant splits are flagged on the synthesis entries
the client reads (not only on the internal matrix), and the timed stub carries a related report, a review-discordant
conflict and per-finding certainty so manual QA shows them."""
from __future__ import annotations

import re

import pytest

from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import _apply_synthesis_strings, _clusters


def _matrix():
    return {
        "consensus": [
            {"outcome": "HF hospitalisation", "direction": "positive", "refs": ["P1", "P2"]},
            {"outcome": "Mortality", "direction": "null", "refs": ["P1", "P3"], "review_discordant": True,
             "discordant_reviews": ["P5"]},
        ],
        "conflicts": [
            {"outcome": "Renal outcome", "refs": ["P2", "P4"], "directions": {"positive": ["P2"], "negative": ["P4"]}},
            {"outcome": "CRC incidence", "refs": ["P3", "P5"], "review_discordant": True,
             "directions": {"positive": ["P5"], "null": ["P3"]}},
        ],
    }


def test_clusters_carry_the_review_discordant_flag():
    consensus, conflicts = _clusters(_matrix(), [])
    assert [c.review_discordant for c in consensus] == [False, True]
    assert [c.review_discordant for c in conflicts] == [False, True]
    assert conflicts[1].statement == "CRC incidence: systematic reviews and primary studies disagree"


def test_localized_synthesis_keeps_the_flag():
    consensus, conflicts = _clusters(_matrix(), [])
    s = {"executive_summary": "x", "evidence_rationale": "y", "research_gaps": [], "comparison": [],
         "consensus": [c.model_dump() for c in consensus], "conflicts": [c.model_dump() for c in conflicts]}
    out = _apply_synthesis_strings(s, {"conflicts.1.statement": "ไทย"}, {})
    assert out["conflicts"][1]["review_discordant"] is True and out["conflicts"][1]["statement"] == "ไทย"
    assert out["consensus"][1]["review_discordant"] is True


@pytest.mark.parametrize("review_type", ["slr", "meta_analysis", "narrative"])
def test_stub_has_one_related_report(review_type):
    r = stub_result("t", "en", review_type)
    papers = {p["ref"]: p for p in r["papers"]}
    related = [p for p in r["papers"] if p.get("related_to")]
    assert len(related) == 1 and r["stats"]["related_reports"] == 1
    rel = related[0]
    assert rel["related_to"] == "P1" and rel["related_reason"].startswith("same trial (")
    assert papers["P1"]["related_reports"] == [rel["ref"]]
    assert all(p["related_reports"] == [] for p in r["papers"] if p["ref"] != "P1")
    # the related report is no evidence: never in the comparison, consensus, conflicts or key findings
    s = r["synthesis"]
    assert rel["ref"] not in {c["ref"] for row in s["comparison"] for c in row["cells"]}
    assert all(rel["ref"] not in c["refs"] for c in [*s["consensus"], *s["conflicts"], *s["key_findings"]])
    assert r["stats"]["selected"] == len(r["papers"]) == r["stats"]["extracted"]
    if review_type == "meta_analysis":
        assert all(rel["ref"] not in [x["ref"] for x in pool["studies"]] for pool in r["meta_analysis"]["pools"])


def test_stub_scoping_links_no_reports():
    r = stub_result("t", "en", "scoping")
    assert r["stats"]["related_reports"] == 0
    assert all(p.get("related_to") is None and p["related_reports"] == [] for p in r["papers"])


@pytest.mark.parametrize("review_type", ["slr", "meta_analysis"])
def test_stub_has_a_review_discordant_conflict(review_type):
    s = stub_result("t", "en", review_type)["synthesis"]
    flagged = [c for c in s["conflicts"] if c.get("review_discordant")]
    assert len(flagged) == 1 and flagged[0]["statement"].endswith("systematic reviews and primary studies disagree")
    assert all(c.get("review_discordant") is False for c in s["conflicts"] if c is not flagged[0])


@pytest.mark.parametrize("review_type", ["slr", "meta_analysis", "narrative"])
def test_stub_safety_finding_agrees_with_its_discordant_conflict(review_type):  # fix round 1, finding 6
    r = stub_result("t", "en", review_type)
    s = r["synthesis"]
    safety = next(f for f in s["key_findings"] if f["outcome"] == "Safety outcome")
    assert "systematic review" in safety["statement"] and not re.search(r"\d", safety["statement"])
    if review_type in ("slr", "meta_analysis"):  # the stub's quality matches the lead clause it shows
        assert r["quality"]["prose_check"]["key_findings_certainty_lead"] == 1
    else:
        assert "prose_check" not in r["quality"]


@pytest.mark.parametrize("review_type", ["slr", "meta_analysis", "narrative", "scoping"])
def test_stub_key_findings_carry_certainty(review_type):
    s = stub_result("t", "en", review_type)["synthesis"]
    expected = s["evidence_strength"] if review_type in ("slr", "meta_analysis") else None
    assert all("certainty" in f and f["certainty"] == expected for f in s["key_findings"])
    if review_type in ("slr", "meta_analysis"):  # the engine's fixed lead clause at low / very low certainty
        lead = {"low": "Low-certainty evidence suggests: ", "very_low": "Very low-certainty evidence: "}
        assert s["key_findings"][0]["statement"].startswith(lead[s["evidence_strength"]])
