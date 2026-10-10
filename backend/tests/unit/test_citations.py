import asyncio

import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.citations import make_fetch_citations
from app.graph.nodes.stub_result import stub_result
from app.harness.citations import build_citations, paper_idents
from app.services.europepmc import EpmcReference
from app.services.openalex import OpenAlexWork
from tests.unit.test_review_graph import make_deps, run

W = lambda n, refs=(), cites=None: OpenAlexWork(f"https://openalex.org/W{n}", list(refs), cites, 2020)
IDENTS = {
    "P1": {"doi": "10.1/a", "pmid": "1", "pmcid": None},
    "P2": {"doi": "10.1/b", "pmid": "2", "pmcid": None},
    "P3": {"doi": None, "pmid": "3", "pmcid": None},
}


def test_builder_maps_openalex_ids_dedupes_and_drops_self_loops_and_outsiders():
    oa = {"P1": W(1, ["https://openalex.org/W2", "https://openalex.org/W2", "https://openalex.org/W1",
                      "https://openalex.org/W999"], 12),
          "P2": W(2, [], 5), "P3": None}
    out = build_citations(IDENTS, oa, {})
    assert out["edges"] == [{"from": "P1", "to": "P2"}]
    assert out["cited_by"] == {"P1": 12, "P2": 5, "P3": None}
    assert out["coverage"] == {"P1": "openalex", "P2": None, "P3": None}  # empty refs + no epmc = no data


def test_builder_falls_back_to_europepmc_by_pmid_or_doi():
    oa = {"P1": W(1, ["https://openalex.org/W3"], 1), "P2": W(2, []), "P3": None}
    epmc = {"P2": [EpmcReference("MED", "1", pmid="1"), EpmcReference("AGR", "x", doi="10.1/zzz"),
                   EpmcReference("MED", "2", pmid="2")],
            "P3": [EpmcReference("PPR", "q", doi="10.1/a"), EpmcReference("MED", "1", pmid="1")]}
    out = build_citations(IDENTS, oa, epmc)
    assert out["coverage"] == {"P1": "openalex", "P2": "europepmc", "P3": "europepmc"}
    assert out["edges"] == [{"from": "P2", "to": "P1"}, {"from": "P3", "to": "P1"}]  # P1->W3 is outside the review
    assert "Europe PMC" in out["source_note"]


def test_paper_idents_normalizes_doi():
    got = paper_idents([{"ref": "P1", "candidate": {"doi": "https://doi.org/10.1/A", "pmid": "7"}}])
    assert got == {"P1": {"doi": "10.1/a", "pmid": "7", "pmcid": None}}


class FakeOA:
    def __init__(self, works=None, fail=False):
        self.works, self.fail, self.calls = works or {}, fail, []

    async def works_by_ids(self, dois, pmids):
        self.calls.append((dois, pmids))
        if self.fail:
            raise RuntimeError("openalex down")
        return self.works


class FakeEpmcRefs:
    def __init__(self, refs=None, fail=False):
        self.refs, self.fail, self.calls = refs or {}, fail, []

    async def references(self, source, id):
        self.calls.append((source, id))
        if self.fail:
            raise RuntimeError("epmc down")
        return self.refs.get(id, [])


def _deps(oa, epmc, timeout=20.0):
    return GraphDeps(settings=Settings(_env_file=None, citations_timeout_seconds=timeout), openalex=oa, europepmc=epmc)


PAYLOAD = {"papers": [{"ref": r, "candidate": {"doi": i["doi"], "pmid": i["pmid"]}} for r, i in IDENTS.items()]}


async def test_node_success_uses_only_openalex_when_it_has_references():
    oa = FakeOA({"doi:10.1/a": W(1, ["https://openalex.org/W2"], 9), "doi:10.1/b": W(2, ["https://openalex.org/W1"], 3),
                 "pmid:3": W(3, ["https://openalex.org/W1"], 0)})
    epmc = FakeEpmcRefs()
    out = (await make_fetch_citations(_deps(oa, epmc))(PAYLOAD))["citations"]
    assert {(e["from"], e["to"]) for e in out["edges"]} == {("P1", "P2"), ("P2", "P1"), ("P3", "P1")}
    assert set(out["coverage"].values()) == {"openalex"} and epmc.calls == []
    assert len(oa.calls) == 1 and oa.calls[0] == (["10.1/a", "10.1/b"], ["1", "2", "3"])


async def test_node_openalex_down_falls_back_to_europepmc():
    epmc = FakeEpmcRefs({"1": [EpmcReference("MED", "2", pmid="2")], "2": [], "3": [EpmcReference("MED", "1", pmid="1")]})
    out = (await make_fetch_citations(_deps(FakeOA(fail=True), epmc))(PAYLOAD))["citations"]
    assert out["coverage"] == {"P1": "europepmc", "P2": None, "P3": "europepmc"}
    assert {(e["from"], e["to"]) for e in out["edges"]} == {("P1", "P2"), ("P3", "P1")}
    assert out["cited_by"] == {"P1": None, "P2": None, "P3": None}
    assert sorted(epmc.calls) == [("MED", "1"), ("MED", "2"), ("MED", "3")]


async def test_node_both_down_soft_fails_without_raising():
    out = (await make_fetch_citations(_deps(FakeOA(fail=True), FakeEpmcRefs(fail=True)))(PAYLOAD))["citations"]
    assert out["edges"] == [] and set(out["coverage"].values()) == {None}
    assert "unavailable" in out["source_note"]


async def test_node_timeout_soft_fails():
    class Slow(FakeOA):
        async def works_by_ids(self, dois, pmids):
            await asyncio.sleep(5)

    out = (await make_fetch_citations(_deps(Slow(), FakeEpmcRefs(), timeout=0.05))(PAYLOAD))["citations"]
    assert set(out["coverage"].values()) == {None} and "unavailable" in out["source_note"]


async def test_graph_runs_citation_branch_and_result_carries_citations():
    deps = make_deps()

    class AllWorks:
        async def works_by_ids(self, dois, pmids):
            n = {d: i for i, d in enumerate(sorted(dois))}
            return {f"doi:{d}": W(100 + i, [f"https://openalex.org/W{100 + (i + 1) % len(n)}"], i)
                    for d, i in n.items()}

    deps.openalex = AllWorks()
    values, events = await run(deps)
    c = values["result"]["citations"]
    refs = [p["ref"] for p in values["result"]["papers"]]
    assert set(c["coverage"]) == set(refs) and set(c["coverage"].values()) == {"openalex"}
    assert c["edges"] and all(e["from"] != e["to"] and e["from"] in refs and e["to"] in refs for e in c["edges"])
    ev = [e for e in events if e.get("type") == "citations_fetched"]
    assert ev == [{"type": "citations_fetched", "edges": len(c["edges"]), "covered": len(refs), "total": len(refs)}]


async def test_graph_without_openalex_has_no_citation_step():
    values, events = await run(make_deps())
    assert values["result"]["citations"] is None
    assert not [e for e in events if e.get("type") == "citations_fetched"]


@pytest.mark.parametrize("review_type", ["slr", "narrative", "scoping"])
def test_stub_result_carries_small_citations_block(review_type):
    c = stub_result("t", "en", review_type)["citations"]
    refs = {f"P{i}" for i in range(1, 7)}
    assert set(c["coverage"]) == refs == set(c["cited_by"])
    assert c["edges"] and all(e["from"] in refs and e["to"] in refs and e["from"] != e["to"] for e in c["edges"])
    assert c["coverage"]["P6"] is None and c["cited_by"]["P6"] is None
