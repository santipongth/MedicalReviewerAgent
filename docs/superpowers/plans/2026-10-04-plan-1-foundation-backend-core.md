# Plan 1 — Foundation & Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, Docker infra (Postgres, Redis, searxng-LDR-academic with JSON enabled), and a working FastAPI + arq worker pipeline where `POST /api/v1/reviews` enqueues a job, a stub LangGraph graph runs in the worker with Postgres checkpointing, progress events flow DB → Redis Streams → SSE, and the result is readable via `GET /api/v1/reviews/{id}`.

**Architecture:** FastAPI (stateless, N replicas) enqueues jobs to arq on Redis; an arq worker compiles one LangGraph graph per process (AsyncPostgresSaver on a psycopg pool) and streams `stream_mode=["custom","updates"]` into a single `EventSink` that writes `review_events` (monotonic `seq`) and `XADD`s to a Redis Stream; the SSE endpoint replays from DB then tails the stream, deduplicating by `seq`. Later plans replace the stub graph nodes with the real pipeline (search → screen → extract → synthesize) without touching this plumbing.

**Tech Stack:** Python 3.12, uv, FastAPI, uvicorn, sse-starlette, slowapi, pydantic-settings, structlog, SQLAlchemy 2 (async, psycopg 3), Alembic, redis-py (asyncio), arq, LangGraph 1.x, langgraph-checkpoint-postgres, Postgres 17, Redis 7, Docker Compose, searxng-LDR-academic fork pinned at commit `f314c2258e1a7647f30cae650d951c83f0eb639b`.

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (sections 2, 3, 4 "Streaming / resume / errors", 5 REST, 6 Data model, 8 file layout, 9 phases 1–3)

**Sub-project split (this is plan 1 of 5):**
1. **Foundation & backend core** (this plan) — scaffold, infra, DB, API, queue, SSE, stub graph
2. Data sources & real graph nodes (Europe PMC, SearXNG client, arXiv, Unpaywall, JATS, screening/extract/synthesize with Claude)
3. MCP server + MCP client + external integration (API keys, webhooks)
4. Frontend (Next.js 16) + Caddy
5. Hardening (quota/budget, Turnstile, exports, docs)

## Global Constraints

- Python `>=3.12`; package manager `uv`; all backend commands run from `backend/` with `uv run ...`
- Database URL scheme is `postgresql+psycopg://` (psycopg 3 for both SQLAlchemy and the LangGraph checkpointer); unit tests use `sqlite+aiosqlite:///<tmp file>`
- Redis clients are created with `decode_responses=True`
- Review statuses: `queued, running, done, error, rejected, cancelled`; terminal = `done, error, rejected, cancelled`
- SSE event ids are the integer `seq`; terminal event types are `done, error, rejected, cancelled`
- arq job id for a review is always `review:{review_id}`; graph `thread_id` is `str(review_id)`
- arq `WorkerSettings`: `job_timeout=1800, max_tries=2, retry_jobs=False, allow_abort_jobs=True, max_jobs=settings.max_concurrent_reviews_per_worker`
- Graph is always run with `stream_mode=["custom","updates"]` and `durability="sync"`
- Nodes never touch Redis/DB for progress; they call `get_stream_writer()`
- SearXNG fork build context pinned: `https://github.com/porespellar/searxng-LDR-academic.git#f314c2258e1a7647f30cae650d951c83f0eb639b`; config dir `/etc/searxng` is bind-mounted read-write from `infra/searxng/` (the entrypoint runs `sed -i` and `chown` on it)
- Public API prefix `/api/v1`; OpenAPI at `/api/docs`
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Windows host: run shell steps in Git Bash (`bash`) unless a step says PowerShell

## Review Focus

1. Topic of only whitespace/emoji or >300 chars → `422` with a field error, never `500` (test in Task 6)
2. `Last-Event-ID: abc` (non-numeric) or `?since=-5` → treated as `0`, stream still works (test in Task 5)
3. Second `POST /reviews` with the same topic/language/options while the first is `queued`/`running` → same `review_id`, `cached: true`, no second job (test in Task 6)
4. Worker node raising mid-run → review ends `error` with `error` event; never stuck in `running` (test in Task 8)
5. `GET /reviews/{id}/events` for an unknown id → `404` JSON, not an open stream (test in Task 5)

---

### Task 1: Backend scaffold, settings, logging, health endpoint

**Files:**
- Create: `backend/pyproject.toml`, `backend/.python-version`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/logging.py`, `backend/app/main.py`, `backend/app/api/__init__.py`, `backend/app/api/health.py`
- Create: `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/unit/__init__.py`, `backend/tests/unit/test_config.py`, `backend/tests/unit/test_health.py`
- Create: `.gitignore`, `CLAUDE.md`

**Interfaces:**
- Produces: `app.config.Settings`, `app.config.get_settings()`, `app.main.create_app(settings=None, deps=None) -> FastAPI`, `app.main.AppDeps` dataclass (`session_factory`, `redis`, `queue`, `event_sink`) — later tasks fill these in; Task 1 only needs `settings`.

- [ ] **Step 1: Create the uv project and dependencies**

Run (Git Bash, from `D:/MedicalReviewerAgent`):
```bash
mkdir -p backend/app/api backend/tests/unit && cd backend && printf '3.12\n' > .python-version
```
Create `backend/pyproject.toml`:
```toml
[project]
name = "medical-reviewer-agent"
version = "0.1.0"
description = "Medical / scientific literature reviewer agent (LangGraph + FastAPI)"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "sse-starlette>=2.1",
  "slowapi>=0.1.9",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
  "structlog>=24.1",
  "orjson>=3.10",
  "sqlalchemy[asyncio]>=2.0.30",
  "psycopg[binary,pool]>=3.2",
  "alembic>=1.13",
  "redis>=5.0",
  "arq>=0.26",
  "langgraph>=1.2",
  "langgraph-checkpoint-postgres>=3.1",
  "httpx>=0.27",
]

