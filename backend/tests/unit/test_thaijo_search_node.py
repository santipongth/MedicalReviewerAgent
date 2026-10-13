import asyncio

import fakeredis.aioredis

from app.config import Settings
from app.evals.freeze import freeze_engines
from app.graph.factory import build_graph_deps, build_thaijo
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import make_enrich, make_search, thaijo_cap, thaijo_errors
from app.graph.schemas import Candidate
from app.harness.quality import summarize_quality
from app.schemas.review import ReviewOptions
from app.services.http import HttpClient
from app.services.thaijo import ThaiJoClient
from tests.unit.test_nodes_retrieval import ABSTRACT, FakeEpmc, FakeSearxng

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/{}"


def thai(i: int) -> Candidate:
    return Candidate(title=f"Thai cohort {i} on metformin adherence in district hospitals", abstract=ABSTRACT,
                     abstract_source="thaijo", url=URL.format(i), thaijo_url=URL.format(i), engines=["thaijo"])


class FakeThaiJo:
    def __init__(self, cands=(), *, fail=None, slow=False, stats=None):
        self.cands, self.fail, self.slow, self.stats, self.calls = list(cands), fail, slow, stats or {}, []

    async def collect(self, queries, *, limit, out, stats):
        self.calls.append((list(queries), limit))
        stats.update({"hits": len(self.cands), "detailed": len(self.cands), **self.stats})
        for c in self.cands[:limit]:
            out.append(c)
            if self.slow:
                await asyncio.sleep(5)
        if self.fail:
            raise self.fail


def _deps(thaijo=None, **kw):
    settings = Settings(_env_file=None, searxng_pages=1, thaijo_timeout_seconds=kw.pop("timeout", 12.0))
    hits = {"q1": [Candidate(title=f"Search hit {i} about metformin", doi=f"10.1/{i}", abstract=ABSTRACT,
                             abstract_source="engine", engines=["pubmed"]) for i in range(3)]}
    return GraphDeps(settings=settings, searxng=FakeSearxng(hits), europepmc=FakeEpmc([]), thaijo=thaijo, **kw)


