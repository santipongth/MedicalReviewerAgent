# Plan 23b: Admin Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the service's models, presets and providers from `/admin/models`. Each save is validated, versioned in the DB, restorable and audited, and workers pick it up without a restart.

**Architecture:**
- **Config source:** `llm.yaml` becomes the seed. A new `llm_config_versions` table holds immutable, validated documents in the same shape, and the newest version wins.
- **Workers:** they read a Redis version key at each job start and every 30 s, then rebuild their LLMs (same semaphore) and graph when the version changed. A running review keeps the graph it started with.
- **Admin side:** thin admin routes over focused services (`llm_store`, `llm_validate`, `llm_cost`, `llm_probe`, a cached catalog) feed a client page with header, presets, YAML, history and catalog tabs.

**Tech Stack:**
- **Backend:** FastAPI, SQLAlchemy async, Alembic, Redis (fakeredis in tests), arq, PyYAML (already a dependency).
- **Frontend:** Next.js 16 client components, Vitest and Testing Library, Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-12-plan-23b-model-management-design.md`

**Worktree:** `D:\MRA-plan-23b` (branch `plan-23b-model-management`). The Bash cwd resets between calls, so every
command starts with `cd /d/MRA-plan-23b/backend` or `cd /d/MRA-plan-23b/frontend`. The frontend needs `npm ci` once
(Task 10).

## Global Constraints

- **Dependencies:** none new, backend or frontend. YAML is parsed and produced only on the backend (`yaml.safe_load`, `yaml.safe_dump(sort_keys=False, allow_unicode=True)`).
- **Redis keys:**
  - `mra:llm:config_version` holds the active version id as text.
  - `mra:llm:loaded` is a hash: field `<hostname>:<pid>` → JSON `{version, preset, loaded_at, error}`. The console ignores entries older than 1 day.
  - `mra:llm:catalog` is the catalog cache, TTL 3600 s.
- **Versions:**
  - Rows are never updated or deleted, and the newest id is active.
  - A save carries `base_version`, which is the active id or `null` while `llm.yaml` is active. A stale value gets 409.
  - The note is ≤ 500 characters and a YAML body ≤ 200,000 characters.
  - `source` is one of `edit | restore | file`.
- **Precedence:** a DB version wins over `llm.yaml`. `LLM_PRESET` (`settings.llm_preset`) applies only while the source is the file.
- **Test call:** `max_tokens` is capped at 512, timeout ≤ 60 s, budget $0.05 per test, and at most 10 tests per minute per actor (`deps.limits.hit("llm-test", actor_label, "10/minute")`).
- **Audit:**
  - Actions are `llm_config.save`, `llm_config.restore`, `llm_config.reset` and `llm.test`.
  - Target types are `llm_config` (target id = version id) and `llm_model` (target id = model id, truncated to 64).
  - The audit row is written in the same transaction as the change. The test call writes its own row.
- **Secrets:** provider API keys never reach the DB, the API or the UI. The console sees only `{ENV_NAME: bool}` saying whether each key is set.
- **Admin routes:**
  - Under `/api/v1/admin`, with `Depends(require_admin)`.
  - Registered with `include_in_schema=False`.
  - Writes are cookie+CSRF or an admin key, as in 23a.
- **Worker:**
  - A reload reuses `ctx["llm_sem"]`.
  - A failed reload keeps the old models and reports `error`.
  - A stub-mode worker records the version without building LLMs.
- **Cache key:** the version string is `f"{prompt_version}+llm{active_version_id}"`. The active id is the text id, or `file` while the table is empty.
- **UI:**
  - Thai labels with English technical terms.
  - DESIGN.md rules as in 23a: `rounded-sm`, 1px `rule` borders, `min-h-11` targets, and status blocks as a tint plus text.
  - No Martian Mono and no `confirm()`.
  - Effects set state only inside promise callbacks.
  - Focus moves to the page notice after an action that unmounts the focused control.
- **Do not touch** `CLAUDE.md`, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new` in `D:\MedicalReviewerAgent`. The CLAUDE.md line is added after the merge.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Bad YAML body** (Task 8): a YAML body that is not a mapping (a list, a plain string, empty text) or that does not parse gives 422 with a readable message, never a 500.
2. **Empty table and stale base** (Task 3): while the table is empty, a save with `base_version: null` works. A second save with `base_version: null` after someone else saved gives 409.
3. **Active preset missing** (Task 3): a document whose `active_preset` names a missing preset, or one that deletes the active preset, is rejected at save. It never reaches a worker.
4. **Redis down** (Task 3): while Redis is down, `active_version_id` falls back to the DB, so review creation still works.
5. **Reload that fails to build** (Task 6): when a reload fails, the worker keeps the old models, reports the error in `mra:llm:loaded`, and retries on the next poll.

---

### Task 1: Load a config from a dict, and build LLMs from a resolved config

**Files:**
- Modify: `backend/app/services/llm_config.py`
- Modify: `backend/app/services/llm.py` (`LLMs.config_version`, `build_llms` keyword arguments)
- Modify: `backend/app/graph/factory.py` (`build_graph_deps` keyword arguments)
- Create: `backend/tests/llm_helpers.py`
- Test: `backend/tests/unit/test_llm_config_source.py`

**Interfaces:**
- Produces:
  - `read_llm_yaml(path) -> dict` (raises `LLMConfigError`).
  - `parse_llm_config(raw, *, where="llm config") -> LLMConfig` (raises `LLMConfigError`).
  - `resolve_llm_config(config: LLMConfig, preset: str | None = None, *, where="llm config") -> ResolvedLLMConfig`.
  - `load_llm_config(path, preset=None)`, unchanged behaviour.
  - `LLMs.config_version: str` (default `""`).
  - `build_llms(settings, catalog=None, *, resolved=None, sem=None, config_version="file") -> LLMs`.
  - `build_graph_deps(settings, http, redis=None, catalog=None, *, resolved=None, sem=None, config_version="file")`.
  - Test helper `MINIMAL: dict`, `with_model(raw, preset, role, model) -> dict`, `write_yaml(path, raw) -> Path`.

- [ ] **Step 1: Write the test helper**

`backend/tests/llm_helpers.py`:

```python
"""A small valid LLM config document for Plan 23b tests (same shape as config/llm.yaml)."""
import copy
from pathlib import Path

import yaml

ROLES = ("guard", "planner", "screener", "extractor", "synthesizer")

MINIMAL: dict = {
    "active_preset": "cheap",
    "default_provider": "openrouter",
    "providers": {"openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key_env": "OPENROUTER_API_KEY"}},
    "presets": {
        "cheap": {r: {"model": "vendor/cheap"} for r in ROLES},
        "better": {r: {"model": "vendor/better"} for r in ROLES},
    },
}


def with_model(raw: dict, preset: str, role: str, model: str) -> dict:
    out = copy.deepcopy(raw)
    out["presets"][preset][role] = {**out["presets"][preset].get(role, {}), "model": model}
    return out


def write_yaml(path: Path, raw: dict) -> Path:
    path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_llm_config_source.py`:

```python
import asyncio

import pytest

from app.config import Settings
from app.services.llm import build_llms
from app.services.llm_config import LLMConfigError, load_llm_config, parse_llm_config, resolve_llm_config
from tests.llm_helpers import MINIMAL, with_model, write_yaml


def test_a_dict_parses_and_resolves_like_the_file(tmp_path):
    from_dict = resolve_llm_config(parse_llm_config(MINIMAL))
    from_file = load_llm_config(write_yaml(tmp_path / "llm.yaml", MINIMAL))
    assert from_dict.describe() == from_file.describe()
    assert from_dict.preset == "cheap" and from_dict.roles["synthesizer"].spec.model == "vendor/cheap"
    assert resolve_llm_config(parse_llm_config(MINIMAL), "better").roles["guard"].spec.model == "vendor/better"


def test_invalid_documents_name_where_they_came_from():
    with pytest.raises(LLMConfigError, match="version 3"):
        parse_llm_config({"active_preset": "x"}, where="version 3")
    with pytest.raises(LLMConfigError, match="Unknown preset 'missing'"):
        resolve_llm_config(parse_llm_config({**MINIMAL, "active_preset": "missing"}))
    with pytest.raises(LLMConfigError):
        parse_llm_config(["not", "a", "mapping"])


def test_build_llms_uses_a_given_config_semaphore_and_version():
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x")
    sem = asyncio.Semaphore(3)
    resolved = resolve_llm_config(parse_llm_config(with_model(MINIMAL, "cheap", "synthesizer", "vendor/big")))
    llms = build_llms(settings, resolved=resolved, sem=sem, config_version="7")
    assert llms.models["synthesizer"] == "openrouter:vendor/big" and llms.preset == "cheap"
    assert llms.synthesizer.sem is sem and llms.guard.sem is sem
    assert llms.config_version == "7"
    assert build_llms(settings).config_version == "file"  # the file path, as before
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_config_source.py -q`
Expected: FAIL with `ImportError: cannot import name 'parse_llm_config'`.

- [ ] **Step 4: Split `llm_config.py`**

Replace `load_llm_config` with the four functions below. The resolution body is the current one, with `path` replaced by `where`, so existing error messages keep naming the file:

```python
def read_llm_yaml(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    if not path.is_file():
        raise LLMConfigError(f"LLM config not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise LLMConfigError(f"{path}: invalid YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{path}: the config must be a mapping")
    return raw


def parse_llm_config(raw: Any, *, where: str = "llm config") -> LLMConfig:
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{where}: the config must be a mapping")
    try:
        return LLMConfig.model_validate(raw)
    except ValidationError as exc:
        raise LLMConfigError(f"{where}: {exc}") from exc


def resolve_llm_config(config: LLMConfig, preset: str | None = None, *,
                       where: str = "llm config") -> ResolvedLLMConfig:
    name = preset or config.active_preset
    if name not in config.presets:
        raise LLMConfigError(f"Unknown preset '{name}'. Available: {', '.join(config.presets)}")
    roles: dict[str, ResolvedRole] = {}
    preset_roles = config.presets[name]
    for role in (*ROLES, *OPTIONAL_ROLES):
        if role in preset_roles:
            spec = preset_roles[role]
        elif role in FALLBACK_ROLES:
            spec = preset_roles[FALLBACK_ROLES[role]]
        elif role in config.overrides and "model" in config.overrides[role]:
            spec = RoleSpec(model=config.overrides[role]["model"])  # enabled purely via overrides
        else:
            continue
        if role in config.overrides:
            try:
                spec = RoleSpec.model_validate({**spec.model_dump(), **config.overrides[role]})
            except ValidationError as exc:
                raise LLMConfigError(f"{where}: overrides.{role}: {exc}") from exc
        provider = spec.provider or config.default_provider
        if provider not in config.providers:
            raise LLMConfigError(f"Provider '{provider}' is not configured (overrides.{role})")
        roles[role] = ResolvedRole(role, provider, config.providers[provider], spec)
    return ResolvedLLMConfig(preset=name, roles=roles, harness=config.harness)


def load_llm_config(path: str | Path, preset: str | None = None) -> ResolvedLLMConfig:
    return resolve_llm_config(parse_llm_config(read_llm_yaml(path), where=str(path)), preset, where=str(path))
```

- [ ] **Step 5: Thread the config through `build_llms` and `build_graph_deps`**

In `backend/app/services/llm.py`, add the field `config_version: str = ""` to `LLMs` (after `models`). Change `build_llms`:

```python
def build_llms(settings: Settings, catalog: dict[str, ModelInfo] | None = None, *,
               resolved: ResolvedLLMConfig | None = None, sem: asyncio.Semaphore | None = None,
               config_version: str = "file") -> LLMs:
    """`resolved` defaults to config/llm.yaml; `sem` lets a reload keep the process's one LLM semaphore (Plan 23b)."""
    config = resolved or load_llm_config(settings.llm_config_path, settings.llm_preset)
    sem = sem or asyncio.Semaphore(max(1, settings.llm_concurrency))
```

The rest of the body is unchanged, except that the return passes `config_version=config_version`. Import
`ResolvedLLMConfig` from `app.services.llm_config`.

In `backend/app/graph/factory.py`:

```python
def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file") -> GraphDeps:
```

and pass `build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_config_source.py tests/unit/test_llm_config.py tests/unit/test_llm_limit.py tests/unit/test_models_cli.py -q`
Expected: PASS, with the old config tests unchanged.

- [ ] **Step 7: Full suite, lint, commit**

```bash
cd /d/MRA-plan-23b/backend && uv run pytest -q && uv run ruff check .
cd /d/MRA-plan-23b && git add backend/app/services/llm_config.py backend/app/services/llm.py backend/app/graph/factory.py \
  backend/tests/llm_helpers.py backend/tests/unit/test_llm_config_source.py
git commit -m "refactor(llm): config from a dict as well as llm.yaml; build_llms takes a resolved config, semaphore and version (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `llm_config_versions` table

**Files:**
- Modify: `backend/app/db/models.py` (append `LlmConfigVersion`)
- Create: `backend/migrations/versions/f2a4c6e8b0d1_llm_config_versions.py`
- Test: `backend/tests/unit/test_llm_versions_table.py`, `backend/tests/integration/test_llm_config_migration.py`

**Interfaces:**
- Produces: model `LlmConfigVersion` with `id: int`, `created_at`, `created_by: str`, `note: str | None`, `source: str`, `restored_from: int | None`, `config: dict` and `changes: dict`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_llm_versions_table.py`:

```python
from sqlalchemy import select

from app.db.models import LlmConfigVersion
from tests.llm_helpers import MINIMAL


async def test_versions_store_the_document_and_number_upwards(session_factory):
    async with session_factory() as s, s.begin():
        s.add(LlmConfigVersion(created_by="owner", source="edit", config=MINIMAL, changes={}))
        s.add(LlmConfigVersion(created_by="owner", source="restore", restored_from=1, config=MINIMAL,
                               changes={"active_preset": "a → b"}, note="back"))
    async with session_factory() as s:
        rows = list((await s.execute(select(LlmConfigVersion).order_by(LlmConfigVersion.id))).scalars())
    assert [r.id for r in rows] == [1, 2]
    assert rows[0].config == MINIMAL and rows[1].restored_from == 1 and rows[1].note == "back"
    assert rows[1].changes == {"active_preset": "a → b"} and rows[0].created_at is not None
```

`backend/tests/integration/test_llm_config_migration.py`:

```python
import json
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import get_settings
from tests.llm_helpers import MINIMAL

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")


def test_llm_versions_migration_and_jsonb_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert "llm_config_versions" in inspect(engine).get_table_names()
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO llm_config_versions (created_by, source, config, changes) "
                              "VALUES ('owner', 'edit', CAST(:c AS JSONB), '{}'::jsonb)"), {"c": json.dumps(MINIMAL)})
            stored = conn.execute(text("SELECT config FROM llm_config_versions")).scalar_one()
        assert stored == MINIMAL
        command.downgrade(cfg, "-1")
        assert "llm_config_versions" not in inspect(engine).get_table_names()
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_versions_table.py -q`
Expected: FAIL with `ImportError: cannot import name 'LlmConfigVersion'`.

- [ ] **Step 3: Implement the model and the migration**

Append to `backend/app/db/models.py`:

```python
class LlmConfigVersion(Base):
    """One saved LLM configuration (Plan 23b), in the config/llm.yaml shape. Never updated or deleted; the newest
    row is the configuration in use, and while the table is empty config/llm.yaml is."""

    __tablename__ = "llm_config_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # edit | restore | file
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
```

`backend/migrations/versions/f2a4c6e8b0d1_llm_config_versions.py`:

```python
"""llm config versions (Plan 23b)

Revision ID: f2a4c6e8b0d1
Revises: e1f3a5c7b9d2
Create Date: 2026-10-12 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f2a4c6e8b0d1"
down_revision: Union[str, None] = "e1f3a5c7b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "llm_config_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("restored_from", sa.Integer(), nullable=True),
        sa.Column("config", JSON, nullable=False),
        sa.Column("changes", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("llm_config_versions")
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_versions_table.py -q`
Expected: PASS.
Run the migration test against the running Postgres (as in 23a):
`docker exec mra-postgres-1 psql -U mra -d postgres -c "CREATE DATABASE mra_test"` (ignore "already exists"), then
`cd /d/MRA-plan-23b/backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_llm_config_migration.py tests/integration/test_admin_migration.py -q`
Expected: PASS. If Postgres is not reachable, write down that the test was not run and why; never mark it passed.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check app tests migrations
cd /d/MRA-plan-23b && git add backend/app/db/models.py backend/migrations/versions/f2a4c6e8b0d1_llm_config_versions.py \
  backend/tests/unit/test_llm_versions_table.py backend/tests/integration/test_llm_config_migration.py
git commit -m "feat(llm): llm_config_versions table (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The version store (effective config, save, restore, reset, history, active id)

**Files:**
- Create: `backend/app/services/llm_store.py`
- Test: `backend/tests/unit/test_llm_store.py`

