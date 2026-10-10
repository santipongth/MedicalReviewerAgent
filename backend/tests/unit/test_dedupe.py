from app.graph.schemas import Candidate
from app.services.dedupe import merge_candidates


def test_merges_by_shared_identifiers_transitively():
    a = Candidate(title="Metformin and CRC risk", doi="10.1/a", engines=["pubmed"])
    b = Candidate(title="Metformin & CRC risk.", pmid="99", doi="10.1/a", engines=["openalex"])
    c = Candidate(title="Totally different words here", pmid="99", pmcid="PMC9", engines=["europepmc"])
    out = merge_candidates([a, b, c])
    assert len(out) == 1
    m = out[0]
    assert (m.doi, m.pmid, m.pmcid) == ("10.1/a", "99", "PMC9")
    assert m.engines == ["europepmc", "openalex", "pubmed"]
    assert m.key == "doi:10.1/a"


def test_earlier_input_wins_scalars_and_longest_abstract_wins():
    epmc = Candidate(title="Official Title", doi="10.1/x", journal="Lancet", abstract="short", is_open_access=True)
    sx = Candidate(title="searx title", doi="10.1/x", journal="LANCET", abstract="a much longer abstract text")
    m = merge_candidates([epmc, sx])[0]
    assert m.title == "Official Title" and m.journal == "Lancet"
    assert m.abstract == "a much longer abstract text" and m.is_open_access is True


def test_fuzzy_title_match_requires_compatible_years():
    a = Candidate(title="Metformin use and colorectal cancer incidence: a cohort study", year=2020)
    b = Candidate(title="Metformin use and colorectal cancer incidence - a cohort study", year=2020, arxiv_id="2001.1")
    c = Candidate(title="Metformin use and colorectal cancer incidence: a cohort study", year=2015, doi="10.9/old")
    out = merge_candidates([a, b, c])
    assert len(out) == 2
    assert {o.year for o in out} == {2020, 2015}


def test_distinct_papers_stay_distinct_and_order_is_stable():
    xs = [Candidate(title=f"Paper number {i} about topic {i * 7}") for i in range(5)]
    out = merge_candidates(xs)
    assert [o.title for o in out] == [x.title for x in xs]


def test_titles_differing_only_in_numbers_stay_distinct():
    out = merge_candidates([Candidate(title="Paper 1 on metformin outcomes"),
                            Candidate(title="Paper 11 on metformin outcomes"),
                            Candidate(title="Metformin trial part 2 results in adults")])
    assert len(out) == 3


def test_empty_input():
    assert merge_candidates([]) == []


def test_a_real_abstract_beats_a_longer_search_snippet():
    epmc = Candidate(title="Official Title", doi="10.1/x", abstract="Background: the real abstract.",
                     abstract_source="europepmc")
    sx = Candidate(title="searx title", doi="10.1/x", abstract="a much longer search snippet that was cut off …",
                   abstract_source="snippet")
    m = merge_candidates([sx, epmc])[0]
    assert m.abstract == "Background: the real abstract." and m.abstract_source == "europepmc"


def test_a_europepmc_abstract_beats_a_longer_engine_abstract():
    epmc = Candidate(title="Official Title", doi="10.1/y", abstract="Background: curated abstract.",
                     abstract_source="europepmc")
    eng = Candidate(title="Official Title", doi="10.1/y", abstract="Background: " + "much longer text " * 30,
                    abstract_source="engine")
    for order in ([eng, epmc], [epmc, eng]):
        m = merge_candidates(order)[0]
        assert m.abstract == "Background: curated abstract." and m.abstract_source == "europepmc"