STATE = {"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}}


def test_the_share_cap_is_at_most_15_and_an_eighth_of_the_pool():
    s = Settings(_env_file=None)
    caps = [thaijo_cap(s, ReviewOptions(candidate_limit=n, max_papers=5)) for n in (120, 60, 40, 20)]
    assert caps == [15, 7, 5, 2]
    assert thaijo_cap(Settings(_env_file=None, thaijo_max_candidates=0), ReviewOptions()) == 0


async def test_thaijo_hits_join_the_round_robin_and_count_as_their_own_source():
    fake = FakeThaiJo([thai(1), thai(2)])
    out = await make_search(_deps(fake))(STATE)
    titles = [c["title"] for c in out["candidates"]]
    assert titles[:2] == ["Search hit 0 about metformin", "Thai cohort 1 on metformin adherence in district hospitals"]
    assert len(titles) == 5 and out["errors"] == []
    assert out["search_stats"]["per_source"] == {"pubmed": 3, "thaijo": 2}
    assert fake.calls == [(["q1"], 15)]
    entry = out["quality"][0]["thaijo"]
    assert entry["cap"] == 15 and entry["kept"] == 2 and entry["hits"] == 2 and "seconds" in entry


async def test_the_cap_follows_the_pool_size():
    fake = FakeThaiJo([thai(i) for i in range(20)])
    out = await make_search(_deps(fake))({**STATE, "options": {"candidate_limit": 40, "max_papers": 10}})
    assert fake.calls[0][1] == 5 and out["search_stats"]["per_source"]["thaijo"] == 5


async def test_a_failing_thaijo_never_fails_the_search():
    out = await make_search(_deps(FakeThaiJo(fail=RuntimeError("down"))))(STATE)
    assert len(out["candidates"]) == 3 and "thaijo" not in out["search_stats"]["per_source"]
    assert out["errors"] == ["ThaiJO search failed: RuntimeError"]
    assert out["quality"][0]["thaijo"]["failed"] == "RuntimeError"


async def test_a_slow_thaijo_is_cut_at_its_timeout_and_keeps_what_arrived():
    out = await make_search(_deps(FakeThaiJo([thai(1), thai(2)], slow=True), timeout=0.2))(STATE)
    assert [c["thaijo_url"] for c in out["candidates"] if c["thaijo_url"]] == [URL.format(1)]
    assert out["errors"] == ["ThaiJO search timed out after 0.2 s; kept 1 candidate(s)"]
    assert out["quality"][0]["thaijo"]["timed_out"] is True


def test_lost_requests_are_reported():
    entry = {"kept": 3, "search_failed": 1, "detail_failed": 2}
    assert thaijo_errors(entry, 12.0) == ["ThaiJO: 1 search(es) and 2 abstract lookup(s) failed"]
    assert thaijo_errors({"kept": 0}, 12.0) == []


async def test_without_thaijo_nothing_changes():
    out = await make_search(_deps())(STATE)
    assert "thaijo" not in out["quality"][0] and out["search_stats"]["per_source"] == {"pubmed": 3}


async def test_enrich_keeps_thaijo_candidates_with_their_link():
    found = (await make_search(_deps(FakeThaiJo([thai(1)])))(STATE))["candidates"]
    out = await make_enrich(_deps())({"candidates": found, "options": STATE["options"]})
    kept = [c for c in out["candidates"] if c["thaijo_url"]]
    assert [c["abstract_source"] for c in kept] == ["thaijo"] and kept[0]["pdf_url"] is None


def test_the_client_is_built_whatever_thaijo_enabled_says():
    http = HttpClient()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    # Plan 23d: construction does no I/O; the sources in force decide whether it is asked (test_sources_propagation.py)
    assert isinstance(build_thaijo(Settings(_env_file=None), http, redis), ThaiJoClient)
    client = build_thaijo(Settings(_env_file=None, thaijo_enabled=True, thaijo_request_timeout_seconds=4.0), http, redis)
    assert isinstance(client, ThaiJoClient) and client.cache is redis and client.timeout == 4.0
    assert client.base_url == "https://www.tci-thaijo.org/api/v1" and client.cache_ttl == 604800
    on = Settings(_env_file=None, thaijo_enabled=True, graph_mode="stub")
    assert build_graph_deps(on, http).thaijo is None  # the stub graph never searches


def test_quality_reports_the_thaijo_block_and_the_metadata_step():
    entries = [{"stage": "search", "thaijo": {"hits": 9, "kept": 4, "cap": 15}},
               {"stage": "thaijo_metadata", "asked": 3, "found": 2, "failed": 1}]
    got = summarize_quality(entries, None)["thaijo"]
    assert got == {"hits": 9, "kept": 4, "cap": 15,
                   "metadata": {"asked": 3, "found": 2, "failed": 1, "timed_out": False}}
    assert "thaijo" not in summarize_quality([{"stage": "search"}], None)


def test_a_frozen_pool_names_thaijo_when_it_was_searched():
    assert "thaijo" not in freeze_engines(GraphDeps(settings=Settings(_env_file=None)))
    assert freeze_engines(GraphDeps(settings=Settings(_env_file=None, thaijo_enabled=True)))[-1] == "thaijo"


async def test_turning_thaijo_on_starts_a_new_cache_generation(client, app):
    body = {"topic": "metformin adherence in older adults", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=body)).json()
    assert (await client.post("/api/v1/reviews", json=body)).json()["review_id"] == first["review_id"]
    app.state.deps.service.settings.thaijo_enabled = True
    again = (await client.post("/api/v1/reviews", json=body)).json()
    assert again["review_id"] != first["review_id"]


class BlockingSearxng(FakeSearxng):
    async def search(self, q, pageno=1):
        await asyncio.sleep(30)


class WatchedThaiJo(FakeThaiJo):
    cancelled = False

    async def collect(self, queries, *, limit, out, stats):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.cancelled = True
            raise


async def test_cancelling_the_search_cancels_the_thaijo_task():
    fake = WatchedThaiJo()
    deps = _deps(fake)
    deps.searxng = BlockingSearxng({})
    task = asyncio.ensure_future(make_search(deps)(STATE))
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert task.cancelled() and fake.cancelled


async def test_the_result_is_trimmed_to_the_cap_even_if_collect_overshoots():
    class Greedy(FakeThaiJo):
        async def collect(self, queries, *, limit, out, stats):
            out.extend(self.cands)

    out = await make_search(_deps(Greedy([thai(i) for i in range(30)])))(STATE)
    assert out["search_stats"]["per_source"]["thaijo"] == 15
    assert out["quality"][0]["thaijo"]["kept"] == 15
