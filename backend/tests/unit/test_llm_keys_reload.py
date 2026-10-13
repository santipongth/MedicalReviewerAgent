"""Plan 23e Task 5: workers follow the keys revision. A key change rebuilds the LLMs on the same config, label and
semaphore at the next job or poll; a ring that cannot be read keeps the old LLMs and is reported; the result cache key
does not move."""
import asyncio
from dataclasses import dataclass

from cryptography.fernet import Fernet
from pydantic import SecretStr

from app.config import Settings
from app.graph.graph import GraphDeps
from app.harness.glossary import SEED_GLOSSARY
from app.services.llm_keys import cipher, clear_key, store_key
from app.services.llm_store import (
    KEYS_VERSION_KEY,
    loaded_workers,
    publish_keys_version,
    reconcile_keys_version,
)
from app.services.runtime_config import Runtime
from app.services.sources import effective_sources
from app.worker import llm_reload, tasks
from app.worker.llm_reload import init_llms, refresh_llms
from app.worker.runtime_reload import _rebuild
from tests.admin_helpers import admin_headers
from tests.llm_helpers import MINIMAL, write_yaml

SECRET = Fernet.generate_key().decode()
KEY = "sk-test-0000000000000000abcd"
NEW_KEY = "sk-test-1111111111111111efgh"
ENV_KEY = "sk-or-env-000000000000wxyz"
OPENROUTER = "https://openrouter.ai"


@dataclass
class FakeGraph:
    deps: GraphDeps
    checkpointer: object = None


def build_graph_fn(deps, checkpointer=None):
    return FakeGraph(deps, checkpointer)


async def offline():
    raise OSError("offline")