**Interfaces:**
- Consumes: `read_llm_yaml`, `parse_llm_config`, `resolve_llm_config`, `LLMConfigError` (Task 1); `LlmConfigVersion` (Task 2); `record` (`app.services.audit`); `AdminPrincipal` (`app.services.admin_auth`); `Conflict`, `NotFound` (`app.services.review_service`).
- Produces:
  - Constants `LLM_VERSION_KEY`, `LOADED_KEY`, `NOTE_MAX = 500`.
  - `EffectiveConfig(source, version, raw, config, env_preset)` with `.label` (`"db:<id>"` or `"file"`), `.active_id` (`"<id>"` or `"file"`) and `.resolve() -> ResolvedLLMConfig`.
  - `async load_effective(session, settings) -> EffectiveConfig`.
  - `summarize_change(old_raw: dict | None, new_raw: dict) -> dict`.
  - `async save_version(session, actor, raw, *, settings, base_version, note=None, source="edit", restored_from=None, ip_hash=None) -> LlmConfigVersion`.
  - `async restore_version(session, actor, version_id, *, settings, base_version, note=None, ip_hash=None)`.
  - `async reset_to_file(session, actor, *, settings, base_version, note=None, ip_hash=None)`.
  - `async list_versions(session, *, before=None, limit=50) -> tuple[list[LlmConfigVersion], int | None]`.
  - `async get_version(session, version_id) -> LlmConfigVersion` (raises `NotFound`).
  - `version_out(row) -> dict`.
  - `async publish_version(redis, version_id: int) -> None`.
  - `async active_version_id(session_factory, redis) -> str`.
  - `async report_loaded(redis, worker: str, version: str, preset: str, error: str | None = None) -> None`.
  - `async loaded_workers(redis, now=None) -> list[dict]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_llm_store.py`:

```python
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import Settings
from app.db.models import AdminAudit, LlmConfigVersion
from app.services.admin_auth import AdminPrincipal
from app.services.llm_config import LLMConfigError
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    active_version_id,
    list_versions,
    load_effective,
    loaded_workers,
    publish_version,
    report_loaded,
    reset_to_file,
    restore_version,
    save_version,
    summarize_change,
    version_out,
)
from app.services.review_service import Conflict, NotFound
from tests.llm_helpers import MINIMAL, with_model, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))


async def save(session_factory, settings, raw, base, **kw):
    async with session_factory() as s, s.begin():
        return await save_version(s, OWNER, raw, settings=settings, base_version=base, **kw)


async def test_the_file_is_effective_until_a_version_exists(session_factory, settings):
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert (eff.source, eff.version, eff.label, eff.active_id) == ("file", None, "file", "file")
    assert eff.resolve().preset == "cheap"
    row = await save(session_factory, settings, {**MINIMAL, "active_preset": "better"}, None, note="try better")
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert (eff.source, eff.version, eff.label) == ("db", row.id, f"db:{row.id}")
    assert eff.resolve().preset == "better"


async def test_llm_preset_applies_only_to_the_file(session_factory, settings):
    settings.llm_preset = "better"
    async with session_factory() as s:
        assert (await load_effective(s, settings)).resolve().preset == "better"
    await save(session_factory, settings, MINIMAL, None)
    async with session_factory() as s:
        eff = await load_effective(s, settings)
    assert eff.resolve().preset == "cheap" and eff.env_preset == "better"


async def test_a_stale_base_is_a_conflict_and_an_empty_table_takes_null(session_factory, settings):
    first = await save(session_factory, settings, MINIMAL, None)
    with pytest.raises(Conflict):
        await save(session_factory, settings, MINIMAL, None)  # someone saved meanwhile
    second = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/x"), first.id)
    with pytest.raises(Conflict):
        await save(session_factory, settings, MINIMAL, first.id)
    assert second.id == first.id + 1


async def test_invalid_documents_are_refused_and_leave_no_row(session_factory, settings):
    broken = {**MINIMAL, "active_preset": "missing"}
    no_active = {**MINIMAL, "presets": {"better": MINIMAL["presets"]["better"]}}  # deleted the active preset
    for raw in (broken, no_active, {"presets": {}}, ["not", "a", "mapping"]):
        with pytest.raises(LLMConfigError):
            await save(session_factory, settings, raw, None)
    async with session_factory() as s:
        assert (await s.execute(select(LlmConfigVersion))).first() is None


async def test_save_writes_a_change_summary_and_one_audit_row(session_factory, settings):
    raw = with_model({**MINIMAL, "active_preset": "better"}, "cheap", "synthesizer", "vendor/big")
    row = await save(session_factory, settings, raw, None, note="n" * 600)
    assert len(row.note) == 500 and row.source == "edit" and row.created_by == "owner"
    assert row.changes == {"active_preset": "cheap → better",
                           "roles": {"cheap.synthesizer": "vendor/cheap → vendor/big"}}
    async with session_factory() as s:
        [audit] = list((await s.execute(select(AdminAudit))).scalars())
    assert audit.action == "llm_config.save" and audit.target_type == "llm_config"
    assert audit.target_id == str(row.id) and audit.before == {"version": None}
    assert audit.after["version"] == row.id and audit.after["active_preset"] == "cheap → better"


def test_summarize_change_cases():
    old = MINIMAL
    new = {**with_model(MINIMAL, "better", "guard", "vendor/g"), "harness": {"max_repairs": 1}}
    new["presets"]["fresh"] = new["presets"].pop("cheap")
    new["presets"]["better"]["planner"] = {"model": "vendor/better", "max_tokens": 9}
    assert summarize_change(old, new) == {
        "presets_added": ["fresh"], "presets_removed": ["cheap"],
        "roles": {"better.guard": "vendor/better → vendor/g", "better.planner": "settings changed"},
        "sections": ["harness"],
    }
    assert summarize_change(MINIMAL, MINIMAL) == {}


async def test_restore_and_reset_append_copies(session_factory, settings):
    v1 = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/a"), None)
    v2 = await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", "vendor/b"), v1.id)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, v1.id, settings=settings, base_version=v2.id)
    assert (v3.source, v3.restored_from, v3.config) == ("restore", v1.id, v1.config)
    assert v3.note == f"restored from version {v1.id}"
    async with session_factory() as s, s.begin():
        v4 = await reset_to_file(s, OWNER, settings=settings, base_version=v3.id)
    assert v4.source == "file" and v4.config == MINIMAL and v4.note == "reset to llm.yaml"
    with pytest.raises(NotFound):
        async with session_factory() as s, s.begin():
            await restore_version(s, OWNER, 999, settings=settings, base_version=v4.id)
    async with session_factory() as s:
        actions = [a.action for a in (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars()]
    assert actions == ["llm_config.save", "llm_config.save", "llm_config.restore", "llm_config.reset"]


async def test_history_pages_newest_first(session_factory, settings):
    base = None
    for i in range(3):
        base = (await save(session_factory, settings, with_model(MINIMAL, "cheap", "guard", f"vendor/{i}"), base)).id
    async with session_factory() as s:
        page, cursor = await list_versions(s, limit=2)
        rest, end = await list_versions(s, before=cursor, limit=2)
    assert [r.id for r in page + rest] == [3, 2, 1] and end is None
    out = version_out(page[0])
    assert out["id"] == 3 and out["active_preset"] == "cheap" and "config" not in out


async def test_active_version_id_uses_redis_then_the_db(session_factory, settings, redis):
    assert await active_version_id(session_factory, redis) == "file"
    row = await save(session_factory, settings, MINIMAL, None)
    await redis.delete(LLM_VERSION_KEY)
    assert await active_version_id(session_factory, redis) == str(row.id)  # miss → DB, then cached
    assert await redis.get(LLM_VERSION_KEY) == str(row.id)
    await publish_version(redis, 42)
    assert await active_version_id(session_factory, redis) == "42"


async def test_active_version_id_survives_redis_being_down(session_factory, settings):
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("redis down")

        async def set(self, *_ , **__):
            raise ConnectionError("redis down")

    row = await save(session_factory, settings, MINIMAL, None)
    assert await active_version_id(session_factory, DeadRedis()) == str(row.id)


async def test_loaded_workers_report_and_expire(redis):
    await report_loaded(redis, "host:1", "3", "cheap")
    await report_loaded(redis, "host:2", "2", "cheap", error="boom")
    stale = {"version": "1", "preset": "cheap", "loaded_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
             "error": None}
    await redis.hset(LOADED_KEY, "host:3", json.dumps(stale))
    rows = await loaded_workers(redis)
    assert [(r["worker"], r["version"], r["error"]) for r in rows] == [("host:1", "3", None), ("host:2", "2", "boom")]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_store.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.llm_store'`.

- [ ] **Step 3: Implement `backend/app/services/llm_store.py`**

```python
"""LLM configuration versions (Plan 23b). config/llm.yaml is the seed; every save from the admin console appends an
immutable, validated version, and the newest version is the configuration in use. Workers learn of a new version from
the Redis key LLM_VERSION_KEY and report what they loaded in LOADED_KEY."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import LlmConfigVersion
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.llm_config import LLMConfig, ResolvedLLMConfig, parse_llm_config, read_llm_yaml, resolve_llm_config
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

LLM_VERSION_KEY = "mra:llm:config_version"
LOADED_KEY = "mra:llm:loaded"
LOADED_MAX_AGE = timedelta(days=1)
NOTE_MAX = 500
_ACTIONS = {"edit": "llm_config.save", "restore": "llm_config.restore", "file": "llm_config.reset"}


@dataclass(frozen=True)
class EffectiveConfig:
    source: Literal["db", "file"]
    version: int | None
    raw: dict[str, Any]
    config: LLMConfig
    env_preset: str | None

    @property
    def label(self) -> str:
        return f"db:{self.version}" if self.source == "db" else "file"

    @property
    def active_id(self) -> str:
        return str(self.version) if self.source == "db" else "file"

    def resolve(self) -> ResolvedLLMConfig:
        """LLM_PRESET overrides the active preset only while config/llm.yaml is the source."""
        preset = self.env_preset if self.source == "file" else None
        return resolve_llm_config(self.config, preset, where=self.label)


async def _newest(session: AsyncSession) -> LlmConfigVersion | None:
    stmt = select(LlmConfigVersion).order_by(LlmConfigVersion.id.desc()).limit(1)
    return (await session.execute(stmt)).scalar_one_or_none()


async def load_effective(session: AsyncSession, settings: Settings) -> EffectiveConfig:
    row = await _newest(session)
    if row is not None:
        return EffectiveConfig("db", row.id, row.config, parse_llm_config(row.config, where=f"version {row.id}"),
                               settings.llm_preset)
    raw = read_llm_yaml(settings.llm_config_path)
    return EffectiveConfig("file", None, raw, parse_llm_config(raw, where=settings.llm_config_path),
                           settings.llm_preset)


def _models(raw: dict[str, Any], preset: str, role: str) -> tuple[str | None, Any]:
    spec = ((raw.get("presets") or {}).get(preset) or {}).get(role)
    return (spec or {}).get("model"), spec


def summarize_change(old_raw: dict[str, Any] | None, new_raw: dict[str, Any]) -> dict[str, Any]:
    """What a save changed, for history and the audit log: the active preset, presets added or removed, each role's
    model (or "settings changed"), and the other top-level sections that differ."""
    old = old_raw or {}
    out: dict[str, Any] = {}
    if old.get("active_preset") != new_raw.get("active_preset"):
        out["active_preset"] = f"{old.get('active_preset')} → {new_raw.get('active_preset')}"
    old_presets, new_presets = old.get("presets") or {}, new_raw.get("presets") or {}
    if added := sorted(set(new_presets) - set(old_presets)):
        out["presets_added"] = added
    if removed := sorted(set(old_presets) - set(new_presets)):
        out["presets_removed"] = removed
    roles: dict[str, str] = {}
    for preset in sorted(set(old_presets) & set(new_presets)):
        for role in sorted(set(old_presets[preset] or {}) | set(new_presets[preset] or {})):
            (a, spec_a), (b, spec_b) = _models(old, preset, role), _models(new_raw, preset, role)
            if a != b:
                roles[f"{preset}.{role}"] = f"{a or '—'} → {b or '—'}"
            elif spec_a != spec_b:
                roles[f"{preset}.{role}"] = "settings changed"
    if roles:
        out["roles"] = roles
    if sections := [k for k in ("default_provider", "providers", "harness", "overrides") if old.get(k) != new_raw.get(k)]:
        out["sections"] = sections
    return out


async def save_version(session: AsyncSession, actor: AdminPrincipal, raw: Any, *, settings: Settings,
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> LlmConfigVersion:
    """Validate (schema and the active preset), refuse a stale base, append the version and its audit row."""
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    stored = config.model_dump(mode="json", exclude_unset=True)
    current = await _newest(session)
    current_id = current.id if current is not None else None
    if base_version != current_id:
        active = f"version {current_id}" if current_id is not None else "llm.yaml"
        raise Conflict(f"{active} is in use now; reload the latest version and try again")
    previous = current.config if current is not None else read_llm_yaml(settings.llm_config_path)
    changes = summarize_change(previous, stored)
    row = LlmConfigVersion(created_at=datetime.now(UTC), created_by=actor.label[:64],
                           note=(note or "").strip()[:NOTE_MAX] or None, source=source,
                           restored_from=restored_from, config=stored, changes=changes)
    session.add(row)
    await session.flush()
    await record(session, actor, _ACTIONS[source], target_type="llm_config", target_id=row.id,
                 before={"version": current_id}, after={"version": row.id, **changes}, ip_hash=ip_hash)
    return row


async def get_version(session: AsyncSession, version_id: int) -> LlmConfigVersion:
    row = await session.get(LlmConfigVersion, version_id)
    if row is None:
        raise NotFound(f"version {version_id} not found")
    return row


async def restore_version(session: AsyncSession, actor: AdminPrincipal, version_id: int, *, settings: Settings,
                          base_version: int | None, note: str | None = None,
                          ip_hash: str | None = None) -> LlmConfigVersion:
    old = await get_version(session, version_id)
    return await save_version(session, actor, old.config, settings=settings, base_version=base_version,
                              note=note or f"restored from version {version_id}", source="restore",
                              restored_from=version_id, ip_hash=ip_hash)


async def reset_to_file(session: AsyncSession, actor: AdminPrincipal, *, settings: Settings,
                        base_version: int | None, note: str | None = None,
                        ip_hash: str | None = None) -> LlmConfigVersion:
    return await save_version(session, actor, read_llm_yaml(settings.llm_config_path), settings=settings,
                              base_version=base_version, note=note or "reset to llm.yaml", source="file",
                              ip_hash=ip_hash)


async def list_versions(session: AsyncSession, *, before: int | None = None,
                        limit: int = 50) -> tuple[list[LlmConfigVersion], int | None]:
    stmt = select(LlmConfigVersion).order_by(LlmConfigVersion.id.desc()).limit(limit + 1)
    if before is not None:
        stmt = stmt.where(LlmConfigVersion.id < before)
    rows = list((await session.execute(stmt)).scalars())
    cursor = rows[limit - 1].id if len(rows) > limit else None
    return rows[:limit], cursor


def version_out(row: LlmConfigVersion) -> dict[str, Any]:
    return {"id": row.id, "created_at": row.created_at, "created_by": row.created_by, "note": row.note,
            "source": row.source, "restored_from": row.restored_from,
            "active_preset": (row.config or {}).get("active_preset"), "changes": row.changes or {}}


async def publish_version(redis, version_id: int) -> None:
    """Tell every worker (and the cache key) that a new version is active. Best-effort: a miss falls back to the DB."""
    try:
        await redis.set(LLM_VERSION_KEY, str(version_id))
    except Exception:  # noqa: BLE001 - workers and the cache key read the DB when the key is missing
        log.warning("llm_version_publish_failed", version=version_id)


async def active_version_id(session_factory, redis) -> str:
    """The active version id as text ("file" while the table is empty): Redis first, the DB on a miss or an error."""
    try:
        cached = await redis.get(LLM_VERSION_KEY)
    except Exception:  # noqa: BLE001 - Redis down must not block review creation
        cached = None
    if cached:
        return cached
    async with session_factory() as session:
        newest = await session.scalar(select(func.max(LlmConfigVersion.id)))
    value = str(newest) if newest is not None else "file"
    if newest is not None:
        try:
            await redis.set(LLM_VERSION_KEY, value)
        except Exception:  # noqa: BLE001
            pass
    return value


async def report_loaded(redis, worker: str, version: str, preset: str, error: str | None = None) -> None:
    payload = {"version": version, "preset": preset, "loaded_at": datetime.now(UTC).isoformat(),
               "error": (error or None) and error[:300]}
    try:
        await redis.hset(LOADED_KEY, worker, json.dumps(payload))
    except Exception:  # noqa: BLE001 - reporting never breaks a worker
        log.warning("llm_loaded_report_failed", worker=worker)


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

Note: `active_version_id` returns `"file"` without caching it, so the first save (which publishes the id) is never
shadowed by a stale `"file"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_store.py -q`
Expected: PASS. If `settings.llm_preset = "better"` fails because `Settings` is frozen, build a second `Settings`
with `llm_preset="better"` instead; the assertion is what matters.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check app tests
cd /d/MRA-plan-23b && git add backend/app/services/llm_store.py backend/tests/unit/test_llm_store.py
git commit -m "feat(llm): version store — effective config, save with base-version check, restore, reset, history, active id (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cost estimate, cached catalog and `cli.models check --source db`

**Files:**
- Create: `backend/app/services/llm_cost.py`
- Modify: `backend/app/services/model_catalog.py` (`load_live_catalog`, `cached_catalog`, `catalog_rows`)
- Modify: `backend/app/cli/models.py` (import the moved table and loader; `check --source file|db`)
- Test: `backend/tests/unit/test_llm_cost_catalog.py`; keep `backend/tests/unit/test_models_cli.py` passing

**Interfaces:**
- Consumes: `ResolvedLLMConfig` (Task 1); `load_effective` (Task 3).
- Produces:
  - `TYPICAL_CALLS` and `estimate_review_cost(resolved, catalog) -> {"total_usd", "per_role", "unknown_models"}`.
  - `CATALOG_KEY = "mra:llm:catalog"`.
  - `async load_live_catalog() -> dict[str, ModelInfo]`.
  - `async cached_catalog(redis, load=load_live_catalog) -> dict[str, ModelInfo] | None`.
  - `catalog_rows(catalog, *, q=None, structured=False, reasoning=False, max_price=None, limit=100) -> list[dict]`. Each row has `id`, `context_length`, `price_in_per_m`, `price_out_per_m`, `structured`, `tools` and `reasoning`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_llm_cost_catalog.py`:

