import csv
import io
from types import SimpleNamespace

from app.services.report import CSV_FIELDS, render_csv, render_markdown

CELLS = {"outcome": "Pain", "cells": [{"ref": "P1", "finding": "less pain", "direction": "positive"}]}


def review(review_type, strength):
    synthesis = {"executive_summary": "S [P1].", "comparison": [CELLS], "evidence_strength": strength,
                 "evidence_rationale": "Why.", "research_gaps": [],
                 "consensus": [{"statement": "Pain: supports", "refs": ["P1"], "explanation": "e"}], "conflicts": []}
    result = {"review_type": review_type, "summary": "S [P1].", "synthesis": synthesis, "papers": [{
        "ref": "P1", "title": "T", "year": 2020, "card": {
            "study_design": "RCT", "design_category": "rct", "sample_size": 10, "population": "adults",
            "intervention_or_exposure": "drug", "comparator": None, "risk_of_bias": "low",
            "overall_direction": "positive", "key_findings": ["a", "b"], "limitations": ["small"],
            "outcomes": [{"outcome": "Pain", "direction": "positive"}]}}]}
    return SimpleNamespace(topic="t", status="done", error=None, result=result)


def test_markdown_per_type():
    slr = render_markdown(review("slr", "low"))
    assert "Review type" not in slr and "**Evidence strength:** low — Why." in slr
    assert "less pain (supports)" in slr and "## Consensus" in slr
    narr = render_markdown(review("narrative", None))
    assert "Narrative review" in narr and "**Evidence strength:** not assessed (Why.)" in narr
    assert "less pain (supports)" in narr
    sc = render_markdown(review("scoping", None))
    assert "Scoping review" in sc and "not assessed" in sc and "less pain" in sc
    assert "supports" not in sc and "## Consensus" not in sc


def test_legacy_result_without_type_has_no_type_line():
    md = render_markdown(review(None, "low"))
    assert "Review type" not in md and "(supports)" in md


def test_csv_appends_columns_at_the_end_and_joins_lists():
    assert CSV_FIELDS[:18][-1] == "error" and CSV_FIELDS[18:] == [
        "population", "intervention_or_exposure", "comparator", "risk_of_bias", "overall_direction", "key_findings",
        "limitations"]
    rows = list(csv.DictReader(io.StringIO(render_csv(review("slr", "low").result).lstrip("﻿"))))
    assert rows[0]["key_findings"] == "a | b" and rows[0]["risk_of_bias"] == "low" and rows[0]["limitations"] == "small"


def test_stub_cards_quote_their_numbers_and_counts_match():
    from app.graph.nodes.stub_result import stub_result
    for rt, strength in (("slr", "low"), ("narrative", None), ("scoping", None)):
        r = stub_result("t", "en", rt)
        assert r["synthesis"]["evidence_strength"] == strength
        assert (r["synthesis"]["grade_baseline"] is None) == (strength is None)
        for p in r["papers"]:
            c, o = p["card"], p["card"]["outcomes"][0]
            shown = [v for v in (c["sample_size"], o["effect_value"], o["ci_lower"], o["ci_upper"]) if v is not None]
            assert p["verification"]["numbers_total"] == p["verification"]["numbers_verified"] == len(shown)
            if c["sample_size"]:
                assert str(c["sample_size"]) in c["sample_size_quote"]
            if o["effect_value"] is not None:
                assert all(str(v) in o["evidence_quote"] for v in (o["effect_value"], o["ci_lower"], o["ci_upper"]))
