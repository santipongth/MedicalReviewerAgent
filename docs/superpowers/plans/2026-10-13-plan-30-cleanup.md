# Plan 30: Cleanup After Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the review findings of Plans 22a–27 that are still open, so the service can ship: a finished review is cached under the configuration the worker actually ran; a personal medical refusal never echoes its question; full-review prose checks scope an after-period citation to its own sentence; and a set of small safety, ops, test and UI fixes. No prompt or schema change, no new dependency, no spend.

**Architecture:**
- **Cache generation that ran** (`app/services/pipeline_version.py`): `pipeline_version()` builds the version string for both the API's admission key (`ReviewService._version`) and the worker (`run_version(ctx)` in `app/worker/tasks.py`, read with `ctx["graph"]`). `ReviewRunner` stores `result.pipeline_version` and, on `done`, `finished_cache_key()`: the key of the version that ran, a never-reused key for a resumed run whose version differs, else the admission key.
- **Personal refusals** (`app/services/safety.py` `shown_topic`): `ReviewOut.topic` null, the MCP resource and the Markdown title without it, the `queued` event without it and a replay that strips it; `HarnessResult.refused` makes an escalation model's refusal a `personal_medical` rejection; two verb-led red flags.
- **Prose** (`app/harness/prose.py` `_sentences`): an after-period citation joins its sentence inside the stop; the quick writer's limits sentence drops direct advice (`_ADVICE`).
- **MCP** (`app/mcp/server.py`): `quick_answer` waits hold a per-client Redis slot (`SseSlots`, `waiter_key`).
- **Ops and tests:** stale worker heartbeats pruned after 3 minutes; the search records env-only engines; the sign-in re-read is locked; queue-position ties ordered by id; eval writers clean up `.tmp`.
- **Frontend:** a neutral tab title until the topic check passes (`RunState.guardPassed`); `/r/{id}/report.html` of a quick answer answers 303 to `/r/{id}`; quick page spacing and a missing-paper line; `getReview` reads a null topic as `""`; `RequestSlip` without `initialTopic`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Redis, LangGraph and the project's fake LLMs; Next.js 16, React, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-30-cleanup-design.md`

**Worktree:** `D:\MRA-cleanup` (branch `cleanup-after-27`).
- It is based on master `eae78b5` (Plans 22a through 27 and 23d merged). Its first commit holds the spec, this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-30-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-cleanup/backend` or `cd /d/MRA-cleanup/frontend`.
- The frontend needs `npm ci` once (Task 6).
- **Existing interfaces this plan uses**, checked against master `eae78b5` on 2026-10-13:
  - `ReviewService._version`, `ReviewService.create`, `ReviewService.sse_key`, `ReviewService.effective`, `Identity` (`app/services/review_service.py`); `compute_cache_key`, `ReviewSummary`, `ReviewOut` (`app/schemas/review.py`); `cache_part`, `effective_sources`, `ActiveSources` (`app/services/sources.py`); `refusal_code_of`, `rejection_error`, `red_flag`, `MEDICAL_PATTERNS_EN` (`app/services/safety.py`);
  - `run_review`, `_runner` (`app/worker/tasks.py`); `ReviewRunner.run`, `_finish` (`app/worker/runner.py`); the worker ctx keys `llm_lock`, `llm_version`, `glossary_version`, `sources`, `base_settings`, `settings`, `graph` (`app/worker/llm_reload.py`, `app/worker/runtime_reload.py`); `LOADED_KEY`, `LOADED_MAX_AGE`, `loaded_workers`, `report_loaded` (`app/services/llm_store.py`);
  - `HarnessRunner.call`, `_run_escalation`, `HarnessResult` (`app/harness/runner.py`); `make_topic_guard` (`app/graph/nodes/intake.py`); `_sentences`, `_SENTENCE`, `_REF`, `prose_problems`, `fix_prose`, `statement_problems`, `fix_statement`, `prose_context` (`app/harness/prose.py`); `closing_line`, `_CERTAINTY_TALK`, `_claims_level` (`app/graph/nodes/quick.py`); `make_search` (`app/graph/nodes/retrieval.py`);
  - `render_markdown` (`app/services/report.py`); `review_events` (`app/api/events.py`); `build_mcp`, `quick_answer`, `QUICK_ANSWER_DOC`, `_sleep`, `review_resource` (`app/mcp/server.py`); `SseSlots` (`app/services/sse_slots.py`); `_record_sign_in` (`app/api/admin.py`); `ReviewRepository.queue_position` (`app/db/repositories.py`); `write_json_atomic`, `save_manifest`, `load_gold`, `EVAL_ROOT` (`app/evals/models.py`);
  - test helpers: the `app`, `client`, `redis`, `session_factory`, `test_settings` fixtures (`tests/conftest.py`), `FakeStructuredLLM` (`tests/fakes.py`), `_deps`, `_llms` (`tests/unit/test_nodes_intake.py`), `_parse_sse` (`tests/unit/test_sse.py`), `META_PAPERS`, `ctx` (`tests/unit/test_comparison_and_prose.py`), `ctx` (`tests/unit/test_quick_answer.py`), `QUICK_RESULT` (`tests/unit/test_quick_outputs.py`), `attempt`, `count`, `create_admin` (`tests/unit/test_admin_api_auth.py`), `deps_with` (`tests/unit/test_sources_propagation.py`);
  - frontend `ReviewScreen`, `QuickAnswer` and its `Sentence`, `RequestSlip`, `getReview`, `request`, `reduceRun`, `initialRun`, `RunState`, `STEP_OF`, `FALLBACK_TITLE`, `isPersonalRefusal`, `isQuickReview`, `FormStart`, `RC.quick`, `L`, the report route `GET` (`src/app/r/[id]/report.html/route.ts`), fixtures `reviewFixture`, `quickReviewFixture`.
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** none new, backend or frontend.
- **No spend:** no real LLM call anywhere in this plan, tests included (fake LLMs only). The controller's smoke check calls no model and starts no review.
- **Prompts:** none changes. `prompt_version` stays `2026-10-13.3`; every pin in `tests/unit/test_prompts_by_type.py` holds.
- **Cache keys:** `ReviewService._version` must stay byte-identical for every configuration (it now calls `pipeline_version`); the API's admission flow is unchanged. Only the worker's `done` write may change a row's `cache_key`, and only in the same `UPDATE` that sets `status = "done"`.
- **Exact values:** `LOADED_MAX_AGE = timedelta(minutes=3)`; the MCP wait cap is `sse_max_per_ip` (default 5) per client, keys `mcpwait:key:<api key id>` or `mcpwait:ip:<ReviewService.sse_key(ip)>` under the `SseSlots` prefix `mra:sse:`; the report redirect is `303` with `Location: /r/{id}`; the never-reused key is `compute_cache_key(topic, language, options, f"{version}+resumed:{review_id}")`.
- **Safety precision:** every list in `tests/unit/test_safety_precision.py` stays green (no research title wrongly refused).
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\`. Use the editor tools.
- **Commits:** each message is written with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (the folder is git-ignored) and committed with `git commit -F .superpowers/commit-msg.txt`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known flaky tests:** under host load two heavy vitest cases can pass the 5 s timeout: `src/lib/agent-layout.test.ts` "keeps everything inside the viewBox and nodes apart" (wide and narrow) and `team-stage.test.tsx` "Plan 21 fix round 1: for N = 5, 30 and 50 …". In the pre-flight they timed out in full runs and passed alone; this plan touches neither. If one fails, rerun it alone once and report both results. (`test_capacity.py::test_queue_position` is fixed by Task 5.)
- **Do not touch** `D:\MedicalReviewerAgent` until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`; never touch `D:\MRA-plan-23e`.

## Review Focus

1. **The key a finished review is stored under** (Task 1): `test_a_job_queued_across_a_save_is_cached_under_the_config_that_ran`, `test_the_finished_key_follows_the_version_that_ran` (resumed + differs → never reused), `test_the_worker_computes_the_key_the_api_admitted_with`, `test_the_version_string_keeps_the_admission_rules`.
2. **A personal refusal never echoes its question** (Task 2): `test_rest_returns_no_topic_for_a_personal_refusal_and_keeps_it_otherwise`, `test_mcp_resource_and_markdown_report_leave_the_question_out`, `test_the_queued_event_carries_no_topic_and_a_replay_drops_an_old_one`, `test_the_guard_turns_an_escalation_refusal_into_the_personal_message`; and the tab title (Task 6, "keeps a neutral title while the topic is being checked").
3. **Red flags stay precise** (Task 2): `test_a_swallowed_coin_or_rat_poison_is_an_emergency`, `test_coin_and_rat_poison_research_titles_are_not_refused`, the whole `test_safety_precision.py`.
4. **Prose scope** (Task 3): `test_a_number_is_checked_against_the_paper_cited_after_the_stop`, `test_a_leading_citation_stays_when_the_sentence_before_already_cites`, the advice and research-wording cases; every existing prose, quick and support test unchanged.
5. **Bounded waits and the ops fixes** (Tasks 4, 5): `test_a_client_at_its_wait_cap_gets_the_answer_at_once`, `test_a_wait_takes_one_slot_and_gives_it_back`, `test_a_worker_silent_for_three_minutes_is_not_listed_and_is_removed`, `test_reviews_created_in_one_tick_get_distinct_positions`.

---

### Task 1: The cache bound to the configuration the worker ran

**Files:**
- Create: `backend/app/services/pipeline_version.py`
- Modify: `backend/app/services/review_service.py`
- Modify: `backend/app/worker/tasks.py`
- Modify: `backend/app/worker/runner.py`
- Test (create): `backend/tests/unit/test_cache_generation.py`

**Interfaces:**
- Consumes: `compute_cache_key`, `cache_part`, `effective_sources`, the worker ctx keys.
- Produces:
  - `app/services/pipeline_version.py`: `pipeline_version(prompt_version, *, llm: str | None, glossary: str, sources: ActiveSources, base) -> str` and `finished_cache_key(cache_key, topic, language, options, version: str | None, *, resumed: bool, review_id: str) -> str`.
  - `app/worker/tasks.py`: `run_version(ctx) -> str | None` (None without `llm_lock`); `_runner(ctx)` passes it.
  - `ReviewRunner(..., pipeline_version: str | None = None)`; a `done` result carries `pipeline_version`, and `_finish` writes `cache_key` when it changes.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_cache_generation.py` (complete):

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_cache_generation.py -q`

Expected: collection error `ModuleNotFoundError: No module named 'app.services.pipeline_version'`

- [ ] **Step 3: Implement**

**New file** `backend/app/services/pipeline_version.py` (complete):

```python
"""The result cache's pipeline version (Plan 30): one function for the API, which keys a request with the versions it
sees at admission, and the worker, which records the versions it actually ran. A job queued across an admin save runs
on the newer configuration, so the worker re-keys its result when the two differ."""
from __future__ import annotations

from typing import Any

from app.schemas.review import compute_cache_key
from app.services.sources import ActiveSources, cache_part


def pipeline_version(prompt_version: str, *, llm: str | None, glossary: str, sources: ActiveSources, base) -> str:
    """prompt_version, then `+llm<id>` (the LLM config version, "file" while llm.yaml is in use; left out when unknown),
    `+g<version>` once a glossary version exists, and the sources' part (Plan 24's `+thaijo`, Plan 23d's `+src`).
    `base` is the env settings: cache_part compares the sources in force with env's."""
    version = prompt_version
    if llm is not None:
        version = f"{version}+llm{llm}"
    if glossary != "file":
        version = f"{version}+g{glossary}"
    return version + cache_part(sources, base)


def finished_cache_key(cache_key: str, topic: str, language: str, options: dict[str, Any], version: str | None, *,
                       resumed: bool, review_id: str) -> str:
    """The cache key a finished review is stored under. Unchanged when the run's version is unknown or gives the key the
    review was admitted with. Otherwise the key of the version that ran, so the same question asked under that version
    reuses it and one asked under the admission's version does not. A resumed run whose version differs may hold work
    of two configurations, so it gets a key no request computes: it is never reused."""
    if version is None:
        return cache_key
    ran = compute_cache_key(topic, language, options, version)
    if ran == cache_key:
        return cache_key
    if resumed:
        return compute_cache_key(topic, language, options, f"{version}+resumed:{review_id}")
    return ran
```

**Edit** `backend/app/services/review_service.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.budget import review_cost_cap
from app.services.capacity import AdmissionBusy
from app.services.ratelimits import RateLimits
from app.services.safety import red_flag
from app.services.sources import ActiveSources, cache_part, effective_sources, public_list
from app.services.turnstile import TurnstileUnavailable, verify_turnstile
from app.services.urlsafety import is_public_http_url
```

   with

```python
from app.services.budget import review_cost_cap
from app.services.capacity import AdmissionBusy
from app.services.pipeline_version import pipeline_version
from app.services.ratelimits import RateLimits
from app.services.safety import red_flag
from app.services.sources import ActiveSources, effective_sources, public_list
from app.services.turnstile import TurnstileUnavailable, verify_turnstile
from app.services.urlsafety import is_public_http_url
```

2. Replace

