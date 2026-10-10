"""Plan 20 Task 6: Vancouver references in the Markdown export (the same rules as the report's `lib/citation.ts`), the
per-paper `design_excluded` flag, and the key findings' certainty stated once for the whole review."""
from types import SimpleNamespace

import pytest

from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import make_finalize
from app.services.report import doi_href, render_markdown, vancouver, vancouver_name
from tests.unit.test_comparison_and_prose import card, outcome, paper
from tests.unit.test_nodes_synthesis import deps, state

FULL = {"ref": "P1", "title": "Metformin and colorectal cancer: a cohort study.",
        "authors": ["Kim JH", "Lee S."], "journal": "Diabetes Care.", "year": 2021,
        "doi": "https://doi.org/10.1000/xyz", "pmid": "12345", "pmcid": "678"}


def test_vancouver_full_record():
    assert vancouver(FULL) == ("Kim JH, Lee S. Metformin and colorectal cancer: a cohort study. Diabetes Care. 2021. "
                               "doi: 10.1000/xyz. PMID: 12345. PMCID: PMC678.")


def test_vancouver_omits_missing_parts():
    assert vancouver({"title": "Only a title"}) == "Only a title."
    assert vancouver({"title": "Does it work?", "year": 2020}) == "Does it work? 2020."
    assert vancouver({"title": "T", "authors": [], "journal": None, "doi": "", "pmid": None}) == "T."


def test_vancouver_lists_six_authors_then_et_al():
    seven = [f"Author{i} A" for i in range(1, 8)]
    assert vancouver({"title": "T", "authors": seven}).startswith(
        "Author1 A, Author2 A, Author3 A, Author4 A, Author5 A, Author6 A, et al. T.")
    assert vancouver({"title": "T", "authors": seven[:6]}).startswith("Author1 A, Author2 A, Author3 A, Author4 A, "
                                                                       "Author5 A, Author6 A. T.")


def test_vancouver_keeps_a_thai_title_as_written():
    assert vancouver({"title": "ผลของเมตฟอร์มินต่อมะเร็งลำไส้ใหญ่", "journal": "วารสารการแพทย์", "year": 2019}) == \
        "ผลของเมตฟอร์มินต่อมะเร็งลำไส้ใหญ่. วารสารการแพทย์. 2019."


# The same table as frontend src/lib/citation.test.ts NAME_CASES: both formatters must agree byte for byte.
NAME_CASES = [
    ("Kim JH", "Kim JH"),
    ("Kim J.H.", "Kim JH"),
    ("van der Berg AB", "van der Berg AB"),
    ("John A. Smith", "Smith JA"),
    ("Smith, John", "Smith J"),
    ("Smith, John Andrew", "Smith JA"),
    ("Smith, J.A.", "Smith JA"),
    ("Ludwig van Beethoven", "van Beethoven L"),
    ("Beethoven, Ludwig van", "van Beethoven L"),
    ("Anna de la Cruz", "de la Cruz A"),
    ("Jean-Pierre Dupont", "Dupont JP"),
    ("Maria Garcia-Lopez", "Garcia-Lopez M"),
    ("Plato", "Plato"),
    ("WHO Collaborative Group 2", "WHO Collaborative Group 2"),
    ("สมชาย ใจดี", "สมชาย ใจดี"),
    ("  ", ""),
]


@pytest.mark.parametrize(("name", "expected"), NAME_CASES)
def test_vancouver_name(name, expected):
    assert vancouver_name(name) == expected


def test_an_author_list_joined_with_semicolons_is_split():
    assert vancouver({"title": "T", "authors": ["Smith J; Doe A", "Roe, Richard"]}) == "Smith J, Doe A, Roe R. T."
    assert vancouver({"title": "T", "authors": ["John A. Smith", "Jane Doe"]}) == "Smith JA, Doe J. T."