```python
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_cost import TYPICAL_CALLS, estimate_review_cost
from app.services.model_catalog import CATALOG_KEY, ModelInfo, cached_catalog, catalog_rows
from tests.llm_helpers import MINIMAL

CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs", "tools"}))
SMART = ModelInfo("vendor/smart", 200_000, 3e-6, 1.5e-5, frozenset({"structured_outputs", "reasoning"}))
CATALOG = {m.id: m for m in (CHEAP, SMART)}


def test_estimate_sums_typical_calls_and_lists_unknown_models():
    resolved = resolve_llm_config(parse_llm_config(MINIMAL))  # cheap preset: every role on vendor/cheap
    est = estimate_review_cost(resolved, CATALOG)
    expected = sum(TYPICAL_CALLS[r][0] * CHEAP.cost(*TYPICAL_CALLS[r][1:]) for r in resolved.roles)
    assert est["total_usd"] == round(expected, 4) and est["unknown_models"] == []
    assert set(est["per_role"]) == set(resolved.roles)
    better = estimate_review_cost(resolve_llm_config(parse_llm_config(MINIMAL), "better"), CATALOG)
    assert better["total_usd"] == 0 and better["unknown_models"][0].endswith("vendor/better")


async def test_catalog_is_cached_in_redis_for_an_hour(redis):
    calls = []

    async def load():
        calls.append(1)
        return CATALOG

    first = await cached_catalog(redis, load)
    second = await cached_catalog(redis, load)
    assert first == second == CATALOG and calls == [1]
    assert 3590 <= await redis.ttl(CATALOG_KEY) <= 3600


async def test_a_failed_fetch_returns_none(redis):
    async def load():
        raise OSError("offline")

    assert await cached_catalog(redis, load) is None


def test_catalog_rows_filter_and_shape():
    rows = catalog_rows(CATALOG, structured=True)
    assert [r["id"] for r in rows] == ["vendor/cheap", "vendor/smart"]
    assert rows[0] == {"id": "vendor/cheap", "context_length": 100_000, "price_in_per_m": 0.1,
                       "price_out_per_m": 0.4, "structured": True, "tools": True, "reasoning": False}
    assert [r["id"] for r in catalog_rows(CATALOG, reasoning=True)] == ["vendor/smart"]
    assert [r["id"] for r in catalog_rows(CATALOG, q="SMA")] == ["vendor/smart"]
    assert [r["id"] for r in catalog_rows(CATALOG, max_price=1.0)] == ["vendor/cheap"]
    assert len(catalog_rows(CATALOG, limit=1)) == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_cost_catalog.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.llm_cost'`.

- [ ] **Step 3: Implement `llm_cost.py`**

Move `_PAPERS`, `_POOL` and `TYPICAL_CALLS` (the full table with its comments) from `app/cli/models.py` into
`backend/app/services/llm_cost.py`, then add:

```python
def estimate_review_cost(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo]) -> dict[str, Any]:
    """Rough USD cost of one default review with this preset (OpenRouter prices); models the catalog does not know
    (other providers, typos) are listed instead of priced."""
    per_role: dict[str, float] = {}
    unknown: list[str] = []
    total = 0.0
    for name, role in resolved.roles.items():
        calls, tokens_in, tokens_out = TYPICAL_CALLS.get(name, (0, 0, 0))
        info = catalog.get(role.spec.model) if role.provider == "openrouter" else None
        if info is None:
            unknown.append(f"{name}: {role.provider}:{role.spec.model}")
            continue
        cost = calls * info.cost(tokens_in, tokens_out)
        per_role[name] = round(cost, 6)
        total += cost
    return {"total_usd": round(total, 4), "per_role": per_role, "unknown_models": unknown}
```

In `app/cli/models.py`, import `TYPICAL_CALLS`, `_PAPERS` and `_POOL` from `app.services.llm_cost`, and
`load_live_catalog` from `app.services.model_catalog`, in place of the local `_load_live_catalog`. The `check` output
stays byte-for-byte the same.

- [ ] **Step 4: Implement the catalog helpers in `model_catalog.py`**

```python
import json
from collections.abc import Awaitable, Callable

from app.logging import get_logger

log = get_logger(__name__)
CATALOG_KEY = "mra:llm:catalog"
CATALOG_TTL_SECONDS = 3600


async def load_live_catalog() -> dict[str, ModelInfo]:
    http = HttpClient(timeout=30)
    try:
        return await OpenRouterCatalog(http).load()
    finally:
        await http.aclose()


def _to_json(catalog: dict[str, ModelInfo]) -> str:
    return json.dumps([{"id": m.id, "context_length": m.context_length, "price_in": m.price_in,
                        "price_out": m.price_out, "supported_parameters": sorted(m.supported_parameters)}
                       for m in catalog.values()])


def _from_json(text: str) -> dict[str, ModelInfo]:
    return {m["id"]: ModelInfo(id=m["id"], context_length=m["context_length"], price_in=m["price_in"],
                               price_out=m["price_out"], supported_parameters=frozenset(m["supported_parameters"]))
            for m in json.loads(text)}


async def cached_catalog(redis, load: Callable[[], Awaitable[dict[str, ModelInfo]]] = load_live_catalog
                         ) -> dict[str, ModelInfo] | None:
    """The OpenRouter catalog, cached in Redis for an hour; None when it cannot be fetched (checks are then skipped)."""
    try:
        cached = await redis.get(CATALOG_KEY)
    except Exception:  # noqa: BLE001
        cached = None
    if cached:
        return _from_json(cached)
    try:
        catalog = await load()
    except Exception as exc:  # noqa: BLE001 - an offline catalog only skips the checks
        log.warning("openrouter_catalog_unavailable", error=str(exc))
        return None
    try:
        await redis.set(CATALOG_KEY, _to_json(catalog), ex=CATALOG_TTL_SECONDS)
    except Exception:  # noqa: BLE001
        pass
    return catalog


def catalog_rows(catalog: dict[str, ModelInfo], *, q: str | None = None, structured: bool = False,
                 reasoning: bool = False, max_price: float | None = None, limit: int = 100) -> list[dict]:
    """Catalog entries for the console, cheapest first; max_price is the input price in USD per 1M tokens."""
    rows = sorted(catalog.values(), key=lambda m: (m.price_in, m.id))
    if q:
        rows = [m for m in rows if q.lower() in m.id.lower()]
    if structured:
        rows = [m for m in rows if m.supports("structured_outputs")]
    if reasoning:
        rows = [m for m in rows if m.supports("reasoning")]
    if max_price is not None:
        rows = [m for m in rows if m.price_in * 1_000_000 <= max_price]
    return [{"id": m.id, "context_length": m.context_length, "price_in_per_m": round(m.price_in * 1_000_000, 6),
             "price_out_per_m": round(m.price_out * 1_000_000, 6), "structured": m.supports("structured_outputs"),
             "tools": m.supports("tools"), "reasoning": m.supports("reasoning")} for m in rows[:limit]]
```

- [ ] **Step 5: `check --source db`**

In `app/cli/models.py`, add `p_check.add_argument("--source", choices=["file", "db"], default="file")`. In `_check`,
when `args.source == "db"`, resolve through the DB:

```python
async def _db_config(settings):
    from app.db.session import make_engine, make_session_factory
    from app.services.llm_store import load_effective

    engine = make_engine(settings.database_url)
    try:
        async with make_session_factory(engine)() as session:
            return await load_effective(session, settings)
    finally:
        await engine.dispose()
```

```python
    if args.source == "db":
        effective = run_async(_db_config(settings))
        out.write(f"source: {effective.label}\n")
        config = effective.resolve()
    else:
        config = load_llm_config(args.config or settings.llm_config_path, args.preset or settings.llm_preset)
```

Keep the `LLMConfigError` handling. Add a test to `backend/tests/unit/test_models_cli.py` that monkeypatches
`app.cli.models._db_config` to return an `EffectiveConfig` built from `MINIMAL`, then asserts `source: db:5` and the
cheap models appear in the output.

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_cost_catalog.py tests/unit/test_models_cli.py tests/unit/test_model_catalog.py -q`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check app tests
cd /d/MRA-plan-23b && git add backend/app/services/llm_cost.py backend/app/services/model_catalog.py backend/app/cli/models.py \
  backend/tests/unit/test_llm_cost_catalog.py backend/tests/unit/test_models_cli.py
git commit -m "feat(llm): cost estimate service, Redis-cached OpenRouter catalog, models check --source db (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The test call (probe)

**Files:**
- Create: `backend/app/services/llm_probe.py`
- Test: `backend/tests/unit/test_llm_probe.py`

**Interfaces:**
- Consumes:
  - `ResolvedRole.with_spec`.
  - `build_role_llm(role, settings, catalog, schema=)`, `LimitedLLM` and `LLMResult` from `app.services.llm`.
  - `ReviewBudget` and `use_budget` from `app.services.budget`.
- Produces:
  - `ProbeAnswer(BaseModel)`.
  - `PROBE_MAX_TOKENS = 512`, `PROBE_TIMEOUT_SECONDS = 60.0` and `PROBE_BUDGET_USD = 0.05`.
  - `async probe(role: ResolvedRole, settings, catalog=None, *, build=build_role_llm) -> dict` returning `ok`, `latency_ms`, `cost_usd`, `model` and `error`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_llm_probe.py`:

```python
from app.config import Settings
from app.services.llm import LLMResult
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_probe import PROBE_MAX_TOKENS, ProbeAnswer, probe
from tests.llm_helpers import MINIMAL, with_model

SETTINGS = Settings(_env_file=None, openrouter_api_key="sk-or-x")


def role(model="vendor/cheap", max_tokens=8192, timeout=300):
    raw = with_model(MINIMAL, "cheap", "synthesizer", model)
    raw["presets"]["cheap"]["synthesizer"].update(max_tokens=max_tokens, timeout_seconds=timeout)
    return resolve_llm_config(parse_llm_config(raw)).roles["synthesizer"]


class FakeLLM:
    def __init__(self, answer, cost=0.0001, error=None):
        self.model, self.answer, self.cost, self.error = "vendor/cheap", answer, cost, error

    async def ainvoke(self, system, user):
        if self.error:
            raise self.error
        return LLMResult(value=self.answer, cost_usd=self.cost, model=self.model, input_tokens=20, output_tokens=5)


async def test_a_working_model_reports_ok_cost_and_latency():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen.update(max_tokens=r.spec.max_tokens, timeout=r.spec.timeout_seconds, schema=schema)
        return FakeLLM(ProbeAnswer(ok=True, word="hello"))

    out = await probe(role(), SETTINGS, None, build=build)
    assert out["ok"] is True and out["error"] is None and out["cost_usd"] == 0.0001
    assert out["model"] == "vendor/cheap" and out["latency_ms"] >= 0
    assert seen == {"max_tokens": PROBE_MAX_TOKENS, "timeout": 60.0, "schema": ProbeAnswer}


async def test_small_limits_are_kept():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen.update(max_tokens=r.spec.max_tokens, timeout=r.spec.timeout_seconds)
        return FakeLLM(ProbeAnswer(ok=True, word="x"))

    await probe(role(max_tokens=100, timeout=10), SETTINGS, None, build=build)
    assert seen == {"max_tokens": 100, "timeout": 10}


async def test_failures_come_back_as_text_never_raise():
    out = await probe(role(), SETTINGS, None,
                      build=lambda *a, **k: FakeLLM(None, error=RuntimeError("model not found")))
    assert out["ok"] is False and "model not found" in out["error"] and out["cost_usd"] == 0
    missing_key = await probe(role(), Settings(_env_file=None, openrouter_api_key=""), None)  # real builder
    assert missing_key["ok"] is False and "OPENROUTER_API_KEY" in missing_key["error"]


async def test_an_unexpected_answer_is_not_ok():
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=False, word="no")))
    assert out["ok"] is False and out["error"] == "the model did not confirm"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_probe.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.llm_probe'`.

- [ ] **Step 3: Implement `backend/app/services/llm_probe.py`**

```python
"""One small real call to a role's model (Plan 23b "ทดสอบ"): proves the model, provider, key and structured output
work together. Output tokens and time are capped and the call runs inside a tiny budget; it never raises."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import Settings
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LimitedLLM, build_role_llm
from app.services.llm_config import ResolvedRole

PROBE_MAX_TOKENS = 512  # reasoning models need some room before they answer
PROBE_TIMEOUT_SECONDS = 60.0
PROBE_BUDGET_USD = 0.05
PROBE_SYSTEM = "You are a connectivity check for a structured-output API. Set ok to true and word to one English word."
PROBE_USER = "Answer now."


class ProbeAnswer(BaseModel):
    ok: bool
    word: str = Field(default="", max_length=40)


async def probe(role: ResolvedRole, settings: Settings, catalog=None, *, build=build_role_llm) -> dict[str, Any]:
    capped = role.with_spec(max_tokens=min(role.spec.max_tokens, PROBE_MAX_TOKENS),
                            timeout_seconds=min(role.spec.timeout_seconds, PROBE_TIMEOUT_SECONDS))
    budget = ReviewBudget(cap_usd=PROBE_BUDGET_USD)
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        llm = LimitedLLM(build(capped, settings, catalog, schema=ProbeAnswer), asyncio.Semaphore(1))
        with use_budget(budget):
            res = await llm.ainvoke(PROBE_SYSTEM, PROBE_USER)
    except Exception as exc:  # noqa: BLE001 - the console shows the reason; nothing else depends on it
        return {"ok": False, "latency_ms": elapsed(), "cost_usd": round(budget.spent, 6), "model": role.spec.model,
                "error": f"{type(exc).__name__}: {exc}"[:300]}
    ok = isinstance(res.value, ProbeAnswer) and res.value.ok
    return {"ok": ok, "latency_ms": elapsed(), "cost_usd": round(res.cost_usd, 6), "model": res.model or role.spec.model,
            "error": None if ok else "the model did not confirm"}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_probe.py -q`
Expected: PASS. If `MissingKeyLLM`'s message does not contain the env name, assert on what it does say (read
`app/services/llm.py` `MissingKeyLLM.ainvoke`). Do not change `MissingKeyLLM`.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check app tests
cd /d/MRA-plan-23b && git add backend/app/services/llm_probe.py backend/tests/unit/test_llm_probe.py
git commit -m "feat(llm): capped test call for one role's model (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Workers load the effective config and reload it without a restart

**Files:**
- Create: `backend/app/worker/llm_reload.py`
- Modify: `backend/app/worker/settings.py` (startup and shutdown)
- Modify: `backend/app/worker/tasks.py` (`run_review` refreshes first)
- Test: `backend/tests/unit/test_llm_reload.py`

**Interfaces:**
- Consumes: `load_effective`, `report_loaded`, `LLM_VERSION_KEY` (Task 3); `build_llms(..., resolved=, sem=, config_version=)` and `build_graph_deps(..., resolved=, sem=, config_version=)` (Task 1).
- Produces:
  - `worker_id() -> str`.
  - `async initial_llm_config(session_factory, settings) -> tuple[ResolvedLLMConfig | None, str, str | None]`, i.e. `(resolved or None for stub, active_id, error)`.
  - `async refresh_llms(ctx, *, build_graph_fn=build_graph) -> bool`.
  - `async poll_llm_config(ctx, interval=30.0)`.
  - ctx keys `llm_version`, `llm_sem`, `llm_lock`, `catalog`, `llm_poller`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_llm_reload.py`:

```python
import asyncio
from dataclasses import dataclass

from app.config import Settings
from app.graph.graph import GraphDeps
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import LLM_VERSION_KEY, LOADED_KEY, loaded_workers, publish_version, save_version
from app.worker.llm_reload import initial_llm_config, refresh_llms, worker_id
from tests.llm_helpers import MINIMAL, with_model, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@dataclass
class FakeGraph:
    deps: GraphDeps
    checkpointer: object = None


def build_graph_fn(deps, checkpointer=None):
    return FakeGraph(deps, checkpointer)


async def make_ctx(tmp_path, session_factory, redis, mode="real"):
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x", graph_mode=mode,
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    sem = asyncio.Semaphore(4)
    deps = GraphDeps(settings=settings, llms=object())
    return {"settings": settings, "session_factory": session_factory, "events_redis": redis,
            "graph_deps": deps, "graph": FakeGraph(deps, checkpointer="CP"), "llm_version": "file",
            "llm_sem": sem, "llm_lock": asyncio.Lock(), "catalog": None}


async def save(session_factory, settings, raw, base):
    async with session_factory() as s, s.begin():
        row = await save_version(s, OWNER, raw, settings=settings, base_version=base)
    return row.id


