"""Plan 23d: the sources in force reach the API (RuntimeConfig), the workers (runtime_reload), the graph deps, the
search node, paper search and the eval freeze; a running review keeps the set it started with."""
import dataclasses
import json

import httpx

from app.config import Settings
from app.evals.freeze import freeze_engines
from app.graph.factory import build_graph_deps
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import make_enrich, make_search, thaijo_on
from app.graph.schemas import Candidate
from app.harness.quality import summarize_quality
from app.services import llm_store
from app.services.http import HttpClient
from app.services.llm_store import LOADED_KEY, publish_version
from app.services.paper_search import PaperSearch
from app.services.runtime_config import RuntimeConfig, load_runtime
from app.services.searxng import SearxngClient
from app.services.sources import effective_sources
from app.services.sources_store import SOURCES_KEY, SOURCES_KIND
from app.services.thaijo import ThaiJoClient
from app.worker.llm_reload import init_llms, refresh_llms, worker_id
from app.worker.runtime_reload import refresh_runtime
from tests.llm_helpers import MINIMAL
from tests.unit.test_nodes_retrieval import ABSTRACT, FakeEpmc
from tests.unit.test_papers_and_report import Epmc, Searx, hits
from tests.unit.test_runtime_reload import (
    OWNER,
    FakeGraph,
    build_graph_fn,
    make_ctx,
    save,
    save_and_publish,
)
from tests.unit.test_thaijo_search_node import FakeThaiJo, thai

ENV = Settings(_env_file=None)  # THAIJO_ENABLED=false (tests/conftest.py)
ENV_ON = Settings(_env_file=None, thaijo_enabled=True)
NO_OPENAIRE = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj"


class RecordingSearxng:
    """A SearXNG fake that records the engines each call asked for; page 1 has three hits, later pages one."""

    def __init__(self):
        self.calls = []

    async def search(self, query, pageno=1, engines=None):
        self.calls.append((query, pageno, engines))
        n = 3 if pageno == 1 else 1
        return [Candidate(title=f"{query} hit {pageno}.{i} about metformin", doi=f"10.1/{query}.{pageno}.{i}",
                          abstract=ABSTRACT, abstract_source="engine", engines=["pubmed"]) for i in range(n)]


class TrialEpmc(FakeEpmc):
    def __init__(self):
        super().__init__([])
        self.trials = []

    async def search_trials(self, query, page_size=25):
        self.trials.append(query)
        return []


def deps_with(sources, **kw):
    settings = Settings(_env_file=None, searxng_pages=1, searxng_pages_max=2)
    return GraphDeps(settings=settings, searxng=kw.pop("searxng", RecordingSearxng()), europepmc=TrialEpmc(),
                     sources=sources, **kw)


# ---- the API process ------------------------------------------------------------------------------------------------
class Down:
    async def get(self, *_):
        raise ConnectionError("redis down")


def broken_db():
    raise ConnectionError("db down")


async def test_the_api_reads_the_sources_on_a_mirror_hit_a_miss_and_keeps_them_while_both_are_down(session_factory,
                                                                                                 redis):
    rc = RuntimeConfig(ENV, session_factory, redis, ttl=0)
    first = await rc.sources()
    assert first.version is None and first.engines == ENV.searxng_engines
    await save(session_factory, SOURCES_KIND, {"sources": {"openaire": False}})  # in the DB only: a mirror miss
    missed = await rc.sources()
    assert (missed.version, missed.engines) == (1, NO_OPENAIRE)
    await redis.set(SOURCES_KEY, json.dumps({"version": 2, "sources": {"thaijo": True}}))  # a mirror hit
    hit = await rc.sources()
    assert (hit.version, hit.thaijo, hit.engines) == (2, True, ENV.searxng_engines)
    rc.redis, rc.session_factory = Down(), broken_db
    assert await rc.sources() == hit  # the last known set, never an error