def test_doi_links_encode_each_path_segment():
    doi = "10.1002/(SICI)1097-0258(19980430)17:8<857::AID-SIM777>3.0.CO;2-E#x?y%"
    assert doi_href(doi) == ("https://doi.org/10.1002/(SICI)1097-0258(19980430)17%3A8%3C857%3A%3AAID-SIM777%3E3.0.CO"
                             "%3B2-E%23x%3Fy%25")
    r = stub_result("t", "en", "slr")
    r["papers"][0]["doi"] = "10.1/a#b"
    line = next(x for x in render_markdown(_review(r)).splitlines() if x.startswith("- [P1] "))
    assert "doi: [10.1/a#b](https://doi.org/10.1/a%23b)." in line


def test_markdown_notes_a_design_mismatch_paper():
    r = stub_result("t", "en", "slr")
    r["papers"][1]["verification"] = {**(r["papers"][1].get("verification") or {}), "design_mismatch": True}
    line = next(x for x in render_markdown(_review(r)).splitlines() if x.startswith("- [P2] "))
    assert line.endswith("Used as evidence although its design is outside the ticked study types, because fewer "
                         "than 3 studies matched.")


def test_stub_papers_carry_design_excluded():
    assert all(p["design_excluded"] is False for p in stub_result("t", "en", "slr")["papers"])


def _review(result):
    return SimpleNamespace(topic="t", status="done", error=None, result=result)


def test_markdown_references_are_vancouver_with_links_and_related_reports_under_their_primary():
    r = stub_result("t", "en", "slr")
    r["papers"][0] |= {"doi": "10.1000/xyz", "pmid": "12345", "pmcid": "PMC678", "related_reports": ["P2"]}
    r["papers"][1] |= {"related_to": "P1", "related_reason": "same trial (EMPEROR-Preserved)"}
    r["papers"][2] |= {"design_excluded": True}
    md = render_markdown(_review(r))
    assert "## References" in md and "## Papers" not in md
    lines = md.splitlines()
    i = next(n for n, x in enumerate(lines) if x.startswith("- [P1] "))
    p1 = lines[i]
    assert p1.startswith("- [P1] Stub A, Stub B. ")
    assert "doi: [10.1000/xyz](https://doi.org/10.1000/xyz). PMID: [12345](https://pubmed.ncbi.nlm.nih.gov/12345/). " \
           "PMCID: [PMC678](https://pmc.ncbi.nlm.nih.gov/articles/PMC678/)." in p1
    # the further report sits right under its primary, indented, and is not a numbered study of its own
    assert lines[i + 1].startswith("  - Related report [P2] ")
    assert lines[i + 1].endswith("Related report of [P1] (same trial (EMPEROR-Preserved)), not counted again.")
    assert not any(x.startswith("- [P2]") for x in lines)
    p3 = next(x for x in lines if x.startswith("- [P3] "))
    assert "Not used as evidence: read as a design outside the ticked study types." in p3


def test_markdown_states_the_certainty_once_for_the_whole_review():
    r = stub_result("t", "en", "slr")
    level = r["synthesis"]["evidence_strength"]
    md = render_markdown(_review(r))
    block = md[md.index("## Key findings"):md.index("## Summary")]
    assert f"Certainty (whole review, not graded per outcome): {level.replace('_', ' ')}" in block
    assert ", certainty " not in block
    narrative = render_markdown(_review(stub_result("t", "en", "narrative")))
    assert "Certainty (whole review" not in narrative


async def test_finalize_flags_papers_left_out_for_their_design():
    papers = [paper("P1", card([outcome("CRC", "HR", 0.8, 0.7, 0.9)], design="rct")),
              paper("P2", card([outcome("CRC", "HR", 0.7, 0.6, 0.8)], design="cohort"))]
    st = state(papers, language="en", options={"study_types": ["RCT"]})
    final = (await make_finalize(deps())({**st, "topic": "t", "synthesis": None}))["result"]
    assert [p["design_excluded"] for p in final["papers"]] == [False, True]