```python
        """The cache key's pipeline version: prompt, LLM config (23b), once one is saved the glossary (23c), and the
        search sources (Plan 24's `+thaijo`; Plan 23d's `+src` fingerprint once a sources version changes the
        SearXNG engines)."""
        version = self.settings.prompt_version
        if self.llm_version is not None:
            version = f"{version}+llm{await self.llm_version()}"
        if self.runtime is not None and (glossary := await self.runtime.glossary_label()) != "file":
            version = f"{version}+g{glossary}"
        # Plan 24: a pool with ThaiJO is a different search; Plan 23d: so is one from another engine set. While no
        # sources version exists this is Plan 24's `+thaijo` rule, so the key is unchanged.
        return version + cache_part(await self.sources(), self.settings)

    async def _reuse(self, cache_key: str, settings: Settings | None = None) -> ReviewCreated | None:
```

   with

```python
        """The cache key's pipeline version: prompt, LLM config (23b), once one is saved the glossary (23c), and the
        search sources (Plan 24's `+thaijo`; Plan 23d's `+src` fingerprint once a sources version changes the
        SearXNG engines). Plan 30: built by `pipeline_version`, which the worker uses for what it actually ran."""
        llm = await self.llm_version() if self.llm_version is not None else None
        glossary = await self.runtime.glossary_label() if self.runtime is not None else "file"
        # Plan 24: a pool with ThaiJO is a different search; Plan 23d: so is one from another engine set. While no
        # sources version exists this is Plan 24's `+thaijo` rule, so the key is unchanged.
        return pipeline_version(self.settings.prompt_version, llm=llm, glossary=glossary,
                                sources=await self.sources(), base=self.settings)

    async def _reuse(self, cache_key: str, settings: Settings | None = None) -> ReviewCreated | None:
```

**Edit** `backend/app/worker/tasks.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.services.urlsafety import is_public_http_url
from app.services.webhook import DeliveryOutcome, deliver, sign
```

   with

```python
from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.services.pipeline_version import pipeline_version
from app.services.sources import effective_sources
from app.services.urlsafety import is_public_http_url
from app.services.webhook import DeliveryOutcome, deliver, sign
```

2. Replace

```python


def _runner(ctx: dict) -> ReviewRunner:
    queue = ctx.get("queue")
    notify = queue.enqueue_webhook if queue is not None else None
    return ReviewRunner(ctx["session_factory"], ctx["event_sink"], ctx["graph"], notify=notify,
                        capacity=ctx.get("capacity"), settings=ctx.get("settings") or get_settings())


async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review (the runner resumes when a checkpoint exists). Saved settings and glossary (Plan 23c),
    then a saved LLM configuration (Plan 23b), are picked up first, so the review runs on the newest of each."""
    if "llm_lock" in ctx:
        await refresh_runtime(ctx)
```

   with

```python


def run_version(ctx: dict) -> str | None:
    """The pipeline version of what this worker runs now (Plan 30): its loaded LLM config, glossary and sources, the
    labels the API reads at admission. None outside a reloading worker (tests, the harness job): the key is kept."""
    if "llm_lock" not in ctx:
        return None
    base = ctx.get("base_settings") or ctx["settings"]
    sources = ctx.get("sources") or effective_sources(base, {})
    return pipeline_version(base.prompt_version, llm=ctx.get("llm_version") or "file",
                            glossary=ctx.get("glossary_version") or "file", sources=sources, base=base)


def _runner(ctx: dict) -> ReviewRunner:
    queue = ctx.get("queue")
    notify = queue.enqueue_webhook if queue is not None else None
    # The graph and the version are read together, with no await between them: the version names that graph.
    return ReviewRunner(ctx["session_factory"], ctx["event_sink"], ctx["graph"], notify=notify,
                        capacity=ctx.get("capacity"), settings=ctx.get("settings") or get_settings(),
                        pipeline_version=run_version(ctx))


async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review (the runner resumes when a checkpoint exists). Saved settings and glossary (Plan 23c),
    then a saved LLM configuration (Plan 23b), are picked up first, so the review runs on the newest of each; the
    result is cached under the version that ran (Plan 30)."""
    if "llm_lock" in ctx:
        await refresh_runtime(ctx)
```

**Edit** `backend/app/worker/runner.py` (5 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.budget import ReviewBudget, review_cost_cap, use_budget
from app.services.events import EventSink
from app.services.safety import refusal_code_of

```

   with

```python
from app.services.budget import ReviewBudget, review_cost_cap, use_budget
from app.services.events import EventSink
from app.services.pipeline_version import finished_cache_key
from app.services.safety import refusal_code_of

```

2. Replace

```python

    def __init__(self, session_factory: async_sessionmaker, event_sink: EventSink, graph, notify=None,
                 capacity=None, settings: Settings | None = None) -> None:
        self.settings = settings  # sizes each review's LLM spend cap from its options (None → uncapped)
        self.capacity = capacity  # app.services.capacity.Capacity: finished reviews count toward the daily spend
```

   with

```python

    def __init__(self, session_factory: async_sessionmaker, event_sink: EventSink, graph, notify=None,
                 capacity=None, settings: Settings | None = None, pipeline_version: str | None = None) -> None:
        self.settings = settings  # sizes each review's LLM spend cap from its options (None → uncapped)
        self.capacity = capacity  # app.services.capacity.Capacity: finished reviews count toward the daily spend
```

3. Replace

```python
        self.graph = graph
        self.notify = notify  # async (review_id) -> None: enqueue the webhook for reviews with a callback_url

    async def _notify(self, review_id: uuid.UUID, has_callback: bool) -> None:
```

   with

```python
        self.graph = graph
        self.notify = notify  # async (review_id) -> None: enqueue the webhook for reviews with a callback_url
        # Plan 30: the version of the configuration this runner's graph was built with (None: keep the admission key)
        self.pipeline_version = pipeline_version

    async def _notify(self, review_id: uuid.UUID, has_callback: bool) -> None:
```

4. Replace

```python
            await repo.update(review_id, status="running", started_at=first_start or now, error=None)
            topic, language, options = review.topic, review.language, dict(review.options or {})
            has_callback = bool(review.callback_url)
        t0 = time.monotonic() - ((now - first_start).total_seconds() if first_start else 0.0)

```

   with

```python
            await repo.update(review_id, status="running", started_at=first_start or now, error=None)
            topic, language, options = review.topic, review.language, dict(review.options or {})
            has_callback, cache_key = bool(review.callback_url), review.cache_key
        t0 = time.monotonic() - ((now - first_start).total_seconds() if first_start else 0.0)

```

5. Replace

```python
            return "rejected"
        result = values.get("result") or {}
        if not await self._finish(review_id, "done", result=result, cost_usd=cost,
                                  prompt_version=result.get("prompt_version"), model_versions=result.get("models")):
            return ReviewStatus.cancelled.value
        await emit("done", {"cost_usd": cost})
```

   with

```python
            return "rejected"
        result = values.get("result") or {}
        keyed = {}
        if self.pipeline_version is not None:  # Plan 30: cached under the version that ran, not the admission's
            result = {**result, "pipeline_version": self.pipeline_version}
            keyed["cache_key"] = finished_cache_key(cache_key, topic, language, options, self.pipeline_version,
                                                    resumed=resume, review_id=str(review_id))
        if not await self._finish(review_id, "done", result=result, cost_usd=cost,
                                  prompt_version=result.get("prompt_version"), model_versions=result.get("models"),
                                  **keyed):
            return ReviewStatus.cancelled.value
        await emit("done", {"cost_usd": cost})
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_cache_generation.py -q`

Expected: 7 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-cleanup/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2596 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(cache): store a finished review under the configuration the worker ran (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add backend/tests/unit/test_cache_generation.py backend/app/services/pipeline_version.py backend/app/services/review_service.py backend/app/worker/tasks.py backend/app/worker/runner.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 2: A personal refusal never echoes its question; an escalation refusal is one; two red flags

**Files:**
- Modify: `backend/app/schemas/review.py`
- Modify: `backend/app/services/safety.py`
- Modify: `backend/app/services/report.py`
- Modify: `backend/app/mcp/server.py`
- Modify: `backend/app/services/review_service.py`
- Modify: `backend/app/api/events.py`
- Modify: `backend/app/harness/runner.py`
- Modify: `backend/app/graph/nodes/intake.py`
- Test (create): `backend/tests/unit/test_personal_refusal_privacy.py`
- Test (modify): `backend/tests/unit/test_safety_precision.py`

**Interfaces:**
- Consumes: `refusal_code_of`, `rejection_error`, `HarnessRunner`, `make_topic_guard`.
- Produces:
  - `ReviewSummary.topic: str | None`; `ReviewOut` sets `topic = None` when `refusal_code == "personal_medical"`.
  - `shown_topic(status, error, topic) -> str | None` (`app/services/safety.py`), used by `render_markdown` (title "# Literature review" without a topic) and the MCP resource `review://{id}`.
  - The API's `queued` event is `{}`; `app/api/events.py` `_data(payload)` drops `topic` from replayed and live payloads.
  - `HarnessResult.refused: bool = False` (True when the escalation model raised `LLMRefusal`); `topic_guard` maps `value is None and refused` to `rejection_error("personal_medical")`.
  - Two entries in `MEDICAL_PATTERNS_EN`: swallowed coin(s), ate/eaten/swallowed/drank/drunk rat/mouse/rodent poison/bait.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_personal_refusal_privacy.py` (complete):

```python
"""Plan 30: a personal medical refusal never echoes its question, an escalation model's refusal is one, and two more
red flags."""
import json
import uuid

import pytest
from fastmcp import Client

from app.db.repositories import EventRepository, ReviewRepository
from app.graph.nodes.intake import make_topic_guard
from app.graph.schemas import TopicVerdict
from app.harness.runner import HarnessRunner
from app.services import safety
from app.services.llm import LLMOutputError, LLMRefusal
from app.services.report import render_markdown
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_intake import _deps, _llms
from tests.unit.test_sse import _parse_sse

QUESTION = "my mother is 80, should she keep taking aspirin"


async def _rejected(session_factory, error: str, topic: str = QUESTION):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic=topic, language="en", options={}, cache_key=f"k-{error[:5]}")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review.id, status="rejected", error=error)
    async with session_factory() as s:
        return await ReviewRepository(s).get(review.id)


async def test_rest_returns_no_topic_for_a_personal_refusal_and_keeps_it_otherwise(client, session_factory):
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    declined = await _rejected(session_factory, "The topic is not a biomedical research question.", topic="pizza")
    got = (await client.get(f"/api/v1/reviews/{personal.id}")).json()
    assert got["topic"] is None and got["refusal_code"] == "personal_medical"
    assert QUESTION not in json.dumps(got)
    assert (await client.get(f"/api/v1/reviews/{declined.id}")).json()["topic"] == "pizza"


async def test_mcp_resource_and_markdown_report_leave_the_question_out(app, session_factory):
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    async with Client(app.state.mcp) as c:
        resource = json.loads((await c.read_resource(f"review://{personal.id}"))[0].text)
        md = (await c.read_resource(f"review://{personal.id}/report.md"))[0].text
    assert resource["topic"] is None and resource["refusal_code"] == "personal_medical"
    assert md.startswith("# Literature review\n") and QUESTION not in md
    declined = await _rejected(session_factory, "Not medical.", topic="best pizza in town")
    assert render_markdown(declined).startswith("# Literature review: best pizza in town")


async def test_the_queued_event_carries_no_topic_and_a_replay_drops_an_old_one(client, session_factory, app):
    created = (await client.post("/api/v1/reviews", json={"topic": "statins and dementia", "language": "en"})).json()
    async with session_factory() as s:
        [queued] = await EventRepository(s).list_since(uuid.UUID(created["review_id"]), 0)
    assert queued.type == "queued" and queued.payload == {}
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    sink = app.state.deps.event_sink
    await sink.emit(personal.id, "queued", {"topic": QUESTION})  # as stored before Plan 30
    await sink.emit(personal.id, "rejected", {"reason": "x", "code": "personal_medical"})
    async with client.stream("GET", f"/api/v1/reviews/{personal.id}/events") as resp:
        body = (await resp.aread()).decode()
    events = _parse_sse(body)
    assert [e["event"] for e in events] == ["queued", "rejected"] and json.loads(events[0]["data"]) == {}
    assert QUESTION not in body


async def test_an_escalation_refusal_is_flagged_by_the_harness():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    refusing = FakeStructuredLLM("big", lambda s, u: LLMRefusal("declined"))
    res = await HarnessRunner(max_repairs=0, escalation=lambda schema: refusing).call(
        broken, "sys", "user", schema=TopicVerdict)
    assert res.value is None and res.refused is True
    failing = FakeStructuredLLM("big", lambda s, u: LLMOutputError("still not JSON"))
    res2 = await HarnessRunner(max_repairs=0, escalation=lambda schema: failing).call(
        broken, "sys", "user", schema=TopicVerdict)
    assert res2.value is None and res2.refused is False


async def test_the_guard_turns_an_escalation_refusal_into_the_personal_message():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    refusing = FakeStructuredLLM("big", lambda s, u: LLMRefusal("declined"))
    llms = _llms(guard=broken)
    llms.escalation = lambda schema: refusing
    out = await make_topic_guard(_deps(llms))({"topic": QUESTION, "language": "en"})
    assert out["rejected"] == safety.rejection_error("personal_medical")
    assert safety.refusal_code_of("rejected", out["rejected"]) == "personal_medical"
    assert "1669" in out["rejected"] and "1323" in out["rejected"] and "aspirin" not in out["rejected"]


async def test_an_escalation_that_only_fails_still_fails_the_review():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    llms = _llms(guard=broken)
    llms.escalation = lambda schema: FakeStructuredLLM("big", lambda s, u: LLMOutputError("not JSON either"))
    with pytest.raises(LLMOutputError):
        await make_topic_guard(_deps(llms))({"topic": "statins", "language": "en"})


