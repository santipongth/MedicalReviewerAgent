from app.graph.nodes.stub_result import stub_result
from app.services.report import render_markdown, vancouver
from tests.unit.test_plan20_task6 import FULL, _review

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
BIB = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["2985-1750"],
       "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}
THAI = {"title": "Medication adherence among older adults with hypertension", "authors": ["Somchai Demo"],
        "journal": "Journal of Demo Health Sciences", "year": 2024, "thaijo_url": URL, "bib": BIB}


def test_a_thaijo_reference_has_volume_issue_pages_and_its_page():
    assert vancouver(THAI) == ("Demo S. Medication adherence among older adults with hypertension. Journal of Demo "
                               f"Health Sciences. 2024;17(4):1048-1066. ThaiJO: {URL}.")


def test_partial_bibliographic_fields_are_left_out_never_invented():
    def ref(**bib):
        return vancouver({"title": "T", "year": 2024, "bib": bib})

    assert ref(volume="11", issue="2") == "T. 2024;11(2)."
    assert ref(pages="e265234") == "T. 2024:e265234."
    assert vancouver({"title": "T", "bib": {"volume": "11", "pages": "45-58"}}) == "T. 11:45-58."
    assert vancouver({"title": "T", "year": 2024, "bib": None}) == "T. 2024."


def test_other_papers_keep_their_reference():
    assert vancouver({**FULL, "bib": None, "thaijo_url": None}) == vancouver(FULL)


def test_a_page_outside_thaijo_is_never_linked():
    for url in ["https://evil.example/index.php/demo/article/view/1", f"{URL}/555", "javascript:alert(1)"]:
        assert "ThaiJO" not in vancouver({**THAI, "thaijo_url": url})


def test_markdown_links_the_thaijo_page():
    r = stub_result("t", "en", "slr")
    r["papers"][0] |= {"thaijo_url": URL, "bib": BIB, "doi": None, "pmid": None, "pmcid": None}
    p1 = next(x for x in render_markdown(_review(r)).splitlines() if x.startswith("- [P1] "))
    assert f"ThaiJO: [{URL}]({URL})." in p1 and ";17(4):1048-1066." in p1
