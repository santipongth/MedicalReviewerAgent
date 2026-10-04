import httpx
import pytest

from app.graph.schemas import Candidate
from app.services.paper_search import PaperSearch, SearchUnavailable
from app.services.report import render_markdown
from app.services.review_service import NotFound, Unprocessable

JATS = """<article><front><article-meta><abstract><p>Short abstract.</p></abstract></article-meta></front>
<body><sec><title>Methods</title><p>We enrolled 1,234 adults.</p></sec>
<sec><title>Results</title><p>HR 0.80 (95% CI 0.71-0.90).</p></sec></body></article>"""


class Searx:
    def __init__(self, results=None, fail=False):
        self.results, self.fail, self.queries = results or [], fail, []

    async def search(self, query, pageno=1):
        self.queries.append(query)
        if self.fail:
            raise httpx.ConnectError("down")
        return list(self.results)


class Epmc:
    def __init__(self, fail=False):
        self.fail = fail

    async def lookup(self, *, dois, pmids):
        if self.fail:
            raise httpx.ConnectError("down")
        return [Candidate(title="Metformin and colorectal cancer: cohort", doi="10.1/a", pmcid="PMC123",
                          is_open_access=True, abstract="enriched", engines=["europepmc"])]

    async def fulltext_xml(self, pmcid):
        return JATS if pmcid == "PMC123" else None


def hits():
    return [Candidate(title="Metformin and colorectal cancer cohort", doi="10.1/a", engines=["pubmed"]),
            Candidate(title="Metformin and colorectal cancer cohort.", pmid="9", engines=["semantic scholar"]),
            Candidate(title="Statins and polyps", doi="10.1/b", engines=["openalex"])]


async def test_search_dedupes_enriches_and_caps():
    out = await PaperSearch(Searx(hits()), Epmc()).search("metformin crc", limit=1)
    assert len(out) == 1 and out[0].doi == "10.1/a" and out[0].pmcid == "PMC123"
    survives = await PaperSearch(Searx(hits()), Epmc(fail=True)).search("metformin crc", limit=10)
    assert [c.doi for c in survives] == ["10.1/a", "10.1/b"]


async def test_search_unavailable_and_fulltext_validation():
    with pytest.raises(SearchUnavailable):
        await PaperSearch(Searx(fail=True), Epmc()).search("x", limit=5)
    ps = PaperSearch(Searx(), Epmc())
    ft = await ps.fulltext("PMC123")
    assert ft["source"] == "europepmc" and "## Results" in ft["text"] and "0.80" in ft["text"]
    with pytest.raises(Unprocessable):
        await ps.fulltext("../etc/passwd")
    with pytest.raises(NotFound):
        await ps.fulltext("PMC999")


async def test_rest_paper_endpoints(client, app):
    app.state.deps.papers = PaperSearch(Searx(hits()), Epmc())
    r = await client.get("/api/v1/papers/search", params={"q": "metformin", "limit": 5})
    assert r.status_code == 200 and r.json()[0]["doi"] == "10.1/a"
    assert (await client.get("/api/v1/papers/search", params={"q": ""})).status_code == 422
    assert (await client.get("/api/v1/papers/fulltext/PMC123")).json()["pmcid"] == "PMC123"
    assert (await client.get("/api/v1/papers/fulltext/PMC999")).status_code == 404
    app.state.deps.papers = PaperSearch(Searx(fail=True), Epmc())
    assert (await client.get("/api/v1/papers/search", params={"q": "statins"})).status_code == 502


class FakeReview:
    def __init__(self, result, status="done"):
        self.id, self.topic, self.status, self.result, self.language = "rid", "metformin", status, result, "en"
        self.error = None


RESULT = {
    "summary": "Metformin lowers CRC risk [P1].",
    "question": {"refined_question": "Does metformin reduce CRC?", "interpretation": "i"},
    "synthesis": {"evidence_strength": "low", "evidence_rationale": "observational",
                  "comparison": [{"outcome": "CRC | incidence", "cells": [
                      {"ref": "P1", "finding": "lower", "direction": "positive"}]}],
                  "consensus": [{"statement": "CRC: consistent", "refs": ["P1"], "explanation": "e"}],
                  "conflicts": [{"statement": "CRC: disagree", "refs": ["P1", "P2"], "explanation": "dose",
                                 "likely_reasons": ["dose"]}],
                  "research_gaps": ["RCTs"]},
    "papers": [{"ref": "P1", "title": "A cohort", "year": 2020, "journal": "J", "doi": "10.1/a",
                "card": {"study_design": "cohort", "sample_size": 100}}],
    "quality": {"verification_rate": 1.0, "papers_uncertain": 0},
}


def test_markdown_report_has_table_and_escapes_pipes():
    md = render_markdown(FakeReview(RESULT))
    assert md.startswith("# ") and "Does metformin reduce CRC?" in md
    assert "| CRC \\| incidence |" in md and "[P1]" in md
    assert "https://doi.org/10.1/a" in md and "dose" in md and "RCTs" in md


def test_markdown_for_unfinished_review():
    md = render_markdown(FakeReview(None, status="running"))
    assert "running" in md