@pytest.mark.parametrize("topic", [
    "help my son swallowed a coin", "my kid ate rat poison", "my daughter swallowed 2 coins",
    "dog ate rat bait and my toddler too help", "my husband drank rat poison",
])
def test_a_swallowed_coin_or_rat_poison_is_an_emergency(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical"), topic


@pytest.mark.parametrize("topic", [
    "coin ingestion in children", "swallowed coins in children: endoscopy or observation",
    "rat poison ingestion in children", "children who swallowed a coin", "brodifacoum rat poison exposure",
    "dogs that ate rat poison", "coin battery versus coin ingestion outcomes",
])
def test_coin_and_rat_poison_research_titles_are_not_refused(topic):
    assert safety.red_flag(topic) is None, topic
```

**Edit** `backend/tests/unit/test_safety_precision.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    "is coughing up blood always cancer",
]
# Caught (13/20). Left to the guard: "my mom cnt breathe", "dad having chest pian", "help my son swallowed a coin",
# "grandma face drooping and cant talk", "my kid ate rat poison", "she cut her wrists bleeding alot", "สามีเจบหน้าอก".
RR4_EMERGENCIES = [
    ("my wife just collapsed", "medical"), ("baby turned blue not breathing", "medical"),
```

   with

```python
    "is coughing up blood always cancer",
]
# Caught (13/20; 15/20 since Plan 30, which added the coin and rat-poison patterns). Left to the guard: "my mom cnt
# breathe", "dad having chest pian", "grandma face drooping and cant talk", "she cut her wrists bleeding alot",
# "สามีเจบหน้าอก" (typos and and-framed phrasing: no precise rule without a measured set).
RR4_EMERGENCIES = [
    ("my wife just collapsed", "medical"), ("baby turned blue not breathing", "medical"),
```

2. Replace

```python
    ("หายใจไม่ออก ช่วยด้วย", "medical"), ("เพื่อนชักกระตุก ทำไงดี", "medical"),
    ("แฟนกรีดข้อมือเลือดไม่หยุด", "self_harm"), ("ยายล้มหัวฟาดพื้นไม่รู้สึกตัว", "medical"),
]
# Accepted and parked (flagged through the "someone" anchor): "what to do when someone is choking: public knowledge",
```

   with

```python
    ("หายใจไม่ออก ช่วยด้วย", "medical"), ("เพื่อนชักกระตุก ทำไงดี", "medical"),
    ("แฟนกรีดข้อมือเลือดไม่หยุด", "self_harm"), ("ยายล้มหัวฟาดพื้นไม่รู้สึกตัว", "medical"),
    ("help my son swallowed a coin", "medical"), ("my kid ate rat poison", "medical"),  # Plan 30
]
# Accepted and parked (flagged through the "someone" anchor): "what to do when someone is choking: public knowledge",
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_personal_refusal_privacy.py tests/unit/test_safety_precision.py -q`

Expected: 12 failed, 90 passed (the REST, MCP/Markdown, event, escalation and red-flag tests, and the two moved RR4 emergencies)

- [ ] **Step 3: Implement**

**Edit** `backend/app/schemas/review.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python

    id: uuid.UUID
    topic: str
    language: str
    status: str
```

   with

```python

    id: uuid.UUID
    topic: str | None  # Plan 30: null for a personal medical refusal (the person's own question is never echoed)
    language: str
    status: str
```

2. Replace

```python
            self.verification_rate = verification_rate_of(self.result)
        self.refusal_code = refusal_code_of(self.status, self.error)
        return self

```

   with

```python
            self.verification_rate = verification_rate_of(self.result)
        self.refusal_code = refusal_code_of(self.status, self.error)
        if self.refusal_code == "personal_medical":  # Plan 30: the topic stays out of every answer about it
            self.topic = None
        return self

