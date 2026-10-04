import json
from pathlib import Path

from app.services.quality import looks_like_fulltext
from app.services.sections import clean_markdown, extract_markdown_sections, pdf_markdown_text

FIX = Path(__file__).parent.parent / "fixtures"
MDPI_TITLE = "Dual Metabolic Targeting of Cancer: Lessons from Metformin and 2-Deoxy-D-Glucose"
FRONTIERS_TITLE = "Metformin and Colorectal Cancer"


def markdown(name: str) -> str:
    data = json.loads((FIX / f"crawl4ai_{name}.json").read_text(encoding="utf-8"))
    md = data["body"]["results"][0]["markdown"]
    return md["raw_markdown"] or md["fit_markdown"] or ""


def test_markdown_sections_from_mdpi_article():
    text = extract_markdown_sections(markdown("mdpi_html"), max_chars=60_000)
    for heading in ("## Abstract", "## Methods", "## Results", "## Discussion", "## Conclusions"):
        assert heading in text
    assert "## Introduction" not in text and "Simple Summary" not in text
    assert "Trypan Blue" in text  # nested 2.3.1 subsection kept inside Methods
    assert "](http" not in text  # links flattened
    assert len(text) <= 60_000
    assert text.index("## Methods") < text.index("## Results") < text.index("## Discussion")


def test_markdown_sections_none_when_no_known_headings():
    assert extract_markdown_sections("# Title\n\nJust a page\n\n## Contact\nmail", max_chars=1000) is None


def test_clean_markdown_flattens_links_and_images():
    assert clean_markdown("See ![fig](a.png) [the trial](https://x.org/t)  now") == "See the trial now"


def test_pdf_markdown_drops_references_and_caps():
    text = pdf_markdown_text(markdown("frontiers_pdf"), max_chars=60_000)
    assert "CONCLUSION" in text and "REFERENCES" not in text
    assert len(pdf_markdown_text(markdown("frontiers_pdf"), max_chars=500)) <= 502


def test_quality_gate_accepts_articles_and_rejects_consent_page():
    assert looks_like_fulltext(markdown("mdpi_html"), MDPI_TITLE, pdf=False)
    assert looks_like_fulltext(markdown("frontiers_pdf"), FRONTIERS_TITLE, pdf=True)  # review: intro+conclusion
    assert not looks_like_fulltext(markdown("wiley_consent"), "Metformin and cardiovascular outcomes in diabetes", pdf=False)


def test_quality_gate_rejects_short_text_and_wrong_article():
    body = "Introduction ... Methods ... Results ... Discussion ... " * 80
    assert not looks_like_fulltext("Methods Results short", "Anything", pdf=False)
    assert not looks_like_fulltext(body, "Completely unrelated quantum chromodynamics lattice", pdf=False)
    assert looks_like_fulltext(body + " metformin colorectal", "Metformin colorectal", pdf=False)
    assert not looks_like_fulltext("Manage Preferences " * 400, "Metformin", pdf=False)  # 'preferences' ≠ 'references'
