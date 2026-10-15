import pytest

from app.evals import models
from app.evals.freeze import freeze_all
from app.evals.leakage import drop_target
from app.evals.models import Fixture, Manifest, ManifestEntry, Stratum
from app.evals.run import eval_state
from app.graph.schemas import Candidate
from tests.unit.test_review_graph import ABSTRACT, make_deps


def test_drop_target_removes_versions_and_pmid_keeps_others():
    cands = [{"doi": "10.1002/14651858.CD000001.pub2"}, {"doi": "10.1002/14651858.CD000001.pub3"},
             {"doi": "10.1/x", "pmid": "42"}, {"doi": "10.1002/14651858.CD000002.pub1"}, {"doi": None}]
    kept, n = drop_target(cands, "CD000001", "42")
    assert n == 3 and [c["doi"] for c in kept] == ["10.1002/14651858.CD000002.pub1", None]
    kept, n = drop_target(cands, "CD000001", "")  # empty pmid never matches
    assert n == 2 and len(kept) == 3


@pytest.mark.asyncio
async def test_freeze_removes_target_from_pool(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    results = [Candidate(title=f"Paper {i} about metformin and colorectal cancer", doi=f"10.1/{i}",
                         abstract=f"Paper {i}. {ABSTRACT}", engines=["pubmed"]) for i in range(5)]
    results.append(Candidate(title="Metformin for colorectal cancer prevention", doi="10.1002/14651858.CD000001.pub2",
                             abstract=f"Cochrane. {ABSTRACT}", engines=["pubmed"]))
    m = Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[
        ManifestEntry(id="CD000001", stratum="cv", title="t", question="metformin and colorectal cancer",
                      year_to=2023, checked_by_owner=True)])
    [fx] = await freeze_all(make_deps(results=results), m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    assert fx.search_stats["target_removed"] == 1
    assert fx.candidates and not any("CD000001" in (c.get("doi") or "") for c in fx.candidates)


def test_eval_state_drops_target_again():
    fx = Fixture(id="CD000001", pool_version="v1", frozen_at="t", git_sha="s", prompt_version="p", engines=[],
                 year_to=2023, pmid="42", topic="t", english_topic=None, question=None, plan=None,
                 candidates=[{"doi": "10.1002/14651858.CD000001.pub3"}, {"pmid": "42"}, {"doi": "10.1/ok"}],
                 search_stats={}, status="ok")
    assert eval_state(fx, {})["candidates"] == [{"doi": "10.1/ok"}]


def test_a_titled_copy_without_doi_or_pmid_is_dropped():
    cands = [{"title": "Statins for X: a Cochrane review", "doi": "", "pmid": ""},
             {"title": "Statins for X", "doi": "", "pmid": ""}, {"title": "Another title", "doi": "", "pmid": ""}]
    kept, n = drop_target(cands, "CD000001", "", title="Statins for X")
    assert n == 1 and [c["title"] for c in kept] == ["Statins for X: a Cochrane review", "Another title"]
    assert drop_target(cands, "CD000001", "")[1] == 0  # no title given: as before