```

**Edit** `backend/app/services/safety.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    r"took \d+ (?:\w+ ){0,2}?" + _PILLS_EN,
    r"took (?:a |an )?(?:whole |full |entire )?(?:bottle|pack|packet|strip|box) of (?:\w+ ){0,2}?" + _PILLS_EN,
)
MEDICAL_TH = ("เจ็บหน้าอก", "แน่นหน้าอก", "หายใจไม่ออก", "หายใจไม่ทัน", "หายใจลำบาก", "หอบเหนื่อยมาก", "ปากเบี้ยว",
```

   with

```python
    r"took \d+ (?:\w+ ){0,2}?" + _PILLS_EN,
    r"took (?:a |an )?(?:whole |full |entire )?(?:bottle|pack|packet|strip|box) of (?:\w+ ){0,2}?" + _PILLS_EN,
    # Plan 30: two misses of the Plan 26 held-out check; a verb is required, so "coin ingestion" or "rat poison
    # exposure" stay titles, and the anchor or cue rule applies as to every red flag
    r"swallowed (?:a |an |two |some |\d+ )?coins?",
    r"(?:ate|eaten|swallowed|drank|drunk) (?:some )?(?:rat|mouse|rodent) (?:poison|bait)",
)
MEDICAL_TH = ("เจ็บหน้าอก", "แน่นหน้าอก", "หายใจไม่ออก", "หายใจไม่ทัน", "หายใจลำบาก", "หอบเหนื่อยมาก", "ปากเบี้ยว",
```

2. Replace

```python
        return None
    return "personal_medical" if (error or "").startswith("personal_medical: ") else "declined"
```

   with

```python
        return None
    return "personal_medical" if (error or "").startswith("personal_medical: ") else "declined"


def shown_topic(status: str | None, error: str | None, topic: str | None) -> str | None:
    """The topic as answers about a stored review may show it (Plan 30): None for a personal medical refusal, whose
    question is the person's own case and is never echoed (REST, MCP, the Markdown report, the event replay)."""
    return None if refusal_code_of(status, error) == "personal_medical" else topic
```

**Edit** `backend/app/services/report.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.harness.design import NON_QUANTITATIVE_CATEGORIES
from app.harness.meta import DESIGN_GROUP_LABEL
from app.services.thaijo import article_link

```

   with

```python
from app.harness.design import NON_QUANTITATIVE_CATEGORIES
from app.harness.meta import DESIGN_GROUP_LABEL
from app.services.safety import shown_topic
from app.services.thaijo import article_link

```

2. Replace

```python
def render_markdown(review) -> str:
    result = review.result
    out = [f"# Literature review: {review.topic}", ""]
    if not result:
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
```

   with

```python
def render_markdown(review) -> str:
    result = review.result
    topic = shown_topic(review.status, review.error, review.topic)  # Plan 30: never a personal refusal's question
    out = [f"# Literature review: {topic}" if topic else "# Literature review", ""]
    if not result:
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
```

**Edit** `backend/app/mcp/server.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.report import quick_view, render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of

_MIN_PAPERS, _MAX_PAPERS = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
```

   with

```python
from app.services.report import quick_view, render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of, shown_topic

_MIN_PAPERS, _MAX_PAPERS = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
```

2. Replace

```python
    async def review_resource(review_id: str) -> dict[str, Any]:
        r = await review_or_error(review_id)
        return {"review_id": review_id, "topic": r.topic, "status": r.status, "result": r.result, "error": r.error,
                "refusal_code": refusal_code_of(r.status, r.error)}

    @mcp.resource("review://{review_id}/report.md", mime_type="text/markdown",
```

   with

```python
    async def review_resource(review_id: str) -> dict[str, Any]:
        r = await review_or_error(review_id)
        return {"review_id": review_id, "topic": shown_topic(r.status, r.error, r.topic), "status": r.status,
                "result": r.result, "error": r.error, "refusal_code": refusal_code_of(r.status, r.error)}

    @mcp.resource("review://{review_id}/report.md", mime_type="text/markdown",
```

**Edit** `backend/app/services/review_service.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        review_id = outcome
        try:
            await self.event_sink.emit(review_id, "queued", {"topic": req.topic})
            await self.queue.enqueue_review(review_id)
        except Exception as exc:
```

   with

```python
        review_id = outcome
        try:
            await self.event_sink.emit(review_id, "queued", {})  # Plan 30: no topic in the event log
            await self.queue.enqueue_review(review_id)
        except Exception as exc:
```

**Edit** `backend/app/api/events.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python

router = APIRouter()


```

   with

```python

router = APIRouter()


def _data(payload: dict) -> str:
    """An event's JSON, without the `topic` that `queued` events stored before Plan 30: a stream never echoes the
    question (a personal medical refusal's question in particular)."""
    return json.dumps({k: v for k, v in (payload or {}).items() if k != "topic"}, default=str)


```

2. Replace

```python
            for ev in replay:
                last = ev.seq
                yield {"id": str(ev.seq), "event": ev.type, "data": json.dumps(ev.payload, default=str)}
                if ev.type in TERMINAL_EVENT_TYPES:
                    return
```

   with

```python
            for ev in replay:
                last = ev.seq
                yield {"id": str(ev.seq), "event": ev.type, "data": _data(ev.payload)}
                if ev.type in TERMINAL_EVENT_TYPES:
                    return
```

3. Replace

```python
                    "id": str(ev["seq"]),
                    "event": ev["type"],
                    "data": json.dumps(ev["payload"], default=str),
                }
                if ev["type"] in TERMINAL_EVENT_TYPES:
```

   with

```python
                    "id": str(ev["seq"]),
                    "event": ev["type"],
                    "data": _data(ev["payload"]),
                }
                if ev["type"] in TERMINAL_EVENT_TYPES:
```

**Edit** `backend/app/harness/runner.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
    problems: list[str] = field(default_factory=list)
    ok: bool = False


```

   with

```python
    problems: list[str] = field(default_factory=list)
    ok: bool = False
    refused: bool = False  # Plan 30: the escalation model declined (a provider refusal), not a malformed answer


```

2. Replace

```python
                    return escalated
                return HarnessResult(last_value, escalated.cost, escalated.attempts, True, True,
                                     escalated.problems or problems, False)
        return HarnessResult(last_value, cost, attempts, attempts > 1, False, problems, False)

```

   with

```python
                    return escalated
                return HarnessResult(last_value, escalated.cost, escalated.attempts, True, True,
                                     escalated.problems or problems, False, escalated.refused)
        return HarnessResult(last_value, cost, attempts, attempts > 1, False, problems, False)

```

3. Replace

```python
        except LLMError as exc:  # incl. refusal: the caller keeps its own answer and flags it
            return HarnessResult(None, 0.0, 1, False, True, [f"escalation failed: {type(exc).__name__}: {exc}"],
                                 False)
        problems = validate(res.value) if validate else []
        return HarnessResult(res.value, res.cost_usd, 1, False, True, problems, not problems)
```

   with

```python
        except LLMError as exc:  # incl. refusal: the caller keeps its own answer and flags it
            return HarnessResult(None, 0.0, 1, False, True, [f"escalation failed: {type(exc).__name__}: {exc}"],
                                 False, isinstance(exc, LLMRefusal))
        problems = validate(res.value) if validate else []
        return HarnessResult(res.value, res.cost_usd, 1, False, True, problems, not problems)
```

**Edit** `backend/app/graph/nodes/intake.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
            # provider refusals cluster on self-harm/violence text: give the fixed message with 1669 and 1323
            return {"rejected": rejection_error("personal_medical")}
        if res.value is None:
            raise LLMOutputError(f"topic check failed: {'; '.join(res.problems) or 'no valid answer'}")
```

   with

```python
            # provider refusals cluster on self-harm/violence text: give the fixed message with 1669 and 1323
            return {"rejected": rejection_error("personal_medical")}
        if res.value is None and res.refused:  # Plan 30: the escalation model's refusal is a refusal too
            return {"rejected": rejection_error("personal_medical"), "cost_usd": res.cost}
        if res.value is None:
            raise LLMOutputError(f"topic check failed: {'; '.join(res.problems) or 'no valid answer'}")
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_personal_refusal_privacy.py tests/unit/test_safety_precision.py -q`

Expected: 102 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-cleanup/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2616 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(safety): a personal refusal never echoes its question, an escalation refusal is one, coin and rat-poison red flags (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add backend/tests/unit/test_personal_refusal_privacy.py backend/tests/unit/test_safety_precision.py backend/app/schemas/review.py backend/app/services/safety.py backend/app/services/report.py backend/app/mcp/server.py backend/app/services/review_service.py backend/app/api/events.py backend/app/harness/runner.py backend/app/graph/nodes/intake.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 3: An after-period citation is checked against its own sentence; the quick limits sentence gives no advice

**Files:**
- Modify: `backend/app/harness/prose.py`
- Modify: `backend/app/graph/nodes/quick.py`
- Test (create): `backend/tests/unit/test_prose_cite_scope.py`

**Interfaces:**
- Consumes: `_SENTENCE`, `_REF`, `closing_line`.
- Produces: `prose._sentences` with `_LEADING_CITES` and `_CITES_AFTER_STOP` (a citation group after the stop joins the sentence before it, inside the stop, when that sentence cites nothing else or the group stands alone); `quick._ACT`, `quick._ADVICE`, used by `closing_line`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_prose_cite_scope.py` (complete):

```python
"""Plan 30: a citation written after the stop is checked against its own sentence, and the quick answer's limits
sentence never gives a person advice."""
import pytest

from app.graph.nodes.quick import closing_line
from app.graph.nodes.synthesis import ANSWER_CERTAINTY
from app.harness.prose import _sentences, fix_prose, fix_statement, prose_problems
from tests.unit.test_comparison_and_prose import META_PAPERS, ctx
from tests.unit.test_quick_answer import ctx as quick_ctx


def test_a_citation_after_the_stop_joins_its_sentence_inside_the_stop():
    text = "Dapagliflozin lowered worsening heart failure (HR 0.74). [P1] Empagliflozin lowered it too [P2]."
    assert _sentences(text) == ["Dapagliflozin lowered worsening heart failure (HR 0.74) [P1].",
                                "Empagliflozin lowered it too [P2]."]
    assert _sentences("It fell (HR 0.74). [P1]") == ["It fell (HR 0.74) [P1]."]
    assert _sentences("It fell (HR 0.74). [P1] [P2]") == ["It fell (HR 0.74) [P1] [P2]."]


def test_a_leading_citation_stays_when_the_sentence_before_already_cites():
    text = "It fell (HR 0.74) [P1]. [P2] reported a smaller effect."
    assert _sentences(text) == ["It fell (HR 0.74) [P1].", "[P2] reported a smaller effect."]
    # a lone group after a cited sentence still belongs to it (nothing else to attach it to)
    assert _sentences("It fell (HR 0.74) [P1]. [P2]") == ["It fell (HR 0.74) [P1] [P2]."]


def test_a_number_is_checked_against_the_paper_cited_after_the_stop():
    c = ctx(META_PAPERS)
    wrong = "Empagliflozin lowered heart failure hospitalisation (HR 0.74). [P2]"  # 0.74 is P1's, not P2's
    right = "Dapagliflozin lowered worsening heart failure (HR 0.74). [P1]"
    problems = prose_problems(wrong, c, "executive_summary")
    assert len(problems) == 1 and "states 0.74" in problems[0] and "(P2)" in problems[0]
    assert fix_prose(wrong, c) == ("", {"numbers_removed": 1})
    assert prose_problems(right, c, "executive_summary") == []
    assert fix_prose(right, c) == ("Dapagliflozin lowered worsening heart failure (HR 0.74) [P1].", {})


def test_a_numberless_statement_is_scoped_the_same_way():
    c = ctx(META_PAPERS)
    text, counts = fix_statement("Empagliflozin reduced events by 0.74. [P2]", c)
    assert text == "" and counts == {"numbers_removed": 1}


@pytest.mark.parametrize("advice", [
    "Patients should stop taking metformin before surgery.", "Take the drug with food.",
    "Do not stop treatment without asking a doctor.", "You should talk to your doctor first.",
    "Please consult a pharmacist.", "People must not switch brands.", "Don't use it in pregnancy.",
])
def test_a_limits_sentence_that_advises_a_person_is_dropped(advice):
    assert closing_line(advice, quick_ctx(), "low") == ANSWER_CERTAINTY["low"]
    assert closing_line(f"{advice} All studies were observational.", quick_ctx(), "low") == \
        f"{ANSWER_CERTAINTY['low']} All studies were observational."


@pytest.mark.parametrize("limits", [
    "Use of statins was self-reported.", "Never-smokers were excluded from two cohorts.",
    "Patients should be followed up longer in future trials.", "Starting doses varied between studies.",
    "All studies were observational cohorts, so confounding may remain.",
])
def test_research_wording_is_not_advice(limits):
    assert closing_line(limits, quick_ctx(), "low") == f"{ANSWER_CERTAINTY['low']} {limits}"
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_prose_cite_scope.py -q`

Expected: 11 failed, 5 passed (the five research-wording cases already pass)

- [ ] **Step 3: Implement**

**Edit** `backend/app/harness/prose.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


def _sentences(text: str) -> list[str]:
    return _SENTENCE.split(text.strip()) if text and text.strip() else []


```

   with

```python


_LEADING_CITES = re.compile(r"^(?:\s*\[\s*P\d+[^\]]*\])+")
_CITES_AFTER_STOP = re.compile(r"^(?P<body>.*?)(?P<stop>[.!?])\s*(?P<cites>(?:\s*\[\s*P\d+[^\]]*\])+)\s*$", re.DOTALL)


def _sentences(text: str) -> list[str]:
    """The sentences of `text`. A citation group written after the stop ("... (HR 0.55). [P1]") belongs to the sentence
    before it when that sentence cites nothing else, and is moved inside its stop ("... (HR 0.55) [P1].") so the
    sentence is checked against its own papers, not every paper (Plan 30; as the quick writer does)."""
    if not text or not text.strip():
        return []
    out: list[str] = []
    for piece in _SENTENCE.split(text.strip()):
        lead = _LEADING_CITES.match(piece)
        if lead and out and (not _REF.search(out[-1]) or not piece[lead.end():].strip()):
            m = _CITES_AFTER_STOP.match(f"{out[-1]} {lead.group(0).strip()}")
            out[-1] = f"{m['body'].rstrip()} {m['cites'].strip()}{m['stop']}" if m else f"{out[-1]} {lead.group(0).strip()}"
            piece = piece[lead.end():].strip()
        if piece:
            out.append(piece)
    return out


```

**Edit** `backend/app/graph/nodes/quick.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python


def _claims_level(sentence: str, strength: str | None) -> bool:
    """The sentence (read without its [Pn] groups) mentions a certainty level for the evidence (any level: the closing
```

   with

```python


# Plan 30: direct advice to a person ("Patients should stop…", "Take X…", "you should…") is never a limits sentence;
# such a sentence is dropped like a certainty claim (fail-safe: the next clean sentence, else none). Research wording
# ("patients should be followed up longer in future trials") is not advice: the verbs are the ones a person acts on.
_ACT = r"(?:stop|start|take|avoid|switch|use|ask|consult|see|talk|discuss|continue|keep|try|reduce|increase)"
_ADVICE = re.compile(
    rf"(?i)^\W*(?:please\s+)?(?:{_ACT}|do\s+not|don'?t|never|always\s+{_ACT})\b(?!-|\s+of\b)"
    rf"|\b(?:you|your|yourself)\b"
    rf"|\b(?:patients?|people|readers?|anyone|everyone|adults|parents)\s+(?:should|must|need\s+to|ought\s+to)"
    rf"\s+(?:not\s+)?{_ACT}\b")


def _claims_level(sentence: str, strength: str | None) -> bool:
    """The sentence (read without its [Pn] groups) mentions a certainty level for the evidence (any level: the closing
```

2. Replace

```python
    """The certainty sentence (the GRADE-lite baseline, or "not graded") and the model's limits sentence when it
    passes the numberless check (its first sentence that says nothing about certainty or evidence quality, without
    citations)."""
    text, _counts = fix_statement(_CITE_GROUP.sub("", limits or "").strip(), prose)
    text, _n = _drop_wrong_self_claims(text, strength)
    first = next((s for s in _split_sentences(text)
                  if not _claims_level(s, strength) and not _CERTAINTY_TALK.search(s)), "")
    certainty = ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
    return f"{certainty} {first}".strip()
```

   with

```python
    """The certainty sentence (the GRADE-lite baseline, or "not graded") and the model's limits sentence when it
    passes the numberless check (its first sentence that says nothing about certainty or evidence quality, without
    citations, and (Plan 30) no direct advice to a person)."""
    text, _counts = fix_statement(_CITE_GROUP.sub("", limits or "").strip(), prose)
    text, _n = _drop_wrong_self_claims(text, strength)
    first = next((s for s in _split_sentences(text)
                  if not _claims_level(s, strength) and not _CERTAINTY_TALK.search(s) and not _ADVICE.search(s)), "")
    certainty = ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
    return f"{certainty} {first}".strip()
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_prose_cite_scope.py -q`

Expected: 16 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-cleanup/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2632 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(prose): scope an after-period citation to its own sentence; no advice in the quick limits line (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add backend/tests/unit/test_prose_cite_scope.py backend/app/harness/prose.py backend/app/graph/nodes/quick.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 4: MCP quick_answer waits bounded per client

**Files:**
- Modify: `backend/app/mcp/server.py`
- Test (create): `backend/tests/unit/test_quick_wait_cap.py`

**Interfaces:**
- Consumes: `SseSlots`, `ReviewService.sse_key`, `ReviewService.effective().sse_max_per_ip`.
- Produces: `waiter_key(ident: Identity, deps: AppDeps) -> str` (`mcpwait:key:<id>` or `mcpwait:ip:<hashed>`); `quick_answer` holds one slot while it waits and returns at once when the client is at its cap; `QUICK_ANSWER_DOC` says so.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_quick_wait_cap.py` (complete):

```python
"""Plan 30: MCP quick_answer waits are bounded per client, like event streams."""
import json
import uuid
from datetime import UTC, datetime

from fastmcp import Client

from app.db.repositories import ReviewRepository
from app.mcp import server
from app.services.review_service import Identity
from app.services.sse_slots import SseSlots
from tests.unit.test_quick_outputs import QUICK_RESULT

TOPIC = {"topic": "statins and dementia risk", "language": "en"}


def data(result):
    return json.loads(result.content[0].text)


def local_waiter(app) -> str:
    """The in-process MCP client has no HTTP request: its address is "mcp-local"."""
    return server.waiter_key(Identity(ip="mcp-local"), app.state.deps)


def test_the_waiter_key_never_holds_a_raw_address(app):
    key = server.waiter_key(Identity(ip="203.0.113.9"), app.state.deps)
    assert key.startswith("mcpwait:ip:") and "203.0.113.9" not in key


async def test_a_client_at_its_wait_cap_gets_the_answer_at_once(app, redis, monkeypatch):
    slept = []

    async def sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(server, "_sleep", sleep)
    held = SseSlots(redis, limit=5)
    for _ in range(app.state.deps.service.settings.sse_max_per_ip):  # every wait slot of this client is taken
        assert await held.acquire(local_waiter(app))
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", TOPIC | {"wait_seconds": 30}))
    assert out["status"] == "queued" and "still running" in out["message"] and slept == []
    assert int(await redis.get(f"mra:sse:{local_waiter(app)}")) == 5  # nothing taken, nothing released


async def test_a_wait_takes_one_slot_and_gives_it_back(app, redis, session_factory, monkeypatch):
    seen = []
    rid: list[uuid.UUID] = []
    real_create = app.state.deps.service.create

    async def remember(req, **kw):
        created = await real_create(req, **kw)
        rid.append(created.review_id)
        return created

    async def finish(seconds):  # while the tool waits, its slot is held; then the review finishes
        seen.append(await redis.get(f"mra:sse:{local_waiter(app)}"))
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(rid[0], status="done", result=QUICK_RESULT, finished_at=datetime.now(UTC))

    monkeypatch.setattr(app.state.deps.service, "create", remember)
    monkeypatch.setattr(server, "_sleep", finish)
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", TOPIC | {"wait_seconds": 30}))
    assert out["status"] == "done" and seen == ["1"]
    assert await redis.get(f"mra:sse:{local_waiter(app)}") is None  # released
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_quick_wait_cap.py tests/unit/test_quick_outputs.py -q`

Expected: 3 failed, 13 passed (`AttributeError: ... has no attribute 'waiter_key'`, surfaced through the tool as `UnexpectedToolError`)

- [ ] **Step 3: Implement**

**Edit** `backend/app/mcp/server.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of, shown_topic

_MIN_PAPERS, _MAX_PAPERS = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
```

   with

```python
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of, shown_topic
from app.services.sse_slots import SseSlots

_MIN_PAPERS, _MAX_PAPERS = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
```

2. Replace

```python
(n, ref, citation, links to PubMed, DOI, PubMed Central or ThaiJO). When still running, poll get_review_status and
call get_review_result. It counts as one review against the same limits as start_review. `study_types` and `year_from`
work as in start_review. A topic that reads as an emergency returns status "refused" as in start_review. Not
medical advice."""


```

   with

```python
(n, ref, citation, links to PubMed, DOI, PubMed Central or ThaiJO). When still running, poll get_review_status and
call get_review_result. It counts as one review against the same limits as start_review. `study_types` and `year_from`
work as in start_review. A topic that reads as an emergency returns status "refused" as in start_review. A client
waits in at most `sse_max_per_ip` (see /status) quick_answer calls at once; one more returns at once, as with
wait_seconds 0. Not medical advice."""


```

3. Replace

```python
            "pmid": c.pmid, "pmcid": c.pmcid, "url": c.url, "is_open_access": c.is_open_access,
            "abstract": abstract + ("…" if c.abstract and len(c.abstract) > 600 else "")}


```

   with

```python
            "pmid": c.pmid, "pmcid": c.pmcid, "url": c.url, "is_open_access": c.is_open_access,
            "abstract": abstract + ("…" if c.abstract and len(c.abstract) > 600 else "")}


def waiter_key(ident: Identity, deps: AppDeps) -> str:
    """The client a quick_answer wait counts against (Plan 30): the API key, else the hashed address (raw addresses
    never reach Redis)."""
    return f"mcpwait:key:{ident.api_key.id}" if ident.api_key else f"mcpwait:ip:{deps.service.sse_key(ident.ip)}"


```

4. Replace

```python
        rid = uuid.UUID(started["review_id"])
        deadline = time.monotonic() + max(0, min(wait_seconds, QUICK_WAIT_MAX))
        review = await get_deps().service.get(rid)
        while review is not None and review.status not in TERMINAL_STATUSES and time.monotonic() < deadline:
            await _sleep(QUICK_POLL_SECONDS)
            review = await get_deps().service.get(rid)
        if review is None:
            raise ToolError(f"review {rid} not found")