[dependency-groups]
dev = [
  "pytest>=8.2",
  "pytest-asyncio>=0.23",
  "aiosqlite>=0.20",
  "fakeredis>=2.23",
  "respx>=0.21",
  "ruff>=0.5",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = ["integration: needs docker compose services (set MRA_INTEGRATION=1)"]

[tool.ruff]
line-length = 100
target-version = "py312"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["app"]
```
Run: `cd backend && uv sync` — Expected: `.venv` created, `uv.lock` written, no errors.

- [ ] **Step 2: Write the failing settings test**

`backend/tests/unit/test_config.py`:
```python
from app.config import Settings


def test_defaults_are_local_dev():
    s = Settings(_env_file=None)
    assert s.database_url.startswith("postgresql+psycopg://")
    assert s.redis_url == "redis://localhost:6379/0"
    assert s.review_rate_limit == "5/hour"
    assert s.max_topic_length == 300


def test_checkpoint_conninfo_strips_sqlalchemy_driver():
    s = Settings(_env_file=None, database_url="postgresql+psycopg://u:p@db:5432/mra")
    assert s.checkpoint_conninfo == "postgresql://u:p@db:5432/mra"


def test_env_override(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://r:6379/3")
    assert Settings(_env_file=None).redis_url == "redis://r:6379/3"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'` (or `ImportError`)

- [ ] **Step 4: Implement settings and logging**

`backend/app/__init__.py`: empty file.

`backend/app/config.py`:
```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://mra:mra@localhost:5432/mra"
    redis_url: str = "redis://localhost:6379/0"
    ratelimit_storage_uri: str = "memory://"
    searxng_url: str = "http://localhost:8080"

    anthropic_api_key: str = ""
    contact_email: str = ""

    trust_proxy: bool = False
    ip_hash_salt: str = "change-me"
    review_rate_limit: str = "5/hour"
    max_topic_length: int = 300
    result_cache_ttl_seconds: int = 86400
    event_stream_ttl_seconds: int = 86400
    sse_ping_seconds: int = 15
    max_concurrent_reviews_per_worker: int = 2
    stale_running_minutes: int = 30

    @property
    def checkpoint_conninfo(self) -> str:
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`backend/app/logging.py`:
```python
import logging

import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
```

- [ ] **Step 5: Run settings tests**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: 3 PASS

- [ ] **Step 6: Write the failing health test**

`backend/tests/unit/test_health.py`:
```python
import httpx

from app.config import Settings
from app.main import create_app


async def test_healthz_reports_ok_without_backends():
    app = create_app(Settings(_env_file=None))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] is None and body["redis"] is None
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 8: Implement app factory and health route**

`backend/app/api/__init__.py`: empty file.

`backend/app/api/health.py`:
```python
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request) -> JSONResponse:
    deps = getattr(request.app.state, "deps", None)
    db_ok: bool | None = None
    redis_ok: bool | None = None
    if deps is not None:
        try:
            async with deps.session_factory() as session:
                await session.execute(text("SELECT 1"))
            db_ok = True
        except Exception:  # noqa: BLE001 - health must never raise
            db_ok = False
        try:
            redis_ok = bool(await deps.redis.ping())
        except Exception:  # noqa: BLE001
            redis_ok = False
    healthy = db_ok is not False and redis_ok is not False
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "db": db_ok, "redis": redis_ok},
    )
```

`backend/app/main.py`:
```python
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.config import Settings, get_settings
from app.logging import configure_logging


@dataclass
class AppDeps:
    session_factory: Any
    redis: Any
    queue: Any
    event_sink: Any


def create_app(settings: Settings | None = None, deps: AppDeps | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if deps is not None:
            app.state.deps = deps
            yield
            return
        from app.infra import build_runtime_deps, close_runtime_deps  # Task 6 adds this module

        runtime = await build_runtime_deps(settings)
        app.state.deps = runtime
        try:
            yield
        finally:
            await close_runtime_deps(runtime)

    app = FastAPI(
        title="Medical Reviewer Agent API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    if deps is not None:
        app.state.deps = deps
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id"],
    )
    app.include_router(health.router, prefix="/api/v1", tags=["system"])
    return app


app = create_app()
```
Note: `app.infra` is created in Task 6; until then the import is only reached when running the real server, not in tests (tests pass `settings` and never trigger lifespan).

- [ ] **Step 9: Run health test**

Run: `cd backend && uv run pytest tests/unit -v`
Expected: 4 PASS

- [ ] **Step 10: Add test scaffolding, gitignore, CLAUDE.md and commit**

`backend/tests/__init__.py`, `backend/tests/unit/__init__.py`: empty files.

`backend/tests/conftest.py`:
```python
import os

import pytest


def pytest_collection_modifyitems(config, items):
    if os.environ.get("MRA_INTEGRATION") == "1":
        return
    skip = pytest.mark.skip(reason="integration test; set MRA_INTEGRATION=1 with docker compose up")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)
```

`.gitignore` (repo root):
```
# python
backend/.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
# node
frontend/node_modules/
frontend/.next/
# env & data
.env
*.db
infra/searxng/limiter.toml
infra/searxng/settings.yml.new
# os
.DS_Store
Thumbs.db
```

`CLAUDE.md` (repo root):
```markdown
# Medical Reviewer Agent

Monorepo: `backend/` (Python 3.12, FastAPI + LangGraph + arq), `frontend/` (Next.js 16), `infra/` (compose configs).
Spec: `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- Backend tests: `cd backend && uv run pytest` (unit). Integration: `MRA_INTEGRATION=1 uv run pytest -m integration` with `docker compose up -d postgres redis searxng`.
- Lint: `cd backend && uv run ruff check .`
- API dev server: `cd backend && uv run uvicorn app.main:app --reload --port 8000`
- Worker: `cd backend && uv run arq app.worker.settings.WorkerSettings`
- Migrations: `cd backend && uv run alembic upgrade head`; new: `uv run alembic revision --autogenerate -m "..."`
- Full stack: `docker compose up -d --build`

## Conventions
- Graph nodes report progress only via `langgraph.config.get_stream_writer()`; the worker's `EventSink` is the only writer to `review_events` / Redis Streams.
- Repositories never commit; callers use `async with session.begin()`.
- Structured LLM calls go through `app/services/llm.py` (`method="json_schema"`), never raw `ChatAnthropic` in nodes.
- Redis clients use `decode_responses=True`.
```

Run:
```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(backend): scaffold FastAPI app, settings, logging, health endpoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 2: Docker infra — Postgres, Redis, searxng-LDR-academic with JSON API

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `infra/postgres/init.sql`, `infra/searxng/settings.yml`
- Create: `backend/tests/integration/__init__.py`, `backend/tests/integration/test_searxng_json.py`

**Interfaces:**
- Produces: running services on `localhost:5432` (db `mra` + `mra_test`, user/pass `mra`/`mra`), `localhost:6379`, `localhost:8080` (SearXNG with `format=json`).

- [ ] **Step 1: Write the failing SearXNG integration test**

`backend/tests/integration/__init__.py`: empty.

`backend/tests/integration/test_searxng_json.py`:
```python
import os

import httpx
import pytest

pytestmark = pytest.mark.integration

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")


async def test_search_json_returns_academic_results():
    async with httpx.AsyncClient(base_url=SEARXNG_URL, timeout=60) as client:
        resp = await client.get(
            "/search",
            params={"q": "metformin colorectal cancer", "format": "json", "engines": "pubmed,arxiv"},
        )
    assert resp.status_code == 200, resp.text[:300]
    body = resp.json()
    assert "results" in body
    assert len(body["results"]) > 0
    engines = {e for r in body["results"] for e in r.get("engines", [])}
    assert engines & {"pubmed", "arxiv"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_searxng_json.py -v`
Expected: FAIL with `httpx.ConnectError` (nothing listening on 8080)

- [ ] **Step 3: Write the SearXNG override settings**

`infra/searxng/settings.yml`:
```yaml
# Overrides merged on top of the fork's bundled searx/settings.yml (academic engines pre-enabled).
# Mounted read-write at /etc/searxng (the entrypoint sed's the secret and chowns the dir).
use_default_settings: true

general:
  instance_name: "MRA academic search"
  debug: false

search:
  safe_search: 2
  default_lang: "en-US"
  formats:
    - html
    - json

server:
  secret_key: "ultrasecretkey"   # replaced at container start by the entrypoint / SEARXNG_SECRET
  limiter: false
  public_instance: false
  image_proxy: false
```

- [ ] **Step 4: Write compose, env example, postgres init**

`infra/postgres/init.sql`:
```sql
CREATE DATABASE mra_test;
```

`.env.example` (repo root):
```
# --- LLM ---
ANTHROPIC_API_KEY=
CONTACT_EMAIL=you@example.com

# --- infra (compose service names) ---
DATABASE_URL=postgresql+psycopg://mra:mra@postgres:5432/mra
REDIS_URL=redis://redis:6379/0
RATELIMIT_STORAGE_URI=redis://redis:6379/1
SEARXNG_URL=http://searxng:8080
SEARXNG_SECRET=change-me-to-a-long-random-string

# --- app ---
APP_ENV=dev
LOG_LEVEL=INFO
TRUST_PROXY=true
IP_HASH_SALT=change-me
REVIEW_RATE_LIMIT=5/hour
MAX_CONCURRENT_REVIEWS_PER_WORKER=2
```

`docker-compose.yml` (repo root):
```yaml
name: mra

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: mra
      POSTGRES_PASSWORD: mra
      POSTGRES_DB: mra
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mra -d mra"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--save", "60", "1", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  searxng:
    build:
      context: https://github.com/porespellar/searxng-LDR-academic.git#f314c2258e1a7647f30cae650d951c83f0eb639b
    image: mra/searxng-ldr-academic:f314c22
    environment:
      SEARXNG_SECRET: ${SEARXNG_SECRET:-change-me-to-a-long-random-string}
      SEARXNG_BASE_URL: http://searxng:8080/
    volumes:
      - ./infra/searxng:/etc/searxng
      - searxngdata:/var/lib/searxng
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "python3 -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=5).status == 200 else 1)\""]
      interval: 10s
      timeout: 6s
      retries: 30
      start_period: 20s

volumes:
  pgdata:
  redisdata:
  searxngdata:
```

- [ ] **Step 5: Build and start infra, verify JSON**

Run (first build takes several minutes):
```bash
cd /d/MedicalReviewerAgent && cp -n .env.example .env; docker compose up -d --build postgres redis searxng && docker compose ps
```
Expected: three services `healthy`. Then:
```bash
curl -s "http://localhost:8080/search?q=metformin&format=json&engines=pubmed" | head -c 400
```
Expected: JSON starting with `{"query": "metformin", "number_of_results": ...` (not a 403 HTML page). If `403`, run `docker compose logs searxng` and confirm `/etc/searxng/settings.yml` inside the container contains `- json` (`docker compose exec searxng cat /etc/searxng/settings.yml`).

- [ ] **Step 6: Run the integration test**

Run: `cd backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_searxng_json.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "infra: compose with postgres, redis and searxng-LDR-academic (json enabled)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Database models, repositories, Alembic migration

**Files:**
- Create: `backend/app/db/__init__.py`, `backend/app/db/models.py`, `backend/app/db/session.py`, `backend/app/db/repositories.py`
- Create: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/` (autogenerated initial revision)
- Create: `backend/tests/unit/test_repositories.py`; Modify: `backend/tests/conftest.py`

**Interfaces:**
- Produces: `Base`, `Review`, `Paper`, `ReviewPaper`, `ReviewEvent`, `ApiKey`, `ReviewStatus`, `TERMINAL_STATUSES`; `make_engine(url) -> AsyncEngine`, `make_session_factory(engine) -> async_sessionmaker`; `ReviewRepository(session)` with `create(...)`, `get(id)`, `find_reusable(cache_key, done_after)`, `update(id, **fields)`, `list_recent(limit)`, `list_stale_running(older_than)`; `EventRepository(session)` with `append(review_id, type, payload) -> ReviewEvent`, `list_since(review_id, after_seq) -> list[ReviewEvent]`.

- [ ] **Step 1: Write failing repository tests**

Add to `backend/tests/conftest.py` (append below the existing hook):
```python
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.models import Base
from app.db.session import make_session_factory


@pytest.fixture
async def session_factory(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()
```

`backend/tests/unit/test_repositories.py`:
```python
import uuid
from datetime import UTC, datetime, timedelta

from app.db.models import ReviewStatus
from app.db.repositories import EventRepository, ReviewRepository


async def _create(session_factory, **kw):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(
            topic=kw.get("topic", "metformin"),
            language=kw.get("language", "th"),
            options=kw.get("options", {"max_papers": 10}),
            cache_key=kw.get("cache_key", "k1"),
            ip_hash="h",
        )
    return review


async def test_create_and_get_roundtrip(session_factory):
    created = await _create(session_factory)
    async with session_factory() as s:
        got = await ReviewRepository(s).get(created.id)
    assert got is not None
    assert got.topic == "metformin"
    assert got.status == ReviewStatus.queued.value
    assert got.options == {"max_papers": 10}


async def test_get_unknown_returns_none(session_factory):
    async with session_factory() as s:
        assert await ReviewRepository(s).get(uuid.uuid4()) is None


async def test_find_reusable_prefers_active_then_recent_done(session_factory):
    now = datetime.now(UTC)
    old_done = await _create(session_factory, cache_key="k")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            old_done.id, status="done", finished_at=now - timedelta(days=2)
        )
    async with session_factory() as s:
        assert await ReviewRepository(s).find_reusable("k", now - timedelta(days=1)) is None

    running = await _create(session_factory, cache_key="k")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(running.id, status="running")
    async with session_factory() as s:
        found = await ReviewRepository(s).find_reusable("k", now - timedelta(days=1))
    assert found is not None and found.id == running.id


async def test_list_recent_only_done_and_listed(session_factory):
    a = await _create(session_factory, cache_key="a")
    b = await _create(session_factory, cache_key="b")
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        await repo.update(a.id, status="done", finished_at=datetime.now(UTC))
        await repo.update(b.id, status="done", finished_at=datetime.now(UTC), is_listed=False)
    async with session_factory() as s:
        recent = await ReviewRepository(s).list_recent(limit=10)
    assert [r.id for r in recent] == [a.id]


async def test_events_seq_is_monotonic_per_review(session_factory):
    r1 = await _create(session_factory, cache_key="x")
    r2 = await _create(session_factory, cache_key="y")
    async with session_factory() as s, s.begin():
        repo = EventRepository(s)
        e1 = await repo.append(r1.id, "queued", {})
        e2 = await repo.append(r1.id, "planning", {"n": 1})
        e3 = await repo.append(r2.id, "queued", {})
    assert (e1.seq, e2.seq, e3.seq) == (1, 2, 1)
    async with session_factory() as s:
        later = await EventRepository(s).list_since(r1.id, after_seq=1)
    assert [e.type for e in later] == ["planning"]
    assert later[0].payload == {"n": 1}


async def test_list_stale_running(session_factory):
    r = await _create(session_factory, cache_key="s")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            r.id, status="running", started_at=datetime.now(UTC) - timedelta(hours=2)
        )
    async with session_factory() as s:
        stale = await ReviewRepository(s).list_stale_running(
            older_than=datetime.now(UTC) - timedelta(minutes=30)
        )
    assert [x.id for x in stale] == [r.id]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_repositories.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'`

- [ ] **Step 3: Implement models**

`backend/app/db/__init__.py`: empty.

`backend/app/db/models.py`:
```python
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class ReviewStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    error = "error"
    rejected = "rejected"
    cancelled = "cancelled"


TERMINAL_STATUSES = {
    ReviewStatus.done.value,
    ReviewStatus.error.value,
    ReviewStatus.rejected.value,
    ReviewStatus.cancelled.value,
}


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    daily_quota: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    topic: Mapped[str] = mapped_column(Text)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    language: Mapped[str] = mapped_column(String(8), default="th")
    options: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(16), default=ReviewStatus.queued.value, index=True)
    progress: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("api_keys.id"), nullable=True
    )
    callback_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    model_versions: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_listed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Paper(Base):
    __tablename__ = "papers"
    __table_args__ = (
        Index("ux_papers_doi", "doi", unique=True, postgresql_where="doi IS NOT NULL",
              sqlite_where="doi IS NOT NULL"),
        Index("ux_papers_pmid", "pmid", unique=True, postgresql_where="pmid IS NOT NULL",
              sqlite_where="pmid IS NOT NULL"),
        Index("ux_papers_pmcid", "pmcid", unique=True, postgresql_where="pmcid IS NOT NULL",
              sqlite_where="pmcid IS NOT NULL"),
        Index("ux_papers_arxiv", "arxiv_id", unique=True, postgresql_where="arxiv_id IS NOT NULL",
              sqlite_where="arxiv_id IS NOT NULL"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pmid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pmcid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    arxiv_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list[str]] = mapped_column(JSONType, default=list)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    journal: Mapped[str | None] = mapped_column(Text, nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    oa_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fulltext_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReviewPaper(Base):
    __tablename__ = "review_papers"

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True
    )
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    screen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    included: Mapped[bool] = mapped_column(Boolean, default=False)
    extraction: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)


class ReviewEvent(Base):
    __tablename__ = "review_events"
    __table_args__ = (UniqueConstraint("review_id", "seq", name="uq_review_events_seq"),)

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True,
                                    autoincrement=True)
    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

`backend/app/db/session.py`:
```python
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

- [ ] **Step 4: Implement repositories**

`backend/app/db/repositories.py`:
```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Review, ReviewEvent, ReviewStatus

ACTIVE_STATUSES = (ReviewStatus.queued.value, ReviewStatus.running.value)


class ReviewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        topic: str,
        language: str,
        options: dict[str, Any],
        cache_key: str,
        ip_hash: str | None = None,
        callback_url: str | None = None,
        api_key_id: uuid.UUID | None = None,
    ) -> Review:
        review = Review(
            topic=topic,
            language=language,
            options=options,
            cache_key=cache_key,
            ip_hash=ip_hash,
            callback_url=callback_url,
            api_key_id=api_key_id,
        )
        self.session.add(review)
        await self.session.flush()
        return review

    async def get(self, review_id: uuid.UUID) -> Review | None:
        return await self.session.get(Review, review_id)

    async def find_reusable(self, cache_key: str, done_after: datetime) -> Review | None:
        stmt = (
            select(Review)
            .where(Review.cache_key == cache_key)
            .where(
                or_(
                    Review.status.in_(ACTIVE_STATUSES),
                    (Review.status == ReviewStatus.done.value) & (Review.finished_at >= done_after),
                )
            )
            .order_by(Review.created_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def update(self, review_id: uuid.UUID, **fields: Any) -> None:
        await self.session.execute(update(Review).where(Review.id == review_id).values(**fields))

    async def list_recent(self, limit: int = 20) -> list[Review]:
        stmt = (
            select(Review)
            .where(Review.status == ReviewStatus.done.value, Review.is_listed.is_(True))
            .order_by(Review.finished_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars())

    async def list_stale_running(self, older_than: datetime) -> list[Review]:
        stmt = select(Review).where(
            Review.status == ReviewStatus.running.value, Review.started_at < older_than
        )
        return list((await self.session.execute(stmt)).scalars())


class EventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def append(self, review_id: uuid.UUID, type: str, payload: dict[str, Any]) -> ReviewEvent:
        next_seq = (
            await self.session.execute(
                select(func.coalesce(func.max(ReviewEvent.seq), 0) + 1).where(
                    ReviewEvent.review_id == review_id
                )
            )
        ).scalar_one()
        event = ReviewEvent(review_id=review_id, seq=next_seq, type=type, payload=payload)
        self.session.add(event)
        await self.session.flush()
        return event

    async def list_since(self, review_id: uuid.UUID, after_seq: int = 0) -> list[ReviewEvent]:
        stmt = (
            select(ReviewEvent)
            .where(ReviewEvent.review_id == review_id, ReviewEvent.seq > after_seq)
            .order_by(ReviewEvent.seq)
        )
        return list((await self.session.execute(stmt)).scalars())
```

- [ ] **Step 5: Run repository tests**

Run: `cd backend && uv run pytest tests/unit/test_repositories.py -v`
Expected: 6 PASS

- [ ] **Step 6: Configure Alembic (async) and generate the initial migration**

`backend/alembic.ini`:
```ini
[alembic]
script_location = migrations
prepend_sys_path = .
sqlalchemy.url = postgresql+psycopg://mra:mra@localhost:5432/mra

[loggers]
keys = root,sqlalchemy,alembic
[handlers]
keys = console
[formatters]
keys = generic
[logger_root]
level = WARN
handlers = console
[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine
[logger_alembic]
level = INFO
handlers =
qualname = alembic
[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic
[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

`backend/migrations/env.py`:
```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

`backend/migrations/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Run (Postgres from Task 2 must be up; the host-side URL is the `Settings` default):
```bash
cd backend && mkdir -p migrations/versions && DATABASE_URL=postgresql+psycopg://mra:mra@localhost:5432/mra uv run alembic revision --autogenerate -m "initial schema" && DATABASE_URL=postgresql+psycopg://mra:mra@localhost:5432/mra uv run alembic upgrade head
```
Expected: a file `migrations/versions/<rev>_initial_schema.py` creating `api_keys, reviews, papers, review_papers, review_events` and `alembic upgrade head` prints `Running upgrade -> <rev>, initial schema`. Verify: `docker compose exec postgres psql -U mra -d mra -c '\dt'` lists the five tables plus `alembic_version`.

- [ ] **Step 7: Run all unit tests and commit**

Run: `cd backend && uv run pytest tests/unit -v` — Expected: all PASS
```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(db): models, repositories and initial alembic migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: EventSink (DB + Redis Streams) and live stream reader

**Files:**
- Create: `backend/app/services/__init__.py`, `backend/app/services/events.py`
- Create: `backend/tests/unit/test_events.py`; Modify: `backend/tests/conftest.py`

**Interfaces:**
- Produces: `TERMINAL_EVENT_TYPES`, `stream_key(review_id) -> str`, `EventSink(session_factory, redis, ttl_seconds).emit(review_id, type, payload) -> int (seq)`, `read_live(redis, review_id, *, after_seq, block_ms=15000) -> AsyncIterator[dict | None]` (yields `None` on idle timeout so callers can check disconnects; dict = `{"seq", "type", "payload"}`).

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/conftest.py`:
```python
import fakeredis.aioredis


@pytest.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()
```

`backend/tests/unit/test_events.py`:
```python
import asyncio

from app.db.repositories import EventRepository, ReviewRepository
from app.services.events import EventSink, read_live, stream_key


async def _review(session_factory):
    async with session_factory() as s, s.begin():
        return await ReviewRepository(s).create(
            topic="t", language="en", options={}, cache_key="c"
        )


async def test_emit_persists_and_publishes(session_factory, redis):
    review = await _review(session_factory)
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    seq1 = await sink.emit(review.id, "queued", {})
    seq2 = await sink.emit(review.id, "searching", {"found": 42})
    assert (seq1, seq2) == (1, 2)

    async with session_factory() as s:
        rows = await EventRepository(s).list_since(review.id, 0)
    assert [(r.seq, r.type) for r in rows] == [(1, "queued"), (2, "searching")]

    entries = await redis.xrange(stream_key(review.id))
    assert [e[1]["type"] for e in entries] == ["queued", "searching"]
    assert await redis.ttl(stream_key(review.id)) > 0


async def test_read_live_skips_already_seen_and_stops_at_terminal(session_factory, redis):
    review = await _review(session_factory)
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    await sink.emit(review.id, "queued", {})
    await sink.emit(review.id, "planning", {})
    await sink.emit(review.id, "done", {"cost_usd": 0.1})

    seen = []
    async for ev in read_live(redis, review.id, after_seq=1, block_ms=100):
        if ev is None:
            continue
        seen.append(ev)
        if ev["type"] == "done":
            break
    assert [e["seq"] for e in seen] == [2, 3]
    assert seen[-1]["payload"] == {"cost_usd": 0.1}


async def test_read_live_yields_none_when_idle(redis):
    import uuid

    gen = read_live(redis, uuid.uuid4(), after_seq=0, block_ms=50)
    first = await asyncio.wait_for(gen.__anext__(), timeout=2)
    assert first is None
    await gen.aclose()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_events.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services'`

- [ ] **Step 3: Implement EventSink and read_live**

`backend/app/services/__init__.py`: empty.

`backend/app/services/events.py`:
```python
from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.repositories import EventRepository

TERMINAL_EVENT_TYPES = {"done", "error", "rejected", "cancelled"}
STREAM_MAXLEN = 1000


def stream_key(review_id: uuid.UUID | str) -> str:
    return f"review:{review_id}:events"


class EventSink:
    """The only writer of review progress: review_events (durable) + Redis Stream (live)."""

    def __init__(self, session_factory: async_sessionmaker, redis: Redis, ttl_seconds: int) -> None:
        self.session_factory = session_factory
        self.redis = redis
        self.ttl_seconds = ttl_seconds

    async def emit(self, review_id: uuid.UUID, type: str, payload: dict[str, Any] | None = None) -> int:
        payload = payload or {}
        async with self.session_factory() as session, session.begin():
            event = await EventRepository(session).append(review_id, type, payload)
            seq = event.seq
        key = stream_key(review_id)
        await self.redis.xadd(
            key,
            {"seq": str(seq), "type": type, "payload": json.dumps(payload, default=str)},
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )
        await self.redis.expire(key, self.ttl_seconds)
        return seq


async def read_live(
    redis: Redis, review_id: uuid.UUID | str, *, after_seq: int, block_ms: int = 15000
) -> AsyncIterator[dict[str, Any] | None]:
    """Tail the review's Redis Stream from the beginning, dropping seq <= after_seq.

    Reading from '0-0' (not '$') closes the gap between a DB replay and subscribing: every
    event still in the stream is re-read and de-duplicated by seq. Yields None on idle
    timeout so the caller can check for client disconnects.
    """
    key = stream_key(review_id)
    last_id = "0-0"
    while True:
        response = await redis.xread({key: last_id}, block=block_ms, count=100)
        if not response:
            yield None
            continue
        for _, entries in response:
            for entry_id, fields in entries:
                last_id = entry_id
                seq = int(fields["seq"])
                if seq <= after_seq:
                    continue
                after_seq = seq
                yield {"seq": seq, "type": fields["type"], "payload": json.loads(fields["payload"])}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_events.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(events): EventSink writing review_events and Redis Streams, live reader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SSE endpoint with replay + live tail

**Files:**
- Create: `backend/app/api/deps.py`, `backend/app/api/events.py`
- Modify: `backend/app/main.py` (include router)
- Create: `backend/tests/unit/test_sse.py`; Modify: `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `EventSink`, `read_live`, `ReviewRepository`, `EventRepository`, `TERMINAL_STATUSES`, `TERMINAL_EVENT_TYPES`
- Produces: `GET /api/v1/reviews/{review_id}/events` (SSE; `id:` = seq, `event:` = type, `data:` = JSON payload; honours `Last-Event-ID` header and `?since=`); `app.api.deps.get_deps(request) -> AppDeps`, `get_settings_dep(request) -> Settings`, `parse_since(value: str | None) -> int`.

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/conftest.py`:
```python
import httpx

from app.config import Settings
from app.main import AppDeps, create_app
from app.services.events import EventSink


class FakeJobQueue:
    def __init__(self) -> None:
        self.enqueued: list[str] = []

    async def enqueue_review(self, review_id) -> bool:
        self.enqueued.append(str(review_id))
        return True


@pytest.fixture
def queue():
    return FakeJobQueue()


@pytest.fixture
def test_settings():
    return Settings(_env_file=None, ratelimit_storage_uri="memory://", review_rate_limit="100/minute")


@pytest.fixture
async def app(session_factory, redis, queue, test_settings):
    import app.api.ratelimit as rl

    rl.limiter.reset()
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    deps = AppDeps(session_factory=session_factory, redis=redis, queue=queue, event_sink=sink)
    return create_app(test_settings, deps=deps)


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

`backend/tests/unit/test_sse.py`:
```python
import json
import uuid

import pytest

from app.api.events import parse_since
from app.db.repositories import ReviewRepository


def _parse_sse(text: str) -> list[dict]:
    events, current = [], {}
    for line in text.splitlines():
        if not line.strip():
            if current:
                events.append(current)
                current = {}
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        current[field] = value.strip()
    if current:
        events.append(current)
    return events


@pytest.mark.parametrize("raw,expected", [(None, 0), ("", 0), ("7", 7), ("abc", 0), ("-5", 0)])
def test_parse_since(raw, expected):
    assert parse_since(raw) == expected


async def test_events_404_for_unknown_review(client):
    resp = await client.get(f"/api/v1/reviews/{uuid.uuid4()}/events")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "review not found"


async def test_replays_from_db_and_stops_at_terminal(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    sink = app.state.deps.event_sink
    await sink.emit(review.id, "queued", {})
    await sink.emit(review.id, "planning", {"queries": 3})
    await sink.emit(review.id, "done", {"cost_usd": 0.2})

    async with client.stream("GET", f"/api/v1/reviews/{review.id}/events") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = await resp.aread()
    events = _parse_sse(body.decode())
    assert [e["event"] for e in events] == ["queued", "planning", "done"]
    assert [e["id"] for e in events] == ["1", "2", "3"]
    assert json.loads(events[1]["data"]) == {"queries": 3}


async def test_last_event_id_resumes_without_duplicates(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    sink = app.state.deps.event_sink
    for t in ["queued", "planning", "searching", "done"]:
        await sink.emit(review.id, t, {})

    async with client.stream(
        "GET", f"/api/v1/reviews/{review.id}/events", headers={"Last-Event-ID": "2"}
    ) as resp:
        body = await resp.aread()
    assert [e["event"] for e in _parse_sse(body.decode())] == ["searching", "done"]


async def test_non_numeric_last_event_id_is_treated_as_zero(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    await app.state.deps.event_sink.emit(review.id, "error", {"message": "boom"})
    async with client.stream(
        "GET", f"/api/v1/reviews/{review.id}/events", headers={"Last-Event-ID": "abc"}
    ) as resp:
        body = await resp.aread()
    assert [e["event"] for e in _parse_sse(body.decode())] == ["error"]


async def test_terminal_review_with_no_events_closes_immediately(client, session_factory):
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        review = await repo.create(topic="t", language="en", options={}, cache_key="k")
        await repo.update(review.id, status="done")
    async with client.stream("GET", f"/api/v1/reviews/{review.id}/events") as resp:
        body = await resp.aread()
    assert _parse_sse(body.decode()) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_sse.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.api.events'`

- [ ] **Step 3: Implement deps and the SSE route**

`backend/app/api/deps.py`:
```python
from fastapi import Request

from app.config import Settings
from app.main import AppDeps


def get_deps(request: Request) -> AppDeps:
    return request.app.state.deps


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings
```

`backend/app/api/events.py`:
```python
from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_deps, get_settings_dep
from app.config import Settings
from app.db.models import TERMINAL_STATUSES
from app.db.repositories import EventRepository, ReviewRepository
from app.main import AppDeps
from app.services.events import TERMINAL_EVENT_TYPES, read_live

router = APIRouter()


def parse_since(value: str | None) -> int:
    if not value:
        return 0
    try:
        return max(int(value), 0)
    except ValueError:
        return 0


@router.get("/reviews/{review_id}/events")
async def review_events(
    review_id: uuid.UUID,
    request: Request,
    deps: AppDeps = Depends(get_deps),
    settings: Settings = Depends(get_settings_dep),
) -> EventSourceResponse:
    after_seq = parse_since(request.headers.get("last-event-id") or request.query_params.get("since"))

    async with deps.session_factory() as session:
        review = await ReviewRepository(session).get(review_id)
        if review is None:
            raise HTTPException(status_code=404, detail="review not found")
        replay = await EventRepository(session).list_since(review_id, after_seq)
    review_status = review.status

    async def generate() -> AsyncIterator[dict]:
        last = after_seq
        for ev in replay:
            last = ev.seq
            yield {"id": str(ev.seq), "event": ev.type, "data": json.dumps(ev.payload, default=str)}
            if ev.type in TERMINAL_EVENT_TYPES:
                return
        if review_status in TERMINAL_STATUSES:
            return
        async for ev in read_live(deps.redis, review_id, after_seq=last, block_ms=5000):
            if await request.is_disconnected():
                return
            if ev is None:
                continue
            yield {"id": str(ev["seq"]), "event": ev["type"], "data": json.dumps(ev["payload"], default=str)}
            if ev["type"] in TERMINAL_EVENT_TYPES:
                return

    return EventSourceResponse(generate(), ping=settings.sse_ping_seconds)
```

Modify `backend/app/main.py`: change `from app.api import health` to `from app.api import events, health` and after the health router add:
```python
    app.include_router(events.router, prefix="/api/v1", tags=["reviews"])
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_sse.py -v`
Expected: 9 PASS (5 parametrized + 4 async)

- [ ] **Step 5: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(api): SSE review events endpoint with DB replay and Redis Streams tail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Reviews REST API (create with dedupe + enqueue, get, list) and runtime deps

**Files:**
- Create: `backend/app/schemas/__init__.py`, `backend/app/schemas/review.py`, `backend/app/api/ratelimit.py`, `backend/app/api/reviews.py`, `backend/app/services/queue.py`, `backend/app/infra.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/unit/test_reviews_api.py`

**Interfaces:**
- Consumes: `ReviewRepository`, `EventSink`, `FakeJobQueue.enqueue_review(review_id) -> bool`
- Produces: `ReviewOptions`, `CreateReviewRequest`, `ReviewCreated`, `ReviewOut`, `compute_cache_key(topic, language, options) -> str`, `hash_ip(ip, salt) -> str`, `client_ip(request) -> str`, `JobQueue` Protocol + `ArqJobQueue(pool)`, `build_runtime_deps(settings) -> AppDeps`, `close_runtime_deps(deps)`; routes `POST /api/v1/reviews`, `GET /api/v1/reviews/{id}`, `GET /api/v1/reviews?recent=N`.

- [ ] **Step 1: Write failing tests**

`backend/tests/unit/test_reviews_api.py`:
```python
import uuid
from datetime import UTC, datetime, timedelta

from app.db.repositories import ReviewRepository
from app.schemas.review import compute_cache_key


def test_cache_key_normalizes_whitespace_and_case():
    a = compute_cache_key("  Metformin   AND  Cancer ", "th", {"max_papers": 10})
    b = compute_cache_key("metformin and cancer", "th", {"max_papers": 10})
    c = compute_cache_key("metformin and cancer", "en", {"max_papers": 10})
    assert a == b and a != c and len(a) == 64


async def test_create_review_enqueues_and_emits_queued(client, queue, session_factory):
    resp = await client.post(
        "/api/v1/reviews", json={"topic": "metformin colorectal cancer", "language": "th"}
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued" and body["cached"] is False
    review_id = uuid.UUID(body["review_id"])
    assert queue.enqueued == [str(review_id)]

    got = await client.get(f"/api/v1/reviews/{review_id}")
    assert got.status_code == 200
    assert got.json()["topic"] == "metformin colorectal cancer"
    assert got.json()["options"]["max_papers"] == 10

    async with client.stream("GET", f"/api/v1/reviews/{review_id}/events") as s:
        first_chunk = await s.aiter_bytes().__anext__()
    assert b"event: queued" in first_chunk


async def test_duplicate_request_while_active_returns_same_review(client, queue):
    payload = {"topic": "aspirin stroke prevention", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    second = (await client.post("/api/v1/reviews", json=payload)).json()
    assert second["review_id"] == first["review_id"]
    assert second["cached"] is True
    assert len(queue.enqueued) == 1


async def test_recent_done_review_is_reused_but_old_one_is_not(client, queue, session_factory):
    payload = {"topic": "statin myopathy", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(first["review_id"]), status="done", finished_at=datetime.now(UTC)
        )
    assert (await client.post("/api/v1/reviews", json=payload)).json()["cached"] is True

    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(first["review_id"]), finished_at=datetime.now(UTC) - timedelta(days=3)
        )
    third = (await client.post("/api/v1/reviews", json=payload)).json()
    assert third["cached"] is False and third["review_id"] != first["review_id"]
    assert len(queue.enqueued) == 2


async def test_validation_rejects_blank_long_and_bad_language(client):
    assert (await client.post("/api/v1/reviews", json={"topic": "   "})).status_code == 422
    assert (await client.post("/api/v1/reviews", json={"topic": "x" * 301})).status_code == 422
    assert (
        await client.post("/api/v1/reviews", json={"topic": "ok topic", "language": "fr"})
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/reviews", json={"topic": "ok topic", "options": {"max_papers": 99}}
        )
    ).status_code == 422


async def test_get_unknown_review_404(client):
    assert (await client.get(f"/api/v1/reviews/{uuid.uuid4()}")).status_code == 404


async def test_list_recent_returns_done_only(client, session_factory):
    created = (await client.post("/api/v1/reviews", json={"topic": "vitamin d fracture"})).json()
    assert (await client.get("/api/v1/reviews?recent=5")).json() == []
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(created["review_id"]), status="done", finished_at=datetime.now(UTC)
        )
    listed = (await client.get("/api/v1/reviews?recent=5")).json()
    assert [r["id"] for r in listed] == [created["review_id"]]
    assert "result" not in listed[0]


async def test_rate_limit_returns_429(session_factory, redis, queue, monkeypatch):
    import httpx

    import app.api.ratelimit as rl
    from app.config import Settings, get_settings
    from app.main import AppDeps, create_app
    from app.services.events import EventSink

    # The limit string is read from get_settings() (env REVIEW_RATE_LIMIT) by the decorator.
    monkeypatch.setenv("REVIEW_RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    rl.limiter.reset()
    settings = Settings(_env_file=None, ratelimit_storage_uri="memory://")
    deps = AppDeps(session_factory, redis, queue, EventSink(session_factory, redis, 60))
    app = create_app(settings, deps=deps)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        responses = [
            await c.post("/api/v1/reviews", json={"topic": f"topic number {i}"}) for i in range(3)
        ]
    assert [r.status_code for r in responses] == [202, 202, 429]
    assert "retry-after" in responses[2].headers
    get_settings.cache_clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_reviews_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.schemas'`

- [ ] **Step 3: Implement schemas**

`backend/app/schemas/__init__.py`: empty.

`backend/app/schemas/review.py`:
```python
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class ReviewOptions(BaseModel):
    max_papers: int = Field(10, ge=3, le=20)
    candidate_limit: int = Field(100, ge=20, le=200)
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)


class CreateReviewRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    language: Literal["th", "en"] = "th"
    options: ReviewOptions = Field(default_factory=ReviewOptions)
    callback_url: HttpUrl | None = None

    @field_validator("topic")
    @classmethod
    def topic_must_have_words(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3 or not any(ch.isalnum() for ch in cleaned):
            raise ValueError("topic must contain at least 3 characters including letters or digits")
        return cleaned


class ReviewCreated(BaseModel):
    review_id: uuid.UUID
    status: str
    cached: bool


class ReviewSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    topic: str
    language: str
    status: str
    created_at: datetime
    finished_at: datetime | None


class ReviewOut(ReviewSummary):
    options: dict[str, Any]
    progress: dict[str, Any] | None
    result: dict[str, Any] | None
    error: str | None
    cost_usd: float
    started_at: datetime | None


def compute_cache_key(topic: str, language: str, options: dict[str, Any]) -> str:
    normalized = " ".join(topic.lower().split())
    material = json.dumps({"t": normalized, "l": language, "o": options}, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def hash_ip(ip: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()
```

- [ ] **Step 4: Implement rate limiting helpers, queue abstraction, runtime deps**

`backend/app/api/ratelimit.py`:
```python
from fastapi import Request
from slowapi import Limiter

from app.config import get_settings


def client_ip(request: Request) -> str:
    settings = getattr(request.app.state, "settings", None)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and settings is not None and settings.trust_proxy:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(
    key_func=client_ip, storage_uri=get_settings().ratelimit_storage_uri, headers_enabled=True
)
```

`backend/app/services/queue.py`:
```python
from __future__ import annotations

import uuid
from typing import Protocol

from arq.connections import ArqRedis


def review_job_id(review_id: uuid.UUID | str) -> str:
    return f"review:{review_id}"


class JobQueue(Protocol):
    async def enqueue_review(self, review_id: uuid.UUID) -> bool: ...


class ArqJobQueue:
    def __init__(self, pool: ArqRedis) -> None:
        self.pool = pool

    async def enqueue_review(self, review_id: uuid.UUID) -> bool:
        job = await self.pool.enqueue_job("run_review", str(review_id), _job_id=review_job_id(review_id))
        return job is not None
```

`backend/app/infra.py`:
```python
from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings
from redis.asyncio import Redis

from app.config import Settings
from app.db.session import make_engine, make_session_factory
from app.main import AppDeps
from app.services.events import EventSink
from app.services.queue import ArqJobQueue


async def build_runtime_deps(settings: Settings) -> AppDeps:
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    deps = AppDeps(
        session_factory=session_factory,
        redis=redis,
        queue=ArqJobQueue(arq_pool),
        event_sink=EventSink(session_factory, redis, settings.event_stream_ttl_seconds),
    )
    deps.engine = engine  # type: ignore[attr-defined]
    deps.arq_pool = arq_pool  # type: ignore[attr-defined]
    return deps


async def close_runtime_deps(deps: AppDeps) -> None:
    await deps.arq_pool.aclose()  # type: ignore[attr-defined]
    await deps.redis.aclose()
    await deps.engine.dispose()  # type: ignore[attr-defined]
```

- [ ] **Step 5: Implement the reviews router and wire it**

`backend/app/api/reviews.py`:
```python
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.api.deps import get_deps, get_settings_dep
from app.api.ratelimit import client_ip, limiter
from app.config import Settings, get_settings
from app.db.repositories import ReviewRepository
from app.main import AppDeps
from app.schemas.review import (
    CreateReviewRequest,
    ReviewCreated,
    ReviewOut,
    ReviewSummary,
    compute_cache_key,
    hash_ip,
)

router = APIRouter()


@router.post("/reviews", response_model=ReviewCreated, status_code=202)
@limiter.limit(lambda: get_settings().review_rate_limit)  # slowapi re-evaluates the callable per request
async def create_review(
    request: Request,
    response: Response,
    body: CreateReviewRequest,
    deps: AppDeps = Depends(get_deps),
    settings: Settings = Depends(get_settings_dep),
) -> ReviewCreated:
    options = body.options.model_dump()
    cache_key = compute_cache_key(body.topic, body.language, options)
    done_after = datetime.now(UTC) - timedelta(seconds=settings.result_cache_ttl_seconds)

    async with deps.session_factory() as session, session.begin():
        repo = ReviewRepository(session)
        existing = await repo.find_reusable(cache_key, done_after)
        if existing is not None:
            return ReviewCreated(review_id=existing.id, status=existing.status, cached=True)
        review = await repo.create(
            topic=body.topic,
            language=body.language,
            options=options,
            cache_key=cache_key,
            ip_hash=hash_ip(client_ip(request), settings.ip_hash_salt),
            callback_url=str(body.callback_url) if body.callback_url else None,
        )
        review_id = review.id

    await deps.event_sink.emit(review_id, "queued", {"topic": body.topic})
    await deps.queue.enqueue_review(review_id)
    return ReviewCreated(review_id=review_id, status="queued", cached=False)


@router.get("/reviews", response_model=list[ReviewSummary])
async def list_recent_reviews(
    recent: int = Query(20, ge=1, le=50), deps: AppDeps = Depends(get_deps)
) -> list[ReviewSummary]:
    async with deps.session_factory() as session:
        rows = await ReviewRepository(session).list_recent(limit=recent)
    return [ReviewSummary.model_validate(r) for r in rows]


@router.get("/reviews/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps)) -> ReviewOut:
    async with deps.session_factory() as session:
        review = await ReviewRepository(session).get(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="review not found")
    return ReviewOut.model_validate(review)
```
Why the limit comes from `get_settings()`: slowapi's limit callable receives no request, so it cannot read `app.state.settings`; it reads the process-wide settings (env `REVIEW_RATE_LIMIT`). That is why `test_rate_limit_returns_429` sets the env var and clears the cache, and why the `app` fixture calls `rl.limiter.reset()` so every test starts with a clean in-memory counter under the default `5/hour` (no test issues more than 4 POSTs).

Wire routers in `backend/app/main.py`: change the import to `from app.api import events, health, reviews`, add these imports at the top:
```python
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.ratelimit import limiter
```
and inside `create_app` right after `app.state.settings = settings`:
```python
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
```
and after the events router:
```python
    app.include_router(reviews.router, prefix="/api/v1", tags=["reviews"])
```
Also delete the inline comment `# Task 6 adds this module` on the `app.infra` import.

- [ ] **Step 6: Run tests**

Run: `cd backend && uv run pytest tests/unit -v`
Expected: all PASS (the 429 test returns `[202, 202, 429]` with a `Retry-After` header).

- [ ] **Step 7: Smoke the real server against compose services**

Run in one terminal (Postgres/Redis up from Task 2; `.env` from Task 2 points at compose hostnames, so override for the host):
```bash
cd backend && DATABASE_URL=postgresql+psycopg://mra:mra@localhost:5432/mra REDIS_URL=redis://localhost:6379/0 uv run uvicorn app.main:app --port 8000
```
In a second terminal:
```bash
curl -s -X POST localhost:8000/api/v1/reviews -H 'content-type: application/json' -d '{"topic":"metformin colorectal cancer"}'
```
Expected: `{"review_id":"<uuid>","status":"queued","cached":false}`. Then `curl -N --max-time 5 localhost:8000/api/v1/reviews/<uuid>/events` prints `id: 1`, `event: queued`, `data: {"topic": ...}` and then only `: ping` lines (no worker yet). Posting the same body again returns the same `review_id` with `"cached":true`. Stop uvicorn with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(api): create/get/list reviews with cache-key dedupe, rate limiting and arq enqueue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: LangGraph review graph skeleton (state with reducers, stub nodes, custom stream events)

**Files:**
- Create: `backend/app/graph/__init__.py`, `backend/app/graph/state.py`, `backend/app/graph/graph.py`, `backend/app/graph/nodes/__init__.py`, `backend/app/graph/nodes/stubs.py`
- Create: `backend/tests/unit/test_graph_skeleton.py`

**Interfaces:**
- Produces: `ReviewState` TypedDict (`review_id, topic, language, options, errors[+], cost_usd[+], result`), `GraphDeps` dataclass (`settings`), `build_graph(deps, checkpointer=None) -> CompiledStateGraph`, `initial_state(review_id, topic, language, options) -> ReviewState`. Plan 2 adds the real nodes between `plan_queries` and `finalize` and extends `ReviewState`; the worker (Task 8) only depends on these names.

- [ ] **Step 1: Write failing tests**

`backend/tests/unit/test_graph_skeleton.py`:
```python
from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state


async def test_stub_graph_streams_progress_and_produces_result():
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "t1"}}
    state = initial_state("t1", "metformin colorectal cancer", "th", {"max_papers": 10})

    custom, updates = [], []
    async for mode, chunk in graph.astream(
        state, config, stream_mode=["custom", "updates"], durability="sync"
    ):
        (custom if mode == "custom" else updates).append(chunk)

    assert [c["type"] for c in custom] == ["planning", "synthesizing"]
    assert [list(u.keys())[0] for u in updates] == ["plan_queries", "finalize"]

    final = await graph.aget_state(config)
    assert final.values["result"]["summary"].startswith("Stub review")
    assert final.values["result"]["language"] == "th"
    assert final.values["errors"] == []
    assert final.values["cost_usd"] == 0.0


async def test_errors_and_cost_use_add_reducers():
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)))
    out = await graph.ainvoke(
        {**initial_state("x", "topic", "en", {}), "errors": ["pre"], "cost_usd": 0.5}
    )
    assert out["errors"] == ["pre"]
    assert out["cost_usd"] == 0.5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_graph_skeleton.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.graph'`

- [ ] **Step 3: Implement state, stub nodes and the builder**

`backend/app/graph/__init__.py`, `backend/app/graph/nodes/__init__.py`: empty.

`backend/app/graph/state.py`:
```python
from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class ReviewState(TypedDict, total=False):
    review_id: str
    topic: str
    language: str
    options: dict[str, Any]
    # Parallel branches (Send fan-out, added in Plan 2) append to these; reducers merge them.
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
    result: dict[str, Any] | None
```

`backend/app/graph/nodes/stubs.py`:
```python
from __future__ import annotations

from langgraph.config import get_stream_writer

from app.graph.state import ReviewState


async def plan_queries(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "planning", "topic": state["topic"]})
    return {}


async def finalize(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "synthesizing"})
    return {
        "result": {
            "summary": f"Stub review for: {state['topic']}",
            "language": state["language"],
            "papers": [],
            "comparison": [],
        }
    }
```

`backend/app/graph/graph.py`:
```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.graph.nodes import stubs
from app.graph.state import ReviewState


@dataclass
class GraphDeps:
    settings: Settings


def initial_state(review_id: str, topic: str, language: str, options: dict[str, Any]) -> ReviewState:
    return ReviewState(
        review_id=review_id,
        topic=topic,
        language=language,
        options=options,
        errors=[],
        cost_usd=0.0,
        result=None,
    )


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    builder = StateGraph(ReviewState)
    builder.add_node("plan_queries", stubs.plan_queries)
    builder.add_node("finalize", stubs.finalize)
    builder.add_edge(START, "plan_queries")
    builder.add_edge("plan_queries", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_graph_skeleton.py -v`
Expected: 2 PASS. If `langgraph.checkpoint.memory.InMemorySaver` does not exist in the installed version, use `MemorySaver` from the same module (both names are exported in LangGraph 1.x; `InMemorySaver` is the newer alias).

- [ ] **Step 5: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(graph): review graph skeleton with reducers and custom progress stream

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: arq worker — run/resume review, Postgres checkpointer, EventSink bridge, stale-job recovery

**Files:**
- Create: `backend/app/worker/__init__.py`, `backend/app/worker/runner.py`, `backend/app/worker/tasks.py`, `backend/app/worker/settings.py`, `backend/app/db/setup_checkpointer.py`
- Create: `backend/tests/unit/test_runner.py`, `backend/tests/integration/test_worker_postgres.py`

**Interfaces:**
- Consumes: `build_graph`, `initial_state`, `EventSink`, `ReviewRepository`, `TERMINAL_STATUSES`, `review_job_id`
- Produces: `ReviewRunner(session_factory, event_sink, graph).run(review_id, *, resume=False) -> str (final status)`; arq tasks `run_review(ctx, review_id: str)`, `resume_review(ctx, review_id: str)`; `WorkerSettings`; `python -m app.db.setup_checkpointer` (creates LangGraph checkpoint tables).

- [ ] **Step 1: Write failing unit tests (fake graph, sqlite, fakeredis)**

`backend/tests/unit/test_runner.py`:
```python
import uuid

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.db.repositories import EventRepository, ReviewRepository
from app.graph.graph import GraphDeps, build_graph
from app.graph.state import ReviewState
from app.services.events import EventSink
from app.worker.runner import ReviewRunner


async def _queued_review(session_factory):
    async with session_factory() as s, s.begin():
        return await ReviewRepository(s).create(
            topic="metformin", language="en", options={"max_papers": 5}, cache_key="k"
        )


async def test_run_completes_review_and_emits_events(session_factory, redis):
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    status = await ReviewRunner(session_factory, sink, graph).run(review.id)
    assert status == "done"

    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "done"
    assert got.result["summary"] == "Stub review for: metformin"
    assert got.started_at is not None and got.finished_at is not None
    assert [e.type for e in events] == ["started", "planning", "synthesizing", "done"]


def _failing_graph():
    async def boom(state: ReviewState) -> dict:
        get_stream_writer()({"type": "planning"})
        raise RuntimeError("upstream exploded")

    b = StateGraph(ReviewState)
    b.add_node("boom", boom)
    b.add_edge(START, "boom")
    b.add_edge("boom", END)
    return b.compile(checkpointer=InMemorySaver())


async def test_exception_marks_error_and_emits_error_event(session_factory, redis):
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    status = await ReviewRunner(session_factory, sink, _failing_graph()).run(review.id)
    assert status == "error"
    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "error" and "upstream exploded" in got.error
    assert events[-1].type == "error" and "upstream exploded" in events[-1].payload["message"]


async def test_terminal_review_is_not_rerun(session_factory, redis):
    review = await _queued_review(session_factory)
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review.id, status="done")
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)))
    assert await ReviewRunner(session_factory, sink, graph).run(review.id) == "done"
    async with session_factory() as s:
        assert await EventRepository(s).list_since(review.id, 0) == []


async def test_missing_review_returns_missing(session_factory, redis):
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)))
    assert await ReviewRunner(session_factory, sink, graph).run(uuid.uuid4()) == "missing"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.worker'`

- [ ] **Step 3: Implement the runner**

`backend/app/worker/__init__.py`: empty.

`backend/app/worker/runner.py`:
```python
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models import TERMINAL_STATUSES
from app.db.repositories import ReviewRepository
from app.graph.graph import initial_state
from app.logging import get_logger
from app.services.events import EventSink

log = get_logger(__name__)


class ReviewRunner:
    """Drives one review through the graph and bridges progress into the EventSink."""

    def __init__(self, session_factory: async_sessionmaker, event_sink: EventSink, graph) -> None:
        self.session_factory = session_factory
        self.event_sink = event_sink
        self.graph = graph

    async def run(self, review_id: uuid.UUID, *, resume: bool = False) -> str:
        async with self.session_factory() as session, session.begin():
            repo = ReviewRepository(session)
            review = await repo.get(review_id)
            if review is None:
                return "missing"
            if review.status in TERMINAL_STATUSES:
                return review.status
            await repo.update(review_id, status="running", started_at=datetime.now(UTC), error=None)
            topic, language, options = review.topic, review.language, dict(review.options or {})

        await self.event_sink.emit(review_id, "started", {"resume": resume})
        config = {"configurable": {"thread_id": str(review_id)}}
        state_input = None if resume else initial_state(str(review_id), topic, language, options)

        try:
            async for mode, chunk in self.graph.astream(
                state_input, config, stream_mode=["custom", "updates"], durability="sync"
            ):
                if mode == "custom" and isinstance(chunk, dict):
                    payload = {k: v for k, v in chunk.items() if k != "type"}
                    await self.event_sink.emit(review_id, str(chunk.get("type", "progress")), payload)
            snapshot = await self.graph.aget_state(config)
            values = snapshot.values
        except asyncio.CancelledError:
            await self._finish(review_id, "cancelled", error="cancelled")
            await self.event_sink.emit(review_id, "cancelled", {})
            raise
        except Exception as exc:  # noqa: BLE001 - any failure must be recorded, never swallowed silently
            log.exception("review_failed", review_id=str(review_id))
            message = f"{type(exc).__name__}: {exc}"
            await self._finish(review_id, "error", error=message)
            await self.event_sink.emit(review_id, "error", {"message": message})
            return "error"

        cost = float(values.get("cost_usd", 0.0))
        await self._finish(review_id, "done", result=values.get("result"), cost_usd=cost)
        await self.event_sink.emit(review_id, "done", {"cost_usd": cost})
        return "done"

    async def _finish(self, review_id: uuid.UUID, status: str, **fields) -> None:
        async with self.session_factory() as session, session.begin():
            await ReviewRepository(session).update(
                review_id, status=status, finished_at=datetime.now(UTC), **fields
            )
```

- [ ] **Step 4: Run unit tests**

Run: `cd backend && uv run pytest tests/unit/test_runner.py -v`
Expected: 4 PASS

- [ ] **Step 5: Implement arq tasks, worker settings and checkpointer setup**

`backend/app/worker/tasks.py`:
```python
from __future__ import annotations

import uuid

from app.worker.runner import ReviewRunner


def _runner(ctx: dict) -> ReviewRunner:
    return ReviewRunner(ctx["session_factory"], ctx["event_sink"], ctx["graph"])


async def run_review(ctx: dict, review_id: str) -> dict:
    status = await _runner(ctx).run(uuid.UUID(review_id))
    return {"review_id": review_id, "status": status}


async def resume_review(ctx: dict, review_id: str) -> dict:
    status = await _runner(ctx).run(uuid.UUID(review_id), resume=True)
    return {"review_id": review_id, "status": status}
```

`backend/app/worker/settings.py`:
```python
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from arq.connections import RedisSettings
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis

from app.config import get_settings
from app.db.repositories import ReviewRepository
from app.db.session import make_engine, make_session_factory
from app.graph.graph import GraphDeps, build_graph
from app.logging import configure_logging, get_logger
from app.services.events import EventSink
from app.services.queue import review_job_id
from app.worker.tasks import resume_review, run_review

log = get_logger(__name__)


async def startup(ctx: dict) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    ctx["settings"] = settings
    engine = make_engine(settings.database_url)
    ctx["engine"] = engine
    ctx["session_factory"] = make_session_factory(engine)
    ctx["events_redis"] = Redis.from_url(settings.redis_url, decode_responses=True)
    ctx["event_sink"] = EventSink(
        ctx["session_factory"], ctx["events_redis"], settings.event_stream_ttl_seconds
    )
    pool = AsyncConnectionPool(
        settings.checkpoint_conninfo,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0},
        min_size=1,
        max_size=settings.max_concurrent_reviews_per_worker + 2,
        open=False,
    )
    await pool.open()
    ctx["pg_pool"] = pool
    ctx["graph"] = build_graph(GraphDeps(settings=settings), checkpointer=AsyncPostgresSaver(pool))
    await _requeue_stale_running(ctx)
    log.info("worker_started", max_jobs=settings.max_concurrent_reviews_per_worker)


async def _requeue_stale_running(ctx: dict) -> None:
    settings = ctx["settings"]
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.stale_running_minutes)
    async with ctx["session_factory"]() as session:
        stale = await ReviewRepository(session).list_stale_running(older_than=cutoff)
    for review in stale:
        job = await ctx["redis"].enqueue_job(
            "resume_review", str(review.id), _job_id=review_job_id(review.id)
        )
        log.info("requeued_stale_review", review_id=str(review.id), enqueued=job is not None)


async def shutdown(ctx: dict) -> None:
    await ctx["pg_pool"].close()
    await ctx["events_redis"].aclose()
    await ctx["engine"].dispose()


class WorkerSettings:
    functions = [run_review, resume_review]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = get_settings().max_concurrent_reviews_per_worker
    job_timeout = 1800
    max_tries = 2
    retry_jobs = False
    allow_abort_jobs = True
    health_check_interval = 30
    keep_result = 3600
```
Note: arq injects its own `ArqRedis` as `ctx["redis"]`; that is what `_requeue_stale_running` uses to enqueue.

`backend/app/db/setup_checkpointer.py`:
```python
"""One-off: create LangGraph checkpoint tables. Run after `alembic upgrade head`."""
import asyncio

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.config import get_settings


async def main() -> None:
    async with AsyncPostgresSaver.from_conn_string(get_settings().checkpoint_conninfo) as saver:
        await saver.setup()
    print("checkpoint tables ready")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 6: Write the Postgres/Redis integration test**

`backend/tests/integration/test_worker_postgres.py`:
```python
import asyncio
import os
import uuid

import pytest
from arq import create_pool
from arq.connections import RedisSettings
from arq.worker import Worker
from redis.asyncio import Redis

from app.config import Settings, get_settings
from app.db.models import Base
from app.db.repositories import EventRepository, ReviewRepository
from app.db.session import make_engine, make_session_factory
from app.services.queue import ArqJobQueue
from app.worker import settings as worker_settings

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/15")


@pytest.fixture
async def pg_session_factory():
    engine = make_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


async def test_worker_runs_job_with_postgres_checkpointer(pg_session_factory, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("REDIS_URL", REDIS_URL)
    get_settings.cache_clear()
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    async with AsyncPostgresSaver.from_conn_string(Settings(_env_file=None, database_url=TEST_DB).checkpoint_conninfo) as saver:
        await saver.setup()

    async with pg_session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(
            topic="integration topic", language="en", options={}, cache_key=str(uuid.uuid4())
        )

    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    pool = await create_pool(redis_settings)
    await pool.flushdb()
    assert await ArqJobQueue(pool).enqueue_review(review.id) is True
    assert await ArqJobQueue(pool).enqueue_review(review.id) is False  # same _job_id → deduped

    worker = Worker(
        functions=worker_settings.WorkerSettings.functions,
        on_startup=worker_settings.startup,
        on_shutdown=worker_settings.shutdown,
        redis_settings=redis_settings,
        burst=True,
        max_jobs=2,
        job_timeout=120,
        retry_jobs=False,
    )
    await asyncio.wait_for(worker.main(), timeout=90)
    await worker.close()

    async with pg_session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "done"
    assert got.result["summary"] == "Stub review for: integration topic"
    assert [e.type for e in events] == ["started", "planning", "synthesizing", "done"]

    live = Redis.from_url(REDIS_URL, decode_responses=True)
    entries = await live.xrange(f"review:{review.id}:events")
    assert [e[1]["type"] for e in entries][-1] == "done"
    await live.aclose()
    await pool.aclose()
    get_settings.cache_clear()
```

- [ ] **Step 7: Run the integration test against compose services**

Run:
```bash
cd backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_worker_postgres.py -v -s
```
Expected: PASS; log lines `worker_started`, job `run_review` completes, review `done`. If the `mra_test` database is missing (compose volume created before Task 2's init.sql), run `docker compose exec postgres psql -U mra -c 'CREATE DATABASE mra_test;'`.

- [ ] **Step 8: Run full unit suite and commit**

Run: `cd backend && uv run pytest tests/unit -v` — Expected: all PASS
```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "feat(worker): arq worker running the review graph with Postgres checkpointer and event bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Containerize api/worker/migrate and run the full stack end-to-end

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `scripts/smoke.sh`, `README.md`
- Modify: `docker-compose.yml` (add `migrate`, `api`, `worker`)

**Interfaces:**
- Produces: `docker compose up -d --build` brings up the whole backend; `scripts/smoke.sh` posts a review and tails SSE until `done`.

- [ ] **Step 1: Write the smoke script (the "test" for this task)**

`scripts/smoke.sh`:
```bash
#!/usr/bin/env bash
# End-to-end smoke: create a review via the API and tail SSE until a terminal event.
set -euo pipefail
API="${API:-http://localhost:8000/api/v1}"
TOPIC="${1:-metformin colorectal cancer risk}"

echo "→ health"; curl -fsS "$API/healthz"; echo
echo "→ create"
CREATE=$(curl -fsS -X POST "$API/reviews" -H 'content-type: application/json' \
  -d "{\"topic\":\"$TOPIC\",\"language\":\"th\"}")
echo "$CREATE"
ID=$(echo "$CREATE" | python -c 'import sys,json; print(json.load(sys.stdin)["review_id"])')

echo "→ events (until done/error, max 120s)"
curl -sN --max-time 120 "$API/reviews/$ID/events" | while IFS= read -r line; do
  echo "$line"
  case "$line" in event:\ done*|event:\ error*|event:\ rejected*|event:\ cancelled*) pkill -P $$ curl || true; break;; esac
done

echo "→ result"; curl -fsS "$API/reviews/$ID" | python -c 'import sys,json; r=json.load(sys.stdin); print(r["status"], r["result"])'
```
Run `chmod +x scripts/smoke.sh`. Running it now (no api container yet) must fail with `curl: (7) Failed to connect` — that is the failing state.

- [ ] **Step 2: Backend Dockerfile**

`backend/.dockerignore`:
```
.venv
__pycache__
*.pyc
.pytest_cache
.ruff_cache
tests
```

`backend/Dockerfile`:
```dockerfile
FROM python:3.12-slim-bookworm AS base
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
```

- [ ] **Step 3: Add migrate/api/worker services to compose**

Append to the `services:` block of `docker-compose.yml` (before `volumes:`):
```yaml
  migrate:
    build: ./backend
    image: mra/backend:dev
    env_file: .env
    command: ["sh", "-c", "alembic upgrade head && python -m app.db.setup_checkpointer"]
    depends_on:
      postgres:
        condition: service_healthy

  api:
    image: mra/backend:dev
    env_file: .env
    ports:
      - "8000:8000"
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      searxng:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/healthz', timeout=5).status == 200 else 1)\""]
      interval: 10s
      timeout: 6s
      retries: 12
    restart: unless-stopped

  worker:
    image: mra/backend:dev
    env_file: .env
    command: ["arq", "app.worker.settings.WorkerSettings"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      searxng:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 4: Bring up the stack and run the smoke script**

```bash
cd /d/MedicalReviewerAgent && docker compose up -d --build && docker compose ps && bash scripts/smoke.sh
```
Expected: `migrate` exits 0 (`checkpoint tables ready`), `api` healthy, `worker` running (`docker compose logs worker` shows `worker_started`), and the smoke prints events `queued → started → planning → synthesizing → done` followed by `done {'summary': 'Stub review for: metformin colorectal cancer risk', ...}`.
Then scale and repeat: `docker compose up -d --scale worker=2 && bash scripts/smoke.sh "aspirin stroke prevention"` — still ends `done`.

- [ ] **Step 5: Write the README quick start**

`README.md` (repo root):
```markdown
# Medical Reviewer Agent

Public literature-review agent: type a disease / drug / topic → the agent searches PubMed, arXiv, Semantic Scholar, OpenAlex and CrossRef (via a self-hosted searxng-LDR-academic), screens ~100 candidates down to 10, reads abstracts and open-access full text, and produces a comparison table of agreeing / conflicting findings. Backend: Python + LangGraph + Claude. Exposed as a web app, a REST API and an MCP server.

## Quick start (Docker)
1. `cp .env.example .env` and set `ANTHROPIC_API_KEY`, `CONTACT_EMAIL`, `SEARXNG_SECRET`.
2. `docker compose up -d --build` (first build of SearXNG takes a few minutes).
3. `bash scripts/smoke.sh` — creates a review and tails its progress.
4. API docs: http://localhost:8000/api/docs · SearXNG: http://localhost:8080

## Status
Plan 1 (foundation) done: infra, API, queue, SSE, stub graph. Next: real search/extract/synthesize nodes (Plan 2), MCP (Plan 3), web dashboard (Plan 4), hardening (Plan 5). See `docs/superpowers/`.

## Development
See `CLAUDE.md` for commands. Unit tests need no services; integration tests need `docker compose up -d postgres redis searxng` and `MRA_INTEGRATION=1`.
```

- [ ] **Step 6: Commit**

```bash
cd /d/MedicalReviewerAgent && git add -A && git commit -q -m "build: containerize api/worker/migrate, full compose stack and e2e smoke script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage (phases 1–3):** scaffold (T1), infra + JSON (T2), DB model incl. `api_keys`, partial unique indexes, `UNIQUE(review_id, seq)` (T3), EventSink + Redis Streams (T4), SSE replay/live with `Last-Event-ID` and pings (T5), REST create/get/list with cache-key dedupe + rate limit + proxy-aware IP + `callback_url` stored (T6), reducers + `get_stream_writer` + `durability="sync"` (T7), arq settings, pool-per-worker saver, resume/stale requeue, `setup()` as migration step (T8), containers + scale test (T9). Deferred by design to later plans: `DELETE /reviews/{id}`, `/papers/search`, export, `/admin/mcp/reload`, webhooks, Caddy, Turnstile, budget guard.
- **Type consistency:** `AppDeps(session_factory, redis, queue, event_sink)` is used identically in Tasks 1, 5, 6; `EventSink.emit` returns `int`; `read_live` yields `dict | None`; `ReviewRunner.run` returns status strings matching `ReviewStatus` values; `review_job_id` used by both `ArqJobQueue` and stale requeue.
- **Review Focus → tests:** (1) `test_validation_rejects_blank_long_and_bad_language`; (2) `test_parse_since` + `test_non_numeric_last_event_id_is_treated_as_zero`; (3) `test_duplicate_request_while_active_returns_same_review`; (4) `test_exception_marks_error_and_emits_error_event`; (5) `test_events_404_for_unknown_review`.
