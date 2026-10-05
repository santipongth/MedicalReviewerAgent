import csv
import io
import uuid

from app.db.repositories import ReviewRepository
from app.services.report import render_csv

CARD = {"study_design": "nested case-control", "design_category": "case_control", "sample_size": None,
        "outcomes": [{"outcome": "CRC incidence", "direction": "positive", "effect_measure": "HR", "effect_value": 0.8,
                      "ci_lower": 0.71, "ci_upper": 0.9, "p_value": None, "evidence_quote": "HR 0.80 (0.71-0.90)"},
                     {"outcome": "CRC mortality", "direction": "null", "effect_measure": "none", "effect_value": None,
                      "ci_lower": None, "ci_upper": None, "p_value": None, "evidence_quote": "no difference"}]}
RESULT = {"papers": [
    {"ref": "P1", "title": "A, \"quoted\" title", "year": 2020, "journal": "Gut", "doi": "10.1/a", "card": {**CARD, "population": "ผู้ใหญ่"},
     "card_en": CARD},
    {"ref": "P2", "title": "Failed one", "card": None, "card_en": None, "error": "extraction failed"}]}


def test_csv_has_one_row_per_paper_outcome_and_leaves_unverified_values_empty():
    rows = list(csv.DictReader(io.StringIO(render_csv(RESULT).lstrip("\ufeff"))))
    assert [(r["ref"], r["outcome"]) for r in rows] == [("P1", "CRC incidence"), ("P1", "CRC mortality"), ("P2", "")]
    assert rows[0]["effect_value"] == "0.8" and rows[0]["design_category"] == "case_control"
    assert rows[1]["effect_value"] == "" and rows[0]["sample_size"] == ""  # blanked, never guessed
    assert rows[0]["title"] == 'A, "quoted" title' and rows[2]["error"] == "extraction failed"


async def test_export_endpoint_formats_and_states(client, session_factory):
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        done = await repo.create(topic="metformin", language="en", options={}, cache_key="e1")
        await repo.update(done.id, status="done", result={**RESULT, "summary": "S [P1]."})
        running = await repo.create(topic="statins", language="en", options={}, cache_key="e2")
    short = str(done.id)[:8]
    md = await client.get(f"/api/v1/reviews/{done.id}/export", params={"format": "md"})
    assert md.status_code == 200 and md.headers["content-type"].startswith("text/markdown")
    assert f'filename="review-{short}.md"' in md.headers["content-disposition"]
    c = await client.get(f"/api/v1/reviews/{done.id}/export", params={"format": "csv"})
    assert c.headers["content-type"].startswith("text/csv") and "CRC incidence" in c.text
    j = await client.get(f"/api/v1/reviews/{done.id}/export", params={"format": "json"})
    assert j.json()["result"]["summary"] == "S [P1]." and j.json()["review_id"] == str(done.id)
    assert (await client.get(f"/api/v1/reviews/{running.id}/export")).status_code == 409
    assert (await client.get(f"/api/v1/reviews/{uuid.uuid4()}/export")).status_code == 404
    assert (await client.get(f"/api/v1/reviews/{done.id}/export", params={"format": "pdf"})).status_code == 422


def test_csv_cells_cannot_become_spreadsheet_formulas():
    hostile = {"papers": [{"ref": "P1", "title": "=HYPERLINK(\"http://x\")", "card_en": {
        "study_design": "@SUM(A1)", "design_category": "rct", "sample_size": 10, "outcomes": [
            {"outcome": "+cmd", "direction": "negative", "effect_measure": "MD", "effect_value": -1.5, "ci_lower": -2.0,
             "ci_upper": -1.0, "p_value": None, "evidence_quote": "-2 points"}]}}]}
    rows = list(csv.DictReader(io.StringIO(render_csv(hostile).lstrip("\ufeff"))))
    assert rows[0]["title"].startswith("'=") and rows[0]["study_design"].startswith("'@")
    assert rows[0]["outcome"] == "'+cmd" and rows[0]["evidence_quote"] == "'-2 points"
    assert rows[0]["effect_value"] == "-1.5" and rows[0]["ci_lower"] == "-2.0"  # real numbers stay numbers