```

   with

```python
        rid = uuid.UUID(started["review_id"])
        deadline = time.monotonic() + max(0, min(wait_seconds, QUICK_WAIT_MAX))
        deps = get_deps()
        review = await deps.service.get(rid)
        if review is not None and review.status not in TERMINAL_STATUSES and time.monotonic() < deadline:
            # Plan 30: a client holds at most sse_max_per_ip waits at once (shared with nothing else; Redis-backed so
            # every API process counts them); one over the cap gets the answer at once, as with wait_seconds=0
            waits = SseSlots(deps.redis, limit=(await deps.service.effective()).sse_max_per_ip)
            waiter = waiter_key(await identity(ctx), deps)
            if await waits.acquire(waiter):
                try:
                    while (review is not None and review.status not in TERMINAL_STATUSES
                           and time.monotonic() < deadline):
                        await _sleep(QUICK_POLL_SECONDS)
                        review = await deps.service.get(rid)
                finally:
                    await waits.release(waiter)
        if review is None:
            raise ToolError(f"review {rid} not found")
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_quick_wait_cap.py tests/unit/test_quick_outputs.py -q`

Expected: 16 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-cleanup/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2635 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(mcp): bound concurrent quick_answer waits per client (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add backend/tests/unit/test_quick_wait_cap.py backend/app/mcp/server.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 5: Ghost workers, the sources searched, the sign-in race, queue positions and the eval writers

**Files:**
- Modify: `backend/app/services/llm_store.py`
- Modify: `backend/app/graph/nodes/retrieval.py`
- Modify: `backend/app/api/admin.py`
- Modify: `backend/app/db/repositories.py`
- Modify: `backend/app/evals/models.py`
- Test (create): `backend/tests/unit/test_cleanup_ops.py`
- Test (modify): `backend/tests/unit/test_capacity.py`
- Test (modify): `backend/tests/unit/test_llm_reload.py`

**Interfaces:**
- Consumes: `loaded_workers`, `make_search`, `_record_sign_in`, `ReviewRepository.queue_position`, `write_json_atomic`, `save_manifest`, `load_gold`.
- Produces: `LOADED_MAX_AGE = timedelta(minutes=3)` and pruning in `loaded_workers`; the search `quality` entry's `sources` = enabled + `extras`; `with_for_update=True` in `_record_sign_in`; id tie-break in `queue_position`; `app/evals/models.py` `_replace(tmp, path)`; `load_gold` → None for an empty file.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_cleanup_ops.py` (complete):

```python
"""Plan 30: ghost workers, the sources a review searched, the sign-in race, queue positions in one clock tick, and the
eval writers."""
import json
import os
from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.evals import models
from app.graph.nodes.retrieval import make_search
from app.services.admin_auth import set_password
from app.services.llm_store import LOADED_KEY, LOADED_MAX_AGE, loaded_workers, report_loaded
from app.services.sources import effective_sources
from tests.unit.test_admin_api_auth import attempt, count, create_admin
from tests.unit.test_sources_propagation import deps_with


# ---- D1: workers that stopped reporting -----------------------------------------------------------------------------
async def test_a_worker_silent_for_three_minutes_is_not_listed_and_is_removed(redis):
    await report_loaded(redis, "live:1", "3", "cheap")
    old = {"version": "2", "preset": "cheap", "error": None,
           "loaded_at": (datetime.now(UTC) - LOADED_MAX_AGE - timedelta(seconds=1)).isoformat()}
    recent = {**old, "loaded_at": (datetime.now(UTC) - LOADED_MAX_AGE + timedelta(seconds=30)).isoformat()}
    await redis.hset(LOADED_KEY, mapping={"gone:1": json.dumps(old), "slow:1": json.dumps(recent),
                                          "junk:1": "not json", "odd:1": json.dumps(["a", "list"])})
    assert LOADED_MAX_AGE == timedelta(minutes=3)
    assert [r["worker"] for r in await loaded_workers(redis)] == ["live:1", "slow:1"]
    assert set(await redis.hkeys(LOADED_KEY)) == {"live:1", "slow:1"}  # the ghosts are gone from the hash


# ---- D4: the sources a review searched ------------------------------------------------------------------------------
async def test_the_search_records_env_only_engines_with_the_catalog_sources():
    env = Settings(_env_file=None, searxng_engines="pubmed,plos", thaijo_enabled=False)
    sources = effective_sources(env, {})
    assert sources.extras == ("plos",)
    deps = deps_with(sources)
    out = await make_search(deps)({"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}})
    assert out["quality"][0]["sources"] == [*sources.enabled, "plos"]


# ---- E1/E2: a password set while the sign-in checks the old one ----------------------------------------------------
async def test_a_password_changed_while_the_password_is_checked_does_not_get_in(app, client, session_factory,
                                                                               monkeypatch, redis):
    import app.api.admin as admin_api

    real_verify = admin_api.verify_password

    async def change_meanwhile(stored, password):
        result = await real_verify(stored, password)
        async with session_factory() as s, s.begin():
            await set_password(s, "owner", "an entirely new passphrase 42")
        return result

    await create_admin(session_factory)
    monkeypatch.setattr(admin_api, "verify_password", change_meanwhile)
    r = await attempt(client)
    assert r.status_code == 401 and "set-cookie" not in r.headers
    assert await count(session_factory, "admin.login") == 0 and await redis.keys("mra:admin:session:*") == []


# ---- F1: queue positions of reviews created in the same clock tick -------------------------------------------------
async def test_reviews_created_in_one_tick_get_distinct_positions(session_factory):
    tick = datetime.now(UTC)
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        made = [await repo.create(topic=f"t{i}", language="en", options={}, cache_key=f"k{i}") for i in range(3)]
        for r in made:
            await repo.update(r.id, created_at=tick)
    async with session_factory() as s:
        repo = ReviewRepository(s)
        positions = [await repo.queue_position(await repo.get(r.id)) for r in made]
    assert sorted(positions) == [1, 2, 3]
    by_id = sorted(made, key=lambda r: r.id)
    assert [positions[made.index(r)] for r in by_id] == [1, 2, 3]  # ties go by id


# ---- F3: the eval writers ----------------------------------------------------------------------------------------
def test_a_failed_replace_leaves_no_temporary_file(tmp_path, monkeypatch):
    def locked(src, dst):
        raise PermissionError("the file is open in another process")

    monkeypatch.setattr(os, "replace", locked)
    target = tmp_path / "runs" / "x.json"
    with pytest.raises(PermissionError):
        models.write_json_atomic(target, {"a": 1})
    assert list(target.parent.iterdir()) == []


def test_an_empty_gold_file_is_no_gold_record(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    (tmp_path / "gold").mkdir()
    (tmp_path / "gold" / "CD000001.yaml").write_text("", encoding="utf-8")
    assert models.load_gold("CD000001") is None
    assert models.load_gold("CD000002") is None  # no file
```

**Edit** `backend/tests/unit/test_capacity.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
import uuid
from datetime import UTC, datetime

from app.config import Settings
```

   with

```python
import uuid
from datetime import UTC, datetime, timedelta

from app.config import Settings
```

2. Replace

```python
    ids = [(await client.post("/api/v1/reviews", json={"topic": f"topic number {i} about statins",
                                                         "language": "en"})).json()["review_id"] for i in range(3)]
    positions = [(await client.get(f"/api/v1/reviews/{i}")).json()["queue_position"] for i in ids]
    assert positions == [1, 2, 3]
```

   with

```python
    ids = [(await client.post("/api/v1/reviews", json={"topic": f"topic number {i} about statins",
                                                         "language": "en"})).json()["review_id"] for i in range(3)]
    async with session_factory() as s, s.begin():  # Plan 30: distinct times; one clock tick on Windows made this flaky
        start = datetime.now(UTC)
        for n, rid in enumerate(ids):
            await ReviewRepository(s).update(uuid.UUID(rid), created_at=start + timedelta(seconds=n))
    positions = [(await client.get(f"/api/v1/reviews/{i}")).json()["queue_position"] for i in ids]
    assert positions == [1, 2, 3]
```

**Edit** `backend/tests/unit/test_llm_reload.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
async def test_a_poll_without_a_version_change_still_refreshes_loaded_at(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old = {"version": "file", "preset": "cheap", "error": None,
           "loaded_at": (datetime.now(UTC) - timedelta(hours=20)).isoformat()}
    await redis.hset(LOADED_KEY, worker_id(), json.dumps(old))
    graph = ctx["graph"]
```

   with

```python
async def test_a_poll_without_a_version_change_still_refreshes_loaded_at(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old = {"version": "file", "preset": "cheap", "error": None,  # still listed (Plan 30: listed for 3 minutes)
           "loaded_at": (datetime.now(UTC) - timedelta(minutes=2)).isoformat()}
    await redis.hset(LOADED_KEY, worker_id(), json.dumps(old))
    graph = ctx["graph"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_cleanup_ops.py tests/unit/test_capacity.py tests/unit/test_llm_reload.py -q`

Expected: 5 failed, 43 passed (the password-changed-meanwhile test passes already: it pins the existing re-read; the lock closes the window after it)

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/llm_store.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
LLM_VERSION_KEY = "mra:llm:config_version"
LOADED_KEY = "mra:llm:loaded"
LOADED_MAX_AGE = timedelta(days=1)
NOTE_MAX = 500
PUBLISH_ATTEMPTS = 3
```

   with

```python
LLM_VERSION_KEY = "mra:llm:config_version"
LOADED_KEY = "mra:llm:loaded"
# Plan 30: workers re-report every 30 s, so an entry not refreshed for 3 minutes (six missed heartbeats) is a worker that
# is gone (a rebuild, a crash): it is no longer listed, and loaded_workers removes it from the hash
LOADED_MAX_AGE = timedelta(minutes=3)
NOTE_MAX = 500
PUBLISH_ATTEMPTS = 3
```

2. Replace

```python

async def loaded_workers(redis, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for worker, raw in sorted((await redis.hgetall(LOADED_KEY)).items()):
        try:
            item = json.loads(raw)
            loaded_at = datetime.fromisoformat(item["loaded_at"])
        except (ValueError, KeyError, TypeError):
            continue
        if now - loaded_at <= LOADED_MAX_AGE:
            out.append({"worker": worker, **item})
    return out
```

   with

```python

async def loaded_workers(redis, now: datetime | None = None) -> list[dict[str, Any]]:
    """The workers seen within LOADED_MAX_AGE. Older or unreadable entries (a worker replaced by a rebuild never says
    goodbye) are removed from the hash, best effort: the admin pages never show a ghost worker (Plan 30)."""
    now = now or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    gone: list[str] = []
    for worker, raw in sorted((await redis.hgetall(LOADED_KEY)).items()):
        try:
            item = json.loads(raw)
            loaded_at = datetime.fromisoformat(item["loaded_at"])
            fresh = now - loaded_at <= LOADED_MAX_AGE
        except (ValueError, KeyError, TypeError, AttributeError):
            gone.append(worker)
            continue
        if fresh:
            out.append({"worker": worker, **item})
        else:
            gone.append(worker)
    if gone:
        try:
            await redis.hdel(LOADED_KEY, *gone)
        except Exception:  # noqa: BLE001 - listing never fails on the clean-up
            log.warning("llm_loaded_prune_failed", workers=len(gone))
    return out
```

**Edit** `backend/app/graph/nodes/retrieval.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
            entry["thaijo"] = thaijo_entry
        if getattr(deps, "sources", None) is not None:  # Plan 23d: the sources this review searched
            entry["sources"] = list(deps.sources.enabled)
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
```

   with

```python
            entry["thaijo"] = thaijo_entry
        if getattr(deps, "sources", None) is not None:  # Plan 23d: the sources this review searched
            entry["sources"] = list(deps.sources.enabled) + list(deps.sources.extras)  # Plan 30: env-only too
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
```

**Edit** `backend/app/api/admin.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    or given a new password while its password was being checked does not get in (None)."""
    async with deps.session_factory() as session, session.begin():
        user = await session.get(AdminUser, user_id)
        if user is None or user.disabled_at is not None or user.password_hash != verified_hash:
            return None
```

   with

```python
    or given a new password while its password was being checked does not get in (None)."""
    async with deps.session_factory() as session, session.begin():
        # Plan 30: locked until the commit, so a password set meanwhile (the CLI) is never overwritten by the rehash
        user = await session.get(AdminUser, user_id, with_for_update=True)
        if user is None or user.disabled_at is not None or user.password_hash != verified_hash:
            return None
```

**Edit** `backend/app/db/repositories.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

```

   with

```python
from typing import Any

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

```

2. Replace

```python
        if review.status != "queued":
            return None
        ahead = await self.session.scalar(select(func.count()).select_from(Review).where(
            Review.status == "queued", Review.created_at < review.created_at))
        return int(ahead or 0) + 1

```

   with

```python
        if review.status != "queued":
            return None
        # Plan 30: reviews created in the same clock tick are ordered by id, so no two share a position
        ahead = await self.session.scalar(select(func.count()).select_from(Review).where(
            Review.status == "queued",
            or_(Review.created_at < review.created_at,
                and_(Review.created_at == review.created_at, Review.id < review.id))))
        return int(ahead or 0) + 1

```

**Edit** `backend/app/evals/models.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python


def save_manifest(m: Manifest, path: Path | None = None) -> None:
    p = path if path is not None else EVAL_ROOT / "manifest.yaml"
```

   with

```python


def _replace(tmp: Path, path: Path) -> None:
    """os.replace, removing the temporary file when it fails (Plan 30: on Windows a reader holding `path` makes the
    replace fail, which used to leave a `.tmp` file behind)."""
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def save_manifest(m: Manifest, path: Path | None = None) -> None:
    p = path if path is not None else EVAL_ROOT / "manifest.yaml"
```

2. Replace

```python
        newline="\n",
    )
    os.replace(tmp, p)