async def started(tmp_path, session_factory, redis, monkeypatch, mode="real", secret=SECRET) -> dict:
    """A worker after init_llms, on llm.yaml (MINIMAL) with env key ENV_KEY."""
    monkeypatch.setattr(llm_reload, "load_live_catalog", offline)
    settings = Settings(_env_file=None, openrouter_api_key=ENV_KEY, graph_mode=mode, llm_keys_secret=SecretStr(secret),
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    ctx = {"settings": settings, "session_factory": session_factory, "events_redis": redis, "http": object()}
    await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    return ctx


async def put_key(session_factory, key=KEY, provider="openrouter", origin=OPENROUTER) -> int:
    async with session_factory() as s, s.begin():
        row, _ = await store_key(s, cipher(Settings(_env_file=None, llm_keys_secret=SECRET)), provider, origin, key,
                                 by="owner")
    return row.revision


def key_of(ctx) -> str:
    return ctx["graph_deps"].llms.guard.inner._key


async def test_startup_builds_with_the_stored_key_and_reports_the_revision(tmp_path, session_factory, redis,
                                                                         monkeypatch):
    await put_key(session_factory)
    ctx = await started(tmp_path, session_factory, redis, monkeypatch)
    assert key_of(ctx) == KEY and ctx["llm_keys_version"] == "1" and ctx["llm_keys_error"] is None
    [report] = await loaded_workers(redis)
    assert (report["keys"], report["keys_error"]) == ("1", None)


async def test_a_key_change_rebuilds_on_the_same_config_label_and_semaphore(tmp_path, session_factory, redis,
                                                                           monkeypatch):
    ctx = await started(tmp_path, session_factory, redis, monkeypatch)
    assert key_of(ctx) == ENV_KEY and ctx["llm_keys_version"] == "none"
    old_graph, old_llms, sem = ctx["graph"], ctx["graph_deps"].llms, ctx["llm_sem"]
    await publish_keys_version(redis, await put_key(session_factory))
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True  # a job start: one MGET
    llms = ctx["graph_deps"].llms
    assert key_of(ctx) == KEY and llms.config_version == old_llms.config_version == "file"
    assert llms.guard.sem is sem and ctx["llm_version"] == "file" and ctx["graph"].checkpointer == "CP"
    assert old_graph.deps.llms.guard.inner._key == ENV_KEY  # a review already running keeps its key
    assert (await loaded_workers(redis))[0]["keys"] == "1"
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False  # nothing new


async def test_a_lost_publish_is_found_by_the_poll_and_delete_falls_back_to_env(tmp_path, session_factory, redis,
                                                                               monkeypatch):
    ctx = await started(tmp_path, session_factory, redis, monkeypatch)
    await put_key(session_factory)  # committed, never published
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False  # a job start only trusts Redis
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert key_of(ctx) == KEY and await redis.get(KEYS_VERSION_KEY) == "1"
    async with session_factory() as s, s.begin():
        await clear_key(s, "openrouter", by="owner")
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert key_of(ctx) == ENV_KEY and ctx["llm_keys_version"] == "2"


async def test_a_ring_that_cannot_be_read_keeps_the_old_llms_and_is_reported(tmp_path, session_factory, redis,
                                                                            monkeypatch):
    ctx = await started(tmp_path, session_factory, redis, monkeypatch)
    graph = ctx["graph"]
    await publish_keys_version(redis, await put_key(session_factory))

    async def broken(*_a, **_k):
        raise ConnectionError("db went away")

    monkeypatch.setattr(llm_reload, "load_keyring", broken)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is graph and key_of(ctx) == ENV_KEY
    [report] = await loaded_workers(redis)
    assert report["keys"] == "none" and "could not read the provider keys: db went away" in report["keys_error"]
    monkeypatch.undo()
    monkeypatch.setattr(llm_reload, "load_live_catalog", offline)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True and key_of(ctx) == KEY


async def test_keys_this_worker_cannot_decrypt_are_reported_and_env_is_used(tmp_path, session_factory, redis,
                                                                          monkeypatch):
    await put_key(session_factory)
    ctx = await started(tmp_path, session_factory, redis, monkeypatch, secret="")
    assert key_of(ctx) == ENV_KEY
    [report] = await loaded_workers(redis)
    assert report["keys_error"] == "no_secret: stored keys cannot be read for openrouter"
    assert KEY not in str(report)


async def test_stub_mode_records_the_keys_revision_without_building(tmp_path, session_factory, redis, monkeypatch):
    ctx = await started(tmp_path, session_factory, redis, monkeypatch, mode="stub")
    await publish_keys_version(redis, await put_key(session_factory))
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph_deps"].llms is None and ctx["llm_keys_version"] == "1"


async def test_a_concurrency_change_rebuilds_with_the_ring(tmp_path, session_factory, redis, monkeypatch):
    await put_key(session_factory)
    ctx = await started(tmp_path, session_factory, redis, monkeypatch)
    wider = ctx["settings"].model_copy(update={"llm_concurrency": ctx["llm_sem_size"] + 4})
    runtime = Runtime(wider, "1", SEED_GLOSSARY, effective_sources(wider, {}))
    deps, _graph, sem, size = _rebuild(ctx, runtime, build_graph_fn)
    assert size == ctx["llm_sem_size"] + 4 and deps.llms.guard.sem is sem and deps.llms.guard.inner._key == KEY


async def test_the_keys_mirror_is_raised_pulled_back_and_cleared_like_the_config_id(session_factory, redis):
    assert await reconcile_keys_version(redis, session_factory) is None and await redis.get(KEYS_VERSION_KEY) is None
    await redis.set(KEYS_VERSION_KEY, "9")
    assert await reconcile_keys_version(redis, session_factory) is None and await redis.get(KEYS_VERSION_KEY) is None
    await put_key(session_factory)
    await put_key(session_factory)
    assert await reconcile_keys_version(redis, session_factory) == 2 and await redis.get(KEYS_VERSION_KEY) == "2"
    await redis.set(KEYS_VERSION_KEY, "7")
    assert await reconcile_keys_version(redis, session_factory) == 2 and await redis.get(KEYS_VERSION_KEY) == "2"
    assert await publish_keys_version(redis, 1) is True and await redis.get(KEYS_VERSION_KEY) == "2"  # raise only


async def test_a_key_write_does_not_move_the_result_cache_key(app, client, session_factory, redis, monkeypatch):
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(SECRET))
    body = {"topic": "metformin and colorectal cancer", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=body)).json()
    h = await admin_headers(client, session_factory)
    assert (await client.put("/api/v1/admin/llm-keys/openrouter", json={"key": KEY}, headers=h)).status_code == 200
    again = (await client.post("/api/v1/reviews", json=body)).json()
    assert again["cached"] is True and again["review_id"] == first["review_id"]
    ctx = {"llm_lock": asyncio.Lock(), "settings": app.state.deps.service.settings,
           "base_settings": app.state.deps.service.settings, "llm_version": "file", "glossary_version": "file",
           "sources": effective_sources(app.state.deps.service.settings, {})}
    before = tasks.run_version(ctx)
    ctx["llm_keys_version"] = "1"
    assert tasks.run_version(ctx) == before  # the worker's version string has no keys part either
