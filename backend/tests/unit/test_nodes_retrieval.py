from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import MIN_ABSTRACT_CHARS, make_enrich, make_search
from app.graph.schemas import Candidate

ABSTRACT = ("Background and methods of a cohort study on metformin and colorectal cancer risk in adults with type 2 diabetes, with results, conclusions and the limitations reported by the authors.")


class FakeSearxng:
    def __init__(self, by_query, fail=()):
        self.by_query, self.fail, self.calls = by_query, set(fail), []

    async def search(self, query, pageno=1):
        self.calls.append((query, pageno))
        if query in self.fail:
            raise RuntimeError("searx down")
        return self.by_query.get(query, []) if pageno == 1 else []


class FakeEpmc:
    def __init__(self, records, fail=False):
        self.records, self.fail, self.calls = records, fail, []

    async def lookup(self, *, dois, pmids):
        self.calls.append((sorted(dois), sorted(pmids)))
        if self.fail:
            raise RuntimeError("epmc down")
        return self.records


def _deps(**kw):
    return GraphDeps(settings=Settings(_env_file=None, searxng_pages=2), **kw)


async def test_search_runs_every_query_and_page_and_records_failures():
    sx = FakeSearxng({"q1": [Candidate(title="A paper about metformin", doi="10.1/a")],
                      "q2": [Candidate(title="B paper about metformin", pmid="2")]}, fail={"q3"})
    out = await make_search(_deps(searxng=sx))({"plan": {"queries": ["q1", "q2", "q3"]}})
    assert sorted(sx.calls) == [("q1", 1), ("q1", 2), ("q2", 1), ("q2", 2), ("q3", 1), ("q3", 2)]
    assert [c["doi"] or c["pmid"] for c in out["candidates"]] == ["10.1/a", "2"]
    assert len(out["errors"]) == 2 and "q3" in out["errors"][0]
    stats = out["search_stats"]
    assert stats["found"] == 2 and stats["searched_at"].endswith("+00:00")  # Plan 20 Methods: search date
    # per source, before deduplication; the fake's hits name no engine
    assert stats["per_source"] == {"unknown": 2}


async def test_enrich_merges_epmc_metadata_filters_years_and_caps():
    raw = [
        Candidate(title="Metformin and colorectal cancer cohort", doi="10.1/a", year=2020, engines=["pubmed"]).model_dump(),
        Candidate(title="Metformin and colorectal cancer cohort.", pmid="11", year=2020, engines=["semantic scholar"]).model_dump(),
        Candidate(title="Old metformin study from long ago", doi="10.1/old", year=2001).model_dump(),
        Candidate(title="Undated preprint on metformin and polyps", arxiv_id="2401.00001",
                  abstract=ABSTRACT).model_dump(),
    ]
    epmc = FakeEpmc([Candidate(title="Metformin and colorectal cancer: a cohort", doi="10.1/a", pmid="11",
                               pmcid="PMC5", is_open_access=True, abstract=ABSTRACT, engines=["europepmc"])])
    state = {"candidates": raw, "options": {"year_from": 2010, "candidate_limit": 20, "max_papers": 10}}
    out = await make_enrich(_deps(europepmc=epmc))(state)
    keys = [c["key"] for c in out["candidates"]]
    assert keys == ["doi:10.1/a", "arxiv:2401.00001"]  # merged, old paper filtered, undated kept
    merged = out["candidates"][0]
    assert merged["pmcid"] == "PMC5" and merged["abstract"] == ABSTRACT
    assert merged["title"] == "Metformin and colorectal cancer: a cohort"  # Europe PMC metadata wins
    assert epmc.calls == [(["10.1/a", "10.1/old"], ["11"])]
    assert out["search_stats"] == {"unique": 3, "with_abstract": 2, "non_research": 0, "year_excluded": 1,
                                   "no_abstract": 0}


async def test_enrich_survives_epmc_failure_and_keeps_only_abstract_holders_in_rank_order():
    raw = [Candidate(title=f"Paper {i} on metformin outcomes", doi=f"10.1/{i}",
                     abstract=(ABSTRACT if i % 2 else None)).model_dump() for i in range(30)]
    out = await make_enrich(_deps(europepmc=FakeEpmc([], fail=True)))(
        {"candidates": raw, "options": {"candidate_limit": 20, "max_papers": 10}})
    assert [c["doi"] for c in out["candidates"]] == [f"10.1/{i}" for i in range(1, 30, 2)]
    assert out["search_stats"]["with_abstract"] == 15
    assert out["errors"] and "Europe PMC" in out["errors"][0]