async def test_load_runtime_carries_the_saved_sources(session_factory):
    assert (await load_runtime(session_factory, ENV)).sources == effective_sources(ENV, {})
    await save(session_factory, SOURCES_KIND, {"sources": {"openaire": False, "thaijo": True}})
    runtime = await load_runtime(session_factory, ENV)
    assert (runtime.sources.label, runtime.sources.engines, runtime.sources.thaijo) == ("1", NO_OPENAIRE, True)


# ---- the workers ----------------------------------------------------------------------------------------------------
async def worker_ctx(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    deps = dataclasses.replace(ctx["graph_deps"], sources=ctx["sources"])
    ctx.update(graph_deps=deps, graph=FakeGraph(deps, checkpointer="CP"))
    return ctx


async def test_a_sources_change_rebuilds_deps_and_a_running_graph_keeps_its_set(tmp_path, session_factory, redis):
    ctx = await worker_ctx(tmp_path, session_factory, redis)
    assert (ctx["sources_version"], ctx["sources"].version) == ("env", None)
    running = ctx["graph"]
    await save_and_publish(session_factory, redis, SOURCES_KIND, {"sources": {"openaire": False}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["sources_version"] == "1" and ctx["graph_deps"].sources is ctx["sources"]
    assert ctx["graph"].deps.sources.engines == NO_OPENAIRE and ctx["graph"].checkpointer == "CP"
    assert running.deps.sources.engines == ENV.searxng_engines  # the review already running keeps its set
    report = json.loads(await redis.hget(LOADED_KEY, worker_id()))
    assert (report["sources"], report["settings"], report["glossary"]) == ("1", "env", "file")
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False


async def test_a_lost_publish_is_picked_up_by_the_poll(tmp_path, session_factory, redis):
    ctx = await worker_ctx(tmp_path, session_factory, redis)
    await save(session_factory, SOURCES_KIND, {"sources": {"thaijo": True}})  # saved, but Redis never heard of it
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # a job start trusts the mirror
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["graph_deps"].sources.thaijo is True and json.loads(await redis.get(SOURCES_KEY))["version"] == 1


async def test_a_model_reload_keeps_the_sources(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SOURCES_KIND, {"sources": {"openaire": False}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["http"] = HttpClient()
    await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    assert ctx["graph_deps"].sources is ctx["sources"] and ctx["sources"].engines == NO_OPENAIRE
    async with session_factory() as s, s.begin():
        row = await llm_store.save_version(s, OWNER, {**MINIMAL, "active_preset": "better"},
                                           settings=ctx["settings"], base_version=None)
    await publish_version(redis, row.id)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph_deps"].llms.preset == "better" and ctx["graph_deps"].sources is ctx["sources"]
    await ctx["http"].aclose()


# ---- graph deps, the search node, paper search, evals ---------------------------------------------------------------
async def test_graph_deps_carry_the_sources_and_the_thaijo_client_is_built_in_live_mode(redis):
    http = HttpClient()
    live = Settings(_env_file=None, openrouter_api_key="sk-or-x")
    deps = build_graph_deps(live, http, redis)
    assert deps.sources == effective_sources(live, {}) and isinstance(deps.thaijo, ThaiJoClient)
    assert not thaijo_on(deps)  # THAIJO_ENABLED=false: the client exists, the env default keeps it off
    chosen = effective_sources(live, {"thaijo": True}, 4)
    assert thaijo_on(build_graph_deps(live, http, redis, sources=chosen))
    stub = build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http, sources=chosen)
    assert stub.sources is chosen and stub.thaijo is None
    await http.aclose()


async def test_the_search_asks_only_the_enabled_engines_in_search_and_top_up():
    sources = effective_sources(ENV, {"openaire": False}, 1)
    deps = deps_with(sources)
    state = {"plan": {"queries": ["q1", "q2"]}, "options": {"candidate_limit": 120, "max_papers": 30}}
    out = await make_search(deps)(state)
    assert out["quality"][0]["sources"] == list(sources.enabled) and "openaire" not in sources.enabled
    await make_enrich(deps)({**state, "candidates": out["candidates"]})  # 6 candidates < 120: one top-up page
    assert [(q, p) for q, p, _ in deps.searxng.calls] == [("q1", 1), ("q2", 1), ("q1", 2), ("q2", 2)]
    assert {e for _, _, e in deps.searxng.calls} == {NO_OPENAIRE}


async def test_europepmc_off_also_turns_the_rct_search_off():
    meta = {"plan": {"queries": ["q1"]}, "options": {"review_type": "meta_analysis", "max_papers": 30}}
    on = deps_with(effective_sources(ENV, {}, 1))
    assert (await make_search(on)(meta))["quality"][0]["trial_queries"] == 1 and on.europepmc.trials == ["q1"]
    off = deps_with(effective_sources(ENV, {"europepmc": False}, 2))
    out = await make_search(off)(meta)
    assert out["quality"][0]["trial_queries"] == 0 and off.europepmc.trials == []
    assert "europe pmc" not in off.searxng.calls[0][2]


async def test_thaijo_follows_the_sources_not_thaijo_enabled():
    state = {"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}}
    off = FakeThaiJo([thai(1)])
    out = await make_search(deps_with(effective_sources(ENV_ON, {"thaijo": False}, 1), thaijo=off))(state)
    assert off.calls == [] and "thaijo" not in out["quality"][0]
    on = FakeThaiJo([thai(1)])  # THAIJO_ENABLED is false here; the console turned it on
    out = await make_search(deps_with(effective_sources(ENV, {"thaijo": True}, 2), thaijo=on))(state)
    assert on.calls == [(["q1"], 15)] and out["search_stats"]["per_source"]["thaijo"] == 1
    assert out["quality"][0]["sources"][-1] == "thaijo"



def test_result_quality_lists_the_sources_when_the_search_recorded_them():
    assert summarize_quality([{"stage": "search", "sources": ["pubmed", "arxiv"]}], None)["sources"] == ["pubmed",
                                                                                                         "arxiv"]
    assert "sources" not in summarize_quality([{"stage": "search"}], None)


async def test_searxng_and_paper_search_take_the_engines_per_call():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["engines"])
        return httpx.Response(200, json={"results": []})

    http = HttpClient(retries=0, transport=httpx.MockTransport(handler))
    client = SearxngClient(http, "http://searxng.test", ENV.searxng_engines)
    await client.search("q")
    await client.search("q", engines="pubmed,arxiv")
    assert seen == [ENV.searxng_engines, "pubmed,arxiv"]
    await http.aclose()
    searx = Searx(hits())
    await PaperSearch(searx, Epmc()).search("metformin", 5, engines="pubmed")
    await PaperSearch(searx, Epmc()).search("metformin", 5)
    assert searx.engines == ["pubmed", None]


def test_a_frozen_pool_names_the_sources_it_was_searched_with():
    assert freeze_engines(GraphDeps(settings=ENV))[-1] == "openaire"
    deps = GraphDeps(settings=ENV, sources=effective_sources(ENV, {"openaire": False, "thaijo": True}, 3))
    assert freeze_engines(deps) == [*NO_OPENAIRE.split(","), "thaijo"]


async def test_a_stale_saved_document_warns_once_per_version_not_on_every_refresh(session_factory, redis, capsys):
    await redis.set(SOURCES_KEY, json.dumps({"version": 1, "sources": {"not_a_source": True}}))  # stale mirror entry
    rc = RuntimeConfig(ENV, session_factory, redis, ttl=0)  # every call re-reads
    for _ in range(3):
        assert (await rc.sources()).version == 1
    assert capsys.readouterr().out.count("source_unknown") == 1
    await redis.set(SOURCES_KEY, json.dumps({"version": 2, "sources": {"also_gone": True}}))  # a new version warns again
    assert (await rc.sources()).version == 2
    assert capsys.readouterr().out.count("source_unknown") == 1