```

   with

```python
        newline="\n",
    )
    _replace(tmp, p)


```

3. Replace

```python
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )
    os.replace(tmp, path)


```

   with

```python
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )
    _replace(tmp, path)


```

4. Replace

```python
def load_gold(review_id: str) -> GoldRecord | None:
    p = EVAL_ROOT / "gold" / f"{review_id}.yaml"
    return (
        GoldRecord.model_validate(yaml.safe_load(p.read_text(encoding="utf-8")))
        if p.exists()
        else None
    )
```

   with

```python
def load_gold(review_id: str) -> GoldRecord | None:
    p = EVAL_ROOT / "gold" / f"{review_id}.yaml"
    if not p.exists():
        return None
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    return GoldRecord.model_validate(data) if data else None  # Plan 30: an empty file is no gold record yet
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_cleanup_ops.py tests/unit/test_capacity.py tests/unit/test_llm_reload.py -q`

Expected: 48 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-cleanup/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2641 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(ops): prune silent workers, record env-only engines, lock the sign-in re-read, order queue ties, clean eval temp files (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add backend/tests/unit/test_cleanup_ops.py backend/tests/unit/test_capacity.py backend/tests/unit/test_llm_reload.py backend/app/services/llm_store.py backend/app/graph/nodes/retrieval.py backend/app/api/admin.py backend/app/db/repositories.py backend/app/evals/models.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 6: Frontend — the tab title waits for the topic check, the quick report redirect, quick page details

**Files:**
- Modify: `frontend/src/app/r/[id]/report.html/route.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/progress.ts`
- Modify: `frontend/src/components/review/review-screen.tsx`
- Modify: `frontend/src/components/review/quick-answer.tsx`
- Modify: `frontend/src/lib/i18n-report.ts`
- Modify: `frontend/src/components/landing/request-slip.tsx`
- Test (create): `frontend/src/components/review/cleanup-30.test.tsx`
- Test (modify): `frontend/src/components/landing/request-slip.test.tsx`

**Interfaces:**
- Consumes: the API's `topic: null` (Task 2); `isQuickReview`, `FALLBACK_TITLE`, `RC.quick`.
- Produces: `RunState.guardPassed?: boolean` (set by any step event other than `checking_topic`, and by `done`); `ReviewScreen` titles the tab with the topic only when it is shown (report, a non-personal terminal page, or the check passed); `getReview` maps `topic: null` to `""`; the report route answers 303 `Location: /r/{id}` for a quick answer; `RC.quick.missingPaper`; `Sentence` trims the space before a dropped group; `RequestSlip({ limits?, start? })`.

- [ ] **Step 0: Install the frontend dependencies once**

Run: `cd /d/MRA-cleanup/frontend && npm ci`

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/components/review/cleanup-30.test.tsx` (complete):

```tsx
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene } from "@/lib/agent-scene";
import { getReview } from "@/lib/api";
import { initialRun, reduceRun, type RunState } from "@/lib/progress";
import { FALLBACK_TITLE } from "@/lib/title";
import type { Review, ReviewEvent } from "@/lib/types";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";

const useReview = vi.fn();
vi.mock("@/lib/use-review", () => ({ useReview: (...a: unknown[]) => useReview(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/r/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/standalone-assets", () => ({ loadStandaloneAssets: async () => ({ js: "/*app*/", css: "/*css*/" }) }));

import { GET } from "@/app/r/[id]/report.html/route";
import { QuickAnswer } from "./quick-answer";
import { ReviewScreen } from "./review-screen";

vi.setConfig({ testTimeout: 20_000 });

const TOPIC = "ฉันปวดหัวทุกวัน ควรกินยาอะไร";
const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent =>
  ({ seq, type, payload } as unknown as ReviewEvent);
const runOf = (...types: string[]): RunState => types.reduce((s, t, i) => reduceRun(s, ev(i + 1, t)), initialRun());

function live(run: RunState) {
  const review = { ...reviewFixture, topic: TOPIC, status: "running", result: null } as unknown as Review;
  return { review, run, scene: initialScene(), phase: "live", connection: "open", retry: vi.fn() };
}

beforeEach(() => {
  document.title = "";
  useReview.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Plan 30: the tab title waits for the topic check", () => {
  it("marks the topic check as passed from the first event after it", () => {
    expect(runOf("queued", "started", "checking_topic").guardPassed).toBeFalsy();
    expect(runOf("queued", "started", "checking_topic", "refining").guardPassed).toBe(true);
    expect(runOf("started", "done").guardPassed).toBe(true);
    expect(runOf("started", "checking_topic", "rejected").guardPassed).toBeFalsy();
  });

  it("keeps a neutral title while the topic is being checked", () => {
    useReview.mockReturnValue(live(runOf("queued", "started", "checking_topic")));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(FALLBACK_TITLE);
  });

  it("names the tab after the topic once the check has passed", () => {
    useReview.mockReturnValue(live(runOf("queued", "started", "checking_topic", "refining")));
    render(<ReviewScreen id="x" />);
    expect(document.title).toBe(TOPIC);
  });
});

describe("Plan 30: a personal refusal's topic arrives as null", () => {
  it("reads it as an empty topic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...reviewFixture, topic: null, status: "rejected" }),
      { status: 200, headers: { "content-type": "application/json" } })));
    expect((await getReview(reviewFixture.id)).topic).toBe("");
  });
});

describe("Plan 30: the offline report of a quick answer", () => {
  it("sends the reader to the quick answer page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(quickReviewFixture), { status: 200 })));
    const id = quickReviewFixture.id;
    const res = await GET(new Request(`http://web/r/${id}/report.html`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/r/${id}`);
  });
});

describe("Plan 30: quick page details", () => {
  const withText = (text: string, refs: string[]): Review => ({
    ...quickReviewFixture,
    result: { ...quickReviewFixture.result!, summary: text, support: null, quick: { refs, papers_read: 4 },
      synthesis: { ...quickReviewFixture.result!.synthesis!, executive_summary: text } },
  });

  it("leaves no stray space where a group with no numberable ref is dropped", () => {
    render(<QuickAnswer review={withText("ผลลดลง [P8]. อีกงานพบผลคล้ายกัน [P1]", ["P1"])} />);
    const text = document.querySelector("[data-quick-text]")!.textContent!;
    expect(text).toContain("ผลลดลง.");
    expect(text).not.toMatch(/ {2}| \./);
  });

  it("says a cited study's details are missing instead of showing its raw id", () => {
    render(<QuickAnswer review={withText("ผลลดลง [P1, P9]", ["P1", "P9"])} />);
    const missing = document.querySelector('[data-quick-ref="P9"]')!;
    expect(missing).toHaveTextContent("ไม่พบรายละเอียดของงานวิจัยนี้ในผลลัพธ์");
    expect(missing.textContent).not.toContain("P9");
  });
});
```

**Edit** `frontend/src/components/landing/request-slip.test.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
  });

  it("pre-fills the topic from initialTopic", () => {
    render(<RequestSlip initialTopic="vitamin D and fractures" />);
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("vitamin D and fractures");
  });
```

   with

```tsx
  });

  it("pre-fills the topic from the start values", () => {
    render(<RequestSlip start={{ topic: "vitamin D and fractures" }} />);
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("vitamin D and fractures");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-cleanup/frontend && npx vitest run src/components/review/cleanup-30.test.tsx src/components/landing/request-slip.test.tsx src/components/review/review-screen.test.tsx src/components/review/quick-answer.test.tsx src/lib/i18n-report.test.ts`

Expected: 1 file failed, 6 failed, 95 passed: in `cleanup-30.test.tsx` the `guardPassed` case, the neutral title, the null topic, the 303, the stray space and the missing-paper line fail; "names the tab after the topic once the check has passed" passes already (the title used to be set at once)

- [ ] **Step 3: Implement**

**Edit** `frontend/src/app/r/[id]/report.html/route.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
import { serverApiUrl } from "@/lib/server-api";
import { loadStandaloneAssets } from "@/lib/standalone-assets";
```

   with

```ts
import { isQuickReview } from "@/lib/quick";
import { serverApiUrl } from "@/lib/server-api";
import { loadStandaloneAssets } from "@/lib/standalone-assets";
```

2. Replace

```ts
    return new Response(`review is ${review.status}; the offline report is available once it is done`, { status: 409 });
  }
  const html = buildStandaloneHtml(review, await loadStandaloneAssets());
  return new Response(html, {
```

   with

```ts
    return new Response(`review is ${review.status}; the offline report is available once it is done`, { status: 409 });
  }
  if (isQuickReview(review)) {
    // Plan 30: a quick answer has no full report; its page is the answer (a relative Location: the proxy's host)
    return new Response(null, { status: 303, headers: { location: `/r/${encodeURIComponent(id)}`, "cache-control": "no-store" } });
  }
  const html = buildStandaloneHtml(review, await loadStandaloneAssets());
  return new Response(html, {
```

**Edit** `frontend/src/lib/api.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
}

export function getReview(id: string): Promise<Review> {
  return request<Review>(`/api/v1/reviews/${encodeURIComponent(id)}`);
}

```

   with

```ts
}

/** Plan 30: the API sends `topic: null` for a personal medical refusal (its question is never echoed); pages read "". */
export async function getReview(id: string): Promise<Review> {
  const review = await request<Omit<Review, "topic"> & { topic: string | null }>(`/api/v1/reviews/${encodeURIComponent(id)}`);
  return { ...review, topic: review.topic ?? "" };
}

```

**Edit** `frontend/src/lib/progress.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
  /** Plan 26: a rejection's refusal code ("personal_medical", "declined"); absent on older events */
  code?: string;
  lastSeq: number;
}
```

   with

```ts
  /** Plan 26: a rejection's refusal code ("personal_medical", "declined"); absent on older events */
  code?: string;
  /** Plan 30: an event after the topic check arrived (refining onward, or done): the topic was not refused */
  guardPassed?: boolean;
  lastSeq: number;
}
```

2. Replace

```ts
    s.status = "running";
  }
  switch (ev.type) {
    case "queued":
```

   with

```ts
    s.status = "running";
  }
  if ((step && ev.type !== "checking_topic") || ev.type === "done") s.guardPassed = true;
  switch (ev.type) {
    case "queued":
```

**Edit** `frontend/src/components/review/review-screen.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
  // Name the tab after the question once it is known (effect only: no hydration mismatch).
  // Plan 26: not for a personal medical refusal, whose page shows no topic (nor the tab, history or previews).
  const personalRefusal = phase === "terminal" && run.status === "rejected"
    && isPersonalRefusal(run.code ?? review?.refusal_code, run.message ?? review?.error);
  useEffect(() => {
    if (personalRefusal) document.title = FALLBACK_TITLE;
    else if (knownTopic) document.title = knownTopic;
  }, [knownTopic, personalRefusal]);
  const queuePosition = polledPosition === undefined ? review?.queue_position : polledPosition;

```

   with

```tsx
  // Name the tab after the question once it is known (effect only: no hydration mismatch).
  // Plan 26: not for a personal medical refusal, whose page shows no topic (nor the tab, history or previews).
  // Plan 30: nor before the topic check has passed, since such a refusal can only be known after it.
  const personalRefusal = phase === "terminal" && run.status === "rejected"
    && isPersonalRefusal(run.code ?? review?.refusal_code, run.message ?? review?.error);
  const topicShown = !personalRefusal && (phase === "report" || phase === "terminal" || !!run.guardPassed);
  useEffect(() => {
    if (topicShown && knownTopic) document.title = knownTopic;
    else document.title = FALLBACK_TITLE;
  }, [knownTopic, topicShown]);
  const queuePosition = polledPosition === undefined ? review?.queue_position : polledPosition;

```

**Edit** `frontend/src/components/review/quick-answer.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
        if (p.kind === "cite") return i === 0 || parts[i - 1].kind !== "text" ? cite(p, `c${i}`) : null;
        const group = cite(parts[i + 1]);
        if (!group) return <ThaiText key={i}>{p.text}</ThaiText>;
        const [head, tail] = splitLastWord(p.text);
        return (
```

   with

```tsx
        if (p.kind === "cite") return i === 0 || parts[i - 1].kind !== "text" ? cite(p, `c${i}`) : null;
        const group = cite(parts[i + 1]);
        if (!group) {
          // Plan 30: a group with no numberable ref is left out, and so is the space before it when punctuation or
          // another space follows (no "risk . Next" or double space)
          const next = parts[i + 2];
          const trim = parts[i + 1]?.kind === "cite" && (next?.kind !== "text" || /^[\s.,;:!?)]/.test(next.text));
          return <ThaiText key={i}>{trim ? p.text.replace(/\s+$/, "") : p.text}</ThaiText>;
        }
        const [head, tail] = splitLastWord(p.text);
        return (
```

2. Replace

```tsx
                        <QuickRefFacts paper={paper} lang={lang} />
                      </div>
                    ) : <span className="text-muted">{ref}</span>}
                  </li>
                );
```

   with

```tsx
                        <QuickRefFacts paper={paper} lang={lang} />
                      </div>
                    ) : <span className="text-muted">{L(lang, Q.missingPaper)}</span>}
                  </li>
                );