async def test_initial_config_comes_from_the_db_when_present(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    resolved, active, error = await initial_llm_config(session_factory, ctx["settings"])
    assert (resolved.preset, active, error) == ("cheap", "file", None)
    vid = await save(session_factory, ctx["settings"], {**MINIMAL, "active_preset": "better"}, None)
    resolved, active, _ = await initial_llm_config(session_factory, ctx["settings"])
    assert (resolved.preset, active) == ("better", str(vid))


async def test_no_change_means_no_rebuild(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    graph = ctx["graph"]
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is graph


async def test_a_new_version_rebuilds_with_the_same_semaphore_and_checkpointer(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], with_model(MINIMAL, "cheap", "synthesizer", "vendor/big"), None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    llms = ctx["graph_deps"].llms
    assert llms.models["synthesizer"] == "openrouter:vendor/big" and llms.config_version == f"db:{vid}"
    assert llms.synthesizer.sem is ctx["llm_sem"]
    assert ctx["graph"] is not old_graph and ctx["graph"].checkpointer == "CP" and ctx["llm_version"] == str(vid)
    assert old_graph.deps.llms is not llms  # a runner already holding the old graph keeps the old models
    [report] = await loaded_workers(redis)
    assert report["worker"] == worker_id() and report["version"] == str(vid) and report["error"] is None


async def test_a_config_that_fails_to_build_keeps_the_old_models_and_reports(tmp_path, session_factory, redis,
                                                                            monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)

    def broken(*_a, **_k):
        raise RuntimeError("cannot build")

    monkeypatch.setattr("app.worker.llm_reload.build_llms", broken)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is old_graph and ctx["llm_version"] == "file"
    [report] = await loaded_workers(redis)
    assert report["version"] == "file" and "cannot build" in report["error"]
    monkeypatch.undo()
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True  # the next poll retries


async def test_stub_mode_records_the_version_without_building(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis, mode="stub")
    graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph"] is graph and ctx["llm_version"] == str(vid)
    assert (await loaded_workers(redis))[0]["version"] == str(vid)


async def test_a_missing_redis_key_is_no_change(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await redis.delete(LLM_VERSION_KEY)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert await redis.hgetall(LOADED_KEY) == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_reload.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.worker.llm_reload'`.

- [ ] **Step 3: Implement `backend/app/worker/llm_reload.py`**

```python
"""Workers pick up a saved LLM configuration without a restart (Plan 23b). Each worker compares the Redis key
LLM_VERSION_KEY with the version it loaded, when a review job starts and every 30 seconds; on a change it rebuilds its
LLMs (same per-process semaphore) and graph (same checkpointer). Runners already holding the old graph keep it, so a
review never switches models mid-way. A configuration that fails to build keeps the old models and is reported."""
from __future__ import annotations

import asyncio
import dataclasses
import os
import socket

from app.graph.graph import build_graph
from app.logging import get_logger
from app.services.llm import build_llms
from app.services.llm_config import ResolvedLLMConfig
from app.services.llm_store import LLM_VERSION_KEY, load_effective, report_loaded

log = get_logger(__name__)
POLL_SECONDS = 30.0


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


async def initial_llm_config(session_factory, settings) -> tuple[ResolvedLLMConfig | None, str, str | None]:
    """(resolved config, active id, error) for worker startup. A DB version that cannot be read or resolved falls
    back to config/llm.yaml so the worker still starts; the error is reported."""
    try:
        async with session_factory() as session:
            effective = await load_effective(session, settings)
        return effective.resolve(), effective.active_id, None
    except Exception as exc:  # noqa: BLE001
        log.error("llm_config_load_failed", error=str(exc))
        from app.services.llm_config import load_llm_config
        return load_llm_config(settings.llm_config_path, settings.llm_preset), "file", str(exc)


async def refresh_llms(ctx: dict, *, build_graph_fn=build_graph) -> bool:
    """Rebuild the models when the active version changed. True when this call switched to a new version."""
    redis = ctx["events_redis"]
    try:
        wanted = await redis.get(LLM_VERSION_KEY)
    except Exception:  # noqa: BLE001 - keep the current models while Redis is unreachable
        return False
    if not wanted or wanted == ctx.get("llm_version"):
        return False
    async with ctx["llm_lock"]:
        if wanted == ctx.get("llm_version"):
            return False
        settings = ctx["settings"]
        try:
            async with ctx["session_factory"]() as session:
                effective = await load_effective(session, settings)
            resolved = effective.resolve()
            if settings.graph_mode == "stub":
                deps, graph = ctx["graph_deps"], ctx["graph"]
            else:
                llms = build_llms(settings, ctx.get("catalog"), resolved=resolved, sem=ctx["llm_sem"],
                                  config_version=effective.label)
                deps = dataclasses.replace(ctx["graph_deps"], llms=llms)
                graph = build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None))
        except Exception as exc:  # noqa: BLE001 - keep serving with the models already loaded
            log.error("llm_reload_failed", wanted=wanted, error=str(exc))
            await report_loaded(redis, worker_id(), ctx.get("llm_version") or "file",
                                getattr(getattr(ctx["graph_deps"], "llms", None), "preset", "") or "", error=str(exc))
            return False
        ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, effective.active_id
        await report_loaded(redis, worker_id(), effective.active_id, resolved.preset)
        log.info("llm_reloaded", version=effective.active_id, preset=resolved.preset)
        return True


async def poll_llm_config(ctx: dict, interval: float = POLL_SECONDS) -> None:
    """Background check so an idle worker also picks up (and reports) a new version."""
    while True:
        try:
            await refresh_llms(ctx)
        except Exception as exc:  # noqa: BLE001 - the poller must never die
            log.error("llm_poll_failed", error=str(exc))
        await asyncio.sleep(interval)
```

- [ ] **Step 4: Wire startup, shutdown and the job**

In `backend/app/worker/settings.py` `startup`, replace the two lines that build `graph_deps` and `graph` with:

```python
    ctx["catalog"] = catalog
    ctx["llm_sem"] = asyncio.Semaphore(max(1, settings.llm_concurrency))
    ctx["llm_lock"] = asyncio.Lock()
    resolved, active_id, load_error = await initial_llm_config(ctx["session_factory"], settings)
    ctx["llm_version"] = active_id
    ctx["graph_deps"] = build_graph_deps(settings, ctx["http"], ctx["events_redis"], catalog, resolved=resolved,
                                         sem=ctx["llm_sem"],
                                         config_version=f"db:{active_id}" if active_id != "file" else "file")
    ctx["graph"] = build_graph(ctx["graph_deps"], checkpointer=AsyncPostgresSaver(pool))
    await report_loaded(ctx["events_redis"], worker_id(), active_id, resolved.preset if resolved else "",
                        error=load_error)
    ctx["llm_poller"] = asyncio.create_task(poll_llm_config(ctx))
```

Import `asyncio`, plus `initial_llm_config`, `poll_llm_config` and `worker_id` from `app.worker.llm_reload`, and
`report_loaded` from `app.services.llm_store`. In `shutdown`, first cancel the poller:

```python
    poller = ctx.get("llm_poller")
    if poller is not None:
        poller.cancel()
```

In `backend/app/worker/tasks.py` `run_review`, call `await refresh_llms(ctx)` before `_runner(ctx)`, wrapped so a
failure never blocks the review:

```python
async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review (the runner resumes when a checkpoint exists). A saved LLM configuration is picked up
    first, so the review runs on the newest models (Plan 23b)."""
    if "llm_lock" in ctx:
        await refresh_llms(ctx)
    status = await _runner(ctx).run(uuid.UUID(review_id))
    return {"review_id": review_id, "status": status}
```

The `"llm_lock" in ctx` guard keeps older test contexts (which build ctx by hand) working. Import `refresh_llms` from
`app.worker.llm_reload`.

- [ ] **Step 5: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_llm_reload.py tests/unit -q -k "reload or worker or runner or tasks"`
Expected: PASS. Then run the full suite: `uv run pytest -q`.

- [ ] **Step 6: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check .
cd /d/MRA-plan-23b && git add backend/app/worker/llm_reload.py backend/app/worker/settings.py backend/app/worker/tasks.py \
  backend/tests/unit/test_llm_reload.py
git commit -m "feat(worker): load the effective LLM config and reload it on a new version without a restart (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The result cache key includes the config version

**Files:**
- Modify: `backend/app/services/review_service.py` (`ReviewService(..., llm_version=None)`, the cache key)
- Modify: `backend/app/main.py` (`complete()` passes `llm_version`)
- Test: `backend/tests/unit/test_cache_key_llm_version.py`

**Interfaces:**
- Consumes: `active_version_id(session_factory, redis)`, `publish_version` (Task 3).
- Produces: `ReviewService.__init__(..., llm_version: Callable[[], Awaitable[str]] | None = None)`. The cache version is `prompt_version` when `llm_version` is None, else `f"{prompt_version}+llm{await llm_version()}"`.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_cache_key_llm_version.py`:

```python
from app.services.llm_store import publish_version


async def test_a_new_config_version_makes_a_repeated_topic_run_again(client, redis):
    body = {"topic": "metformin and colorectal cancer"}
    first = await client.post("/api/v1/reviews", json=body)
    again = await client.post("/api/v1/reviews", json=body)
    assert first.status_code == again.status_code == 202
    assert again.json()["review_id"] == first.json()["review_id"]  # same config: reused
    await publish_version(redis, 7)
    other = await client.post("/api/v1/reviews", json=body)
    assert other.status_code == 202 and other.json()["review_id"] != first.json()["review_id"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_cache_key_llm_version.py -q`
Expected: FAIL. The third request reuses the first review.

- [ ] **Step 3: Implement**

In `ReviewService.__init__`, add the parameter `llm_version=None` and store it as `self.llm_version`, with the comment
`async () -> str: the active LLM config version (Plan 23b); None → prompt_version only`. In `create`:

```python
        version = self.settings.prompt_version
        if self.llm_version is not None:
            version = f"{version}+llm{await self.llm_version()}"
        cache_key = compute_cache_key(req.topic, req.language, options, version)
```

In `backend/app/main.py` `complete()`:

```python
            from app.services.llm_store import active_version_id
            d.service = ReviewService(d.session_factory, d.queue, d.event_sink, settings, d.limits,
                                      capacity=Capacity(d.redis, settings),
                                      llm_version=lambda: active_version_id(d.session_factory, d.redis))
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_cache_key_llm_version.py -q && uv run pytest -q`
Expected: PASS. If an existing test computes an expected cache key with only `prompt_version`, update it to the new
version string and say so in the report. The behaviour it pinned (identical requests reuse) must still hold.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check .
cd /d/MRA-plan-23b && git add backend/app/services/review_service.py backend/app/main.py \
  backend/tests/unit/test_cache_key_llm_version.py
git commit -m "feat(cache): the result cache key includes the active LLM config version (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any existing test file you had to adjust to the same commit.)

---

### Task 8: Admin routes for model management

**Files:**
- Create: `backend/app/services/llm_validate.py`
- Create: `backend/app/api/admin_models.py`
- Modify: `backend/app/main.py` (include the router, hidden)
- Test: `backend/tests/unit/test_admin_models_api.py`

**Interfaces:**
- Consumes:
  - Tasks 1, 3, 4 and 5.
  - `require_admin`, `ip_hash_of` and `require_csrf_header` behaviour (`app.api.auth`).
  - `service_error_response` (`app.api.reviews`).
  - `_api_key` from `app.services.llm`, to report key presence.
  - The `admin_headers` test helper.
- Produces:
  - `validate_document(raw, settings, catalog) -> {"ok", "errors", "warnings", "cost", "config", "yaml"}`.
  - The routes in spec section 5. JSON shapes:
    - **Version:** the `version_out` fields.
    - **Effective state:** `{source, version, config, active_preset, env_preset, keys_present, loaded}`.
    - **Catalog:** `{items, available}`.
    - **Probe:** `{ok, latency_ms, cost_usd, model, error}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_models_api.py`:

```python
import pytest
import yaml
from sqlalchemy import func, select

from app.db.models import AdminAudit, LlmConfigVersion
from app.services.llm_store import LLM_VERSION_KEY
from app.services.model_catalog import ModelInfo
from tests.admin_helpers import admin_headers
from tests.llm_helpers import MINIMAL, with_model

BASE = "/api/v1/admin"
CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs"}))


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    async def load():
        return {CHEAP.id: CHEAP}

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", load)


async def count(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def test_state_shows_the_file_then_the_db(client, session_factory):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert state["source"] == "file" and state["version"] is None and state["config"]["active_preset"]
    assert isinstance(state["keys_present"], dict) and state["loaded"] == []
    saved = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert saved.status_code == 201
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert (state["source"], state["version"], state["active_preset"]) == ("db", saved.json()["id"], "cheap")


async def test_save_publishes_the_version_and_a_stale_base_is_409(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    first = (await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)).json()
    assert await redis.get(LLM_VERSION_KEY) == str(first["id"])
    stale = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert stale.status_code == 409 and "reload" in stale.json()["detail"]
    assert await count(session_factory, "llm_config.save") == 1


async def test_invalid_and_non_mapping_bodies_are_422(client, session_factory):
    h = await admin_headers(client, session_factory)
    for body in ({"config": {**MINIMAL, "active_preset": "missing"}, "base_version": None},
                 {"yaml": "- a\n- list\n", "base_version": None},
                 {"yaml": "just text", "base_version": None},
                 {"yaml": "", "base_version": None},
                 {"yaml": "presets: [unclosed", "base_version": None},
                 {"config": MINIMAL, "yaml": "x: 1", "base_version": None},
                 {"base_version": None}):
        r = await client.post(f"{BASE}/llm-config", json=body, headers=h)
        assert r.status_code == 422, (body, r.text)
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(LlmConfigVersion)) == 0


async def test_validate_reports_errors_warnings_cost_and_yaml(client, session_factory):
    h = await admin_headers(client, session_factory)
    ok = (await client.post(f"{BASE}/llm-config/validate", json={"config": MINIMAL}, headers=h)).json()
    assert ok["ok"] is True and ok["errors"] == [] and ok["config"] == MINIMAL
    assert yaml.safe_load(ok["yaml"]) == MINIMAL
    assert ok["cost"]["cheap"]["total_usd"] > 0 and ok["cost"]["better"]["unknown_models"]
    assert any("vendor/better" in w for w in ok["warnings"])  # not in the catalog
    bad = (await client.post(f"{BASE}/llm-config/validate", json={"yaml": "active_preset: x"}, headers=h)).json()
    assert bad["ok"] is False and bad["errors"] and bad["config"] is None


async def test_history_restore_reset_and_yaml_download(client, session_factory):
    h = await admin_headers(client, session_factory)
    v1 = (await client.post(f"{BASE}/llm-config", json={"config": with_model(MINIMAL, "cheap", "guard", "vendor/a"),
                                                         "base_version": None}, headers=h)).json()
    v2 = (await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": v1["id"],
                                                         "note": "back to cheap"}, headers=h)).json()
    page = (await client.get(f"{BASE}/llm-config/versions", headers=h)).json()
    assert [v["id"] for v in page["items"]] == [v2["id"], v1["id"]] and page["next"] is None
    assert page["items"][0]["changes"] == {"roles": {"cheap.guard": "vendor/a → vendor/cheap"}}
    full = (await client.get(f"{BASE}/llm-config/versions/{v1['id']}", headers=h)).json()
    assert full["config"]["presets"]["cheap"]["guard"]["model"] == "vendor/a"
    dl = await client.get(f"{BASE}/llm-config/versions/{v1['id']}/yaml", headers=h)
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
    assert yaml.safe_load(dl.text)["presets"]["cheap"]["guard"]["model"] == "vendor/a"
    restored = await client.post(f"{BASE}/llm-config/versions/{v1['id']}/restore",
                                 json={"base_version": v2["id"]}, headers=h)
    assert restored.status_code == 201 and restored.json()["restored_from"] == v1["id"]
    reset = await client.post(f"{BASE}/llm-config/reset", json={"base_version": restored.json()["id"]}, headers=h)
    assert reset.status_code == 201 and reset.json()["source"] == "file"
    assert (await client.post(f"{BASE}/llm-config/versions/999/restore", json={"base_version": reset.json()["id"]},
                              headers=h)).status_code == 404


async def test_catalog_route_filters_and_reports_availability(client, session_factory, monkeypatch, redis):
    h = await admin_headers(client, session_factory)
    rows = (await client.get(f"{BASE}/llm-models", params={"q": "cheap", "structured": "true"}, headers=h)).json()
    assert rows["available"] is True and [r["id"] for r in rows["items"]] == ["vendor/cheap"]
    await redis.delete("mra:llm:catalog")

    async def offline():
        raise OSError("offline")

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", offline)
    assert (await client.get(f"{BASE}/llm-models", headers=h)).json() == {"items": [], "available": False}


async def test_test_call_resolves_the_draft_rate_limits_and_audits(client, session_factory, monkeypatch):
    h = await admin_headers(client, session_factory)
    seen = []

    async def fake_probe(role, settings, catalog=None):
        seen.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}

    monkeypatch.setattr("app.api.admin_models.probe", fake_probe)
    draft = with_model(MINIMAL, "better", "synthesizer", "vendor/new")
    r = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "preset": "better", "role": "synthesizer"},
                          headers=h)
    assert r.status_code == 200 and r.json()["ok"] is True and seen == [("synthesizer", "vendor/new")]
    assert (await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "nope"},
                              headers=h)).status_code == 422
    for _ in range(8):  # hits 3-10: the refused "nope" call above also counted against the limit
        await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    limited = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    assert limited.status_code == 429 and "retry-after" in limited.headers
    assert await count(session_factory, "llm.test") == 9  # 1 + 8 answered tests; the 422 and the 429 write none


async def test_routes_need_an_admin_and_are_hidden(client):
    assert (await client.get(f"{BASE}/llm-config")).status_code == 401
    paths = (await client.get("/api/openapi.json")).json()["paths"]
    assert not [p for p in paths if "llm" in p]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_admin_models_api.py -q`
Expected: FAIL (404 on `/api/v1/admin/llm-config`).

- [ ] **Step 3: Implement `backend/app/services/llm_validate.py`**

```python
"""Check a draft LLM configuration for the admin console (Plan 23b): schema errors block a save; catalog problems and
missing API key variables are warnings; each preset gets a per-review cost estimate."""
from __future__ import annotations

from typing import Any

import yaml

from app.config import Settings
from app.services.llm import _api_key
from app.services.llm_config import LLMConfigError, parse_llm_config, resolve_llm_config
from app.services.llm_cost import estimate_review_cost
from app.services.model_catalog import ModelInfo, validate_role


def to_yaml(raw: dict[str, Any]) -> str:
    return yaml.safe_dump(raw, sort_keys=False, allow_unicode=True)


def validate_document(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None) -> dict[str, Any]:
    try:
        config = parse_llm_config(raw, where="config")
        resolve_llm_config(config, None, where="config")
    except LLMConfigError as exc:
        return {"ok": False, "errors": [str(exc)], "warnings": [], "cost": {}, "config": None, "yaml": None}
    normalized = config.model_dump(mode="json", exclude_unset=True)
    warnings: list[str] = []
    cost: dict[str, Any] = {}
    if catalog is None:
        warnings.append("OpenRouter catalog unavailable: model checks and cost estimates were skipped")
    used_providers: set[str] = set()
    for preset in config.presets:
        resolved = resolve_llm_config(config, preset, where="config")
        for role in resolved.roles.values():
            used_providers.add(role.provider)
            if catalog is not None:
                warnings += [f"{preset}: {p}" for p in validate_role(role, catalog)]
        if catalog is not None:
            cost[preset] = estimate_review_cost(resolved, catalog)
    for name in sorted(used_providers):
        env_name = config.providers[name].api_key_env
        if not _api_key(settings, env_name) and name != "openai_compatible":
            warnings.append(f"{env_name} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
            "yaml": to_yaml(normalized)}
```

- [ ] **Step 4: Implement `backend/app/api/admin_models.py`**

```python
"""Admin console: LLM model management (Plan 23b). Thin adapters over llm_store, llm_validate, the cached catalog and
the probe. Every change writes its audit row in the same transaction; the probe writes its own."""
from __future__ import annotations

from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import _api_key
from app.services.llm_config import LLMConfigError, parse_llm_config, resolve_llm_config
from app.services.llm_probe import probe
from app.services.llm_store import (
    NOTE_MAX,
    get_version,
    list_versions,
    load_effective,
    loaded_workers,
    publish_version,
    reset_to_file,
    restore_version,
    save_version,
    version_out,
)
from app.services.llm_validate import to_yaml, validate_document
from app.services.model_catalog import cached_catalog, catalog_rows, load_live_catalog
from app.services.review_service import Identity, ServiceError

router = APIRouter()
YAML_MAX = 200_000
TEST_RATE = "10/minute"


class Draft(BaseModel):
    config: dict[str, Any] | None = None
    yaml: str | None = Field(None, max_length=YAML_MAX)

    def raw(self, *, required: bool = True) -> dict[str, Any] | None:
        if self.config is not None and self.yaml is not None:
            raise HTTPException(status_code=422, detail="send either config or yaml, not both")
        if self.yaml is not None:
            try:
                parsed = yaml.safe_load(self.yaml)
            except yaml.YAMLError as exc:
                raise HTTPException(status_code=422, detail=f"invalid YAML: {exc}") from exc
            if not isinstance(parsed, dict):
                raise HTTPException(status_code=422, detail="the YAML must be a mapping (active_preset, presets, …)")
            return parsed
        if self.config is None and required:
            raise HTTPException(status_code=422, detail="config or yaml is required")
        return self.config


class SaveBody(Draft):
    base_version: int | None
    note: str | None = Field(None, max_length=NOTE_MAX)


class BaseBody(BaseModel):
    base_version: int | None
    note: str | None = Field(None, max_length=NOTE_MAX)


class TestBody(Draft):
    preset: str | None = Field(None, max_length=64)
    role: str = Field(min_length=1, max_length=32)


def _config_error(exc: LLMConfigError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


async def _catalog(deps: AppDeps):
    return await cached_catalog(deps.redis, load_live_catalog)


@router.get("/admin/llm-config")
async def llm_config_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    settings = deps.service.settings
    async with deps.session_factory() as session:
        effective = await load_effective(session, settings)
    keys = {p.api_key_env: bool(_api_key(settings, p.api_key_env)) for p in effective.config.providers.values()}
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": effective.config.active_preset, "env_preset": settings.llm_preset,
            "keys_present": keys, "loaded": await loaded_workers(deps.redis)}


@router.get("/admin/llm-config/versions")
async def llm_versions(before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100),
                       deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        rows, nxt = await list_versions(session, before=before, limit=limit)
    return {"items": [version_out(r) for r in rows], "next": nxt}


@router.get("/admin/llm-config/versions/{version_id}")
async def llm_version(version_id: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return {**version_out(row), "config": row.config}


@router.get("/admin/llm-config/versions/{version_id}/yaml")
async def llm_version_yaml(version_id: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return PlainTextResponse(to_yaml(row.config), media_type="text/yaml; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="llm-config-v{version_id}.yaml"'})


@router.post("/admin/llm-config/validate")
async def llm_validate(body: Draft, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    return validate_document(body.raw(), deps.service.settings, await _catalog(deps))


async def _write(deps: AppDeps, identity: Identity, action):
    try:
        async with deps.session_factory() as session, session.begin():
            row = await action(session)
    except LLMConfigError as exc:
        return _config_error(exc)
    except ServiceError as exc:
        return service_error_response(exc)
    await publish_version(deps.redis, row.id)
    return JSONResponse(status_code=201, content=jsonable_encoder(version_out(row)))


@router.post("/admin/llm-config", status_code=201)
async def llm_save(body: SaveBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    raw = body.raw()
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: save_version(
        s, identity.admin, raw, settings=settings, base_version=body.base_version, note=body.note, ip_hash=ip_hash))


@router.post("/admin/llm-config/versions/{version_id}/restore", status_code=201)
async def llm_restore(version_id: int, body: BaseBody, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: restore_version(
        s, identity.admin, version_id, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))


@router.post("/admin/llm-config/reset", status_code=201)
async def llm_reset(body: BaseBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: reset_to_file(
        s, identity.admin, settings=settings, base_version=body.base_version, note=body.note, ip_hash=ip_hash))


@router.get("/admin/llm-models")
async def llm_models(q: str | None = Query(None, max_length=100), structured: bool = False, reasoning: bool = False,
                     max_price: float | None = Query(None, ge=0), limit: int = Query(100, ge=1, le=500),
                     deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    catalog = await _catalog(deps)
    if catalog is None:
        return {"items": [], "available": False}
    return {"items": catalog_rows(catalog, q=q, structured=structured, reasoning=reasoning, max_price=max_price,
                                  limit=limit), "available": True}


@router.post("/admin/llm-models/test")
async def llm_test(body: TestBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    decision = await deps.limits.hit("llm-test", identity.admin.label, TEST_RATE)
    if not decision.allowed:
        return JSONResponse(status_code=429, content={"detail": "too many test calls; wait a minute"},
                            headers={"Retry-After": str(decision.retry_after)})
    settings = deps.service.settings
    try:
        raw = body.raw(required=False)
        if raw is None:
            async with deps.session_factory() as session:
                raw = (await load_effective(session, settings)).raw
        resolved = resolve_llm_config(parse_llm_config(raw, where="config"), body.preset, where="config")
    except LLMConfigError as exc:
        return _config_error(exc)
    role = resolved.roles.get(body.role)
    if role is None:
        raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
    result = await probe(role, settings, await _catalog(deps))
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": body.role, "ok": result["ok"],
                            "cost_usd": result["cost_usd"]}, ip_hash=ip_hash_of(identity, deps))
    return result
```

In `backend/app/main.py`, import `admin_models` with the other API modules and add
`app.include_router(admin_models.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.

- [ ] **Step 5: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_admin_models_api.py -q && uv run pytest -q`
Expected: PASS. The rate-limit test relies on the app fixture's `memory://` limiter, which is reset per test.

- [ ] **Step 6: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check .
cd /d/MRA-plan-23b && git add backend/app/services/llm_validate.py backend/app/api/admin_models.py backend/app/main.py \
  backend/tests/unit/test_admin_models_api.py
git commit -m "feat(admin): model management routes — state, versions, validate, save, restore, reset, catalog, test call (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The eval CLI uses the effective config and records it

**Files:**
- Modify: `backend/app/cli/eval.py` (`main`, the new helper `eval_llm_config`)
- Modify: `backend/app/evals/models.py` (`RunRecord.llm_config`)
- Modify: `backend/app/evals/run.py` (record it)
- Test: `backend/tests/unit/test_eval_llm_config.py`

**Interfaces:**
- Consumes: `load_effective` (Task 3); `load_llm_config`; `build_graph_deps(..., resolved=, config_version=)` (Task 1).
- Produces: `class EvalConfigError(Exception)`, `async eval_llm_config(settings, config_file, session_factory_maker) -> tuple[ResolvedLLMConfig, str]`, `RunRecord.llm_config: str = ""`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_eval_llm_config.py`:

```python
import pytest

from app.cli.eval import EvalConfigError, eval_llm_config
from app.config import Settings
from app.evals.models import RunRecord
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import save_version
from tests.llm_helpers import MINIMAL, write_yaml


async def test_the_db_version_is_used_and_labelled(tmp_path, session_factory):
    settings = Settings(_env_file=None, llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    async with session_factory() as s, s.begin():
        row = await save_version(s, AdminPrincipal("cli", None, "cli"), {**MINIMAL, "active_preset": "better"},
                                 settings=settings, base_version=None)
    resolved, label = await eval_llm_config(settings, None, lambda: session_factory)
    assert resolved.preset == "better" and label == f"db:{row.id}"


async def test_a_config_file_forces_the_file(tmp_path, session_factory):
    path = write_yaml(tmp_path / "other.yaml", MINIMAL)
    resolved, label = await eval_llm_config(Settings(_env_file=None), str(path), lambda: session_factory)
    assert resolved.preset == "cheap" and label == f"file:{path}"


async def test_an_unreachable_db_is_an_error_naming_the_flag():
    def broken():
        raise OSError("connection refused")

    with pytest.raises(EvalConfigError, match="--config-file"):
        await eval_llm_config(Settings(_env_file=None), None, broken)


def test_run_records_carry_the_config_label():
    assert RunRecord.model_fields["llm_config"].default == ""
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_eval_llm_config.py -q`
Expected: FAIL with `ImportError: cannot import name 'EvalConfigError'`.

- [ ] **Step 3: Implement**

In `backend/app/cli/eval.py`, add:

```python
class EvalConfigError(Exception):
    """The model configuration for an eval run could not be read."""


async def eval_llm_config(settings, config_file: str | None, session_factory_maker):
    """(resolved config, label) for an eval run: the service's effective config (the newest DB version, else
    llm.yaml), or the given file. An unreachable DB is an error, never a silent fallback (Plan 23b)."""
    from app.services.llm_config import load_llm_config
    from app.services.llm_store import load_effective

    if config_file:
        return load_llm_config(config_file, settings.llm_preset), f"file:{config_file}"
    try:
        session_factory = session_factory_maker()
        async with session_factory() as session:
            effective = await load_effective(session, settings)
    except Exception as exc:  # noqa: BLE001
        raise EvalConfigError(f"cannot read the model config from the database ({exc}); start Postgres or pass "
                              f"--config-file PATH") from exc
    return effective.resolve(), effective.label
```

In `main()`, take `--config-file` out of argv before `run()` parses the rest, then build the deps from the effective
config:

```python
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config-file")
    known, rest = pre.parse_known_args(sys.argv[1:])

    async def go() -> int:
        from app.db.session import make_engine, make_session_factory

        engine = None

        def factory():
            nonlocal engine
            engine = make_engine(settings.database_url)
            return make_session_factory(engine)

        try:
            resolved, label = await eval_llm_config(settings, known.config_file, factory)
        except EvalConfigError as exc:
            print(exc)
            return 2
        finally:
            if engine is not None:
                await engine.dispose()
        print(f"llm config: {label}")
        http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
        deps = build_graph_deps(settings, http, resolved=resolved, config_version=label)
        deps.openalex, deps.mcp = None, None
        try:
            return await run(rest, deps, http, settings.europepmc_url)
        finally:
            await http.aclose()
```

Add `import argparse` if it is missing. In `backend/app/evals/models.py`, add `llm_config: str = ""` to `RunRecord`,
after `models`. In `backend/app/evals/run.py` `replay`, add
`"llm_config": getattr(deps.llms, "config_version", "")` to `common`. Document `--config-file` in the module
docstring of `app/cli/eval.py`.

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest tests/unit/test_eval_llm_config.py tests/unit -q -k "eval"`
Expected: PASS. Then run the full suite: `uv run pytest -q`.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23b/backend && uv run ruff check .
cd /d/MRA-plan-23b && git add backend/app/cli/eval.py backend/app/evals/models.py backend/app/evals/run.py \
  backend/tests/unit/test_eval_llm_config.py
git commit -m "feat(eval): runs use the service's effective LLM config (DB version or --config-file) and record it (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend foundation for the models page (types, client, nav, header and history)

**Files:**
- Modify: `frontend/src/lib/admin-types.ts`, `frontend/src/lib/admin-api.ts`, `frontend/src/lib/admin-copy.ts`
- Modify: `frontend/src/components/admin/admin-nav.tsx` (add "โมเดล")
- Create: `frontend/src/components/admin/models-view.tsx` (the page container with the header block, tab switcher and draft state)
- Create: `frontend/src/components/admin/models-history.tsx`
- Create: `frontend/src/app/admin/(console)/models/page.tsx`
- Create: `frontend/src/test/admin-model-fixtures.ts`
- Test: `frontend/src/components/admin/models-view.test.tsx`, `frontend/src/components/admin/models-history.test.tsx`, `frontend/src/lib/admin-api.test.ts` (add cases)

**Interfaces:**
- Consumes: the routes from Task 8 (shapes in its Interfaces block); `useAdmin`, `ConfirmButton`, the `ui.ts` classes, and the `mockAdminFetch`/`renderAdmin` helpers from 23a.
- Produces:
  - Types `LlmRoleSpec`, `LlmConfigDoc`, `LoadedWorker`, `LlmConfigState`, `LlmVersion`, `CostEstimate`, `ValidateReport`, `CatalogModel`, `ProbeResult` and `LlmDraft`.
  - `adminApi.llmConfig()`, `llmVersions(before?)`, `llmVersion(id)`, `llmVersionYamlUrl(id)`, `validateLlm(draft)`, `saveLlm(body)`, `restoreLlm(id, base, note?)`, `resetLlm(base, note?)`, `llmModels(query)` and `testLlm(body)`.
  - Copy: `MODEL_SOURCE_LABEL` and `ACTION_LABEL` entries for the four new actions.
  - `<ModelsView />`, which owns `state`, `draft: LlmConfigDoc`, `tab` and `reload()`.
  - `<ModelsHistory base={number | null} onChanged={() => void} />`.

- [ ] **Step 0: Install the frontend dependencies**

Run: `cd /d/MRA-plan-23b/frontend && npm ci`.

- [ ] **Step 1: Types, client and copy**

Append to `frontend/src/lib/admin-types.ts`:

```ts
export interface LlmRoleSpec {
  model: string; provider?: string | null; max_tokens?: number; temperature?: number | null; top_p?: number | null;
  reasoning_effort?: string | null; structured_output?: string; timeout_seconds?: number; fallback_models?: string[];
  extra_body?: Record<string, unknown>;
}
export interface LlmConfigDoc {
  active_preset: string; default_provider?: string; providers: Record<string, Record<string, unknown>>;
  presets: Record<string, Record<string, LlmRoleSpec>>; harness?: Record<string, unknown>;
  overrides?: Record<string, Record<string, unknown>>;
}
export interface LoadedWorker { worker: string; version: string; preset: string; loaded_at: string; error: string | null }
export interface LlmConfigState {
  source: "db" | "file"; version: number | null; config: LlmConfigDoc; active_preset: string; env_preset: string | null;
  keys_present: Record<string, boolean>; loaded: LoadedWorker[];
}
export interface LlmVersion {
  id: number; created_at: string; created_by: string; note: string | null; source: "edit" | "restore" | "file";
  restored_from: number | null; active_preset: string; changes: Record<string, unknown>;
}
export interface CostEstimate { total_usd: number; per_role: Record<string, number>; unknown_models: string[] }
export interface ValidateReport {
  ok: boolean; errors: string[]; warnings: string[]; cost: Record<string, CostEstimate>;
  config: LlmConfigDoc | null; yaml: string | null;
}
export interface CatalogModel {
  id: string; context_length: number | null; price_in_per_m: number; price_out_per_m: number;
  structured: boolean; tools: boolean; reasoning: boolean;
}
export interface ProbeResult { ok: boolean; latency_ms: number; cost_usd: number; model: string; error: string | null }
export type LlmDraft = { config: LlmConfigDoc } | { yaml: string };
export interface CatalogQuery { q?: string; structured?: boolean; reasoning?: boolean; max_price?: number | null }
```

Add to `adminApi` in `frontend/src/lib/admin-api.ts`, and import the new types:

```ts
  llmConfig: () => call<LlmConfigState>("/llm-config"),
  llmVersions: (before?: number | null) => call<Page<LlmVersion>>(`/llm-config/versions${before ? `?before=${before}` : ""}`),
  llmVersion: (id: number) => call<LlmVersion & { config: LlmConfigDoc }>(`/llm-config/versions/${id}`),
  llmVersionYamlUrl: (id: number) => `${ADMIN_BASE}/llm-config/versions/${id}/yaml`,
  validateLlm: (draft: LlmDraft) => call<ValidateReport>("/llm-config/validate", send("POST", draft)),
  saveLlm: (body: LlmDraft & { base_version: number | null; note?: string }) =>
    call<LlmVersion>("/llm-config", send("POST", body)),
  restoreLlm: (id: number, base: number | null, note?: string) =>
    call<LlmVersion>(`/llm-config/versions/${id}/restore`, send("POST", { base_version: base, note })),
  resetLlm: (base: number | null, note?: string) =>
    call<LlmVersion>("/llm-config/reset", send("POST", { base_version: base, note })),
  llmModels: (query: CatalogQuery = {}) => {
    const p = new URLSearchParams();
    if (query.q?.trim()) p.set("q", query.q.trim());
    if (query.structured) p.set("structured", "true");
    if (query.reasoning) p.set("reasoning", "true");
    if (query.max_price != null) p.set("max_price", String(query.max_price));
    const qs = p.toString();
    return call<{ items: CatalogModel[]; available: boolean }>(`/llm-models${qs ? `?${qs}` : ""}`);
  },
  testLlm: (body: Partial<LlmDraft> & { preset?: string; role: string }) =>
    call<ProbeResult>("/llm-models/test", send("POST", body)),
```

Add to `frontend/src/lib/admin-copy.ts`:

```ts
export const MODEL_SOURCE_LABEL: Record<LlmVersion["source"], string> = {
  edit: "แก้ไข", restore: "ย้อนกลับ", file: "จาก llm.yaml",
};
```

Add to `ACTION_LABEL`: `"llm_config.save": "บันทึกการตั้งค่าโมเดล"`, `"llm_config.restore": "ย้อนการตั้งค่าโมเดล"`,
`"llm_config.reset": "กลับไปใช้ llm.yaml"`, `"llm.test": "ทดสอบโมเดล"`. In `admin-nav.tsx`, add
`["/admin/models", "โมเดล"]` to `LINKS` after "API keys".

Add to `frontend/src/lib/admin-api.test.ts` one test that `adminApi.llmModels({ q: " qwen ", structured: true, max_price: 1 })`
requests `/api/v1/admin/llm-models?q=qwen&structured=true&max_price=1`, and one that `saveLlm` sends
`X-MRA-Admin` with a JSON body containing `base_version`.

- [ ] **Step 2: Fixtures and failing tests**

`frontend/src/test/admin-model-fixtures.ts`:

```ts
import type { LlmConfigDoc, LlmConfigState, LlmVersion, Page, ValidateReport } from "@/lib/admin-types";

const ROLES = ["guard", "planner", "screener", "extractor", "synthesizer"] as const;
export const CONFIG: LlmConfigDoc = {
  active_preset: "cheap", default_provider: "openrouter",
  providers: { openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" } },
  presets: {
    cheap: Object.fromEntries(ROLES.map((r) => [r, { model: "vendor/cheap", max_tokens: 4096 }])),
    better: Object.fromEntries(ROLES.map((r) => [r, { model: "vendor/better" }])),
  },
};
export const STATE: LlmConfigState = {
  source: "db", version: 3, config: CONFIG, active_preset: "cheap", env_preset: null,
  keys_present: { OPENROUTER_API_KEY: true },
  loaded: [{ worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-12T10:00:00Z", error: null }],
};
export const VERSIONS: Page<LlmVersion> = {
  items: [
    { id: 3, created_at: "2026-10-12T10:00:00Z", created_by: "owner", note: "cheaper", source: "edit",
      restored_from: null, active_preset: "cheap", changes: { active_preset: "better → cheap" } },
    { id: 2, created_at: "2026-10-11T10:00:00Z", created_by: "owner", note: null, source: "file",
      restored_from: null, active_preset: "better", changes: {} },
  ],
  next: null,
};
export const REPORT_OK: ValidateReport = {
  ok: true, errors: [], warnings: ["better: vendor/better not found on OpenRouter"],
  cost: { cheap: { total_usd: 0.0123, per_role: {}, unknown_models: [] },
          better: { total_usd: 0, per_role: {}, unknown_models: ["guard: openrouter:vendor/better"] } },
  config: CONFIG, yaml: "active_preset: cheap\n",
};
```

`frontend/src/components/admin/models-view.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const routes = (state = STATE) => (m: string, p: string) =>
  p === "/llm-config" ? [200, state] as [number, unknown] : p.startsWith("/llm-config/versions") ? [200, VERSIONS] as [number, unknown] : undefined;

describe("ModelsView header", () => {
  it("says which version is in use, the active preset and what each worker loaded", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/)).toBeInTheDocument();
    expect(screen.getByText(/preset ที่ใช้งาน: cheap/)).toBeInTheDocument();
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("เวอร์ชัน 3");
  });

  it("warns about the file source, LLM_PRESET, missing keys and a worker on another version", async () => {
    mockAdminFetch(routes({
      ...STATE, source: "file", version: null, env_preset: "budget", keys_present: { OPENROUTER_API_KEY: false },
      loaded: [{ worker: "w:1", version: "2", preset: "cheap", loaded_at: "2026-10-12T10:00:00Z", error: "boom" }],
    }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้ llm.yaml/)).toBeInTheDocument();
    expect(screen.getByText(/LLM_PRESET=budget/)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/w:1/)).toHaveTextContent("boom");
  });
});
```

`frontend/src/components/admin/models-history.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsHistory } from "./models-history";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("ModelsHistory", () => {
  it("lists versions with their changes and a YAML download", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-config/versions") ? [200, VERSIONS] : undefined));
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    const v3 = await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ });
    expect(v3).toHaveTextContent("active_preset: better → cheap");
    expect(v3).toHaveTextContent("cheaper");
    expect(within(v3).getByRole("link", { name: /YAML/ })).toHaveAttribute("href", "/api/v1/admin/llm-config/versions/3/yaml");
  });

  it("restores a version after the in-page confirm, sending the base version", async () => {
    const onChanged = vi.fn();
    const fetch = mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/llm-config/versions")) return [200, VERSIONS];
      if (m === "POST" && p === "/llm-config/versions/2/restore") return [201, { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, body }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={onChanged} />);
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const post = fetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ base_version: 3 });
  });

  it("explains a conflict", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET") return [200, VERSIONS];
      if (m === "POST") return [409, { detail: "version 5 is in use now; reload the latest version and try again" }];
    });
    await renderAdmin(<ModelsHistory base={3} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ llm.yaml" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันกลับไปใช้ llm.yaml" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 5 is in use now");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/frontend && npx vitest run src/components/admin/models-view.test.tsx src/components/admin/models-history.test.tsx src/lib/admin-api.test.ts`
Expected: FAIL (missing modules and the missing client methods).

- [ ] **Step 4: Implement the history tab**

`frontend/src/components/admin/models-history.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { MODEL_SOURCE_LABEL, formatWhen } from "@/lib/admin-copy";
import type { LlmVersion } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST } from "./ui";

function changeLines(changes: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (key === "roles" && value && typeof value === "object") {
      for (const [role, change] of Object.entries(value as Record<string, string>)) lines.push(`${role}: ${change}`);
    } else {
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
    }
  }
  return lines;
}

/** Saved versions, newest first: what each changed, restore (a new version with the old content), YAML download. */
export function ModelsHistory({ base, onChanged }: { base: number | null; onChanged: () => void }) {
  const { fail } = useAdmin();
  const [items, setItems] = useState<LlmVersion[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);

  useEffect(() => {
    let alive = true;
    adminApi.llmVersions()
      .then((page) => { if (alive) { setItems(page.items); setNext((page.next as number | null) ?? null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, base]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function act(run: () => Promise<LlmVersion>, done: (v: LlmVersion) => string) {
    setError(null);
    setNotice(null);
    try {
      const v = await run();
      focusNotice.current = true;
      setNotice(done(v));
      onChanged();
    } catch (e) {
      setError(fail(e));
    }
  }

  async function more() {
    try {
      const page = await adminApi.llmVersions(next);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
    } catch (e) {
      setError(fail(e));
    }
  }

  return (
    <section aria-labelledby="models-history-title" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="models-history-title" className="font-display text-xl font-semibold">ประวัติ</h2>
        <ConfirmButton label="กลับไปใช้ llm.yaml" confirmLabel="ยืนยันกลับไปใช้ llm.yaml"
          onConfirm={() => act(() => adminApi.resetLlm(base), (v) => `สร้างเวอร์ชัน ${v.id} จาก llm.yaml แล้ว`)} />
      </div>
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" className="mt-3 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {items === null && !error && <p role="status" className="mt-3 text-muted">กำลังโหลด…</p>}
      {items && items.length === 0 && <p className="mt-3 text-muted">ยังไม่มีเวอร์ชันที่บันทึก ระบบใช้ llm.yaml อยู่</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 border-t border-rule">
          {items.map((v) => (
            <li key={v.id} aria-label={`เวอร์ชัน ${v.id}`} className="grid gap-2 border-b border-rule py-3 md:grid-cols-[14rem_1fr_auto]">
              <div className="text-sm">
                <p className="font-display font-semibold">{`เวอร์ชัน ${v.id}`}{v.id === base ? " · ใช้งานอยู่" : ""}</p>
                <p className="text-muted">{formatWhen(v.created_at)} · {v.created_by}</p>
                <p className="text-muted">{MODEL_SOURCE_LABEL[v.source]}{v.restored_from ? ` จากเวอร์ชัน ${v.restored_from}` : ""} · preset {v.active_preset}</p>
              </div>
              <div className="min-w-0 text-sm">
                {v.note && <p className="mb-1">{v.note}</p>}
                <ul>{changeLines(v.changes).map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <a href={adminApi.llmVersionYamlUrl(v.id)} className={BUTTON_GHOST} download>ดาวน์โหลด YAML</a>
                {v.id !== base && (
                  <ConfirmButton label="ย้อนกลับไปเวอร์ชันนี้" confirmLabel="ยืนยันย้อนกลับ"
                    onConfirm={() => act(() => adminApi.restoreLlm(v.id, base), (n) => `สร้างเวอร์ชัน ${n.id} จากเวอร์ชัน ${v.id} แล้ว`)} />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {next !== null && <button type="button" onClick={more} className={`mt-3 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
```

Note: `restoreLlm(v.id, base)` sends `{ base_version, note: undefined }`, and `JSON.stringify` drops `note`, so
the test's `{ base_version: 3 }` holds.

- [ ] **Step 5: Implement the container**

`frontend/src/components/admin/models-view.tsx` (the editor tabs come in Tasks 11–12; this task renders the header,
the tab switcher and the history tab, and leaves the other tabs as their final components' slots):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ModelsHistory } from "./models-history";

export type ModelsTab = "presets" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [["presets", "Presets"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"]];

export function ModelsHeader({ state }: { state: LlmConfigState }) {
  const missing = Object.entries(state.keys_present).filter(([, set]) => !set).map(([name]) => name);
  const wanted = state.version === null ? "file" : String(state.version);
  return (
    <div className="mt-4 grid gap-2">
      <p className="font-display font-semibold">
        {state.source === "db" ? `ใช้เวอร์ชัน ${state.version} จาก DB` : "ใช้ llm.yaml (ยังไม่มีเวอร์ชันที่บันทึก)"}
        {" · "}{`preset ที่ใช้งาน: ${state.active_preset}`}
      </p>
      {state.env_preset && state.source === "db" && (
        <p className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`ตั้ง LLM_PRESET=${state.env_preset} ไว้ แต่ไม่มีผลเพราะใช้เวอร์ชันจาก DB อยู่`}</p>
      )}
      {state.env_preset && state.source === "file" && (
        <p className="rounded-sm bg-info-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} มีผลอยู่ (ใช้ llm.yaml)`}</p>
      )}
      {missing.map((name) => (
        <p key={name} className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`${name} ยังไม่ได้ตั้ง: role ที่ใช้ provider นี้จะรันไม่ได้`}</p>
      ))}
      <ul className="text-sm" aria-label="worker">
        {state.loaded.length === 0 && <li className="text-muted">ยังไม่มี worker รายงาน (worker จะรายงานภายใน 30 วินาทีหลังเริ่มทำงาน)</li>}
        {state.loaded.map((w) => {
          const off = w.version !== wanted || w.error;
          return (
            <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-3 py-1" : "text-muted"}>
              {`${w.worker}: เวอร์ชัน ${w.version} · preset ${w.preset} · ${formatWhen(w.loaded_at)}`}
              {w.error ? ` · error: ${w.error}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ModelsView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<LlmConfigState | null>(null);
  const [draft, setDraft] = useState<LlmConfigDoc | null>(null);
  const [tab, setTab] = useState<ModelsTab>("presets");
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    adminApi.llmConfig()
      .then((s) => { if (alive) { setState(s); setDraft(s.config); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  return (
    <section aria-labelledby="models-title" className="py-6">
      <h1 id="models-title" className="font-display text-2xl font-semibold">โมเดล</h1>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{error}</p>}
      {!state && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {state && draft && (
        <>
          <ModelsHeader state={state} />
          <div role="group" aria-label="ส่วนของหน้า" className="mt-6 flex flex-wrap gap-1 border-b border-rule pb-2">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}
                className="inline-flex min-h-11 items-center rounded-sm px-3 font-display font-semibold text-ink hover:bg-rail aria-pressed:bg-rail aria-pressed:text-primary">
                {label}
              </button>
            ))}
          </div>
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} />}
          {/* Tasks 11-12 render the presets, YAML and catalog tabs here, sharing `draft`, `setDraft`, `state` and `reload`. */}
        </>
      )}
    </section>
  );
}
```

`frontend/src/app/admin/(console)/models/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ModelsView } from "@/components/admin/models-view";

export const metadata: Metadata = { title: "โมเดล · ผู้ดูแลระบบ" };

export default function AdminModelsPage() {
  return <ModelsView />;
}
```

The JSX comment in `ModelsView` is a marker that Tasks 11 and 12 replace. It is not left in the final code.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `cd /d/MRA-plan-23b/frontend && npx vitest run src/components/admin src/lib && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /d/MRA-plan-23b && git add frontend/src/lib/admin-types.ts frontend/src/lib/admin-api.ts frontend/src/lib/admin-api.test.ts \
  frontend/src/lib/admin-copy.ts frontend/src/components/admin/admin-nav.tsx frontend/src/components/admin/models-view.tsx \
  frontend/src/components/admin/models-history.tsx frontend/src/components/admin/models-view.test.tsx \
  frontend/src/components/admin/models-history.test.tsx frontend/src/test/admin-model-fixtures.ts \
  "frontend/src/app/admin/(console)/models/page.tsx"
git commit -m "feat(admin-ui): models page header (source, workers, warnings) and the history tab with restore and reset (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The presets editor, validation, save and the test call

**Files:**
- Create: `frontend/src/components/admin/models-presets.tsx`
- Create: `frontend/src/components/admin/models-save-bar.tsx`
- Modify: `frontend/src/components/admin/models-view.tsx` (render the presets tab and the save bar)
- Test: `frontend/src/components/admin/models-presets.test.tsx`, `frontend/src/components/admin/models-save-bar.test.tsx`

**Interfaces:**
- Consumes: `ModelsView` state, `draft`, `setDraft`, `reload` (Task 10); `adminApi.validateLlm`, `saveLlm`, `testLlm`.
- Produces:
  - `<ModelsPresets draft setDraft />`.
  - `<ModelsSaveBar state draft onSaved onConflict />`. `onConflict(draftYaml: string)` switches to the YAML tab with the draft kept.
  - Pure helpers in `frontend/src/lib/admin-models.ts`: `setRole(doc, preset, role, patch) -> doc`, `copyPreset(doc, from, to) -> doc`, `deletePreset(doc, name) -> doc` (throws on the active preset), `setActive(doc, name) -> doc` and `ROLE_ORDER: string[]`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/admin-models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONFIG } from "@/test/admin-model-fixtures";
import { copyPreset, deletePreset, setActive, setRole } from "./admin-models";

describe("draft helpers", () => {
  it("never mutate the input", () => {
    const before = JSON.stringify(CONFIG);
    setRole(CONFIG, "cheap", "guard", { model: "x/y" });
    copyPreset(CONFIG, "cheap", "copy");
    setActive(CONFIG, "better");
    expect(JSON.stringify(CONFIG)).toBe(before);
  });
  it("set a role, copy and delete presets, and switch the active one", () => {
    expect(setRole(CONFIG, "cheap", "guard", { model: "x/y", temperature: 0 }).presets.cheap.guard)
      .toEqual({ model: "x/y", max_tokens: 4096, temperature: 0 });
    expect(Object.keys(copyPreset(CONFIG, "cheap", "trial").presets)).toEqual(["cheap", "better", "trial"]);
    expect(Object.keys(deletePreset(CONFIG, "better").presets)).toEqual(["cheap"]);
    expect(() => deletePreset(CONFIG, "cheap")).toThrow(/active/);
    expect(() => copyPreset(CONFIG, "cheap", "better")).toThrow(/exists/);
    expect(setActive(CONFIG, "better").active_preset).toBe("better");
  });
});
```

`frontend/src/components/admin/models-presets.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { CONFIG } from "@/test/admin-model-fixtures";
import { ModelsPresets } from "./models-presets";

const test = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  adminApi: { ...(await orig<typeof import("@/lib/admin-api")>()).adminApi, testLlm: test.run },
}));

function Harness({ onChange }: { onChange: (d: LlmConfigDoc) => void }) {
  const [draft, setDraft] = useState(CONFIG);
  return <ModelsPresets draft={draft} setDraft={(d) => { setDraft(d); onChange(d); }} fail={(e) => String(e)} />;
}

describe("ModelsPresets", () => {
  it("edits a role's model and settings in the draft", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const row = screen.getByRole("row", { name: /synthesizer/ });
    fireEvent.change(within(row).getByLabelText("model ของ synthesizer"), { target: { value: "vendor/big" } });
    fireEvent.change(within(row).getByLabelText("max_tokens ของ synthesizer"), { target: { value: "16000" } });
    const last = onChange.mock.calls.at(-1)![0] as LlmConfigDoc;
    expect(last.presets.cheap.synthesizer).toMatchObject({ model: "vendor/big", max_tokens: 16000 });
  });

  it("switches the active preset and refuses to delete it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "better" } });
    fireEvent.click(screen.getByRole("button", { name: "ตั้งเป็น preset ที่ใช้งาน" }));
    expect((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).active_preset).toBe("better");
    expect(screen.getByRole("button", { name: "ลบ preset" })).toBeDisabled();
  });

  it("copies a preset under a new name", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("ชื่อ preset ใหม่"), { target: { value: "trial" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก preset" }));
    expect(Object.keys((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).presets)).toContain("trial");
  });

  it("tests one role and shows the outcome", async () => {
    test.run.mockResolvedValue({ ok: true, latency_ms: 812, cost_usd: 0.0002, model: "vendor/cheap", error: null });
    render(<Harness onChange={() => {}} />);
    fireEvent.click(within(screen.getByRole("row", { name: /guard/ })).getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
    expect(test.run).toHaveBeenCalledWith({ config: CONFIG, preset: "cheap", role: "guard" });
  });
});
```

`frontend/src/components/admin/models-save-bar.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK, STATE } from "@/test/admin-model-fixtures";
import { ModelsSaveBar } from "./models-save-bar";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("ModelsSaveBar", () => {
  it("shows warnings and cost from validate", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsSaveBar state={STATE} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/vendor\/better not found/)).toBeInTheDocument();
    expect(screen.getByText(/cheap: ~\$0\.012 ต่อรีวิว/)).toBeInTheDocument();
  });

  it("saves with the base version and the note, after validating", async () => {
    const onSaved = vi.fn();
    const fetch = mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4 }];
    });
    await renderAdmin(<ModelsSaveBar state={STATE} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} />);
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "cheaper" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = fetch.mock.calls.find(([u, i]) => String(u).endsWith("/llm-config") && (i as RequestInit).method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ config: CONFIG, base_version: 3, note: "cheaper" });
  });

  it("blocks the save when validate reports errors", async () => {
    const fetch = mockAdminFetch((m, p) => (p === "/llm-config/validate"
      ? [200, { ...REPORT_OK, ok: false, errors: ["config: Unknown preset 'x'"], config: null, yaml: null }] : undefined));
    await renderAdmin(<ModelsSaveBar state={STATE} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown preset");
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith("/llm-config"))).toBe(false);
  });

  it("hands a conflict to the page with the draft as YAML", async () => {
    const onConflict = vi.fn();
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [409, { detail: "version 5 is in use now" }];
    });
    await renderAdmin(<ModelsSaveBar state={STATE} draft={CONFIG} onSaved={() => {}} onConflict={onConflict} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(REPORT_OK.yaml));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/frontend && npx vitest run src/lib/admin-models.test.ts src/components/admin/models-presets.test.tsx src/components/admin/models-save-bar.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the helpers**

`frontend/src/lib/admin-models.ts`:

```ts
import type { LlmConfigDoc, LlmRoleSpec } from "./admin-types";

/** Display order of roles in the editor (the backend accepts any order). */
export const ROLE_ORDER = [
  "guard", "refiner", "planner", "screener", "screener_secondary", "extractor", "extractor_secondary",
  "normalizer", "conflict_explainer", "synthesizer", "localizer", "escalation", "enricher",
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function setRole(doc: LlmConfigDoc, preset: string, role: string, patch: Partial<LlmRoleSpec>): LlmConfigDoc {
  const out = clone(doc);
  out.presets[preset][role] = { ...(out.presets[preset][role] ?? { model: "" }), ...patch } as LlmRoleSpec;
  return out;
}

export function copyPreset(doc: LlmConfigDoc, from: string, to: string): LlmConfigDoc {
  if (doc.presets[to]) throw new Error(`preset ${to} exists`);
  const out = clone(doc);
  out.presets[to] = clone(doc.presets[from]);
  return out;
}

export function deletePreset(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  if (doc.active_preset === name) throw new Error("the active preset cannot be deleted");
  const out = clone(doc);
  delete out.presets[name];
  return out;
}

export function setActive(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  return { ...clone(doc), active_preset: name };
}
```

- [ ] **Step 4: Implement the presets editor**

`frontend/src/components/admin/models-presets.tsx`:

```tsx
"use client";

import { useId, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { ROLE_ORDER, copyPreset, deletePreset, setActive, setRole } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmRoleSpec, ProbeResult } from "@/lib/admin-types";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
    ? <span className="text-sm">{`ใช้ได้ · ${result.latency_ms} ms · $${result.cost_usd.toFixed(4)}`}</span>
    : <span className="text-sm text-err">{`ใช้ไม่ได้: ${result.error ?? "ไม่ทราบสาเหตุ"}`}</span>;
}

/** The presets tab: pick a preset, edit its roles in the draft, copy, delete, make it active, test a role. */
export function ModelsPresets({ draft, setDraft, fail }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
}) {
  const [preset, setPreset] = useState(draft.active_preset);
  const [newName, setNewName] = useState("");
  const [probes, setProbes] = useState<Record<string, ProbeResult | "running">>({});
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const nameId = useId();
  const current = draft.presets[preset] ? preset : draft.active_preset;
  const roles = draft.presets[current] ?? {};
  const order = [...ROLE_ORDER.filter((r) => r in roles), ...Object.keys(roles).filter((r) => !ROLE_ORDER.includes(r))];

  function edit(role: string, patch: Partial<LlmRoleSpec>) {
    setDraft(setRole(draft, current, role, patch));
  }

  async function runTest(role: string) {
    setProbes((p) => ({ ...p, [role]: "running" }));
    try {
      const result = await adminApi.testLlm({ config: draft, preset: current, role });
      setProbes((p) => ({ ...p, [role]: result }));
    } catch (e) {
      setProbes((p) => { const { [role]: _, ...rest } = p; return rest; });
      setError(fail(e));
    }
  }

  function copy() {
    const name = newName.trim();
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) { setError("ชื่อ preset ใช้ได้เฉพาะ a-z, 0-9, _ และ - ไม่เกิน 40 ตัว"); return; }
    try {
      setDraft(copyPreset(draft, current, name));
      setPreset(name);
      setNewName("");
      setError(null);
    } catch {
      setError(`มี preset ชื่อ ${name} อยู่แล้ว`);
    }
  }

  return (
    <section aria-label="Presets" className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor={selectId} className="label">preset ที่กำลังแก้</label>
          <select id={selectId} value={current} onChange={(e) => setPreset(e.target.value)} className={INPUT}>
            {Object.keys(draft.presets).map((name) => (
              <option key={name} value={name}>{name === draft.active_preset ? `${name} (ใช้งาน)` : name}</option>
            ))}
          </select>
        </div>
        <button type="button" className={BUTTON_GHOST} disabled={current === draft.active_preset}
          onClick={() => setDraft(setActive(draft, current))}>ตั้งเป็น preset ที่ใช้งาน</button>
        <ConfirmButton label="ลบ preset" confirmLabel="ยืนยันลบ preset" disabled={current === draft.active_preset}
          onConfirm={() => { setDraft(deletePreset(draft, current)); setPreset(draft.active_preset); }} />
        <div className="grid gap-1">
          <label htmlFor={nameId} className="label">ชื่อ preset ใหม่</label>
          <input id={nameId} value={newName} onChange={(e) => setNewName(e.target.value)} className={INPUT} />
        </div>
        <button type="button" className={BUTTON_GHOST} onClick={copy}>คัดลอก preset</button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      <p className="mt-3 text-sm text-muted">การแก้ไขเป็นแบบร่าง จะมีผลเมื่อกด "บันทึกเป็นเวอร์ชันใหม่"</p>
      <div className={TABLE_REGION} role="region" aria-label={`role ของ preset ${current}`} tabIndex={0}>
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <caption className="sr-only">{`role ของ preset ${current}`}</caption>
          <thead><tr>
            {["role", "model", "provider", "max_tokens", "temperature", "reasoning", "timeout (วินาที)", "fallback", "ทดสอบ"]
              .map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
          </tr></thead>
          <tbody>
            {order.map((role) => {
              const spec = roles[role];
              const probe = probes[role];
              return (
                <tr key={role}>
                  <th scope="row" className={`${TD} font-display`}>{role}</th>
                  <td className={TD}><input aria-label={`model ของ ${role}`} value={spec.model} className={INPUT}
                    onChange={(e) => edit(role, { model: e.target.value })} /></td>
                  <td className={TD}><input aria-label={`provider ของ ${role}`} value={spec.provider ?? ""} className={`${INPUT} w-32`}
                    placeholder={draft.default_provider ?? "openrouter"} onChange={(e) => edit(role, { provider: e.target.value || null })} /></td>
                  <td className={TD}><input aria-label={`max_tokens ของ ${role}`} type="number" min={1} max={128000} className={`${INPUT} w-28`}
                    value={spec.max_tokens ?? ""} onChange={(e) => edit(role, { max_tokens: num(e.target.value) })} /></td>
                  <td className={TD}><input aria-label={`temperature ของ ${role}`} type="number" min={0} max={2} step={0.1} className={`${INPUT} w-24`}
                    value={spec.temperature ?? ""} onChange={(e) => edit(role, { temperature: num(e.target.value) ?? null })} /></td>
                  <td className={TD}><select aria-label={`reasoning ของ ${role}`} className={`${INPUT} w-32`} value={spec.reasoning_effort ?? ""}
                    onChange={(e) => edit(role, { reasoning_effort: e.target.value || null })}>
                    {EFFORTS.map((x) => <option key={x} value={x}>{x || "—"}</option>)}
                  </select></td>
                  <td className={TD}><input aria-label={`timeout ของ ${role}`} type="number" min={1} className={`${INPUT} w-24`}
                    value={spec.timeout_seconds ?? ""} onChange={(e) => edit(role, { timeout_seconds: num(e.target.value) })} /></td>
                  <td className={TD}><input aria-label={`fallback ของ ${role}`} className={INPUT} placeholder="vendor/a, vendor/b"
                    value={(spec.fallback_models ?? []).join(", ")}
                    onChange={(e) => edit(role, { fallback_models: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></td>
                  <td className={TD}>
                    <div className="grid gap-1">
                      <button type="button" className={BUTTON_PRIMARY} disabled={probe === "running"} onClick={() => runTest(role)}>ทดสอบ</button>
                      {probe === "running" && <span role="status" className="text-sm text-muted">กำลังทดสอบ…</span>}
                      {probe && probe !== "running" && <span role="status"><ProbeLine result={probe} /></span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

Empty number fields: `num("")` gives `undefined`, which `JSON.stringify` drops, so the backend default applies. An
empty temperature becomes `null`, which the schema accepts. The test-call message is Thai. "ใช้ได้" means the model
worked.

- [ ] **Step 5: Implement the save bar**

`frontend/src/components/admin/models-save-bar.tsx`:

```tsx
"use client";

import { useId, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import type { LlmConfigDoc, LlmConfigState, ValidateReport } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";

/** Check the draft (errors block, warnings inform, cost per preset), then save it as a new version. */
export function ModelsSaveBar({ state, draft, onSaved, onConflict }: {
  state: LlmConfigState; draft: LlmConfigDoc; onSaved: () => void; onConflict: (draftYaml: string) => void;
}) {
  const { fail } = useAdmin();
  const [note, setNote] = useState("");
  const [report, setReport] = useState<ValidateReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  async function check(): Promise<ValidateReport | null> {
    setError(null);
    try {
      const r = await adminApi.validateLlm({ config: draft });
      setReport(r);
      if (!r.ok) setError(r.errors.join("\n"));
      return r;
    } catch (e) {
      setError(fail(e));
      return null;
    }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await check();
      if (!r?.ok) return;
      await adminApi.saveLlm({ config: draft, base_version: state.version, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
      onSaved();
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        onConflict(report?.yaml ?? "");
        setError("มีผู้ดูแลอื่นบันทึกเวอร์ชันใหม่ก่อน: ร่างของคุณอยู่ในแท็บ YAML ขั้นสูง ตรวจเวอร์ชันล่าสุดแล้วบันทึกใหม่");
      } else {
        setError(fail(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-64 flex-1 gap-1">
          <label htmlFor={noteId} className="label">หมายเหตุ</label>
          <input id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </div>
        <button type="button" className={BUTTON_GHOST} disabled={busy} onClick={check}>ตรวจ</button>
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
      </div>
      {error && <p role="alert" className="whitespace-pre-line rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {report?.ok && (
        <div className="grid gap-2 text-sm">
          {report.warnings.length > 0 && (
            <ul className="rounded-sm bg-warn-bg px-4 py-2">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <ul aria-label="ค่าใช้จ่ายโดยประมาณ">
            {Object.entries(report.cost).map(([preset, c]) => (
              <li key={preset}>
                {`${preset}: ~$${c.total_usd.toFixed(3)} ต่อรีวิว`}
                {c.unknown_models.length > 0 ? ` (ไม่ทราบราคา: ${c.unknown_models.length} role)` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Render them in `ModelsView`**

In `models-view.tsx`, replace the marker comment with the presets tab and the save bar (the YAML and catalog tabs
come in Task 12), and add the conflict handler state:

```tsx
          {tab === "presets" && <ModelsPresets draft={draft} setDraft={setDraft} fail={fail} />}
          {(tab === "presets" || tab === "yaml") && (
            <ModelsSaveBar state={state} draft={draft} onSaved={reload}
              onConflict={(text) => { setConflictYaml(text); setTab("yaml"); }} />
          )}
```

with `const [conflictYaml, setConflictYaml] = useState<string | null>(null);` in the component. Task 12 passes
`conflictYaml` to the YAML tab. Until then it is unused, so prefix it `_` if lint complains, and Task 12 removes the
prefix.

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `cd /d/MRA-plan-23b/frontend && npx vitest run src/components/admin src/lib && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /d/MRA-plan-23b && git add frontend/src/lib/admin-models.ts frontend/src/lib/admin-models.test.ts \
  frontend/src/components/admin/models-presets.tsx frontend/src/components/admin/models-presets.test.tsx \
  frontend/src/components/admin/models-save-bar.tsx frontend/src/components/admin/models-save-bar.test.tsx \
  frontend/src/components/admin/models-view.tsx
git commit -m "feat(admin-ui): presets editor with test call, validate and save as a new version, conflict hand-off (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The YAML editor and the catalog tab

**Files:**
- Create: `frontend/src/components/admin/models-yaml.tsx`
- Create: `frontend/src/components/admin/models-catalog.tsx`
- Modify: `frontend/src/components/admin/models-view.tsx` (render both and pass `conflictYaml`)
- Test: `frontend/src/components/admin/models-yaml.test.tsx`, `frontend/src/components/admin/models-catalog.test.tsx`

**Interfaces:**
- Consumes: `adminApi.validateLlm({ yaml })`, which returns `config` and `yaml`; `adminApi.llmModels(query)`; `setRole`; `ROLE_ORDER`.
- Produces:
  - `<ModelsYaml draft setDraft initialText? />`. "ตรวจ YAML" validates the text, "ใช้ YAML นี้" replaces the draft with the parsed config, and "เริ่มจากร่างปัจจุบัน" refreshes the text from the draft.
  - `<ModelsCatalog draft setDraft />`. It searches, filters, and puts a model into a chosen preset role.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/admin/models-yaml.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK } from "@/test/admin-model-fixtures";
import { ModelsYaml } from "./models-yaml";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("ModelsYaml", () => {
  it("loads the draft as YAML, checks edited text and applies it to the draft", async () => {
    const setDraft = vi.fn();
    const edited = { ...CONFIG, active_preset: "better" };
    const fetch = mockAdminFetch((m, p, body) => {
      if (p !== "/llm-config/validate") return undefined;
      return (body as { config?: unknown }).config
        ? [200, REPORT_OK]
        : [200, { ...REPORT_OK, config: edited, yaml: "active_preset: better\n" }];
    });
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(setDraft).toHaveBeenCalledWith(edited));
    const sent = fetch.mock.calls.map(([, i]) => JSON.parse(((i as RequestInit).body as string) ?? "{}"));
    expect(sent.some((b) => b.yaml === "active_preset: better\n")).toBe(true);
  });

  it("shows YAML errors and leaves the draft alone", async () => {
    const setDraft = vi.fn();
    mockAdminFetch((m, p, body) => {
      if (p !== "/llm-config/validate") return undefined;
      return (body as { yaml?: string }).yaml ? [422, { detail: "invalid YAML: mapping values are not allowed" }] : [200, REPORT_OK];
    });
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    fireEvent.change(await screen.findByLabelText("YAML ของร่าง"), { target: { value: "a: b: c" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid YAML");
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("starts from the conflict text when the save was refused", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} initialText={"active_preset: mine\n"} />);
    expect(await screen.findByLabelText("YAML ของร่าง")).toHaveValue("active_preset: mine\n");
  });
});
```

`frontend/src/components/admin/models-catalog.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG } from "@/test/admin-model-fixtures";
import { ModelsCatalog } from "./models-catalog";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const ITEMS = [
  { id: "qwen/qwen3.5-flash", context_length: 128000, price_in_per_m: 0.1, price_out_per_m: 0.4, structured: true, tools: true, reasoning: true },
  { id: "google/gemini-3.1-flash-lite", context_length: 1000000, price_in_per_m: 0.1, price_out_per_m: 0.4, structured: true, tools: true, reasoning: false },
];

describe("ModelsCatalog", () => {
  it("searches with filters and puts a model into a role of the draft", async () => {
    const setDraft = vi.fn();
    const fetch = mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: ITEMS, available: true }] : undefined));
    await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={setDraft} />);
    fireEvent.change(screen.getByLabelText("ค้นหาโมเดล"), { target: { value: "qwen" } });
    fireEvent.click(screen.getByLabelText("รองรับ structured output"));
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/llm-models?q=qwen&structured=true")).toBe(true));
    const row = await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ });
    expect(row).toHaveTextContent("0.1");
    fireEvent.change(screen.getByLabelText("ใส่ใน role"), { target: { value: "cheap.synthesizer" } });
    fireEvent.click(within(row).getByRole("button", { name: "ใช้กับ role ที่เลือก" }));
    expect((setDraft.mock.calls[0][0] as LlmConfigDoc).presets.cheap.synthesizer.model).toBe("qwen/qwen3.5-flash");
    expect(screen.getByRole("status")).toHaveTextContent("cheap.synthesizer");
  });

  it("says when the catalog is unavailable", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: [], available: false }] : undefined));
    await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={() => {}} />);
    expect(await screen.findByText(/ดึง catalog ของ OpenRouter ไม่ได้/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23b/frontend && npx vitest run src/components/admin/models-yaml.test.tsx src/components/admin/models-catalog.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the YAML editor**

`frontend/src/components/admin/models-yaml.tsx`:

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "./ui";

/** The whole draft as YAML (providers, harness, overrides, extra_body): the backend parses and checks it. */
export function ModelsYaml({ draft, setDraft, initialText }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; initialText?: string | null;
}) {
  const { fail } = useAdmin();
  const [text, setText] = useState(initialText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boxId = useId();

  useEffect(() => {
    if (initialText) return;
    let alive = true;
    adminApi.validateLlm({ config: draft })
      .then((r) => { if (alive && r.yaml) setText(r.yaml); })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
    // the text is loaded once per visit; "เริ่มจากร่างปัจจุบัน" reloads it on demand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fromDraft() {
    setError(null);
    try {
      const r = await adminApi.validateLlm({ config: draft });
      if (r.yaml) setText(r.yaml);
    } catch (e) {
      setError(fail(e));
    }
  }

  async function apply(commit: boolean) {
    setError(null);
    setNotice(null);
    try {
      const r = await adminApi.validateLlm({ yaml: text });
      if (!r.ok || !r.config) { setError(r.errors.join("\n") || "YAML ใช้ไม่ได้"); return; }
      if (commit) { setDraft(r.config); setNotice("ใช้ YAML นี้เป็นร่างแล้ว กดบันทึกเป็นเวอร์ชันใหม่เพื่อให้มีผล"); }
      else setNotice(r.warnings.length ? `ใช้ได้ มีคำเตือน ${r.warnings.length} ข้อ` : "ใช้ได้");
    } catch (e) {
      setError(fail(e));
    }
  }

  return (
    <section aria-label="YAML ขั้นสูง" className="mt-6 grid gap-3">
      <label htmlFor={boxId} className="label">YAML ของร่าง</label>
      <textarea id={boxId} value={text} onChange={(e) => setText(e.target.value)} rows={24} spellCheck={false}
        className="w-full rounded-sm border border-rule bg-ground p-3 font-mono text-sm text-ink" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_GHOST} onClick={() => apply(false)}>ตรวจ YAML</button>
        <button type="button" className={BUTTON_PRIMARY} onClick={() => apply(true)}>ใช้ YAML นี้</button>
        <button type="button" className={BUTTON_GHOST} onClick={fromDraft}>เริ่มจากร่างปัจจุบัน</button>
      </div>
      {notice && <p role="status" className="rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="whitespace-pre-line rounded-sm bg-err-bg px-4 py-2">{error}</p>}
    </section>
  );
}
```

`font-mono` here is the code face for editable configuration text, not Martian Mono for verified paper numbers. If the
project's `font-mono` maps to Martian Mono (check `globals.css`), use the code-block face that
`src/components/code-block.tsx` uses instead, and say which in the report. The `react-hooks/exhaustive-deps` disable is
deliberate: the text loads once per visit. If lint refuses the disable, restructure with a ref that records the first
load.

- [ ] **Step 4: Implement the catalog**

`frontend/src/components/admin/models-catalog.tsx`:

```tsx
"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { adminApi } from "@/lib/admin-api";
import { ROLE_ORDER, setRole } from "@/lib/admin-models";
import type { CatalogModel, CatalogQuery, LlmConfigDoc } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

/** OpenRouter models with prices per 1M tokens and capabilities; one click puts a model into a preset role. */
export function ModelsCatalog({ draft, setDraft }: { draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void }) {
  const { fail } = useAdmin();
  const [query, setQuery] = useState<CatalogQuery>({});
  const [form, setForm] = useState<CatalogQuery>({ q: "", structured: false, reasoning: false, max_price: null });
  const [items, setItems] = useState<CatalogModel[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [target, setTarget] = useState(`${draft.active_preset}.synthesizer`);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { q: useId(), target: useId(), price: useId() };
  const targets = Object.entries(draft.presets).flatMap(([preset, roles]) =>
    ROLE_ORDER.filter((r) => r in roles).map((r) => `${preset}.${r}`));

  useEffect(() => {
    let alive = true;
    adminApi.llmModels(query)
      .then((r) => { if (alive) { setItems(r.items); setAvailable(r.available); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [query, fail]);

  function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setQuery({ ...form });
  }

  function use(model: string) {
    const [preset, role] = target.split(".");
    setDraft(setRole(draft, preset, role, { model }));
    setNotice(`ใส่ ${model} ใน ${target} ของร่างแล้ว`);
  }

  return (
    <section aria-label="Catalog" className="mt-6">
      <form onSubmit={search} className="grid items-end gap-3 md:grid-cols-[2fr_auto_auto_1fr_auto]">
        <div className="grid gap-1">
          <label htmlFor={ids.q} className="label">ค้นหาโมเดล</label>
          <input id={ids.q} value={form.q ?? ""} onChange={(e) => setForm({ ...form, q: e.target.value })} className={INPUT} />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={!!form.structured} onChange={(e) => setForm({ ...form, structured: e.target.checked })} className="size-5 accent-primary" />
          <span>รองรับ structured output</span>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={!!form.reasoning} onChange={(e) => setForm({ ...form, reasoning: e.target.checked })} className="size-5 accent-primary" />
          <span>รองรับ reasoning</span>
        </label>
        <div className="grid gap-1">
          <label htmlFor={ids.price} className="label">ราคา input สูงสุด ($/1M token)</label>
          <input id={ids.price} type="number" min={0} step={0.01} value={form.max_price ?? ""} className={INPUT}
            onChange={(e) => setForm({ ...form, max_price: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <button type="submit" className={BUTTON_PRIMARY}>ค้นหา</button>
      </form>
      <div className="mt-3 grid max-w-md gap-1">
        <label htmlFor={ids.target} className="label">ใส่ใน role</label>
        <select id={ids.target} value={target} onChange={(e) => setTarget(e.target.value)} className={INPUT}>
          {targets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {notice && <p role="status" className="mt-3 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {!available && <p className="mt-3 rounded-sm bg-warn-bg px-4 py-2">ดึง catalog ของ OpenRouter ไม่ได้ตอนนี้ ลองใหม่ภายหลัง หรือพิมพ์ชื่อโมเดลเองในแท็บ Presets</p>}
      {items && items.length > 0 && (
        <div className={TABLE_REGION} role="region" aria-label="โมเดลใน catalog" tabIndex={0}>
          <table className="w-full min-w-[48rem] border-collapse text-sm tabular-nums">
            <caption className="sr-only">โมเดลบน OpenRouter ถูกสุดก่อน</caption>
            <thead><tr>
              {["โมเดล", "input $/1M", "output $/1M", "context", "ความสามารถ", ""].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
            </tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <th scope="row" className={`${TD} break-all font-normal`}>{m.id}</th>
                  <td className={TD}>{m.price_in_per_m}</td>
                  <td className={TD}>{m.price_out_per_m}</td>
                  <td className={TD}>{m.context_length ?? "—"}</td>
                  <td className={TD}>{[m.structured && "structured", m.tools && "tools", m.reasoning && "reasoning"].filter(Boolean).join(", ")}</td>
                  <td className={TD}><button type="button" className={BUTTON_GHOST} onClick={() => use(m.id)}>ใช้กับ role ที่เลือก</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items && items.length === 0 && available && <p className="mt-3 text-muted">ไม่พบโมเดลที่ตรงเงื่อนไข</p>}
    </section>
  );
}
```

The first load lists the whole catalog (`query` `{}`), and the filters start unticked, so the test's one click on
"รองรับ structured output" produces `structured=true` in the submitted query.

- [ ] **Step 5: Render both in `ModelsView`**

```tsx
          {tab === "yaml" && <ModelsYaml draft={draft} setDraft={setDraft} initialText={conflictYaml} />}
          {tab === "catalog" && <ModelsCatalog draft={draft} setDraft={setDraft} />}
```

Remove the `_` prefix from `conflictYaml` if Task 11 added one. Clear `conflictYaml` in `reload()` after a successful
reload of the latest version.

- [ ] **Step 6: Run the whole frontend suite, typecheck and lint**

Run: `cd /d/MRA-plan-23b/frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS. The CPU-heavy `agent-layout` and `team-stage` tests can time out under parallel load; rerun those
files alone and report both runs.

- [ ] **Step 7: Commit**

```bash
cd /d/MRA-plan-23b && git add frontend/src/components/admin/models-yaml.tsx frontend/src/components/admin/models-yaml.test.tsx \
  frontend/src/components/admin/models-catalog.tsx frontend/src/components/admin/models-catalog.test.tsx \
  frontend/src/components/admin/models-view.tsx
git commit -m "feat(admin-ui): advanced YAML editor and the OpenRouter catalog tab (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end flow for the models page (Playwright, mocked admin API)

**Files:**
- Create: `frontend/e2e/admin-models.spec.ts`

**Interfaces:**
- Consumes: the pages from Tasks 10–12; the 23a e2e conventions in `frontend/e2e/admin.spec.ts` (stateful mock with the CSRF check, `noSeriousA11y`, `noHorizontalScroll`, `document.fonts.ready`, alerts scoped to `main`); fixtures from `src/test/admin-model-fixtures.ts`.

- [ ] **Step 1: Write the spec**

`frontend/e2e/admin-models.spec.ts` must cover:
1. **Signed in, the models page shows the header:**
   - "ใช้เวอร์ชัน 3 จาก DB".
   - A worker line.
2. **Presets tab:**
   - Change the synthesizer model of the active preset to `vendor/big`.
   - Click "ตรวจ": the warnings and the cost line appear.
   - Type a note and click "บันทึกเป็นเวอร์ชันใหม่".
   - The mock records the POST body: `base_version: 3`, the note, and the new model in `config.presets.cheap.synthesizer`. It answers 201 with version 4 and from then on serves state version 4 and a history whose newest entry says `cheap.synthesizer: vendor/cheap → vendor/big`.
3. **History tab:**
   - Version 4 is listed with that change.
   - Restore version 3 through the in-page confirm.
   - The mock answers 201 version 5 with `restored_from: 3`.
   - A notice says "สร้างเวอร์ชัน 5 จากเวอร์ชัน 3 แล้ว", and the restore POST carried `base_version: 4`.
4. **Conflict:** a second save whose base is stale gets 409 from the mock. The page moves to the YAML tab and keeps the draft text, and an alert in `main` mentions another admin.
5. **Catalog tab:**
   - Search "qwen" and pick `cheap.guard`.
   - Click "ใช้กับ role ที่เลือก". The status names `cheap.guard`, and the presets tab then shows the model in the guard row.
6. **Test call:** click "ทดสอบ" on a role. The mock answers ok; "ใช้ได้" shows, and the request carried `X-MRA-Admin: 1`.
7. **Layout and accessibility matrix (light/dark × 1440/390):**
   - Run on the models page with each tab open (presets, yaml, history, catalog).
   - Assert there is no sideways scroll and that the page is axe-clean (serious and critical, WCAG 2 A/AA).
   - Wait for `document.fonts.ready` before measuring.
   - Name each page and state in the failure message (`test.step`).

Use the same stateful-mock style as `e2e/admin.spec.ts`. Reject non-GET without `X-MRA-Admin: 1` with 403, answer
401 when not signed in, and use `page.route("**/api/v1/admin/**")`. Copy the axe and layout helpers from
`e2e/admin.spec.ts`.

- [ ] **Step 2: Run the spec**

Run: `cd /d/MRA-plan-23b/frontend && npx playwright test e2e/admin-models.spec.ts`
Expected: PASS. When axe or layout fails, fix the page and do not loosen the check. The role table and the catalog
scroll inside their own regions, so the page must not scroll sideways at 390px.

- [ ] **Step 3: Run the whole e2e suite once**

Run: `cd /d/MRA-plan-23b/frontend && npm run e2e`
Expected: everything passes except the existing skipped live spec.

- [ ] **Step 4: Commit**

```bash
cd /d/MRA-plan-23b && git add frontend/e2e/admin-models.spec.ts
git commit -m "test(admin-ui): e2e model management — edit, validate, save, history restore, conflict, catalog, test call; axe and layout (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any page file you fixed to the same commit, and name it in the report.)

---

### Task 14: Docs, final checks, then merge, docker and the smoke check

**Files:**
- Modify: `docs/api.md` (a "Model management (Plan 23b)" subsection inside the Admin API section, and a cache note)
- Modify: `backend/config/llm.yaml` (header comment: it is the seed)
- Modify: `README.md` (one line under the admin console bullet)
- Modify: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (row 23: 23b done)
- After the merge, on master: root `CLAUDE.md`, by the crafted-blob method

**Steps 1–4 are for the implementer. Steps 5–7 are done by the controller after the final review.**

- [ ] **Step 1: `docs/api.md`**

Document the routes from spec section 5, checked against `backend/app/api/admin_models.py`:
- methods, bodies, success and error codes;
- the 409 rule and `base_version`;
- the YAML body;
- the test-call caps and its 10/minute limit.

Then describe the behaviour:
- reload at the next job start, or within 30 s;
- in-flight reviews keep their models;
- the `mra:llm:loaded` reports;
- `LLM_PRESET` applies only while `llm.yaml` is the source;
- the cache key includes the config version.

In the existing description of the result cache, say that a saved model configuration starts a new cache generation.

- [ ] **Step 2: Other docs**

- **`backend/config/llm.yaml` header:** add two lines near the top saying this file is the seed. The admin console's versions (`/admin/models`) override it once one is saved, and "กลับไปใช้ llm.yaml" restores it.
- **README:** under the admin console bullet, add "Models: change presets and per-role models at `/admin/models`; each save is a version you can restore; workers pick it up within 30 seconds."
- **Roadmap row 23:** append `**23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call).`

- [ ] **Step 3: Commit**

```bash
cd /d/MRA-plan-23b && git add docs/api.md backend/config/llm.yaml README.md docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
git commit -m "docs(admin): model management reference, llm.yaml is the seed, roadmap 23b done (Plan 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final checks on the branch**

Run: `cd /d/MRA-plan-23b/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-23b/frontend && npm test && npm run typecheck && npm run lint`
Expected: all pass. The known flaky tests are allowed only when they pass alone; report them.

- [ ] **Step 5 (controller): Merge, then the CLAUDE.md line**

Merge `plan-23b-model-management` into master with `--no-ff`. Then, by the crafted-blob method used for 23a (build a
blob from `HEAD:CLAUDE.md`, never staging the owner's working copy), replace the committed line that begins
"- Models, presets and per-role tuning live in `backend/config/llm.yaml`" with:

```
- Models, presets and per-role tuning: the admin console's newest saved version (`llm_config_versions`, `app/services/llm_store.py`) wins and `backend/config/llm.yaml` is the seed (default provider OpenRouter, preset `budget`; `LLM_PRESET` applies only while the seed is in use); workers reload a new version at the next job or within 30 s (`app/worker/llm_reload.py`, same LLM semaphore); the result cache key includes the config version; `python -m app.cli.models list|check [--source db]`.
```

- [ ] **Step 6 (controller): Docker rebuild and smoke check through Caddy**

- Run `docker compose build migrate web` then `docker compose up -d`. The migrate job must apply `f2a4c6e8b0d1`.
- Create a temporary `smoke` admin as in 23a, and sign in with curl through `:8088`. Then check each of the following:
  - `GET /api/v1/admin/llm-config` reports source `file` and lists the workers within 30 s.
  - Save a version that only changes the active preset's `guard` model to the same model with `max_tokens: 1000`, so there is no real model change. The answer is 201.
  - Within 30 s, `loaded` shows every worker on the new version with no error. Also check the worker logs for `llm_reloaded`.
  - Restore the seed with `POST /llm-config/reset`, and confirm the workers report it.
  - `GET /api/v1/admin/llm-models?q=qwen` is `available: true`.
  - A test call on `guard` returns `ok: true` and costs under $0.01. Report the actual cost.
- Disable the `smoke` admin at the end.

- [ ] **Step 7 (controller): Clean up and record**

Remove the worktree and keep the branch. Update the memory files (`plan-23a-state.md` → also 23b, or a new
`plan-23b-state.md`) and the `MEMORY.md` index.
