"""Plan 20 Task 6: Vancouver references in the Markdown export (the same rules as the report's `lib/citation.ts`), the
per-paper `design_excluded` flag, and the key findings' certainty stated once for the whole review."""
from types import SimpleNamespace

from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import make_finalize
from app.services.report import render_markdown, vancouver
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
