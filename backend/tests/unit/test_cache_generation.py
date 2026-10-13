"""Plan 30: a review is cached under the configuration the worker ran, not the one the API saw at admission."""
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.graph.graph import GraphDeps, build_graph
from app.schemas.review import compute_cache_key
from app.services.events import EventSink
from app.services.llm_store import publish_version
from app.services.pipeline_version import finished_cache_key, pipeline_version
from app.services.sources import ActiveSources, effective_sources
from app.worker import tasks
from app.worker.runner import ReviewRunner

BODY = {"topic": "metformin and colorectal cancer", "language": "en"}


def worker_ctx(settings: Settings, *, llm: str = "file", glossary: str = "file") -> dict:
    """What a reloading worker holds after startup (only the fields run_version reads)."""
    return {"llm_lock": asyncio.Lock(), "settings": settings, "base_settings": settings, "llm_version": llm,
            "glossary_version": glossary, "sources": effective_sources(settings, {})}


async def row(session_factory, review_id: str):
    async with session_factory() as s:
        return await ReviewRepository(s).get(uuid.UUID(review_id))


async def run_stub(session_factory, redis, review_id: str, version: str | None) -> str:
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    runner = ReviewRunner(session_factory, EventSink(session_factory, redis, 60), graph, pipeline_version=version)
    return await runner.run(uuid.UUID(review_id))


def test_the_version_string_keeps_the_admission_rules():
    base = Settings(_env_file=None, thaijo_enabled=False)
    env = effective_sources(base, {})
    assert pipeline_version("pv", llm=None, glossary="file", sources=env, base=base) == "pv"
    assert pipeline_version("pv", llm="file", glossary="file", sources=env, base=base) == "pv+llmfile"
    assert pipeline_version("pv", llm="7", glossary="3", sources=env, base=base) == "pv+llm7+g3"
    on = Settings(_env_file=None, thaijo_enabled=True)
    assert pipeline_version("pv", llm="7", glossary="file", sources=effective_sources(on, {}), base=on) == "pv+llm7+thaijo"
    off = ActiveSources(version=2, enabled=env.enabled, engines=env.engines, thaijo=False)
    assert pipeline_version("pv", llm="7", glossary="file", sources=off, base=on) == "pv+llm7"


def test_the_finished_key_follows_the_version_that_ran():
    opts = {"max_papers": 5}
    admitted = compute_cache_key("t", "en", opts, "pv+llm1")
    same = finished_cache_key(admitted, "t", "en", opts, "pv+llm1", resumed=False, review_id="r")
    moved = finished_cache_key(admitted, "t", "en", opts, "pv+llm2", resumed=False, review_id="r")
    mixed = finished_cache_key(admitted, "t", "en", opts, "pv+llm2", resumed=True, review_id="r")
    assert same == admitted
    assert moved == compute_cache_key("t", "en", opts, "pv+llm2")
    assert mixed not in (admitted, moved) and len(mixed) == 64  # a resumed run across a save is never reused
    assert finished_cache_key(admitted, "t", "en", opts, None, resumed=True, review_id="r") == admitted
    assert finished_cache_key(admitted, "t", "en", opts, "pv+llm1", resumed=True, review_id="r") == admitted


def test_run_version_names_what_the_worker_loaded_and_is_none_outside_a_worker():
    s = Settings(_env_file=None, thaijo_enabled=False)
    assert tasks.run_version(worker_ctx(s, llm="7", glossary="3")) == f"{s.prompt_version}+llm7+g3"
    assert tasks.run_version({"settings": s}) is None


async def test_the_worker_computes_the_key_the_api_admitted_with(app, client, session_factory, test_settings):
    created = (await client.post("/api/v1/reviews", json=BODY)).json()
    review = await row(session_factory, created["review_id"])
    version = tasks.run_version(worker_ctx(test_settings))
    assert compute_cache_key(review.topic, review.language, review.options, version) == review.cache_key


async def test_a_job_queued_across_a_save_is_cached_under_the_config_that_ran(app, client, session_factory, redis,
                                                                             test_settings):
    first = (await client.post("/api/v1/reviews", json=BODY)).json()  # admitted while llm.yaml is in use
    admitted = (await row(session_factory, first["review_id"])).cache_key
    await publish_version(redis, 7)  # an admin save lands; the worker starts the job on version 7
    version = tasks.run_version(worker_ctx(test_settings, llm="7"))
    assert await run_stub(session_factory, redis, first["review_id"], version) == "done"
    done = await row(session_factory, first["review_id"])
    assert done.result["pipeline_version"] == version
    assert done.cache_key != admitted
    again = (await client.post("/api/v1/reviews", json=BODY)).json()  # asked under version 7: reused
    assert again["cached"] is True and again["review_id"] == first["review_id"]
    async with session_factory() as s:  # under the admission's version it is not there
        assert await ReviewRepository(s).find_reusable(admitted, datetime.now(UTC) - timedelta(days=1)) is None


async def test_a_job_that_ran_on_the_admission_config_keeps_its_key(app, client, session_factory, redis,
                                                                    test_settings):
    first = (await client.post("/api/v1/reviews", json=BODY)).json()
    admitted = (await row(session_factory, first["review_id"])).cache_key
    version = tasks.run_version(worker_ctx(test_settings))
    assert await run_stub(session_factory, redis, first["review_id"], version) == "done"
    done = await row(session_factory, first["review_id"])
    assert done.cache_key == admitted and done.result["pipeline_version"] == version
    again = (await client.post("/api/v1/reviews", json=BODY)).json()
    assert again["cached"] is True and again["review_id"] == first["review_id"]


async def test_a_runner_without_a_version_keeps_the_key_and_adds_nothing(session_factory, redis):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="metformin", language="en", options={"max_papers": 5},
                                                  cache_key="k")
    assert await run_stub(session_factory, redis, str(review.id), None) == "done"
    done = await row(session_factory, str(review.id))
    assert done.cache_key == "k" and "pipeline_version" not in done.result