```

**Edit** `frontend/src/lib/i18n-report.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
    citeChecked: (n: number): Pair => [`อ้างอิง ${n} ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้`, `Reference ${n} checked: the abstract supports this sentence`],
    noRefs: ["คำตอบนี้ไม่ได้อ้างอิงงานวิจัยใด", "This answer cites no study."],
    certaintyTitle: ["ความเชื่อมั่นของหลักฐาน", "Certainty of the evidence"],
    notGraded: ["ไม่ได้ประเมินความเชื่อมั่นของหลักฐาน", "The certainty of the evidence was not assessed"],
```

   with

```ts
    citeChecked: (n: number): Pair => [`อ้างอิง ${n} ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้`, `Reference ${n} checked: the abstract supports this sentence`],
    noRefs: ["คำตอบนี้ไม่ได้อ้างอิงงานวิจัยใด", "This answer cites no study."],
    missingPaper: ["ไม่พบรายละเอียดของงานวิจัยนี้ในผลลัพธ์", "This study's details are missing from the result."],
    certaintyTitle: ["ความเชื่อมั่นของหลักฐาน", "Certainty of the evidence"],
    notGraded: ["ไม่ได้ประเมินความเชื่อมั่นของหลักฐาน", "The certainty of the evidence was not assessed"],
```

**Edit** `frontend/src/components/landing/request-slip.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
 * The paper-count slider's range and start come from /status (`limits`: server-rendered, then the browser's own read);
 * with no usable limits it is not shown and the request leaves the count to the API. */