async def test_enrich_drops_missing_and_short_abstracts():
    raw = [Candidate(title="No abstract paper on metformin", doi="10.1/none").model_dump(),
           Candidate(title="Short abstract paper on metformin", doi="10.1/short", abstract="x" * 80).model_dump(),
           Candidate(title="Long abstract paper on metformin", doi="10.1/long", abstract="y" * 400).model_dump()]
    out = await make_enrich(_deps(europepmc=FakeEpmc([])))({"candidates": raw, "options": {}})
    assert [c["doi"] for c in out["candidates"]] == ["10.1/long"]
    assert out["search_stats"]["with_abstract"] == 1 and MIN_ABSTRACT_CHARS == 150


async def test_enrich_tolerates_options_stored_under_the_old_ranges():
    raw = [Candidate(title=f"Paper {i} on metformin outcomes", doi=f"10.1/{i}", abstract=ABSTRACT).model_dump()
           for i in range(30)]
    out = await make_enrich(_deps(europepmc=FakeEpmc([])))(
        {"candidates": raw, "options": {"max_papers": 3, "candidate_limit": 10}})  # legal before Plan 5
    assert len(out["candidates"]) == 20  # clamped to the new minimum instead of crashing a resumed review


async def test_enrich_does_not_treat_search_snippets_as_abstracts():
    def c(i, text, source):
        return Candidate(title=f"Paper {i} on metformin outcomes", doi=f"10.1/{i}", abstract=text,
                         abstract_source=source).model_dump()
    raw = [c(0, "y" * 400, "snippet"),                      # truncated search snippet: not an abstract
           c(1, "z" * 700 + "…", "snippet"),                # long but visibly cut off
           c(2, "w" * 700 + ".", "snippet"),                # long and complete: usable
           c(3, ABSTRACT, "europepmc"), c(4, ABSTRACT, "arxiv")]
    out = await make_enrich(_deps(europepmc=FakeEpmc([])))({"candidates": raw, "options": {}})
    assert [x["doi"] for x in out["candidates"]] == ["10.1/2", "10.1/3", "10.1/4"]
    assert out["search_stats"]["with_abstract"] == 3 and out["quality"][0]["snippet_only"] == 2


async def test_enrich_drops_editorials_letters_and_retracted_papers_before_screening():
    def c(i, types):
        return Candidate(title=f"Paper {i} on metformin outcomes", doi=f"10.1/{i}", abstract=ABSTRACT,
                         pub_types=types).model_dump()
    raw = [c(0, ["Editorial"]), c(1, ["Letter", "Comment"]), c(2, ["Journal Article", "Retracted Publication"]),
           c(3, ["Journal Article"]), c(4, ["Letter", "Journal Article"]), c(5, [])]
    out = await make_enrich(_deps(europepmc=FakeEpmc([])))({"candidates": raw, "options": {}})
    assert [x["doi"] for x in out["candidates"]] == ["10.1/3", "10.1/4", "10.1/5"]
    assert out["search_stats"]["non_research"] == 3


def test_screening_prompt_excludes_narrative_reviews():
    from app.graph.prompts import SCREEN_SYSTEM
    assert "narrative" in SCREEN_SYSTEM.lower()


async def test_enrich_skips_lookup_for_hits_with_a_europe_pmc_abstract_and_pmcid():
    done = Candidate(title="Already complete", doi="10.1/done", pmid="1", pmcid="PMC1", abstract=ABSTRACT,
                     abstract_source="engine", engines=["europe pmc", "pubmed"], pub_types=["Journal Article"])
    no_pmcid = Candidate(title="Needs a lookup", doi="10.1/todo", pmid="2", abstract=ABSTRACT,
                         abstract_source="engine", engines=["europe pmc"])
    other = Candidate(title="From PubMed only", pmid="3", abstract=ABSTRACT, abstract_source="engine",
                      engines=["pubmed"])
    epmc = FakeEpmc([])
    raw = [c.model_dump() for c in (done, no_pmcid, other)]
    out = await make_enrich(_deps(europepmc=epmc))({"candidates": raw, "options": {}})
    assert epmc.calls == [(["10.1/todo"], ["2", "3"])]
    assert len(out["candidates"]) == 3
    assert out["quality"][0]["looked_up"] == 2 and out["quality"][0]["skipped_lookup"] == 1
