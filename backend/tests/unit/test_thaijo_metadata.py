import asyncio

from langgraph.types import Send

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.screening import route_to_reading
from app.graph.nodes.thaijo import make_thaijo_metadata, thaijo_papers
from app.graph.schemas import Candidate
from tests.unit.test_review_graph import ABSTRACT, make_deps, run

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/{}"
BIB = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["2985-1750"],
       "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}


class FakeRecords:
    def __init__(self, bibs=None, fail=(), slow=()):
        self.bibs, self.fail, self.slow, self.calls = bibs or {}, set(fail), set(slow), []

    async def record(self, url):
        self.calls.append(url)
        if url in self.fail:
            raise RuntimeError("oai down")
        if url in self.slow:
            await asyncio.sleep(5)
        return self.bibs.get(url)


def _deps(fake, timeout=12.0):
    return GraphDeps(settings=Settings(_env_file=None, thaijo_timeout_seconds=timeout), thaijo=fake)


def _selected(*urls):
    return [{"ref": f"P{i}", "candidate": {"title": "t", "thaijo_url": u}} for i, u in enumerate(urls, 1)]


def test_only_papers_from_thaijo_are_asked():
    sel = _selected(URL.format(1), None, URL.format(3))
    assert thaijo_papers(sel) == [{"ref": "P1", "thaijo_url": URL.format(1)}, {"ref": "P3", "thaijo_url": URL.format(3)}]


def test_the_route_adds_one_metadata_step_only_when_enabled_and_needed():
    state = {"selected": _selected(URL.format(1), None), "options": {}, "topic": "t"}
    sends = route_to_reading(state, thaijo_enabled=lambda: True)
    meta = [s for s in sends if isinstance(s, Send) and s.node == "thaijo_metadata"]
    assert len(meta) == 1 and meta[0].arg == {"papers": [{"ref": "P1", "thaijo_url": URL.format(1)}]}
    assert not [s for s in route_to_reading(state, thaijo_enabled=lambda: False) if s.node == "thaijo_metadata"]
    no_thai = {"selected": _selected(None), "options": {}, "topic": "t"}
    assert not [s for s in route_to_reading(no_thai, thaijo_enabled=lambda: True) if s.node == "thaijo_metadata"]


async def test_the_node_collects_records_and_survives_failures():
    fake = FakeRecords({URL.format(1): BIB}, fail={URL.format(2)})
    papers = thaijo_papers(_selected(URL.format(1), URL.format(2), URL.format(3)))
    out = await make_thaijo_metadata(_deps(fake))({"papers": papers})
    assert out["thaijo_bib"] == {"P1": BIB}
    (entry,) = out["quality"]
    assert (entry["stage"], entry["asked"], entry["found"], entry["failed"]) == ("thaijo_metadata", 3, 1, 1)


async def test_a_slow_journal_server_is_cut_at_the_timeout_and_keeps_what_arrived():
    fake = FakeRecords({URL.format(1): BIB}, slow={URL.format(2)})
    papers = thaijo_papers(_selected(URL.format(1), URL.format(2)))
    out = await make_thaijo_metadata(_deps(fake, timeout=0.2))({"papers": papers})
    assert out["thaijo_bib"] == {"P1": BIB} and out["quality"][0]["timed_out"] is True


class FakeThaiJo(FakeRecords):
    async def collect(self, queries, *, limit, out, stats):
        stats.update({"hits": 1, "detailed": 1})
        out.append(Candidate(title="Thai cohort about metformin and colorectal cancer", abstract=f"Thai. {ABSTRACT}",
                             abstract_source="thaijo", url=URL.format(7), thaijo_url=URL.format(7),
                             engines=["thaijo"]))


async def test_a_review_with_thaijo_links_the_page_and_carries_the_record():
    deps = make_deps()
    deps.thaijo = FakeThaiJo({URL.format(7): BIB})
    values, _ = await run(deps, options={"max_papers": 30, "candidate_limit": 40})
    r = values["result"]
    (thai,) = [p for p in r["papers"] if p["thaijo_url"]]
    assert thai["thaijo_url"] == URL.format(7) and thai["url"] == URL.format(7) and thai["bib"] == BIB
    others = [p for p in r["papers"] if not p["thaijo_url"]]
    assert others and all(p["bib"] is None and p["thaijo_url"] is None for p in others)
    assert r["methods"]["sources"]["thaijo"] == 1
    assert r["quality"]["thaijo"]["metadata"] == {"asked": 1, "found": 1, "failed": 0, "timed_out": False}
    assert deps.thaijo.calls == [URL.format(7)]


async def test_a_review_without_thaijo_has_null_fields_and_no_block():
    values, _ = await run(make_deps())
    r = values["result"]
    assert all(p["thaijo_url"] is None and p["bib"] is None for p in r["papers"])
    assert "thaijo" not in r["quality"] and "thaijo" not in (r["methods"]["sources"] or {})