export function RequestSlip({ initialTopic, limits: serverLimits, start }: {
  initialTopic?: string; limits?: ServiceLimits | null;
  /** Plan 27: starting values from the address (`?mode=full&…`, the quick answer's "ทำรีวิวฉบับเต็ม") */
  start?: FormStart;
```

   with

```tsx
 * The paper-count slider's range and start come from /status (`limits`: server-rendered, then the browser's own read);
 * with no usable limits it is not shown and the request leaves the count to the API. */
export function RequestSlip({ limits: serverLimits, start }: {
  limits?: ServiceLimits | null;
  /** Plan 27: starting values from the address (`?mode=full&…`, the quick answer's "ทำรีวิวฉบับเต็ม") */
  start?: FormStart;
```

2. Replace

```tsx
  const id = useId();
  const startOther = start?.studyTypes?.find((t) => t.startsWith("Other: "))?.slice("Other: ".length) ?? "";
  const [topic, setTopic] = useState(initialTopic ?? start?.topic ?? "");
  const [mode, setMode] = useState<ReviewMode>(start?.mode ?? "quick"); // Plan 27: the public default
  const [language, setLanguage] = useState<"th" | "en">(start?.language ?? "th");
```

   with

```tsx
  const id = useId();
  const startOther = start?.studyTypes?.find((t) => t.startsWith("Other: "))?.slice("Other: ".length) ?? "";
  const [topic, setTopic] = useState(start?.topic ?? "");
  const [mode, setMode] = useState<ReviewMode>(start?.mode ?? "quick"); // Plan 27: the public default
  const [language, setLanguage] = useState<"th" | "en">(start?.language ?? "th");
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-cleanup/frontend && npx vitest run src/components/review/cleanup-30.test.tsx src/components/landing/request-slip.test.tsx src/components/review/review-screen.test.tsx src/components/review/quick-answer.test.tsx src/lib/i18n-report.test.ts`

Expected: 5 files, 101 tests passed

- [ ] **Step 5: The full frontend suite, typecheck, lint and the e2e suite**

Run: `cd /d/MRA-cleanup/frontend && npm test && npm run typecheck && npm run lint`
Run: `cd /d/MRA-cleanup/frontend && npm run e2e` (it builds the app and serves it on port 3100 with a mocked API; nothing else may hold port 3100; Docker is not used)

Expected: 155 files, 1660 tests (in the pre-flight the two known-flaky cases timed out in full runs and passed alone); typecheck and eslint clean; e2e 458 passed, 1 skipped.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
fix(web): neutral tab title until the topic check passes, quick report redirect, quick page details (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add frontend/src/components/review/cleanup-30.test.tsx frontend/src/components/landing/request-slip.test.tsx "frontend/src/app/r/[id]/report.html/route.ts" frontend/src/lib/api.ts frontend/src/lib/progress.ts frontend/src/components/review/review-screen.tsx frontend/src/components/review/quick-answer.tsx frontend/src/lib/i18n-report.ts frontend/src/components/landing/request-slip.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 7: Docs and final checks

**Files:**
- Modify: `docs/api.md`
- Test (modify): `backend/tests/unit/test_api_docs_limits.py`

**Interfaces:**
- Consumes: the behaviour of Tasks 1–6.
- Produces: the "Cleanup after review (Plan 30)" section of `docs/api.md` and the matching edits (cache paragraph, `topic` null, the worker listing age, the quick cost cap read from `/status`, the `queued` payload, the `quick_answer` wait cap, the `review://{id}` resource, the quick report redirect); one docs test.

This task ends at the docs commit and the final checks. The merge, the root `CLAUDE.md` convention line, the docker
rebuild and the smoke check are done by the controller afterwards (see "After the plan (controller)" below); the
implementer does none of them.

- [ ] **Step 1: Docs**

**Edit** `docs/api.md` (8 replacements; each `old` occurs exactly once):

1. Replace

```markdown
  emergency, so no review is created (see "Public safety rails and audience modes (Plan 26)").

**Cache hits are free.** The same topic (case and spaces ignored), language, options and pipeline version within 24 hours of finishing, or while still queued or running, returns that review with `cached: true`. Cache hits skip every limit, Turnstile and capacity check. The pipeline version is the prompt version plus the model configuration in use, written `<prompt_version>+llm<id>` (`id` is the saved configuration version, or `file` while `llm.yaml` is in use). A saved glossary starts a new cache generation too (`+g<version>` is added to the pipeline version while a glossary version exists, and results carry `glossary_version`); saved settings never do. A saved model configuration therefore starts a new cache generation: after any save, restore or reset in the admin console (see "Model management"), the same question runs again on the new models instead of returning a review made with the old ones. Deploying Plan 23b itself starts one new generation too: `<prompt_version>` becomes `<prompt_version>+llmfile`, so reviews cached before the deploy are not returned.

**ThaiJO and the cache (Plan 24).** While `THAIJO_ENABLED` is true, `+thaijo` is added to the pipeline version, so
```

   with

```markdown
  emergency, so no review is created (see "Public safety rails and audience modes (Plan 26)").

**Cache hits are free.** The same topic (case and spaces ignored), language, options and pipeline version within 24 hours of finishing, or while still queued or running, returns that review with `cached: true`. Cache hits skip every limit, Turnstile and capacity check. The pipeline version is the prompt version plus the model configuration in use, written `<prompt_version>+llm<id>` (`id` is the saved configuration version, or `file` while `llm.yaml` is in use). A saved glossary starts a new cache generation too (`+g<version>` is added to the pipeline version while a glossary version exists, and results carry `glossary_version`); saved settings never do. A saved model configuration therefore starts a new cache generation: after any save, restore or reset in the admin console (see "Model management"), the same question runs again on the new models instead of returning a review made with the old ones. Deploying Plan 23b itself starts one new generation too: `<prompt_version>` becomes `<prompt_version>+llmfile`, so reviews cached before the deploy are not returned. Since Plan 30 the key a finished review is cached under is the one of the configuration the worker ran: a review queued before a save and run after it is stored under the new generation's key, and a run that resumed across a save is never reused (see "Cleanup after review (Plan 30)").

**ThaiJO and the cache (Plan 24).** While `THAIJO_ENABLED` is true, `+thaijo` is added to the pipeline version, so
```

2. Replace

```markdown
- `refusal_code` (Plan 26) says why a `rejected` review got no review: `personal_medical` or `declined`; it is `null`
  for every other status.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, since Plan 25 `support` (see "Sentence support (Plan 25)"), and since Plan 27 `mode` (`full` or `quick`) and `quick` (null for a full review; see "Quick answer (Plan 27)").
```

   with

```markdown
- `refusal_code` (Plan 26) says why a `rejected` review got no review: `personal_medical` or `declined`; it is `null`
  for every other status.
- `topic` is `null` for a `personal_medical` refusal (Plan 30): the person's own question is never sent back.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, since Plan 25 `support` (see "Sentence support (Plan 25)"), and since Plan 27 `mode` (`full` or `quick`) and `quick` (null for a full review; see "Quick answer (Plan 27)").
```

3. Replace

```markdown
### Exports

The web app also serves the whole interactive report as one HTML file that works offline: `GET <origin>/r/{id}/report.html` (attachment `review-<id8>.html`, about 1.3 MB; 409 until done). It renders from the embedded `review.result` and makes no network request (Plan 20 Task 8: the verified-number face is embedded, the other fonts fall back to system fonts); its header carries a metadata line (review id, review type, search date or else created date, generated date, report language, `prompt_version`) and a light/dark theme toggle. Like the web page, it prints as an A4 report that ends with an appendix of every verified number and its source sentence from the abstract (pooled numbers listed apart, with k and the studies).

`GET /reviews/{id}/export?format=…` returns an attachment named `review-<first 8 chars of id>.<format>`. It is only available once the review is `done`; before that it returns 409.
```

   with

```markdown
### Exports

The web app also serves the whole interactive report as one HTML file that works offline: `GET <origin>/r/{id}/report.html` (attachment `review-<id8>.html`, about 1.3 MB; 409 until done; for a quick answer 303 to `/r/{id}`, Plan 30). It renders from the embedded `review.result` and makes no network request (Plan 20 Task 8: the verified-number face is embedded, the other fonts fall back to system fonts); its header carries a metadata line (review id, review type, search date or else created date, generated date, report language, `prompt_version`) and a light/dark theme toggle. Like the web page, it prints as an A4 report that ends with an appendix of every verified number and its source sentence from the abstract (pooled numbers listed apart, with k and the studies).

`GET /reviews/{id}/export?format=…` returns an attachment named `review-<first 8 chars of id>.<format>`. It is only available once the review is `done`; before that it returns 409.
```

4. Replace

```markdown
  `GET /admin/llm-config` returns the entries as
  `loaded: [{worker, version, preset, loaded_at, error, settings, glossary, runtime_error}]`, leaving out
  those not refreshed for a day, and the console calls a worker "not reporting" after 2 minutes.

**Command line.** `python -m app.cli.models check [--source file|db]` validates `llm.yaml` (the default) or, with
```

   with

```markdown
  `GET /admin/llm-config` returns the entries as
  `loaded: [{worker, version, preset, loaded_at, error, settings, glossary, runtime_error}]`, leaving out
  those not refreshed for 3 minutes (Plan 30; six missed checks) and removing them, and any entry that does not parse,
  from the hash; the console calls a worker "not reporting" after 2 minutes.

**Command line.** `python -m app.cli.models check [--source file|db]` validates `llm.yaml` (the default) or, with
```

5. Replace

```markdown
- **Result.** `mode: "quick"`, `summary` = `synthesis.executive_summary` = the answer (shown language; `synthesis_en` holds the English), `synthesis.answer` = the closing line: the fixed certainty sentence of the GRADE-lite baseline (computed in code, never the model's; `evidence_strength` = `grade_baseline`) then the limits sentence, or "not graded" for qualitative studies only. `comparison`, `consensus`, `conflicts`, `key_findings` and `research_gaps` are empty. `quick: {refs, papers_read}`: the cited refs in order of first citation (reference `[k]` is `refs[k-1]`) and the number of evidence papers the answer was written from. `papers`, `stats`, `question`, `methods` and `support` (Plan 25, which checks the answer's sentences) are as in a full review.
- **Numbers.** Only numbers verified against the abstracts (`app/harness/verify.py`) can stay in the answer; translation keeps them unchanged.
- **Cost and limits.** One review against the same hourly rate limit, key quota, queue and daily counters as a full review. Its cost cap is the usual formula with the quick sizes: 0.04 + 0.006 × 8 + 0.0005 × 30 = $0.103 (defaults); expected spend about $0.02 on `budget`. Admission reserves that cap for a new quick answer; queued reviews are reserved at the worst case, as before.
- **Time.** About 45–75 s on `budget` (an estimate, not measured live: search, screening 3 batches, reading 8 papers in one wave, writing and translating).
- **Exports.** `export?format=md` and `review://{id}/report.md` give "# Quick answer: …", the answer with `[1]…[n]`, the closing line, a scope note and the numbered references. `csv` and `json` are as for any review.
- **Web.** The home form starts as a quick answer; `/r/{id}` shows the answer, the numbered references (links to PubMed, DOI, PubMed Central or ThaiJO), the public safety notices (Plan 26) and "ทำรีวิวฉบับเต็ม", which opens the form as a full review with the same question, language, start year and study types.

## Event stream (SSE)
```

   with

```markdown
- **Result.** `mode: "quick"`, `summary` = `synthesis.executive_summary` = the answer (shown language; `synthesis_en` holds the English), `synthesis.answer` = the closing line: the fixed certainty sentence of the GRADE-lite baseline (computed in code, never the model's; `evidence_strength` = `grade_baseline`) then the limits sentence, or "not graded" for qualitative studies only. `comparison`, `consensus`, `conflicts`, `key_findings` and `research_gaps` are empty. `quick: {refs, papers_read}`: the cited refs in order of first citation (reference `[k]` is `refs[k-1]`) and the number of evidence papers the answer was written from. `papers`, `stats`, `question`, `methods` and `support` (Plan 25, which checks the answer's sentences) are as in a full review.
- **Numbers.** Only numbers verified against the abstracts (`app/harness/verify.py`) can stay in the answer; translation keeps them unchanged.
- **Cost and limits.** One review against the same hourly rate limit, key quota, queue and daily counters as a full review. Its cost cap is the usual formula with the quick sizes (`limits.quick` in `GET /api/v1/status`) and the cost settings in force; expected spend about $0.02 on `budget`. Admission reserves that cap for a new quick answer; queued reviews are reserved at the worst case, as before.
- **Time.** About 45–75 s on `budget` (an estimate, not measured live: search, screening 3 batches, reading 8 papers in one wave, writing and translating).
- **Exports.** `export?format=md` and `review://{id}/report.md` give "# Quick answer: …", the answer with `[1]…[n]`, the closing line, a scope note and the numbered references. `csv` and `json` are as for any review.
- **Web.** The home form starts as a quick answer; `/r/{id}` shows the answer, the numbered references (links to PubMed, DOI, PubMed Central or ThaiJO), the public safety notices (Plan 26) and "ทำรีวิวฉบับเต็ม", which opens the form as a full review with the same question, language, start year and study types.

## Cleanup after review (Plan 30)

Behaviour changed by the cleanup of the review findings of Plans 22a–27 (no prompt or schema change, so
`prompt_version` stays the same).
- **Cache generation that ran.** The API keys a request with the versions it sees at admission (`<prompt_version>`,
  `+llm<id>`, `+g<version>`, the sources' `+thaijo` / `+src<fingerprint>`). The worker picks its configuration up when
  the job starts, so a job queued across an admin save runs on the newer one. On `done` the worker computes the same
  string from what it loaded and stores it as `result.pipeline_version`; when it gives another key than the admission's,
  the review is stored under that key (a request made under the new configuration reuses it, one made under the old
  does not). A run that resumed from a checkpoint and whose version differs may hold work of two configurations: it is
  stored under a key no request computes, so it is never reused.
- **A personal medical refusal's question.** `GET /reviews/{id}` and the MCP resource `review://{id}` return
  `topic: null`, the Markdown report (`review://{id}/report.md`) has the title "# Literature review" with no topic, and
  the event stream never carries the topic (the `queued` event is `{}`). The web page keeps a neutral tab title until
  the topic check has passed (the first event after `checking_topic`).
- **An escalation model's refusal** during the topic check ends the review as a `personal_medical` refusal (the fixed
  message naming 1669 and 1323), like a refusal of the guard's own model. A guard answer that is only malformed still
  ends the review as `error`.
- **Red flags.** "swallowed … coin(s)" and "ate / swallowed / drank … rat (mouse, rodent) poison (bait)" are medical red
  flags under the usual anchor and cue rule; titles such as "coin ingestion in children" are not refused.
- **Prose checks.** A citation group written after the full stop ("… (HR 0.55). [P1]") belongs to the sentence before
  it when that sentence cites nothing else: it is moved inside the stop, and the sentence's numbers are checked against
  that paper only (it was checked against every paper). The quick answer's limits sentence is left out when it advises a
  person ("Patients should stop…", "Take…", "you…"); the next sentence that passes is used, else none.
- **The offline report** `GET <origin>/r/{id}/report.html` of a quick answer answers **303** to `/r/{id}`: a quick
  answer has no full report.
- **The sources a review searched** (the search stage's `quality` entry) list the env-only engines (`extras`, for
  example `plos`) after the catalog sources.
- **Queue positions** of reviews created in the same clock tick are ordered by id, so no two share a position.

## Event stream (SSE)
```

6. Replace

```markdown
| Event | Payload | Notes |
|---|---|---|
| `queued` | `{topic}` | sent by the API |
| `started` | `{resume}` | repeated when a review resumes after a worker restart |
| `checking_topic` | `{}` | |
```

   with

```markdown
| Event | Payload | Notes |
|---|---|---|
| `queued` | `{}` | sent by the API; it carried `{topic}` before Plan 30, and a replay leaves `topic` out of those stored events |
| `started` | `{resume}` | repeated when a review resumes after a worker restart |
| `checking_topic` | `{}` | |
```

7. Replace

```markdown
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the SearXNG engines reviews use (`GET /api/v1/status` → `sources`; never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None, mode="full")` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. `mode` (Plan 27): `full` or `quick`; with `quick` the service sets the type and both sizes. Capacity errors include the reason and the wait time |
| `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)` | `{review_id, status, cached, status_url}` plus, once done, `{answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}`; still running: `message`; ended otherwise: `error`, `refusal_code`; an emergency: the `refused` result of `start_review` | Plan 27. Starts (or reuses) a quick answer and waits up to `wait_seconds` (0–90) for it, checking every 2 s. `answer` has the `[Pn]` groups renumbered `[1]…[n]` by first citation; `references[n-1]` is reference `[n]`, with links to doi.org, PubMed, PubMed Central or ThaiJO. One review against the same limits as `start_review` |
| `get_review_status(review_id)` | `{review_id, status, error, refusal_code, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled`; `refusal_code` as in REST (Plan 26) |
| `get_review_result(review_id)` | `{review_id, status, result}` | The `result` shape is the same as REST: `citations` and, for `meta_analysis`, `meta_analysis`. If the review is not done: `{…, result: null, message, error, refusal_code}` |
```

   with

```markdown
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the SearXNG engines reviews use (`GET /api/v1/status` → `sources`; never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None, mode="full")` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. `mode` (Plan 27): `full` or `quick`; with `quick` the service sets the type and both sizes. Capacity errors include the reason and the wait time |
| `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)` | `{review_id, status, cached, status_url}` plus, once done, `{answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}`; still running: `message`; ended otherwise: `error`, `refusal_code`; an emergency: the `refused` result of `start_review` | Plan 27. Starts (or reuses) a quick answer and waits up to `wait_seconds` (0–90) for it, checking every 2 s. A client (an API key, else an address) waits in at most `sse_max_per_ip` calls at once (Plan 30); one more returns at once, as with `wait_seconds` 0. `answer` has the `[Pn]` groups renumbered `[1]…[n]` by first citation; `references[n-1]` is reference `[n]`, with links to doi.org, PubMed, PubMed Central or ThaiJO. One review against the same limits as `start_review` |
| `get_review_status(review_id)` | `{review_id, status, error, refusal_code, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled`; `refusal_code` as in REST (Plan 26) |
| `get_review_result(review_id)` | `{review_id, status, result}` | The `result` shape is the same as REST: `citations` and, for `meta_analysis`, `meta_analysis`. If the review is not done: `{…, result: null, message, error, refusal_code}` |
```

8. Replace

```markdown
| Kind | Name | Returns |
|---|---|---|
| Resource | `review://{id}` | JSON `{review_id, topic, status, result, error}` |
| Resource | `review://{id}/report.md` | the Markdown report |
| Prompt | `literature_review(topic)` | |
```

   with

```markdown
| Kind | Name | Returns |
|---|---|---|
| Resource | `review://{id}` | JSON `{review_id, topic, status, result, error, refusal_code}`; `topic` is null for a `personal_medical` refusal (Plan 30) |
| Resource | `review://{id}/report.md` | the Markdown report |
| Prompt | `literature_review(topic)` | |
```

**Edit** `backend/tests/unit/test_api_docs_limits.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    from app.config import Settings
    assert f"prompt_version {Settings(_env_file=None).prompt_version}`" in API_MD.read_text(encoding="utf-8")
```

   with

```python
    from app.config import Settings
    assert f"prompt_version {Settings(_env_file=None).prompt_version}`" in API_MD.read_text(encoding="utf-8")


def test_the_quick_answer_cost_cap_is_read_from_status_not_quoted():
    """Plan 30: public limits come from /status; the docs never quote the quick answer's computed cap."""
    text = API_MD.read_text(encoding="utf-8")
    assert "$0.103" not in text and "= $0." not in text
    assert "`limits.quick` in `GET /api/v1/status`" in text
```

Then run: `cd /d/MRA-cleanup/backend && uv run pytest tests/unit/test_api_docs_limits.py tests/unit/test_openapi_docs.py -q`

Expected: 10 passed (never write a range like "5–30" in new text: `test_docs_have_no_stale_paper_counts` reads it as an old paper count).

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-cleanup/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-cleanup/frontend && npm test && npm run typecheck && npm run lint`

Expected: all pass (pre-flight: backend 2642 passed, 17 skipped; frontend 155 files, 1660 tests). Integration tests are unchanged by this plan; run them only if Postgres is up (`MRA_INTEGRATION=1 uv run pytest -m integration -q`) and report the result or why they were not run.

- [ ] **Step 3: Commit**

Write the message with the Write tool to `D:\MRA-cleanup\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
docs(api): cleanup after review: cache generation, personal refusals, waits, redirects (Plan 30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-cleanup && git add docs/api.md backend/tests/unit/test_api_docs_limits.py
git commit -F .superpowers/commit-msg.txt
```

---

## After the plan (controller)

Not part of any task: the controller does these after the whole-branch review, in its own session.
- **Merge** `cleanup-after-27` into master with `--no-ff`. The main worktree's uncommitted owner entries (for
  example `infra/searxng/limiter.toml.new`) are never staged or changed.
- **Root `CLAUDE.md`:** add the convention line to the committed file only (the owner may have working-tree edits):

```text
- Cache generation (Plan 30): `app/services/pipeline_version.py` builds the pipeline version for the API's admission key and the worker (`run_version(ctx)`, read with `ctx["graph"]`); on `done` the runner stores `result.pipeline_version` and re-keys the row to the version that ran (a resumed run whose version differs gets a key no request computes). A `personal_medical` refusal never echoes its question: `topic` null in REST and `review://{id}`, no topic in the Markdown title or any event (`shown_topic`); an escalation model's refusal in the guard is `personal_medical` too. Full-review prose checks move an after-period citation inside its sentence (`prose._sentences`). MCP `quick_answer` waits hold a per-client `SseSlots` slot (`sse_max_per_ip`).
```

- **Docker rebuild and the smoke check, spending nothing.** No review is started and no LLM, database or queue is used.
  Write the script with the Write tool to `D:\MedicalReviewerAgent\.superpowers\smoke30.py` (git-ignored; no heredoc),
  copy it into the api container, run it, then delete both copies.

```python
"""Plan 30 smoke check, spending nothing: no review is started, no LLM, database or queue is used."""
import asyncio
import uuid
from datetime import UTC, datetime

from app.config import Settings
from app.graph.nodes.quick import closing_line
from app.harness.prose import _sentences, prose_context
from app.schemas.review import ReviewOut, compute_cache_key
from app.services.pipeline_version import finished_cache_key, pipeline_version
from app.services.safety import red_flag, rejection_error
from app.services.sources import effective_sources
from app.worker.tasks import run_version

s = Settings()
sources = effective_sources(s, {})
print("prompt_version", s.prompt_version)
api = pipeline_version(s.prompt_version, llm="file", glossary="file", sources=sources, base=s)
ctx = {"llm_lock": asyncio.Lock(), "settings": s, "base_settings": s, "llm_version": "file",
       "glossary_version": "file", "sources": sources}
print("versions agree", api == run_version(ctx))
opts = {"max_papers": 5}
admitted = compute_cache_key("t", "en", opts, api)
moved = finished_cache_key(admitted, "t", "en", opts, run_version({**ctx, "llm_version": "7"}), resumed=False,
                           review_id="r")
mixed = finished_cache_key(admitted, "t", "en", opts, run_version({**ctx, "llm_version": "7"}), resumed=True,
                           review_id="r")
print("rekeyed", moved != admitted, "never reused", mixed not in (admitted, moved))
print("red flags", red_flag("help my son swallowed a coin"), red_flag("coin ingestion in children"))
now = datetime.now(UTC)
out = ReviewOut.model_validate({"id": uuid.uuid4(), "topic": "my mother should take aspirin?", "language": "en",
                                "status": "rejected", "created_at": now, "finished_at": now, "options": {},
                                "result": None, "error": rejection_error("personal_medical"), "cost_usd": 0.0,
                                "started_at": now})
print("personal topic", out.topic, out.refusal_code)
print("sentences", _sentences("It fell (HR 0.74). [P1] It rose [P2]."))
print("closing", closing_line("Patients should stop taking it. Samples were small.", prose_context([]), "low"))
```

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                                                                       # api healthy, worker up
docker compose cp .superpowers/smoke30.py api:/tmp/smoke30.py
docker compose exec -T api python /tmp/smoke30.py
docker compose exec -T api rm /tmp/smoke30.py && rm .superpowers/smoke30.py
docker compose exec -T web sh -c 'grep -rl "guardPassed" .next 2>/dev/null | head -1'   # the title rule is in the build
```

Expected (the pre-flight ran the script outside docker; inside the containers the version string carries the
deployment's labels, so only the lines below are compared):
- `prompt_version 2026-10-13.3`;
- `versions agree True` and `rekeyed True never reused True`;
- `red flags Emergency(kind='medical') None`;
- `personal topic None personal_medical`;
- `sentences ['It fell (HR 0.74) [P1].', 'It rose [P2].']`;
- `closing The certainty of the evidence is low. Samples were small.`;
- a path under `.next` for the grep.

- **Record:** remove the worktree (keep the branch) and update the memory notes: Plan 30 merged; `prompt_version`
  unchanged (2026-10-13.3); deferred items as listed in the spec, section 5.
