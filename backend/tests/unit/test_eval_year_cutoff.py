from app.graph.nodes.retrieval import _filter_pool
from app.graph.schemas import Candidate
from app.schemas.review import ReviewOptions

ABSTRACT = "Results: " + "x " * 120


def cand(i, year):
    return Candidate(title=f"Paper {i}", abstract=ABSTRACT, abstract_source="europepmc", year=year, doi=f"10.1/{i}")


def test_year_to_drops_later_papers_and_keeps_unknown_years():
    pool, counts = _filter_pool([cand(1, 2019), cand(2, 2023), cand(3, 2024), cand(4, None)],
                                ReviewOptions(), [], year_to=2023)
    assert [c.title for c in pool] == ["Paper 1", "Paper 2", "Paper 4"]
    assert counts["after_cutoff"] == 1


def test_no_year_to_keeps_everything():
    pool, counts = _filter_pool([cand(1, 2030)], ReviewOptions(), [])
    assert len(pool) == 1 and counts["after_cutoff"] == 0
