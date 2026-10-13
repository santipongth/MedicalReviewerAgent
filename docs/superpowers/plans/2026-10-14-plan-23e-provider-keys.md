# Plan 23e: LLM Provider Keys in the Admin Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin enters, replaces or removes an LLM provider's API key on `/admin/models` (new tab "ผู้ให้บริการและคีย์"), adds an OpenAI-compatible provider from a template, gives its roles prices, tests it with one capped call, and never edits `.env` or restarts a container. A stolen admin session can spend through the stored keys (within the caps) but can neither read a key nor send one to a host of its choosing. No prompt change, no cache-key change, no spend.

**Architecture:**
- **Provider document** (`app/services/llm_config.py`): `ProviderSpec.kind` (`openrouter | anthropic | openai_compatible`), free provider names (`^[a-z][a-z0-9_]{0,31}$`, at most 12), `api_key_env` optional and pinned (`PROVIDER_KEYS[name]` or `LLM_KEY_<NAME>`), https-or-local-http URL rule for free names, `RoleSpec.price_in/price_out`; `ResolvedRole.kind`; `provider_origin`, `url_origin`, `key_env`, `is_local_origin`. `llm_validate.document_errors` (prices off OpenRouter, `default_provider` configured) is enforced at validate and save, never at load.
- **Key store** (`app/services/llm_keys.py`, table `llm_provider_keys`, migration `c6e8a0b2d4f6`): Fernet (`MultiFernet` of `LLM_KEYS_SECRET`) over `{"v":1, provider, origin, key}`; `KeyRing` (names-only repr), `resolve_key` (console key bound to the origin → else none on a mismatch → else env, a free name only with `LLM_KEY_<NAME>_ORIGIN`); tombstones keep `revision` (= the keys version) rising; CLI `llm-keys-secret`, `rotate-llm-keys`.
- **Clients** (`app/services/llm.py`): `build_role_llm(..., keys=)`/`build_llms(..., keys=)`; OpenAI-compatible servers get `reasoning_effort`, no `models`/`provider` fields, and are charged at the role's price (their own `usage.cost` ignored); a free name on a public host never calls without a key; provider errors pass `redact(text, key)`. Every build site threads the ring (graph factory, worker reloads, harness, eval CLI, probe).
- **Admin API** (`app/api/admin_keys_llm.py`): `GET/PUT/DELETE /admin/llm-keys[/{provider}]`, write-only, body read in code (fixed 422s), 409 without a secret, 20/hour, audit `llm_key.set|replace|delete`, `mra:llm:keys_version` published; `/admin/llm-config` gains `key_status` and `known_prices`; the test route takes `provider`+`model`.
- **Workers** (`app/worker/llm_reload.py`): `refresh_llms` follows the config id and the keys revision (one MGET at job start; the poll reconciles both from the DB), rebuilding on the same config label and semaphore; the heartbeat gains `keys` and `keys_error`.
- **Frontend:** the providers tab (`models-providers.tsx`, templates in `src/lib/provider-templates.ts`), a provider `<select>` and price fields in the presets tab, `missingKeys` in the header, `WorkerVersions` field `keys`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy/Alembic, Redis, `cryptography` (Fernet), langchain-openai/anthropic; Next.js 16, React, Vitest, Testing Library, Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-23e-provider-keys-design.md` (owner-approved design: `C:\Users\santi\.claude\plans\rippling-toasting-whisper.md`).

**Worktree:** `D:\MRA-plan-23e` (branch `plan-23e-provider-keys`).
- It is based on master `cab96c4` (Plan 30 merged). Its commits so far hold the spec (`81c32ee`), this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-14-plan-23e-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-23e/backend` or `cd /d/MRA-plan-23e/frontend`.
- The frontend needs `npm ci` once (Task 6).
- **Plan 30, reconciled against `cab96c4`** (spec section 14): `refresh_llms`/`poll_runtime` keep Plan 23b/23c's flow, so the keys check is added inside `refresh_llms` (one "what changed" step for both values) and `poll_runtime` needs no change; the heartbeat keeps Plan 30's format, TTL and pruning (`LOADED_MAX_AGE` 3 minutes, `loaded_workers`), the two new fields go into `report_state`'s `extra`; `pipeline_version`/`run_version` (Plan 30's cache generation) are untouched because a key is not part of the cache key; Plan 30 added no migration, so `down_revision` is `b3d5f7a9c1e2`; `prompt_version` stays `2026-10-14.1`.
- **Existing interfaces this plan uses**, checked against master `cab96c4` on 2026-10-14:
  - `ProviderSpec`, `RoleSpec`, `LLMConfig._check`, `ResolvedRole`, `PROVIDER_KEYS`, `PINNED_HOSTS`, `VISIBLE_ASCII`, `_is_https_host`, `_is_http_url_with_host`, `url_host`, `parse_llm_config`, `resolve_llm_config`, `FALLBACK_ROLES` (`app/services/llm_config.py`); `validate_document`, `_validate`, `unpriced_roles`, `to_yaml` (`app/services/llm_validate.py`); `estimate_review_cost` (`app/services/llm_cost.py`); `ModelInfo`, `validate_role`, `choose_structured_method` (`app/services/model_catalog.py`);
  - `PRICES_PER_MTOK`, `estimate_cost`, `AnthropicStructuredLLM`, `OpenAICompatibleStructuredLLM`, `MissingKeyLLM`, `LimitedLLM`, `_api_key`, `build_role_llm`, `build_llms`, `OPENROUTER_BASE_URL` (`app/services/llm.py`); `probe`, `PROBE_BUDGET_USD` (`app/services/llm_probe.py`);
  - `save_version`, `restore_version`, `reset_to_file`, `load_effective`, `publish_version`, `reconcile_version_key`, `report_loaded`, `loaded_workers`, `LLM_SAVE_LOCK`, `LLM_VERSION_KEY` (`app/services/llm_store.py`); `record`, `SECRET_FIELDS` (`app/services/audit.py`); `CLI_ACTOR` (`app/services/admin_auth.py`); `run` (`app/cli/admin.py`); `mint_key`, `revoke_key` (`app/services/api_keys.py`);
  - `llm_config_state`, `_unreadable`, `llm_validate`, `llm_test`, `TestBody`, `_catalog` (`app/api/admin_models.py`); `require_admin`, `ip_hash_of` (`app/api/auth.py`); `deps.limits.hit` (`app/services/ratelimits.py`);
  - `refresh_llms`, `report_state`, `init_llms`, `_wire`, `initial_llm_config` (`app/worker/llm_reload.py`); `_rebuild` (`app/worker/runtime_reload.py`); `build_eval_deps` (`app/worker/harness.py`); `eval_main`, `eval_llm_config` (`app/cli/eval.py`); `build_graph_deps` (`app/graph/factory.py`); `run_version` (`app/worker/tasks.py`); `Runtime` (`app/services/runtime_config.py`);
  - test helpers: `app`, `client`, `redis`, `session_factory`, `test_settings` (`tests/conftest.py`); `MINIMAL`, `with_model`, `write_yaml` (`tests/llm_helpers.py`); `admin_headers`, `CSRF` (`tests/admin_helpers.py`); `FakeOpenAIServer`, `completion_body` (`tests/fake_openai.py`); `provider_draft`, `HOSTILE_PROVIDERS`, the `probe_calls` fixture (`tests/unit/test_admin_models_api.py`);
  - frontend `ModelsView`, `ModelsHeader`, `ModelsPresets`, `ModelsSaveBar`, `WorkerVersions`, `ConfirmButton`, `adminApi`, `missingKeyEnvs`, `usedProviders`, `setRole`, `ACTION_LABEL`, `WORKERS_NOT_NOTIFIED`, `formatWhen`, the `ui.ts` classes; test helpers `mockAdminFetch`, `renderAdmin` (`src/test/admin-fetch.tsx`), `CONFIG`, `STATE`, `VERSIONS` (`src/test/admin-model-fixtures.ts`); e2e `mockApi` (`e2e/mock-api.ts`).
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** backend `cryptography>=50.0` (Task 2). It is already in `uv.lock` (50.0.2, through `authlib`), so `uv add --offline "cryptography>=50.0"` (or the two edits of Task 2 and `uv sync --offline`) works without the network. Frontend: none.
- **No spend:** no real LLM call anywhere in this plan, tests included (fake LLMs, the local fake OpenAI server, a mocked admin API in Playwright). The controller's smoke check uses a fake key on a fake provider no active role calls, and presses no "ทดสอบ".
- **Prompts and cache keys:** no prompt or schema sent to a model changes; `prompt_version` stays `2026-10-14.1`; every pin in `tests/unit/test_prompts_by_type.py` holds. `ReviewService._version`, `pipeline_version` and `run_version` are untouched: a key write never moves the result cache key (`test_a_key_write_does_not_move_the_result_cache_key`).
- **Backward compatibility:** today's `backend/config/llm.yaml` and every stored version load unchanged; the new price and `default_provider` rules bite at validate, save, restore and reset only. With no stored keys and no new providers every existing test passes unchanged except the four edits shown in Tasks 1 and 4 (`test_llm_config.py` one message, `test_admin_models_api.py`: the unpriced-Anthropic test, `HOSTILE_PROVIDERS`, the `fake_probe` signatures).
- **Exact values:** table `llm_provider_keys(provider varchar(32) pk, ciphertext text null, last4 varchar(4) null, bound_origin varchar(255) null, revision bigint not null, updated_at timestamptz default now(), updated_by varchar(64))`; migration `c6e8a0b2d4f6`, `down_revision = "b3d5f7a9c1e2"`; advisory lock `LLM_KEYS_LOCK = 0x4D52_414C_4C4D_4B59` ("MRALLMKY"); Redis `mra:llm:keys_version`; payload `{"v": 1, "provider", "origin", "key"}`; a key is stripped, then 8–512 visible ASCII characters, message `the key must be 8 to 512 visible characters without spaces`; `last4` only for keys of 12+ characters; PUT body at most 4096 bytes; `20/hour` per admin (scope `llm-key`, PUT and DELETE); provider names `^[a-z][a-z0-9_]{0,31}$`, `MAX_PROVIDERS = 12`; prices 0–1000 USD per 1M tokens, both or neither; redaction of the key and every 12-character slice; local hosts `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`; heartbeat `keys` (`"none"` before any key) and `keys_error`; audit actions `llm_key.set|replace|delete|rotate`; `SECRET_FIELDS` gains `api_key`, `ciphertext`, `llm_keys_secret`. The probe keeps its $0.05 budget and 10/minute.
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\`. Use the editor tools.
- **Commits:** each message is written with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (the folder is git-ignored) and committed with `git commit -F .superpowers/commit-msg.txt`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known flaky tests:** under host load two heavy vitest cases can pass the 5 s timeout: `src/lib/agent-layout.test.ts` "keeps everything inside the viewBox and nodes apart" (wide and narrow) and `team-stage.test.tsx` "Plan 21 fix round 1: for N = 5, 30 and 50 …"; once, with a second suite running, `glossary-view.test.tsx` and `models-save-bar.test.tsx`. This plan touches none of them. If one fails, rerun it alone once and report both results.
- **e2e port:** `npm run e2e` serves on port 3100 and reuses a server already there (`reuseExistingServer: true`), which could be another worktree's build. Check first (`netstat -ano | grep ":3100 "`); never stop a process you did not start. If 3100 is taken, use the temporary config in Task 6, Step 5 on port 3123 and delete it afterwards (never commit it).
- **Do not touch** `D:\MedicalReviewerAgent` (the live docker stack; a Playwright run may be in progress there) until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`. Never touch other worktrees.

## Review Focus

1. **A key is write-only** (Tasks 2–4, 6): `test_set_replace_and_delete_never_echo_the_key_anywhere` (answers, audit, Redis, logs), `test_a_refused_key_is_never_quoted`, `test_a_body_that_is_not_a_small_key_object_is_a_fixed_422`, `test_the_audit_log_drops_key_fields_at_every_depth`, `test_a_provider_error_that_echoes_the_key_is_redacted`, `test_the_probe_uses_the_ring_and_redacts_what_it_reports`; frontend "sends a typed key once and clears the field, whether the save works or not".
2. **A key goes only to its origin** (Tasks 2–4): `test_seal_and_open_round_trip_and_bind_provider_and_origin`, `test_resolution_console_beats_env_and_never_crosses_origins`, `test_a_free_names_env_key_needs_a_matching_origin_and_never_reads_settings`, `test_the_console_key_beats_env_and_a_moved_origin_gets_none`, `test_moving_a_providers_origin_silences_its_key_and_validate_says_so_first`, `test_a_draft_that_moves_the_origin_tests_without_the_stored_key`.
3. **Hostile documents stay out** (Task 1): the extended `HOSTILE_PROVIDERS` (validate, save and test refused, no probe, no audit), `test_a_free_name_cannot_point_at_an_internal_or_disguised_address`, `test_a_free_name_may_only_name_its_own_variable`, `test_the_kind_rules`, `test_the_seed_and_the_legacy_names_load_unchanged_with_their_kinds`.
4. **Spend stays counted** (Tasks 1, 3): `test_a_role_off_openrouter_without_a_price_is_refused_at_validate`, `test_save_and_restore_refuse_an_unpriced_document_and_a_stored_one_still_loads`, `test_a_console_key_reaches_its_server_in_openai_dialect_and_the_role_price_is_charged`, `test_a_public_server_never_gets_an_anonymous_call_but_a_local_one_may`.
5. **Workers follow keys without moving the cache** (Task 5): `test_a_key_change_rebuilds_on_the_same_config_label_and_semaphore`, `test_a_lost_publish_is_found_by_the_poll_and_delete_falls_back_to_env`, `test_a_ring_that_cannot_be_read_keeps_the_old_llms_and_is_reported`, `test_a_key_write_does_not_move_the_result_cache_key`.

---

### Task 1: The provider document — kinds, free names, URL rules, prices

**Files:**
- Modify: `backend/app/services/llm_config.py`
- Modify: `backend/app/services/llm_validate.py`
- Modify: `backend/app/services/llm_store.py`
- Modify: `backend/app/services/llm_cost.py`
- Modify: `backend/app/services/model_catalog.py`
- Modify: `backend/app/services/llm.py`
- Modify: `backend/app/cli/models.py`
- Modify: `backend/config/llm.yaml`
- Test (create): `backend/tests/unit/test_provider_document.py`
- Test (modify): `backend/tests/unit/test_admin_models_api.py`
- Test (modify): `backend/tests/unit/test_llm_config.py`

**Interfaces:**
- Consumes: `ProviderSpec`, `RoleSpec`, `LLMConfig._check`, `ResolvedRole`, `PROVIDER_KEYS`, `PINNED_HOSTS`, `save_version`, `_validate`, `unpriced_roles`, `estimate_review_cost`, `validate_role`, `build_role_llm`.
- Produces:
  - `app/services/llm_config.py`: `ProviderKind`, `LEGACY_PROVIDERS`, `PROVIDER_NAME`, `MAX_PROVIDERS = 12`, `DEFAULT_ORIGINS`, `LOCAL_HOSTS`; `ProviderSpec.kind`, optional `api_key_env`; `RoleSpec.provider: str | None` (≤ 32), `price_in`/`price_out` (both or neither); `ResolvedRole.kind` (filled from the provider); `provider_kind(name, spec)`, `key_env(name)`, `provider_origin(name, spec)`, `url_origin(url)`, `is_local_origin(origin)`, `_is_open_provider_url(url)`, `_check_provider(name, spec)`.
  - `app/services/llm_validate.py`: `price_errors(config)`, `document_errors(config)`, `save_error_text(errors)`, `MAX_SAVE_ERRORS = 3`; `unpriced_roles` counts a role price; `_validate` returns `document_errors` as errors and warns about fallback models off OpenRouter.
  - `save_version` raises `LLMConfigError("config: …")` for `document_errors` (save, restore and reset).
  - `app/services/model_catalog.py`: `FixedPrice(price_in, price_out)` (per 1M tokens) with `cost()`, `role_price(role)`; `estimate_review_cost` prices a role price first; kind checks in `validate_role`, `cli/models.py` and `build_role_llm` (a free name has no env key until Task 3).

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_provider_document.py` (complete):

```python
"""Plan 23e Task 1: the provider document. Providers have a kind and free names, a free name may only name its own key
variable and only an https (or local http) origin, and every role off OpenRouter carries a price, checked at validate
and save but never when a stored version loads."""
import copy
from pathlib import Path

import pytest

from app.config import Settings
from app.db.models import LlmConfigVersion
from app.services.admin_auth import AdminPrincipal
from app.services.llm_config import (
    LLMConfigError,
    RoleSpec,
    is_local_origin,
    key_env,
    load_llm_config,
    parse_llm_config,
    provider_origin,
    read_llm_yaml,
    resolve_llm_config,
    url_origin,
)
from app.services.llm_cost import estimate_review_cost
from app.services.llm_store import load_effective, restore_version, save_version
from app.services.llm_validate import (
    document_errors,
    price_errors,
    unpriced_roles,
    validate_document,
)
from app.services.model_catalog import ModelInfo
from tests.llm_helpers import MINIMAL

REPO_CONFIG = Path(__file__).parents[2] / "config" / "llm.yaml"
OWNER = AdminPrincipal(kind="user", id=None, label="owner")
SETTINGS = Settings(_env_file=None, openrouter_api_key="sk-or-x")
CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs"}))


def with_provider(name: str, roles: tuple[str, ...] = ("guard",), price: tuple[float, float] | None = (0.5, 1.5),
                  **spec) -> dict:
    """MINIMAL plus a provider `name` that the cheap preset's `roles` use, priced unless price is None."""
    out = copy.deepcopy(MINIMAL)
    out["providers"][name] = {"kind": "openai_compatible", "base_url": "https://api.deepseek.com/v1", **spec}
    for role in roles:
        out["presets"]["cheap"][role] = {"model": "deepseek-chat", "provider": name}
        if price is not None:
            out["presets"]["cheap"][role].update(price_in=price[0], price_out=price[1])
    return out


def test_the_seed_and_the_legacy_names_load_unchanged_with_their_kinds():
    raw = read_llm_yaml(REPO_CONFIG)
    config = parse_llm_config(raw)
    assert config.model_dump(mode="json", exclude_unset=True) == raw
    assert document_errors(config) == []  # the seed saves as it is
    for preset in config.presets:
        for role in resolve_llm_config(config, preset).roles.values():
            assert role.kind == role.provider  # legacy names: the kind is the name
    direct = load_llm_config(REPO_CONFIG, preset="claude_direct")
    assert {r.kind for r in direct.roles.values()} == {"anthropic"}


@pytest.mark.parametrize("name", ["deepseek", "groq", "my_server_2", "a" * 32])
def test_a_free_name_with_a_kind_is_a_provider(name):
    config = parse_llm_config(with_provider(name))
    role = resolve_llm_config(config).roles["guard"]
    assert (role.provider, role.kind) == (name, "openai_compatible")
    assert key_env(name) == f"LLM_KEY_{name.upper()}"


@pytest.mark.parametrize("name", ["DeepSeek", "1abc", "_x", "deep-seek", "a" * 33, "x y", ""])
def test_a_provider_name_is_a_lower_case_slug(name):
    with pytest.raises(LLMConfigError, match="provider name"):
        parse_llm_config(with_provider(name, roles=()))


def test_at_most_twelve_providers():
    raw = copy.deepcopy(MINIMAL)
    for i in range(11):
        raw["providers"][f"p{i}"] = {"kind": "openai_compatible", "base_url": "https://api.example.org/v1"}
    parse_llm_config(raw)  # 12
    raw["providers"]["p11"] = {"kind": "openai_compatible", "base_url": "https://api.example.org/v1"}
    with pytest.raises(LLMConfigError, match="at most 12 providers"):
        parse_llm_config(raw)


@pytest.mark.parametrize("name,spec,match", [
    ("deepseek", {"base_url": "https://api.deepseek.com/v1"}, "kind is required"),
    ("cheapo", {"kind": "openrouter"}, "only under their own names"),
    ("claude", {"kind": "anthropic"}, "only under their own names"),
    ("openrouter", {"kind": "openai_compatible", "base_url": "https://evil.example/v1"}, "only under their own names"),
    ("anthropic", {"kind": "openai_compatible", "base_url": "https://evil.example"}, "only under their own names"),
    ("deepseek", {"kind": "bedrock", "base_url": "https://api.deepseek.com/v1"}, "kind"),
])
def test_the_kind_rules(name, spec, match):
    raw = copy.deepcopy(MINIMAL)
    raw["providers"][name] = spec
    with pytest.raises(LLMConfigError, match=match):
        parse_llm_config(raw)


@pytest.mark.parametrize("env", ["DATABASE_URL", "OPENALEX_API_KEY", "LLM_KEYS_SECRET", "LLM_KEY_OTHER",
                                 "OPENROUTER_API_KEY", "llm_key_deepseek", "LLM_KEY_DEEPSEEK_ORIGIN"])
def test_a_free_name_may_only_name_its_own_variable(env):
    with pytest.raises(LLMConfigError, match="api_key_env must be LLM_KEY_DEEPSEEK or left out"):
        parse_llm_config(with_provider("deepseek", api_key_env=env))
    parse_llm_config(with_provider("deepseek", api_key_env="LLM_KEY_DEEPSEEK"))
    parse_llm_config(with_provider("deepseek"))  # or none at all


def test_a_legacy_name_may_leave_its_variable_out_but_never_name_another():
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["openrouter"].pop("api_key_env")
    parse_llm_config(raw)
    raw["providers"]["openrouter"]["api_key_env"] = "LLM_KEY_OPENROUTER"
    with pytest.raises(LLMConfigError, match="api_key_env must be OPENROUTER_API_KEY"):
        parse_llm_config(raw)


@pytest.mark.parametrize("url", [
    "https://api.deepseek.com/v1", "https://generativelanguage.googleapis.com/v1beta/openai/",
    "https://8.8.8.8/v1", "http://localhost:11434/v1", "http://127.0.0.1:8080/v1", "http://[::1]:11434/v1",
    "http://host.docker.internal:11434/v1",
])
def test_a_free_name_may_use_https_or_local_http(url):
    parse_llm_config(with_provider("ollama", base_url=url))


@pytest.mark.parametrize("url", [
    "http://api.deepseek.com/v1", "http://10.0.0.5:11434/v1", "https://10.0.0.5/v1", "https://192.168.1.2/v1",
    "https://169.254.169.254/latest", "https://[fd00::1]/v1", "https://127.0.0.1/v1",
    "https://user@api.deepseek.com/v1", "https://api.deepseek.com@evil.example/v1", "https://api.deepseek.com/v1?x=1",
    "https://api.deepseek.com/v1#frag", "ftp://api.deepseek.com", "https://api.deepseek.com\\@evil.example/",
    "https://api.deepseek.com:99999/v1", "https:///v1", "api.deepseek.com/v1",
])
def test_a_free_name_cannot_point_at_an_internal_or_disguised_address(url):
    with pytest.raises(LLMConfigError, match="base_url"):
        parse_llm_config(with_provider("deepseek", base_url=url))


def test_a_free_name_needs_a_base_url():
    raw = with_provider("deepseek")
    del raw["providers"]["deepseek"]["base_url"]
    with pytest.raises(LLMConfigError, match="base_url"):
        parse_llm_config(raw)


def test_the_legacy_local_server_keeps_its_wider_rule():
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["openai_compatible"] = {"base_url": "http://10.0.0.5:11434/v1",
                                             "api_key_env": "OPENAI_COMPATIBLE_API_KEY"}
    parse_llm_config(raw)


@pytest.mark.parametrize("url,origin", [
    ("https://API.DeepSeek.com/v1", "https://api.deepseek.com"),
    ("https://api.deepseek.com:443/v1", "https://api.deepseek.com"),
    ("https://api.deepseek.com:8443/v1", "https://api.deepseek.com:8443"),
    ("http://localhost:11434/v1", "http://localhost:11434"),
    ("http://localhost:80/v1", "http://localhost"),
    ("http://[::1]:11434/v1", "http://[::1]:11434"),
    ("https://generativelanguage.googleapis.com/v1beta/openai/", "https://generativelanguage.googleapis.com"),
])
def test_the_origin_is_scheme_host_and_a_non_default_port(url, origin):
    assert url_origin(url) == origin


def test_a_provider_origin_falls_back_to_the_pinned_hosts():
    config = parse_llm_config(read_llm_yaml(REPO_CONFIG))
    origins = {name: provider_origin(name, spec) for name, spec in config.providers.items()}
    assert origins == {"openrouter": "https://openrouter.ai", "anthropic": "https://api.anthropic.com",
                       "openai_compatible": "http://host.docker.internal:11434"}
    assert is_local_origin(origins["openai_compatible"]) and not is_local_origin(origins["openrouter"])
    assert not is_local_origin("http://10.0.0.5:11434") and not is_local_origin("https://localhost")


def test_prices_go_together_and_stay_in_bounds():
    assert RoleSpec(model="m", price_in=0, price_out=0).price_in == 0
    for bad in ({"price_in": 1}, {"price_out": 1}, {"price_in": -1, "price_out": 1}, {"price_in": 1, "price_out": 1001}):
        with pytest.raises(ValueError):
            RoleSpec(model="m", **bad)


def test_a_role_off_openrouter_without_a_price_is_refused_at_validate():
    unpriced = with_provider("deepseek", roles=("guard", "planner"), price=None)
    config = parse_llm_config(unpriced)  # parsing never asks for prices: stored versions keep loading
    why = ("price_in and price_out (USD per 1M tokens) are required for provider 'deepseek' (openai_compatible); the "
           "review cost cap cannot count its calls otherwise")
    # normalizer, localizer, refiner and enricher copy the planner: pricing it prices them, so they are not listed
    assert price_errors(config) == [f"presets.cheap.guard: {why}", f"presets.cheap.planner: {why}"]
    report = validate_document(unpriced, SETTINGS, {CHEAP.id: CHEAP})
    assert report["ok"] is False and len(report["errors"]) == 2 and report["config"] is None
    free = with_provider("ollama", price=(0, 0), base_url="http://localhost:11434/v1")  # a local server costs nothing
    assert validate_document(free, SETTINGS, {CHEAP.id: CHEAP})["ok"] is True


def test_an_override_that_moves_a_role_off_openrouter_needs_a_price():
    raw = with_provider("deepseek", roles=())
    raw["overrides"] = {"synthesizer": {"provider": "deepseek", "model": "deepseek-chat"}}
    errors = price_errors(parse_llm_config(raw))
    assert [e.split(":")[0] for e in errors] == ["presets.cheap.synthesizer", "presets.better.synthesizer"]
    raw["overrides"]["synthesizer"].update(price_in=0.3, price_out=1.2)
    assert price_errors(parse_llm_config(raw)) == []


def test_an_anthropic_model_is_priced_by_the_table_or_by_the_role():
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["anthropic"] = {}
    raw["presets"]["cheap"]["guard"] = {"model": "claude-haiku-4-5", "provider": "anthropic"}
    assert price_errors(parse_llm_config(raw)) == []
    raw["presets"]["cheap"]["guard"]["model"] = "claude-new-9"
    assert len(price_errors(parse_llm_config(raw))) == 1
    raw["presets"]["cheap"]["guard"].update(price_in=3, price_out=15)
    assert price_errors(parse_llm_config(raw)) == []


def test_the_default_provider_must_be_configured_at_validate_but_a_stored_one_still_loads():
    raw = copy.deepcopy(MINIMAL)
    raw["default_provider"] = "anthropic"
    for preset in raw["presets"].values():
        for spec in preset.values():
            spec["provider"] = "openrouter"
    config = parse_llm_config(raw)  # loads: no role uses the default
    assert document_errors(config) == ["default_provider 'anthropic' is not configured in providers"]


def test_a_role_price_is_what_the_estimate_and_the_cap_count():
    priced = parse_llm_config(with_provider("deepseek", roles=("guard",), price=(1.0, 2.0)))
    resolved = resolve_llm_config(priced)
    cost = estimate_review_cost(resolved, {CHEAP.id: CHEAP})
    assert cost["per_role"]["guard"] == round((400 * 1.0 + 100 * 2.0) / 1_000_000, 6)
    assert not any(u.startswith("guard:") for u in cost["unknown_models"])
    assert unpriced_roles(resolved, {CHEAP.id: CHEAP}) == []
    unpriced = resolve_llm_config(parse_llm_config(with_provider("deepseek", price=None)))
    assert unpriced_roles(unpriced, {CHEAP.id: CHEAP}) == ["guard"]


def test_validate_warns_that_fallback_models_stay_on_openrouter():
    raw = with_provider("deepseek")
    raw["presets"]["cheap"]["guard"]["fallback_models"] = ["deepseek-reasoner"]
    report = validate_document(raw, SETTINGS, {CHEAP.id: CHEAP})
    assert report["ok"] is True
    assert "cheap: guard: fallback_models apply only to OpenRouter and are not sent to deepseek" in report["warnings"]


async def test_save_and_restore_refuse_an_unpriced_document_and_a_stored_one_still_loads(session_factory, tmp_path):
    settings = Settings(_env_file=None, llm_config_path=str(REPO_CONFIG))
    unpriced = with_provider("deepseek", price=None)
    with pytest.raises(LLMConfigError, match="price_in and price_out"):
        async with session_factory() as s, s.begin():
            await save_version(s, OWNER, unpriced, settings=settings, base_version=None)
    async with session_factory() as s, s.begin():  # a version saved before the rule (written directly)
        s.add(LlmConfigVersion(created_by="owner", source="edit", config=unpriced, changes={}))
    async with session_factory() as s:
        effective = await load_effective(s, settings)  # workers keep loading it
    assert effective.resolve().roles["guard"].kind == "openai_compatible"
    with pytest.raises(LLMConfigError, match="price_in and price_out"):
        async with session_factory() as s, s.begin():
            await restore_version(s, OWNER, effective.version, settings=settings, base_version=effective.version)
    async with session_factory() as s, s.begin():
        row = await save_version(s, OWNER, with_provider("deepseek"), settings=settings,
                                 base_version=effective.version)
    assert row.config["providers"]["deepseek"]["kind"] == "openai_compatible"
```

**Edit** `backend/tests/unit/test_admin_models_api.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python


def nested(depth):
    top, inner = {}, {}
```

   with

```python


def free_draft(name="deepseek", **fields):
    """MINIMAL plus a provider with a free name (Plan 23e), declared only."""
    out = copy.deepcopy(MINIMAL)
    out["providers"][name] = {"kind": "openai_compatible", "base_url": "https://api.deepseek.com/v1", **fields}
    return out


def nested(depth):
    top, inner = {}, {}
```

2. Replace

```python
    "free-host-with-another-key": provider_draft("openai_compatible", base_url="https://evil.example/v1",
                                                 api_key_env="OPENROUTER_API_KEY"),
}

```

   with

```python
    "free-host-with-another-key": provider_draft("openai_compatible", base_url="https://evil.example/v1",
                                                 api_key_env="OPENROUTER_API_KEY"),
    # Plan 23e: providers with free names
    "free-name-database-url": free_draft(api_key_env="DATABASE_URL"),
    "free-name-openalex-key": free_draft(api_key_env="OPENALEX_API_KEY"),
    "free-name-master-secret": free_draft(api_key_env="LLM_KEYS_SECRET"),
    "free-name-another-providers-key": free_draft(api_key_env="LLM_KEY_OTHER"),
    "openrouter-renamed-kind": provider_draft(kind="openai_compatible", base_url="https://evil.example/v1"),
    "openrouter-kind-under-another-name": free_draft("cheapo", kind="openrouter", base_url=None),
    "free-name-http-to-a-public-host": free_draft(base_url="http://api.deepseek.com/v1"),
    "free-name-private-address": free_draft(base_url="https://10.0.0.5/v1"),
    "free-name-link-local": free_draft(base_url="https://169.254.169.254/latest"),
    "free-name-userinfo-lookalike": free_draft(base_url="https://api.deepseek.com@evil.example/v1"),
}

```

3. Replace

```python
    draft["presets"]["cheap"]["planner"] = {"model": "claude-haiku-4-5", "provider": "anthropic"}  # priced
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is True
    unpriced = [w for w in checked["warnings"] if "no known price" in w]
    assert unpriced[0] == "cheap: no known price for guard: the review cost cap cannot count their calls"
    assert unpriced[1].startswith("better: no known price for guard, planner, screener")  # not in the catalog
    assert len(unpriced) == 2


```

   with

```python
    draft["presets"]["cheap"]["planner"] = {"model": "claude-haiku-4-5", "provider": "anthropic"}  # priced
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    # Plan 23e: a direct Anthropic model without a known price is an error now, not a warning
    assert checked["ok"] is False and checked["errors"] == [
        ("presets.cheap.guard: price_in and price_out (USD per 1M tokens) are required for provider 'anthropic' "
         "(anthropic); the review cost cap cannot count its calls otherwise")]
    draft["presets"]["cheap"]["guard"].update(price_in=3, price_out=15)
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is True
    unpriced = [w for w in checked["warnings"] if "no known price" in w]
    assert unpriced[0].startswith("better: no known price for guard, planner, screener")  # not in the catalog
    assert len(unpriced) == 1


```

**Edit** `backend/tests/unit/test_llm_config.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        (lambda t: t.replace("reasoning_effort: high, fallback", "reasoning_effort: extreme, fallback"), "reasoning_effort"),
        (lambda t: t.replace("    screener:    {model: google/gemini-2.5-flash-lite}\n", "", 1), "missing roles: screener"),
        (lambda t: t.replace("provider: anthropic}", "provider: bedrock}", 1), "provider"),
        (lambda t: t.replace("  anthropic: {api_key_env: ANTHROPIC_API_KEY}\n", ""), "Provider 'anthropic' is not configured"),
        (lambda t: t.replace("temperature: 0}", "temperature: 5}"), "temperature"),
```

   with

```python
        (lambda t: t.replace("reasoning_effort: high, fallback", "reasoning_effort: extreme, fallback"), "reasoning_effort"),
        (lambda t: t.replace("    screener:    {model: google/gemini-2.5-flash-lite}\n", "", 1), "missing roles: screener"),
        (lambda t: t.replace("provider: anthropic}", "provider: bedrock}", 1), "Provider 'bedrock' is not configured"),
        (lambda t: t.replace("  anthropic: {api_key_env: ANTHROPIC_API_KEY}\n", ""), "Provider 'anthropic' is not configured"),
        (lambda t: t.replace("temperature: 0}", "temperature: 5}"), "temperature"),
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_provider_document.py tests/unit/test_admin_models_api.py tests/unit/test_llm_config.py -q`

Expected: collection error `ImportError: cannot import name 'is_local_origin' from 'app.services.llm_config'`

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/llm_config.py` (11 replacements; each `old` occurs exactly once):

1. Replace

```python
from __future__ import annotations

import json
import math
```

   with

```python
from __future__ import annotations

import ipaddress
import json
import math
```

2. Replace

```python
OPTIONAL_ROLES: tuple[str, ...] = (*FALLBACK_ROLES, "screener_secondary", "extractor_secondary", "escalation")
EscalationTrigger = Literal["repair_failed", "verification_failed", "disagreement"]
ProviderName = Literal["openrouter", "anthropic", "openai_compatible"]
Effort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]
StructuredMethod = Literal["auto", "json_schema", "tool_calling", "json_mode"]
```

   with

```python
OPTIONAL_ROLES: tuple[str, ...] = (*FALLBACK_ROLES, "screener_secondary", "extractor_secondary", "escalation")
EscalationTrigger = Literal["repair_failed", "verification_failed", "disagreement"]
# Plan 23e: a provider is a free name with a kind. The three legacy names keep their kind without saying so.
ProviderKind = Literal["openrouter", "anthropic", "openai_compatible"]
LEGACY_PROVIDERS: tuple[str, ...] = ("openrouter", "anthropic", "openai_compatible")
PROVIDER_NAME = re.compile(r"[a-z][a-z0-9_]{0,31}")
MAX_PROVIDERS = 12
Effort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]
StructuredMethod = Literal["auto", "json_schema", "tool_calling", "json_mode"]
```

3. Replace

```python
# variable: a draft cannot make the server send DATABASE_URL, or one provider's key to another's host. OpenRouter and
# Anthropic keys are only ever sent to those providers' own hosts; a local model server (openai_compatible) may be
# anywhere, but it gets only its own key.
PROVIDER_KEYS = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
                 "openai_compatible": "OPENAI_COMPATIBLE_API_KEY"}
PINNED_HOSTS = {"openrouter": "openrouter.ai", "anthropic": "api.anthropic.com"}
VISIBLE_ASCII = re.compile(r"[!-~]+")  # the printable ASCII range without the space
# Visible words with single spaces between them: nothing that could end a header line, and no leading or trailing
```

   with

```python
# variable: a draft cannot make the server send DATABASE_URL, or one provider's key to another's host. OpenRouter and
# Anthropic keys are only ever sent to those providers' own hosts; a local model server (openai_compatible) may be
# anywhere, but it gets only its own key. A provider with a free name (Plan 23e) may only name LLM_KEY_<NAME>.
PROVIDER_KEYS = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
                 "openai_compatible": "OPENAI_COMPATIBLE_API_KEY"}
PINNED_HOSTS = {"openrouter": "openrouter.ai", "anthropic": "api.anthropic.com"}
# Where OpenRouter and Anthropic calls go when their base_url is left out (llm.py's OPENROUTER_BASE_URL, ChatAnthropic's
# default): the origin a stored key of theirs is bound to.
DEFAULT_ORIGINS = {"openrouter": "https://openrouter.ai", "anthropic": "https://api.anthropic.com"}
# A provider with a free name may use plain http only on this machine (a local model server, Ollama in docker).
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})
VISIBLE_ASCII = re.compile(r"[!-~]+")  # the printable ASCII range without the space
# Visible words with single spaces between them: nothing that could end a header line, and no leading or trailing
```

4. Replace

```python
    try:
        return urlsplit(url).scheme in ("http", "https") and url_host(url) is not None
    except ValueError:
        return False
```

   with

```python
    try:
        return urlsplit(url).scheme in ("http", "https") and url_host(url) is not None
    except ValueError:
        return False


def _is_open_provider_url(url: str) -> bool:
    """A base URL for a provider with a free name (Plan 23e): https to a host name or a global IP address, or plain
    http to this machine only; no userinfo, query or fragment. Host names are not resolved here (DNS can change between
    this check and the call), so the IP rule only stops literals: private, link-local and metadata addresses."""
    if not VISIBLE_ASCII.fullmatch(url) or "\\" in url:
        return False
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018 - raises ValueError for a port out of range
        host = parts.hostname
    except ValueError:
        return False
    if not host or "@" in parts.netloc or parts.query or parts.fragment:
        return False
    if parts.scheme == "http":
        return host in LOCAL_HOSTS
    if parts.scheme != "https":
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True  # a host name


def url_origin(url: str) -> str:
    """scheme://host[:port] of a URL, lower case, without a default port: the unit a stored key is bound to (Plan 23e).
    A path change keeps the origin; another host, scheme or port is another origin. Raises ValueError for a URL that
    does not parse."""
    parts = urlsplit(url)
    scheme, host, port = parts.scheme.lower(), parts.hostname or "", parts.port
    if ":" in host:
        host = f"[{host}]"
    default = {"http": 80, "https": 443}.get(scheme)
    return f"{scheme}://{host}" + (f":{port}" if port is not None and port != default else "")


def is_local_origin(origin: str) -> bool:
    """An http origin on this machine: a local model server, which needs no key."""
    try:
        parts = urlsplit(origin)
        return parts.scheme == "http" and parts.hostname in LOCAL_HOSTS
    except ValueError:
        return False
```

5. Replace

```python
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    base_url: str | None = None
    api_key_env: str
    app_name: str | None = None
    app_url: str | None = None
```

   with

```python
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    kind: ProviderKind | None = None  # may be left out only under the three legacy names, where it is the name
    base_url: str | None = None
    api_key_env: str | None = None
    app_name: str | None = None
    app_url: str | None = None
```

6. Replace

```python

    model: str = Field(min_length=1)
    provider: ProviderName | None = None
    max_tokens: int = Field(4096, ge=1, le=128_000)
    temperature: float | None = Field(None, ge=0, le=2)
```

   with

```python

    model: str = Field(min_length=1)
    provider: str | None = Field(None, max_length=32)
    max_tokens: int = Field(4096, ge=1, le=128_000)
    temperature: float | None = Field(None, ge=0, le=2)
```

7. Replace

```python
    fallback_models: list[str] = Field(default_factory=list)
    extra_body: dict[str, Any] = Field(default_factory=dict)

    @field_validator("extra_body")
```

   with

```python
    fallback_models: list[str] = Field(default_factory=list)
    extra_body: dict[str, Any] = Field(default_factory=dict)
    # Plan 23e: USD per 1M tokens, both or neither. Required (at validate and save) off OpenRouter, where no catalog
    # prices a call: the review cost cap charges these.
    price_in: float | None = Field(None, ge=0, le=1000)
    price_out: float | None = Field(None, ge=0, le=1000)

    @field_validator("extra_body")
```

8. Replace

```python
                raise ValueError(f"extra_body.{key} must be a mapping")
        return _check_depth(value, "extra_body")


```

   with

```python
                raise ValueError(f"extra_body.{key} must be a mapping")
        return _check_depth(value, "extra_body")

    @model_validator(mode="after")
    def _both_prices_or_neither(self) -> RoleSpec:
        if (self.price_in is None) != (self.price_out is None):
            raise ValueError("price_in and price_out go together: set both or neither")
        return self


def provider_kind(name: str, spec: ProviderSpec) -> str:
    """The provider's kind: its `kind`, or its name for the three legacy names. The only way code asks for a kind."""
    return spec.kind or name


def key_env(name: str) -> str:
    """The one variable a provider's env key may come from: the fixed name of a legacy provider, else LLM_KEY_<NAME>."""
    return PROVIDER_KEYS.get(name) or f"LLM_KEY_{name.upper()}"


def provider_origin(name: str, spec: ProviderSpec) -> str:
    """The origin the provider's calls go to, which a stored key is bound to: its base_url's, else the default host of
    OpenRouter or Anthropic."""
    if spec.base_url:
        return url_origin(spec.base_url)
    return DEFAULT_ORIGINS.get(provider_kind(name, spec), "")


def _check_provider(name: str, spec: ProviderSpec) -> None:
    if not PROVIDER_NAME.fullmatch(name):
        raise ValueError(f"providers: {name[:40]!r} is not a provider name (a lower-case letter, then up to 31 "
                         "lower-case letters, digits or _)")
    kind = spec.kind or (name if name in LEGACY_PROVIDERS else None)
    if kind is None:
        raise ValueError(f"providers.{name}.kind is required: openrouter, anthropic or openai_compatible")
    if (kind in PINNED_HOSTS or name in PINNED_HOSTS) and kind != name:
        raise ValueError(f"providers.{name}.kind: the openrouter and anthropic kinds exist only under their own names")
    expected = key_env(name)
    if spec.api_key_env is not None and spec.api_key_env != expected:
        raise ValueError(f"providers.{name}.api_key_env must be {expected} or left out: a provider's key is only "
                         "sent to that provider")
    host = PINNED_HOSTS.get(name)
    if host and spec.base_url and not _is_https_host(spec.base_url, host):
        raise ValueError(f"providers.{name}.base_url must be an https://{host}/ address "
                         f"(the {name} key is only sent there)")
    if name == "openai_compatible" and not spec.base_url:
        raise ValueError("providers.openai_compatible.base_url is required, e.g. http://localhost:11434/v1")
    if name == "openai_compatible" and not _is_http_url_with_host(spec.base_url):
        raise ValueError("providers.openai_compatible.base_url must be an http(s) URL with a host, "
                         "e.g. http://localhost:11434/v1")
    if kind == "openai_compatible" and name != "openai_compatible" and not (
            spec.base_url and _is_open_provider_url(spec.base_url)):
        raise ValueError(f"providers.{name}.base_url must be an https:// URL with a public host (or http:// to "
                         "localhost, 127.0.0.1, ::1 or host.docker.internal), without a user, query or fragment")


```

9. Replace

```python

    active_preset: str
    default_provider: ProviderName = "openrouter"
    providers: dict[ProviderName, ProviderSpec]
    presets: dict[str, dict[Role, RoleSpec]]
    harness: HarnessSpec = Field(default_factory=HarnessSpec)
```

   with

```python

    active_preset: str
    default_provider: str = Field("openrouter", max_length=32)
    providers: dict[str, ProviderSpec]
    presets: dict[str, dict[Role, RoleSpec]]
    harness: HarnessSpec = Field(default_factory=HarnessSpec)
```

10. Replace

```python
    @model_validator(mode="after")
    def _check(self) -> LLMConfig:
        for name, provider_spec in self.providers.items():
            if provider_spec.api_key_env != PROVIDER_KEYS[name]:
                raise ValueError(f"providers.{name}.api_key_env must be {PROVIDER_KEYS[name]}: a provider's key is "
                                 "only sent to that provider")
            host = PINNED_HOSTS.get(name)
            if host and provider_spec.base_url and not _is_https_host(provider_spec.base_url, host):
                raise ValueError(f"providers.{name}.base_url must be an https://{host}/ address "
                                 f"(the {name} key is only sent there)")
            if name == "openai_compatible" and not provider_spec.base_url:
                raise ValueError("providers.openai_compatible.base_url is required, e.g. http://localhost:11434/v1")
            if name == "openai_compatible" and not _is_http_url_with_host(provider_spec.base_url):
                raise ValueError("providers.openai_compatible.base_url must be an http(s) URL with a host, "
                                 "e.g. http://localhost:11434/v1")
        for name, roles in self.presets.items():
            missing = [r for r in ROLES if r not in roles]
```

   with

```python
    @model_validator(mode="after")
    def _check(self) -> LLMConfig:
        if len(self.providers) > MAX_PROVIDERS:
            raise ValueError(f"providers: at most {MAX_PROVIDERS} providers")
        for name, provider_spec in self.providers.items():
            _check_provider(name, provider_spec)
        for name, roles in self.presets.items():
            missing = [r for r in ROLES if r not in roles]
```

11. Replace

```python
    provider_spec: ProviderSpec
    spec: RoleSpec

    def with_spec(self, **changes: Any) -> ResolvedRole:
        return ResolvedRole(self.role, self.provider, self.provider_spec, self.spec.model_copy(update=changes))


```

   with

```python
    provider_spec: ProviderSpec
    spec: RoleSpec
    kind: str = ""  # Plan 23e: filled from the provider when left empty

    def __post_init__(self) -> None:
        if not self.kind:
            object.__setattr__(self, "kind", provider_kind(self.provider, self.provider_spec))

    def with_spec(self, **changes: Any) -> ResolvedRole:
        return ResolvedRole(self.role, self.provider, self.provider_spec, self.spec.model_copy(update=changes),
                            self.kind)


```

**Edit** `backend/app/services/llm_validate.py` (6 replacements; each `old` occurs exactly once):

1. Replace

```python
"""Check a draft LLM configuration for the admin console (Plan 23b): schema errors block a save; catalog problems and
missing API key variables are warnings; each preset gets a per-review cost estimate."""
from __future__ import annotations

```

   with

```python
"""Check a draft LLM configuration for the admin console (Plan 23b): schema errors block a save; catalog problems and
missing API key variables are warnings; each preset gets a per-review cost estimate. Plan 23e: a role off OpenRouter
without a price, and a default_provider that is not configured, are errors too (document_errors), at validate and save
but never when a stored version is loaded."""
from __future__ import annotations

```

2. Replace

```python
from app.services.llm_config import (
    CONFIG_ERRORS,
    ResolvedLLMConfig,
    config_error_text,
    ensure_storable,
    parse_llm_config,
    resolve_llm_config,
)
from app.services.llm_cost import estimate_review_cost
from app.services.model_catalog import ModelInfo, validate_role


```

   with

```python
from app.services.llm_config import (
    CONFIG_ERRORS,
    FALLBACK_ROLES,
    LLMConfig,
    ResolvedLLMConfig,
    config_error_text,
    ensure_storable,
    is_local_origin,
    key_env,
    parse_llm_config,
    provider_kind,
    provider_origin,
    resolve_llm_config,
)
from app.services.llm_cost import estimate_review_cost
from app.services.model_catalog import ModelInfo, validate_role

MAX_SAVE_ERRORS = 3


```

3. Replace

```python

def unpriced_roles(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo] | None) -> list[str]:
    """Roles whose calls the review cost cap cannot count (Plan 23c, carried from the 23b review): a direct Anthropic
    model missing from PRICES_PER_MTOK, or an OpenRouter model the catalog does not list (counted only when OpenRouter
    reports the call's cost). Without a catalog the OpenRouter check is skipped (validate already says so), and a
    local server (openai_compatible) is never flagged: it usually costs nothing."""
    return [name for name, role in resolved.roles.items()
            if (role.provider == "anthropic" and role.spec.model not in PRICES_PER_MTOK)
            or (role.provider == "openrouter" and catalog is not None and role.spec.model not in catalog)]


```

   with

```python

def unpriced_roles(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo] | None) -> list[str]:
    """Roles whose calls the review cost cap cannot count (Plan 23c, carried from the 23b review): a role off OpenRouter
    without a price of its own (Plan 23e: an openai_compatible role, or a direct Anthropic model missing from
    PRICES_PER_MTOK), or an OpenRouter model the catalog does not list and no role price covers (counted only when
    OpenRouter reports the call's cost). Without a catalog the OpenRouter check is skipped (validate already says so)."""
    return [name for name, role in resolved.roles.items()
            if role.spec.price_in is None and (
                role.kind == "openai_compatible"
                or (role.kind == "anthropic" and role.spec.model not in PRICES_PER_MTOK)
                or (role.kind == "openrouter" and catalog is not None and role.spec.model not in catalog))]


def price_errors(config: LLMConfig) -> list[str]:
    """Every role of every preset (overrides applied) whose calls the review cost cap could not count: off OpenRouter
    no catalog prices a call, so the role must carry price_in and price_out (an Anthropic model in PRICES_PER_MTOK is
    priced already; 0 is a valid price for a local server). A role that only copies another (FALLBACK_ROLES) is not
    listed again when the role it copies is listed: pricing that one prices both."""
    out: list[str] = []
    for preset in config.presets:
        resolved = resolve_llm_config(config, preset, where="config")
        unpriced = [name for name, role in resolved.roles.items() if role.spec.price_in is None and (
            role.kind == "openai_compatible" or (role.kind == "anthropic" and role.spec.model not in PRICES_PER_MTOK))]
        for name in unpriced:
            copied = name not in config.presets[preset] and name not in config.overrides
            if copied and FALLBACK_ROLES.get(name) in unpriced:
                continue
            role = resolved.roles[name]
            out.append(f"presets.{preset}.{name}: price_in and price_out (USD per 1M tokens) are required for "
                       f"provider '{role.provider}' ({role.kind}); the review cost cap cannot count its calls "
                       "otherwise")
    return out


def document_errors(config: LLMConfig) -> list[str]:
    """What validate and save refuse beyond the schema (Plan 23e). Loading a stored version never checks these, so a
    version saved before them still runs (and an unpriced role still charges 0, as before)."""
    out: list[str] = []
    if config.default_provider not in config.providers:
        out.append(f"default_provider '{config.default_provider}' is not configured in providers")
    return out + price_errors(config)


def save_error_text(errors: list[str]) -> str:
    more = f" (+{len(errors) - MAX_SAVE_ERRORS} more)" if len(errors) > MAX_SAVE_ERRORS else ""
    return "; ".join(errors[:MAX_SAVE_ERRORS]) + more


```

4. Replace

```python
    normalized = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(normalized)  # what save would refuse is not "ok" here either
    warnings: list[str] = []
    cost: dict[str, Any] = {}
```

   with

```python
    normalized = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(normalized)  # what save would refuse is not "ok" here either
    if errors := document_errors(config):
        return {"ok": False, "errors": errors, "warnings": [], "cost": {}, "config": None, "yaml": None}
    warnings: list[str] = []
    cost: dict[str, Any] = {}
```

5. Replace

```python
            if catalog is not None:
                warnings += [f"{preset}: {p}" for p in validate_role(role, catalog)]
        if catalog is not None:
            cost[preset] = estimate_review_cost(resolved, catalog)
```

   with

```python
            if catalog is not None:
                warnings += [f"{preset}: {p}" for p in validate_role(role, catalog)]
            if role.kind != "openrouter" and role.spec.fallback_models:
                warnings.append(f"{preset}: {role.role}: fallback_models apply only to OpenRouter and are not sent "
                                f"to {role.provider}")
        if catalog is not None:
            cost[preset] = estimate_review_cost(resolved, catalog)
```

6. Replace

```python
                            "their calls")
    for name in sorted(used_providers):
        env_name = config.providers[name].api_key_env
        if not _api_key(settings, env_name) and name != "openai_compatible":
            warnings.append(f"{env_name} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
```

   with

```python
                            "their calls")
    for name in sorted(used_providers):
        spec = config.providers[name]
        local = provider_kind(name, spec) == "openai_compatible" and (
            name == "openai_compatible" or is_local_origin(provider_origin(name, spec)))
        env_name = key_env(name)
        if not local and not _api_key(settings, env_name):
            warnings.append(f"{env_name} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
```

**Edit** `backend/app/services/llm_store.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.llm_config import (
    LLMConfig,
    ResolvedLLMConfig,
    ensure_storable,
```

   with

```python
from app.services.llm_config import (
    LLMConfig,
    LLMConfigError,
    ResolvedLLMConfig,
    ensure_storable,
```

2. Replace

```python
    resolve_llm_config,
)
from app.services.review_service import Conflict, NotFound

```

   with

```python
    resolve_llm_config,
)
from app.services.llm_validate import document_errors, save_error_text
from app.services.review_service import Conflict, NotFound

```

3. Replace

```python
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> LlmConfigVersion:
    """Validate (schema and the active preset), refuse a stale base, append the version and its audit row."""
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    stored = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(stored)
```

   with

```python
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> LlmConfigVersion:
    """Validate (schema, the active preset and, Plan 23e, document_errors: prices off OpenRouter and the default
    provider), refuse a stale base, append the version and its audit row. Restore and reset go through here too, so an
    old version or llm.yaml without a now-required price is refused with the same error."""
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    if errors := document_errors(config):
        raise LLMConfigError(f"config: {save_error_text(errors)}")
    stored = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(stored)
```

**Edit** `backend/app/services/llm_cost.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.schemas.review import ReviewOptions
from app.services.llm_config import ResolvedLLMConfig
from app.services.model_catalog import ModelInfo

_PAPERS = ReviewOptions.model_fields["max_papers"].default
```

   with

```python
from app.schemas.review import ReviewOptions
from app.services.llm_config import ResolvedLLMConfig
from app.services.model_catalog import ModelInfo, role_price

_PAPERS = ReviewOptions.model_fields["max_papers"].default
```

2. Replace

```python

def estimate_review_cost(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo]) -> dict[str, Any]:
    """Rough USD cost of one default review with this preset (OpenRouter prices); models the catalog does not know
    (other providers, typos) are listed instead of priced."""
    per_role: dict[str, float] = {}
    unknown: list[str] = []
```

   with

```python

def estimate_review_cost(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo]) -> dict[str, Any]:
    """Rough USD cost of one default review with this preset (a role's own price, Plan 23e, else OpenRouter's);
    models neither prices (other providers without a price, typos) are listed instead of priced."""
    per_role: dict[str, float] = {}
    unknown: list[str] = []
```

3. Replace

```python
    for name, role in resolved.roles.items():
        calls, tokens_in, tokens_out = TYPICAL_CALLS.get(name, (0, 0, 0))
        info = catalog.get(role.spec.model) if role.provider == "openrouter" else None
        if info is None:
            unknown.append(f"{name}: {role.provider}:{role.spec.model}")
```

   with

```python
    for name, role in resolved.roles.items():
        calls, tokens_in, tokens_out = TYPICAL_CALLS.get(name, (0, 0, 0))
        info = role_price(role) or (catalog.get(role.spec.model) if role.kind == "openrouter" else None)
        if info is None:
            unknown.append(f"{name}: {role.provider}:{role.spec.model}")
```

**Edit** `backend/app/services/model_catalog.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return input_tokens * self.price_in + output_tokens * self.price_out


```

   with

```python
    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return input_tokens * self.price_in + output_tokens * self.price_out


@dataclass(frozen=True)
class FixedPrice:
    """A price typed into the configuration (Plan 23e), in USD per 1M tokens: off OpenRouter there is no catalog."""

    price_in: float
    price_out: float

    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return (input_tokens * self.price_in + output_tokens * self.price_out) / 1_000_000


def role_price(role: ResolvedRole) -> FixedPrice | None:
    """The role's own price, when the configuration gives one."""
    spec = role.spec
    if spec.price_in is None or spec.price_out is None:
        return None
    return FixedPrice(spec.price_in, spec.price_out)


```

2. Replace

```python
def validate_role(role: ResolvedRole, catalog: dict[str, ModelInfo]) -> list[str]:
    """Problems with one role's settings against the OpenRouter catalog (OpenRouter roles only)."""
    if role.provider != "openrouter":
        return []
    spec = role.spec
```

   with

```python
def validate_role(role: ResolvedRole, catalog: dict[str, ModelInfo]) -> list[str]:
    """Problems with one role's settings against the OpenRouter catalog (OpenRouter roles only)."""
    if role.kind != "openrouter":
        return []
    spec = role.spec
```

**Edit** `backend/app/services/llm.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
)
from app.services.budget import current_budget
from app.services.llm_config import HarnessSpec, ResolvedLLMConfig, ResolvedRole, load_llm_config
from app.services.model_catalog import ModelInfo, choose_structured_method

```

   with

```python
)
from app.services.budget import current_budget
from app.services.llm_config import (
    PROVIDER_KEYS,
    HarnessSpec,
    ResolvedLLMConfig,
    ResolvedRole,
    load_llm_config,
)
from app.services.model_catalog import ModelInfo, choose_structured_method

```

2. Replace

```python
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    key = _api_key(settings, ps.api_key_env)
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.provider == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, ps.api_key_env)
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds)
    if not key and role.provider == "openrouter":
        return MissingKeyLLM(spec.model, ps.api_key_env)
    info = (catalog or {}).get(spec.model) if role.provider == "openrouter" else None
    if spec.reasoning_effort == "none" and role.provider == "openrouter" and (info is None or info.supports("reasoning")):
        # Some models reason by default (Qwen3.5 Flash on Alibaba) and then break structured output; an explicit
        # "none" turns that off. Never sent to models without reasoning support (require_parameters would 404).
        effort = "none"
    base_url = ps.base_url or (OPENROUTER_BASE_URL if role.provider == "openrouter" else "")
    headers = {}
    if role.provider == "openrouter":
        headers = {k: v for k, v in (("HTTP-Referer", ps.app_url), ("X-Title", ps.app_name)) if v}
    return OpenAICompatibleStructuredLLM(
```

   with

```python
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    env_name = PROVIDER_KEYS.get(role.provider, "")  # a provider with a free name has no env key before Plan 23e Task 3
    key = _api_key(settings, env_name) if env_name else ""
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.kind == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, env_name)
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds)
    if not key and role.kind == "openrouter":
        return MissingKeyLLM(spec.model, env_name)
    info = (catalog or {}).get(spec.model) if role.kind == "openrouter" else None
    if spec.reasoning_effort == "none" and role.kind == "openrouter" and (info is None or info.supports("reasoning")):
        # Some models reason by default (Qwen3.5 Flash on Alibaba) and then break structured output; an explicit
        # "none" turns that off. Never sent to models without reasoning support (require_parameters would 404).
        effort = "none"
    base_url = ps.base_url or (OPENROUTER_BASE_URL if role.kind == "openrouter" else "")
    headers = {}
    if role.kind == "openrouter":
        headers = {k: v for k, v in (("HTTP-Referer", ps.app_url), ("X-Title", ps.app_name)) if v}
    return OpenAICompatibleStructuredLLM(
```

3. Replace

```python
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and role.provider == "openrouter",
        fallback_models=spec.fallback_models, extra_body=spec.extra_body, price=info,
    )
```

   with

```python
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and role.kind == "openrouter",
        fallback_models=spec.fallback_models, extra_body=spec.extra_body, price=info,
    )
```

**Edit** `backend/app/cli/models.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    total = 0.0
    for name, role in config.roles.items():
        info = catalog.get(role.spec.model) if role.provider == "openrouter" else None
        method = choose_structured_method(role.spec.structured_output, info)
        calls, tin, tout = TYPICAL_CALLS[name]
```

   with

```python
    total = 0.0
    for name, role in config.roles.items():
        info = catalog.get(role.spec.model) if role.kind == "openrouter" else None
        method = choose_structured_method(role.spec.structured_output, info)
        calls, tin, tout = TYPICAL_CALLS[name]
```

**Edit** `backend/config/llm.yaml` (3 replacements; each `old` occurs exactly once):

1. Replace

```
# Per-role fields (all optional except model):
#   model              provider model id (OpenRouter ids look like "vendor/model")
#   provider           openrouter | anthropic | openai_compatible   (default: default_provider)
#   max_tokens         output token cap
#   temperature, top_p sampling (ignored for Anthropic models that do not accept them)
```

   with

```
# Per-role fields (all optional except model):
#   model              provider model id (OpenRouter ids look like "vendor/model")
#   provider           a name under providers: below                 (default: default_provider)
#   max_tokens         output token cap
#   temperature, top_p sampling (ignored for Anthropic models that do not accept them)
```

2. Replace

```
#   structured_output  auto | json_schema | tool_calling | json_mode       (auto = from OpenRouter catalog)
#   timeout_seconds    per request
#   fallback_models    OpenRouter fallback chain if the primary model is unavailable
#   extra_body         raw fields merged into the provider request
#
# Browse models with prices:   uv run python -m app.cli.models list --search gemini --structured
```

   with

```
#   structured_output  auto | json_schema | tool_calling | json_mode       (auto = from OpenRouter catalog)
#   timeout_seconds    per request
#   fallback_models    OpenRouter fallback chain if the primary model is unavailable (OpenRouter only)
#   extra_body         raw fields merged into the provider request
#   price_in, price_out  USD per 1M tokens, both or neither. Required (the console refuses to save without them) for
#                      every role off OpenRouter, so the per-review cost cap counts its calls: an openai_compatible
#                      provider (0 for a local server), or an Anthropic model the code has no price for.
#
# Browse models with prices:   uv run python -m app.cli.models list --search gemini --structured
```

3. Replace

```
default_provider: openrouter

# api_key_env must keep its name: OPENROUTER_API_KEY, ANTHROPIC_API_KEY and OPENAI_COMPATIBLE_API_KEY, each only for its
# own provider. The openrouter and anthropic keys are only ever sent to https://openrouter.ai and https://api.anthropic.com,
# so their base_url must stay there; openai_compatible (a local server) may use any http(s) URL.
providers:
  openrouter:
```

   with

```
default_provider: openrouter

# Providers (Plan 23e): each has a kind, openrouter | anthropic | openai_compatible. The three names below have the kind
# of their name and may leave it out; openrouter and anthropic exist only under their own names. Any other name
# (a-z, 0-9, _; at most 12 providers) is an openai_compatible provider with its own base_url, e.g.
#   deepseek: {kind: openai_compatible, base_url: https://api.deepseek.com/v1, require_parameters: false}
# api_key_env may be left out; when given it must be the provider's own variable: OPENROUTER_API_KEY, ANTHROPIC_API_KEY,
# OPENAI_COMPATIBLE_API_KEY, or LLM_KEY_<NAME> for another name (used only with LLM_KEY_<NAME>_ORIGIN set to the
# provider's origin). Keys may also be entered in the admin console (/admin/models, "ผู้ให้บริการและคีย์"), stored
# encrypted, which beats the env key. The openrouter and anthropic keys are only ever sent to https://openrouter.ai and
# https://api.anthropic.com, so their base_url must stay there; openai_compatible (a local server) may use any http(s)
# URL; another name needs https to a public host, or http to localhost, 127.0.0.1, ::1 or host.docker.internal.
providers:
  openrouter:
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_provider_document.py tests/unit/test_admin_models_api.py tests/unit/test_llm_config.py -q`

Expected: 165 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23e/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; pre-flight: backend 2734 passed, 17 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(llm): provider kinds, free provider names, URL rules and required prices off OpenRouter (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add backend/tests/unit/test_provider_document.py backend/tests/unit/test_admin_models_api.py backend/tests/unit/test_llm_config.py backend/app/services/llm_config.py backend/app/services/llm_validate.py backend/app/services/llm_store.py backend/app/services/llm_cost.py backend/app/services/model_catalog.py backend/app/services/llm.py backend/app/cli/models.py backend/config/llm.yaml
git commit -F .superpowers/commit-msg.txt
```

---

### Task 2: The key store — Fernet, table, resolution, CLI, audit scrub

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Modify: `backend/app/config.py`
- Modify: `backend/app/db/models.py`
- Create: `backend/migrations/versions/c6e8a0b2d4f6_llm_provider_keys.py`
- Create: `backend/app/services/llm_keys.py`
- Modify: `backend/app/cli/admin.py`
- Modify: `backend/app/services/audit.py`
- Test (create): `backend/tests/unit/test_llm_keys.py`
- Test (create): `backend/tests/integration/test_llm_keys_migration.py`

**Interfaces:**
- Consumes: `Settings`, `Base`, `key_env`, `provider_origin`, `url_origin`, `VISIBLE_ASCII`, `PROVIDER_KEYS` (Task 1), `record`, `CLI_ACTOR`.
- Produces:
  - `Settings.llm_keys_secret: SecretStr` (env `LLM_KEYS_SECRET`); ORM `LlmProviderKey`; migration `c6e8a0b2d4f6` (create table / drop table).
  - `app/services/llm_keys.py`: `secret_state(settings) -> "ok" | "no_secret" | "bad_secret"`, `cipher(settings) -> MultiFernet | None`, `generate_secret()`, `clean_key(raw) -> str` (raises `KeyTextError`, message `KEY_TEXT_ERROR`), `last4_of(key)`, `seal(fernet, provider, origin, key)`, `open_row(fernet, row) -> str | None`, `StoredKey`, `KeyRing(entries, unreadable, revision, state)`, `live_rows`, `load_keyring(session, settings)`, `KeyChoice(value, source, problem, bound_origin)`, `env_key(name, origin, settings, environ=None)`, `resolve_key(name, spec, ring, settings, environ=None)`, `keys_revision(session)`, `store_key(session, fernet, provider, origin, key, *, by) -> (row, replaced)`, `clear_key(session, provider, *, by) -> row | None`, `rotate_keys(session, fernet) -> (rotated, unreadable)`, `LLM_KEYS_LOCK`.
  - CLI `python -m app.cli.admin llm-keys-secret` and `rotate-llm-keys` (`run(..., settings=None)`); `SECRET_FIELDS` gains `api_key`, `ciphertext`, `llm_keys_secret`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_llm_keys.py` (complete):

```python
"""Plan 23e Task 2: the key store. Keys are sealed with LLM_KEYS_SECRET and bound to their provider and origin; a key
resolves console first, then env, never across origins; nothing prints a key."""
import json

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from cryptography.fernet import Fernet, MultiFernet
from pydantic import SecretStr
from sqlalchemy import select

from app.cli.admin import run as admin_cli
from app.config import Settings
from app.db.models import AdminAudit, LlmProviderKey
from app.services.audit import SECRET_FIELDS, _scrub
from app.services.llm_config import ProviderSpec
from app.services.llm_keys import (
    KEY_TEXT_ERROR,
    KeyRing,
    KeyTextError,
    StoredKey,
    cipher,
    clean_key,
    clear_key,
    keys_revision,
    last4_of,
    load_keyring,
    open_row,
    resolve_key,
    seal,
    secret_state,
    store_key,
)

SECRET_A = Fernet.generate_key().decode()
SECRET_B = Fernet.generate_key().decode()
KEY = "sk-test-0000000000000000abcd"
ENV_KEY = "sk-env-1111111111111111wxyz"
DEEPSEEK = ProviderSpec(kind="openai_compatible", base_url="https://api.deepseek.com/v1")
DEEPSEEK_ORIGIN = "https://api.deepseek.com"
OPENROUTER = ProviderSpec(base_url="https://openrouter.ai/api/v1")


def settings(secret: str = SECRET_A, **over) -> Settings:
    return Settings(_env_file=None, llm_keys_secret=secret, **over)


async def put(session_factory, provider="deepseek", origin=DEEPSEEK_ORIGIN, key=KEY, secret=SECRET_A):
    async with session_factory() as s, s.begin():
        row, replaced = await store_key(s, cipher(settings(secret)), provider, origin, key, by="owner")
    return row.revision, replaced


async def ring(session_factory, secret=SECRET_A) -> KeyRing:
    async with session_factory() as s:
        return await load_keyring(s, settings(secret))


def test_the_secret_state():
    assert secret_state(settings("")) == "no_secret" and cipher(settings("")) is None
    assert secret_state(settings("not-a-fernet-key")) == "bad_secret" and cipher(settings("x")) is None
    assert secret_state(settings(f"{SECRET_A},nope")) == "bad_secret"  # one bad part spoils the whole secret
    assert secret_state(settings(f" {SECRET_A} , {SECRET_B} ")) == "ok"
    assert isinstance(cipher(settings(f"{SECRET_A},{SECRET_B}")), MultiFernet)
    assert SECRET_A not in repr(settings()) and SECRET_A not in str(settings().model_dump())


def test_seal_and_open_round_trip_and_bind_provider_and_origin():
    fernet = cipher(settings())
    token = seal(fernet, "deepseek", DEEPSEEK_ORIGIN, KEY)
    assert KEY not in token and "deepseek" not in token
    row = LlmProviderKey(provider="deepseek", ciphertext=token, bound_origin=DEEPSEEK_ORIGIN)
    assert open_row(fernet, row) == KEY
    assert open_row(fernet, LlmProviderKey(provider="groq", ciphertext=token, bound_origin=DEEPSEEK_ORIGIN)) is None
    assert open_row(fernet, LlmProviderKey(provider="deepseek", ciphertext=token,
                                           bound_origin="https://evil.example")) is None
    assert open_row(cipher(settings(SECRET_B)), row) is None  # another secret
    assert open_row(None, row) is None
    assert open_row(fernet, LlmProviderKey(provider="deepseek", ciphertext="garbage", bound_origin=DEEPSEEK_ORIGIN)) is None
    not_ours = fernet.encrypt(json.dumps({"v": 2, "provider": "deepseek", "origin": DEEPSEEK_ORIGIN,
                                          "key": KEY}).encode()).decode()
    assert open_row(fernet, LlmProviderKey(provider="deepseek", ciphertext=not_ours, bound_origin=DEEPSEEK_ORIGIN)) is None


def test_a_second_secret_still_reads_keys_sealed_with_the_first():
    old = seal(cipher(settings(SECRET_A)), "deepseek", DEEPSEEK_ORIGIN, KEY)
    row = LlmProviderKey(provider="deepseek", ciphertext=old, bound_origin=DEEPSEEK_ORIGIN)
    assert open_row(cipher(settings(f"{SECRET_B},{SECRET_A}")), row) == KEY


@pytest.mark.parametrize("raw", ["short", "x" * 513, "sk with space", "sk-été-0000000", "sk-tab\t0000000",
                                 None, 12345, ["sk-0000000000"], ""])
def test_a_key_that_cannot_be_a_header_is_refused_without_quoting_it(raw):
    with pytest.raises(KeyTextError) as caught:
        clean_key(raw)
    assert str(caught.value) == KEY_TEXT_ERROR
    if isinstance(raw, str) and raw:
        assert raw not in str(caught.value)


def test_a_pasted_key_loses_its_newline_and_shows_at_most_its_last_four():
    assert clean_key(f"  {KEY}\r\n") == KEY
    assert last4_of(KEY) == "abcd" and last4_of("sk-12345678") is None  # under 12 characters: nothing shown


async def test_store_replace_and_delete_move_the_revision_up_and_keep_a_tombstone(session_factory):
    assert (await put(session_factory)) == (1, False)
    assert (await put(session_factory, key="sk-test-replaced-000000009999")) == (2, True)
    assert (await put(session_factory, provider="openrouter", origin="https://openrouter.ai")) == (3, False)
    async with session_factory() as s, s.begin():
        gone = await clear_key(s, "deepseek", by="owner")
    assert gone.revision == 4 and (gone.ciphertext, gone.last4, gone.bound_origin) == (None, None, None)
    async with session_factory() as s, s.begin():
        assert await clear_key(s, "deepseek", by="owner") is None  # nothing live to delete
        assert await clear_key(s, "groq", by="owner") is None
        assert await keys_revision(s) == 4
    async with session_factory() as s:
        rows = {r.provider: r for r in (await s.execute(select(LlmProviderKey))).scalars()}
    assert set(rows) == {"deepseek", "openrouter"} and rows["openrouter"].last4 == "abcd"
    assert KEY not in rows["openrouter"].ciphertext


async def test_the_ring_reads_every_live_row_once_and_names_providers_only(session_factory):
    await put(session_factory)
    await put(session_factory, provider="openrouter", origin="https://openrouter.ai", secret=SECRET_B)
    loaded = await ring(session_factory)
    assert set(loaded.entries) == {"deepseek"} and loaded.unreadable == frozenset({"openrouter"})
    assert loaded.revision == 2 and loaded.state == "ok"
    assert KEY not in repr(loaded) and KEY not in str(loaded) and KEY not in repr(loaded.entries["deepseek"])
    assert (await ring(session_factory, "")).state == "no_secret"
    assert (await ring(session_factory, "")).unreadable == frozenset({"deepseek", "openrouter"})


def test_resolution_console_beats_env_and_never_crosses_origins():
    console = KeyRing({"deepseek": StoredKey(KEY, DEEPSEEK_ORIGIN, "abcd")}, revision=1)
    env = {"LLM_KEY_DEEPSEEK": ENV_KEY, "LLM_KEY_DEEPSEEK_ORIGIN": "https://api.deepseek.com/"}
    chosen = resolve_key("deepseek", DEEPSEEK, console, None, env)
    assert (chosen.value, chosen.source, chosen.problem) == (KEY, "console", None)
    assert KEY not in repr(chosen)
    assert resolve_key("deepseek", DEEPSEEK, None, None, env).source == "env"  # deleted: back to env
    moved = ProviderSpec(kind="openai_compatible", base_url="https://api.other.example/v1")
    elsewhere = resolve_key("deepseek", moved, console, None,
                            {**env, "LLM_KEY_DEEPSEEK_ORIGIN": "https://api.other.example"})
    assert (elsewhere.value, elsewhere.source, elsewhere.problem) == (None, "none", "origin_mismatch")
    assert elsewhere.bound_origin == DEEPSEEK_ORIGIN  # no env fallback while a key is bound to another origin
    path_only = ProviderSpec(kind="openai_compatible", base_url="https://api.deepseek.com/beta")
    assert resolve_key("deepseek", path_only, console, None, {}).source == "console"


def test_an_unreadable_row_falls_back_to_env_and_keeps_its_problem():
    broken = KeyRing(unreadable=frozenset({"openrouter"}), state="bad_secret")
    s = Settings(_env_file=None, openrouter_api_key=ENV_KEY)
    chosen = resolve_key("openrouter", OPENROUTER, broken, s, {})
    assert (chosen.value, chosen.source, chosen.problem) == (ENV_KEY, "env", "unreadable")
    none = resolve_key("openrouter", OPENROUTER, broken, Settings(_env_file=None), {})
    assert (none.source, none.problem) == ("none", "unreadable")


def test_a_free_names_env_key_needs_a_matching_origin_and_never_reads_settings():
    s = Settings(_env_file=None, openalex_api_key="openalex-secret-000", openrouter_api_key=ENV_KEY)
    assert resolve_key("deepseek", DEEPSEEK, None, s, {"LLM_KEY_DEEPSEEK": ENV_KEY}).problem == "env_origin_missing"
    wrong = {"LLM_KEY_DEEPSEEK": ENV_KEY, "LLM_KEY_DEEPSEEK_ORIGIN": "https://evil.example"}
    assert resolve_key("deepseek", DEEPSEEK, None, s, wrong).value is None
    junk = {"LLM_KEY_DEEPSEEK": ENV_KEY, "LLM_KEY_DEEPSEEK_ORIGIN": "https://x:99999"}
    assert resolve_key("deepseek", DEEPSEEK, None, s, junk).problem == "env_origin_missing"
    ok = {"LLM_KEY_DEEPSEEK": ENV_KEY, "LLM_KEY_DEEPSEEK_ORIGIN": "HTTPS://api.deepseek.com:443"}
    assert resolve_key("deepseek", DEEPSEEK, None, s, ok).value == ENV_KEY
    nothing = resolve_key("deepseek", DEEPSEEK, None, s, {})
    assert (nothing.value, nothing.source, nothing.problem) == (None, "none", None)
    for name in ("openalex", "openalex_api", "database"):  # a free name never reaches a Settings field
        spec = ProviderSpec(kind="openai_compatible", base_url="https://api.example.org/v1")
        assert resolve_key(name, spec, None, s, {}).value is None


def test_a_legacy_name_reads_its_setting_then_the_environment_as_before():
    s = Settings(_env_file=None, openrouter_api_key=ENV_KEY)
    assert resolve_key("openrouter", OPENROUTER, None, s, {}).value == ENV_KEY
    empty = Settings(_env_file=None)
    assert resolve_key("openrouter", OPENROUTER, None, empty, {"OPENROUTER_API_KEY": "sk-from-env-0000"}).value == (
        "sk-from-env-0000")
    local = ProviderSpec(base_url="http://localhost:11434/v1", api_key_env="OPENAI_COMPATIBLE_API_KEY")
    assert resolve_key("openai_compatible", local, None, empty, {"OPENAI_COMPATIBLE_API_KEY": "k-local-00"}).source == (
        "env")


def test_the_audit_log_drops_key_fields_at_every_depth():
    assert {"api_key", "ciphertext", "llm_keys_secret"} <= SECRET_FIELDS
    scrubbed = _scrub({"provider": "deepseek", "api_key": KEY, "nested": [{"ciphertext": "gAAA", "origin": "x"}],
                       "LLM_KEYS_SECRET": SECRET_A})
    assert scrubbed == {"provider": "deepseek", "nested": [{"origin": "x"}]}


async def test_the_cli_prints_a_fresh_secret_and_rotates_without_printing_keys(session_factory, redis, capsys):
    assert await admin_cli(["llm-keys-secret"], session_factory, redis) == 0
    printed = capsys.readouterr().out.strip()
    assert secret_state(settings(printed)) == "ok"
    await put(session_factory, secret=SECRET_A)
    await put(session_factory, provider="openrouter", origin="https://openrouter.ai", secret=SECRET_B)  # unreadable
    async with session_factory() as s:
        before = {r.provider: (r.ciphertext, r.revision) for r in (await s.execute(select(LlmProviderKey))).scalars()}
    assert await admin_cli(["rotate-llm-keys"], session_factory, redis,
                           settings=settings(f"{printed},{SECRET_A}")) == 0
    out = capsys.readouterr().out
    assert "1 key(s) re-encrypted" in out and "1 could not be read" in out and KEY not in out
    loaded = await ring(session_factory, printed)  # the old secret can now be removed
    assert set(loaded.entries) == {"deepseek"} and loaded.entries["deepseek"].value == KEY
    async with session_factory() as s:
        after = {r.provider: (r.ciphertext, r.revision) for r in (await s.execute(select(LlmProviderKey))).scalars()}
        audit = (await s.execute(select(AdminAudit).where(AdminAudit.action == "llm_key.rotate"))).scalar_one()
    assert after["deepseek"][0] != before["deepseek"][0] and after["deepseek"][1] == before["deepseek"][1]
    assert after["openrouter"] == before["openrouter"]
    assert (audit.actor_kind, audit.after) == ("cli", {"rotated": 1, "unreadable": 1})
    assert await admin_cli(["rotate-llm-keys"], session_factory, redis, settings=settings("")) == 1


def test_the_migration_is_the_new_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == ["c6e8a0b2d4f6"]
    assert script.get_revision("c6e8a0b2d4f6").down_revision == "b3d5f7a9c1e2"


def test_secret_str_keeps_the_master_key_out_of_reprs():
    s = Settings(_env_file=None, llm_keys_secret=SecretStr(SECRET_A))
    assert s.llm_keys_secret.get_secret_value() == SECRET_A and SECRET_A not in repr(s)
```

**New file** `backend/tests/integration/test_llm_keys_migration.py` (complete):

```python
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

pytestmark = pytest.mark.integration

BEFORE_KEYS = "b3d5f7a9c1e2"  # the revision the provider-keys migration (c6e8a0b2d4f6) builds on
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
INSERT = ("INSERT INTO llm_provider_keys (provider, ciphertext, last4, bound_origin, revision, updated_by) "
          "VALUES (:p, 'gAAAA', 'abcd', 'https://api.deepseek.com', :r, 'owner')")


def test_provider_keys_migration_and_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert "llm_provider_keys" in set(inspect(engine).get_table_names())
        with engine.begin() as conn:
            conn.execute(text(INSERT), {"p": "deepseek", "r": 1})
            conn.execute(text("UPDATE llm_provider_keys SET ciphertext = NULL, last4 = NULL, bound_origin = NULL, "
                              "revision = 2 WHERE provider = 'deepseek'"))  # a tombstone
            assert conn.execute(text("SELECT max(revision) FROM llm_provider_keys")).scalar_one() == 2
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text(INSERT), {"p": "deepseek", "r": 3})  # one row per provider
        command.downgrade(cfg, BEFORE_KEYS)  # pinned, so a later migration cannot change what this undoes
        tables = set(inspect(engine).get_table_names())
        assert "llm_provider_keys" not in tables and "config_versions" in tables
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == BEFORE_KEYS
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_llm_keys.py -q`

Expected: collection error (`ModuleNotFoundError: No module named 'app.services.llm_keys'`)

- [ ] **Step 3: Implement**

**Edit** `backend/pyproject.toml` (1 replacement; each `old` occurs exactly once):

1. Replace

```
  "langchain[mcp]>=1.4",
  "argon2-cffi>=23.1",
]

```

   with

```
  "langchain[mcp]>=1.4",
  "argon2-cffi>=23.1",
  "cryptography>=50.0",
]

```

**Edit** `backend/uv.lock` (2 replacements; each `old` occurs exactly once):

1. Replace

```
    { name = "argon2-cffi" },
    { name = "arq" },
    { name = "fastapi" },
    { name = "httpx" },
```

   with

```
    { name = "argon2-cffi" },
    { name = "arq" },
    { name = "cryptography" },
    { name = "fastapi" },
    { name = "httpx" },
```

2. Replace

```
    { name = "argon2-cffi", specifier = ">=23.1" },
    { name = "arq", specifier = ">=0.26" },
    { name = "fastapi", specifier = ">=0.115" },
    { name = "httpx", specifier = ">=0.27" },
```

   with

```
    { name = "argon2-cffi", specifier = ">=23.1" },
    { name = "arq", specifier = ">=0.26" },
    { name = "cryptography", specifier = ">=50.0" },
    { name = "fastapi", specifier = ">=0.115" },
    { name = "httpx", specifier = ">=0.27" },
```

**Edit** `backend/app/config.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

```

   with

```python
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

```

2. Replace

```python
    screen_batch_size: int = 10

    # LLM models, presets and tuning live in config/llm.yaml; these hold only the path and keys.
    llm_config_path: str = "config/llm.yaml"
    llm_preset: str | None = None  # overrides active_preset in llm.yaml
```

   with

```python
    screen_batch_size: int = 10

    # LLM models, presets and tuning live in config/llm.yaml; these hold only the path and keys. Plan 23e: provider keys
    # may also be entered in the admin console, stored encrypted with LLM_KEYS_SECRET (one or more comma-separated
    # Fernet keys, newest first; env only, read once per process). Without it the console cannot store keys.
    llm_keys_secret: SecretStr = SecretStr("")
    llm_config_path: str = "config/llm.yaml"
    llm_preset: str | None = None  # overrides active_preset in llm.yaml
```

**Edit** `backend/app/db/models.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


class ConfigVersion(Base):
    """One saved runtime document (Plan 23c): kind "settings" (the admin's overrides of env settings) or "glossary"
```

   with

```python


class LlmProviderKey(Base):
    """An LLM provider's API key entered in the admin console (Plan 23e), one row per provider name. Never part of a
    config version: a restore must not bring an old key back. `ciphertext` is a Fernet token of
    {"v": 1, "provider", "origin", "key"} under LLM_KEYS_SECRET; a delete keeps the row with `ciphertext`, `last4` and
    `bound_origin` null (a tombstone), so `revision` (the newest of which is the keys version workers follow) never
    goes backwards."""

    __tablename__ = "llm_provider_keys"

    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    bound_origin: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revision: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[str] = mapped_column(String(64))


class ConfigVersion(Base):
    """One saved runtime document (Plan 23c): kind "settings" (the admin's overrides of env settings) or "glossary"
```

**New file** `backend/migrations/versions/c6e8a0b2d4f6_llm_provider_keys.py` (complete):

```python
"""llm provider keys (Plan 23e)

Revision ID: c6e8a0b2d4f6
Revises: b3d5f7a9c1e2
Create Date: 2026-10-14 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c6e8a0b2d4f6"
down_revision: Union[str, None] = "b3d5f7a9c1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_provider_keys",
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=True),
        sa.Column("last4", sa.String(length=4), nullable=True),
        sa.Column("bound_origin", sa.String(length=255), nullable=True),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("provider"),
    )


def downgrade() -> None:
    op.drop_table("llm_provider_keys")
```

**New file** `backend/app/services/llm_keys.py` (complete):

```python
"""LLM provider keys entered in the admin console (Plan 23e). A key is stored encrypted in llm_provider_keys, never in
a config version, and is write-only: nothing here returns it except to build a client. The master secret is
LLM_KEYS_SECRET (env only): one or more comma-separated Fernet keys, newest first; the first encrypts, all decrypt.

What is encrypted is {"v": 1, "provider", "origin", "key"}: on decrypt the provider and origin must equal the row's, so
a row copied to another provider, or an edited bound_origin, reads as unreadable (Fernet has no associated data).

A key is bound to the origin (scheme://host[:port]) it was saved for. resolve_key gives, per provider: a readable
console key whose origin matches → console; one bound to another origin → none (and no env fallback, or a base_url
change would redirect the env key instead); otherwise the env key (a free name only with LLM_KEY_<NAME>_ORIGIN equal
to the provider's origin). Nothing here logs a key, a payload or the secret."""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import LlmProviderKey
from app.logging import get_logger
from app.services.llm_config import (
    PROVIDER_KEYS,
    VISIBLE_ASCII,
    ProviderSpec,
    key_env,
    provider_origin,
    url_origin,
)

log = get_logger(__name__)

KEY_MIN, KEY_MAX = 8, 512
KEY_TEXT_ERROR = "the key must be 8 to 512 visible characters without spaces"
LAST4_MIN = 12  # a shorter key shows no last 4 characters: they would be a third of it
PAYLOAD_VERSION = 1
# Postgres advisory-lock key that serialises key writes ("MRALLMKY"), like LLM_SAVE_LOCK for config saves
LLM_KEYS_LOCK = 0x4D52_414C_4C4D_4B59
SecretState = Literal["ok", "no_secret", "bad_secret"]
_reported_bad_secret = False


class KeyTextError(ValueError):
    """A key that cannot be stored. The message is fixed and never quotes the input."""

    def __init__(self) -> None:
        super().__init__(KEY_TEXT_ERROR)


def _secret_parts(settings: Settings) -> list[str]:
    return [p.strip() for p in settings.llm_keys_secret.get_secret_value().split(",") if p.strip()]


def secret_state(settings: Settings) -> SecretState:
    """ok, no_secret (unset) or bad_secret (a part that is not a Fernet key: 32 bytes in URL-safe base64)."""
    global _reported_bad_secret
    parts = _secret_parts(settings)
    if not parts:
        return "no_secret"
    try:
        for part in parts:
            Fernet(part)
    except (ValueError, TypeError):
        if not _reported_bad_secret:
            _reported_bad_secret = True
            log.error("llm_keys_secret_invalid", parts=len(parts))
        return "bad_secret"
    return "ok"


def cipher(settings: Settings) -> MultiFernet | None:
    """The MultiFernet of LLM_KEYS_SECRET, or None when it is missing or bad (stored keys are then unreadable)."""
    if secret_state(settings) != "ok":
        return None
    return MultiFernet([Fernet(part) for part in _secret_parts(settings)])


def generate_secret() -> str:
    return Fernet.generate_key().decode("ascii")


def clean_key(raw: object) -> str:
    """The key as stored: surrounding whitespace dropped (a pasted key often ends in a newline), then 8 to 512 visible
    ASCII characters, so it is always a valid Authorization or x-api-key header value."""
    if not isinstance(raw, str):
        raise KeyTextError
    key = raw.strip()
    if not KEY_MIN <= len(key) <= KEY_MAX or not VISIBLE_ASCII.fullmatch(key):
        raise KeyTextError
    return key


def last4_of(key: str) -> str | None:
    return key[-4:] if len(key) >= LAST4_MIN else None


def seal(fernet: MultiFernet, provider: str, origin: str, key: str) -> str:
    payload = {"v": PAYLOAD_VERSION, "provider": provider, "origin": origin, "key": key}
    return fernet.encrypt(json.dumps(payload).encode("utf-8")).decode("ascii")


def open_row(fernet: MultiFernet | None, row: LlmProviderKey) -> str | None:
    """The stored key, or None when the row is a tombstone or unreadable: no secret, another secret, a token that is not
    Fernet's, or a payload that does not name this row's provider and origin."""
    if fernet is None or row.ciphertext is None:
        return None
    try:
        payload = json.loads(fernet.decrypt(row.ciphertext.encode("ascii")))
    except (InvalidToken, ValueError, UnicodeError):
        log.warning("llm_key_unreadable", provider=row.provider)
        return None
    if (not isinstance(payload, dict) or payload.get("v") != PAYLOAD_VERSION
            or payload.get("provider") != row.provider or payload.get("origin") != row.bound_origin
            or not isinstance(payload.get("key"), str)):
        log.warning("llm_key_unreadable", provider=row.provider)
        return None
    return payload["key"]


@dataclass(frozen=True)
class StoredKey:
    value: str = field(repr=False)
    origin: str
    last4: str | None


@dataclass(frozen=True)
class KeyRing:
    """Every readable console key of one moment, decrypted once. Its repr names providers only."""

    entries: dict[str, StoredKey] = field(default_factory=dict)
    unreadable: frozenset[str] = frozenset()
    revision: int | None = None
    state: SecretState = "ok"

    def __repr__(self) -> str:
        return (f"KeyRing(providers={sorted(self.entries)}, unreadable={sorted(self.unreadable)}, "
                f"revision={self.revision}, state={self.state})")

    __str__ = __repr__


async def live_rows(session: AsyncSession) -> list[LlmProviderKey]:
    stmt = select(LlmProviderKey).order_by(LlmProviderKey.provider)
    return list((await session.execute(stmt)).scalars())


async def load_keyring(session: AsyncSession, settings: Settings) -> KeyRing:
    fernet, state = cipher(settings), secret_state(settings)
    entries: dict[str, StoredKey] = {}
    unreadable: set[str] = set()
    revision: int | None = None
    for row in await live_rows(session):
        revision = max(revision or 0, row.revision)
        if row.ciphertext is None:
            continue
        value = open_row(fernet, row)
        if value is None:
            unreadable.add(row.provider)
        else:
            entries[row.provider] = StoredKey(value, row.bound_origin or "", row.last4)
    return KeyRing(entries, frozenset(unreadable), revision, state)


@dataclass(frozen=True)
class KeyChoice:
    """The key a provider's calls use: `source` console, env or none; `problem` origin_mismatch, unreadable or
    env_origin_missing (null when there is none); `bound_origin` the origin a mismatched stored key belongs to."""

    value: str | None = field(repr=False)
    source: Literal["console", "env", "none"]
    problem: str | None = None
    bound_origin: str | None = None


def env_key(name: str, origin: str, settings: Settings | None,
            environ: Mapping[str, str] | None = None) -> tuple[str, str | None]:
    """(env key, problem). A legacy name reads its Settings field, then the environment (unbound, as before Plan 23e).
    A free name reads only os.environ's LLM_KEY_<NAME> (never Settings, so no other field is reachable), and only when
    LLM_KEY_<NAME>_ORIGIN is the provider's origin."""
    environ = os.environ if environ is None else environ
    if name in PROVIDER_KEYS:
        variable = PROVIDER_KEYS[name]
        return str(getattr(settings, variable.lower(), "") or environ.get(variable, "")), None
    variable = key_env(name)
    value = environ.get(variable, "")
    if not value:
        return "", None
    bound = environ.get(f"{variable}_ORIGIN", "")
    try:
        same = bool(bound) and url_origin(bound) == origin
    except ValueError:
        same = False
    return (value, None) if same else ("", "env_origin_missing")


def resolve_key(name: str, spec: ProviderSpec, ring: KeyRing | None, settings: Settings | None,
                environ: Mapping[str, str] | None = None) -> KeyChoice:
    origin = provider_origin(name, spec)
    stored = ring.entries.get(name) if ring is not None else None
    if stored is not None:
        if stored.origin == origin:
            return KeyChoice(stored.value, "console")
        return KeyChoice(None, "none", "origin_mismatch", stored.origin)
    problem = "unreadable" if ring is not None and name in ring.unreadable else None
    value, env_problem = env_key(name, origin, settings, environ)
    if value:
        return KeyChoice(value, "env", problem)
    return KeyChoice(None, "none", problem or env_problem)


async def _lock(session: AsyncSession) -> None:
    if session.get_bind().dialect.name == "postgresql":  # READ COMMITTED would let two writes take one revision
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LLM_KEYS_LOCK})


async def keys_revision(session: AsyncSession) -> int | None:
    """The keys version: the newest revision (None while the table is empty). Rows are never deleted, so it only
    grows."""
    return await session.scalar(select(func.max(LlmProviderKey.revision)))


async def _next_revision(session: AsyncSession) -> int:
    return int(await keys_revision(session) or 0) + 1


async def store_key(session: AsyncSession, fernet: MultiFernet, provider: str, origin: str, key: str, *,
                    by: str) -> tuple[LlmProviderKey, bool]:
    """Set or replace a provider's key (the caller commits). Returns the row and whether a live key was replaced."""
    await _lock(session)
    revision = await _next_revision(session)  # before the row joins the session: the query would flush it half-made
    row = await session.get(LlmProviderKey, provider)
    replaced = row is not None and row.ciphertext is not None
    if row is None:
        row = LlmProviderKey(provider=provider)
        session.add(row)
    row.ciphertext = seal(fernet, provider, origin, key)
    row.last4, row.bound_origin, row.revision = last4_of(key), origin, revision
    row.updated_at, row.updated_by = datetime.now(UTC), by[:64]
    await session.flush()
    return row, replaced


async def clear_key(session: AsyncSession, provider: str, *, by: str) -> LlmProviderKey | None:
    """Delete a provider's key, keeping the row as a tombstone with a new revision. None when there is no live key.
    Needs no secret, so an unreadable row can always be cleared."""
    await _lock(session)
    revision = await _next_revision(session)
    row = await session.get(LlmProviderKey, provider)
    if row is None or row.ciphertext is None:
        return None
    row.ciphertext = row.last4 = row.bound_origin = None
    row.revision = revision
    row.updated_at, row.updated_by = datetime.now(UTC), by[:64]
    await session.flush()
    return row


async def rotate_keys(session: AsyncSession, fernet: MultiFernet) -> tuple[int, int]:
    """Re-encrypt every live row with the first key of the secret (MultiFernet.rotate). (rotated, unreadable). The
    revision does not move: no key changed."""
    await _lock(session)
    rotated = unreadable = 0
    for row in await live_rows(session):
        if row.ciphertext is None:
            continue
        try:
            row.ciphertext = fernet.rotate(row.ciphertext.encode("ascii")).decode("ascii")
            rotated += 1
        except (InvalidToken, ValueError, UnicodeError):
            unreadable += 1
    await session.flush()
    return rotated, unreadable
```

**Edit** `backend/app/cli/admin.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
    python -m app.cli.admin enable NAME
    python -m app.cli.admin list
"""
from __future__ import annotations
```

   with

```python
    python -m app.cli.admin enable NAME
    python -m app.cli.admin list
    python -m app.cli.admin llm-keys-secret                     # print a new LLM_KEYS_SECRET (Plan 23e; no DB)
    python -m app.cli.admin rotate-llm-keys                     # re-encrypt stored provider keys with the first key
"""
from __future__ import annotations
```

2. Replace

```python
from app.services.admin_sessions import AdminSessions
from app.services.audit import record


```

   with

```python
from app.services.admin_sessions import AdminSessions
from app.services.audit import record
from app.services.llm_keys import cipher, generate_secret, rotate_keys


```

3. Replace

```python
        sub.add_parser(name, help=text).add_argument("username")
    sub.add_parser("list", help="list admins")
    return p

```

   with

```python
        sub.add_parser(name, help=text).add_argument("username")
    sub.add_parser("list", help="list admins")
    sub.add_parser("llm-keys-secret", help="print a new LLM_KEYS_SECRET value (a Fernet key) for .env")
    sub.add_parser("rotate-llm-keys", help="re-encrypt the stored LLM provider keys with the first key of "
                                           "LLM_KEYS_SECRET (after adding a new key in front of the old one)")
    return p

```

4. Replace

```python


async def run(argv: list[str], session_factory, redis, *, read_password=getpass.getpass, stdin=None) -> int:
    args = _parser().parse_args(argv)
    if args.cmd == "list":
        async with session_factory() as session:
```

   with

```python


async def _rotate(session_factory, settings) -> int:
    """Plan 23e: LLM_KEYS_SECRET=new,old → every stored key re-encrypted with `new`, one transaction, audited."""
    fernet = cipher(settings)
    if fernet is None:
        print("error: LLM_KEYS_SECRET is missing or not a list of Fernet keys", file=sys.stderr)
        return 1
    async with session_factory() as session, session.begin():
        rotated, unreadable = await rotate_keys(session, fernet)
        await record(session, CLI_ACTOR, "llm_key.rotate", target_type="llm_key",
                     after={"rotated": rotated, "unreadable": unreadable})
    note = f"; {unreadable} could not be read with any key and were left as they are" if unreadable else ""
    print(f"rotate-llm-keys: {rotated} key(s) re-encrypted{note}")
    return 0


async def run(argv: list[str], session_factory, redis, *, read_password=getpass.getpass, stdin=None,
              settings=None) -> int:
    args = _parser().parse_args(argv)
    if args.cmd == "llm-keys-secret":
        print(generate_secret())
        return 0
    if args.cmd == "rotate-llm-keys":
        from app.config import get_settings

        return await _rotate(session_factory, settings or get_settings())
    if args.cmd == "list":
        async with session_factory() as session:
```

**Edit** `backend/app/services/audit.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
from app.services.admin_auth import AdminPrincipal

SECRET_FIELDS = frozenset({"password", "password_hash", "key", "key_hash", "raw_key", "token"})
SECRET_SUFFIXES = ("password", "token", "secret", "_hash")

```

   with

```python
from app.services.admin_auth import AdminPrincipal

# Plan 23e: api_key, ciphertext and llm_keys_secret too, a backstop for any caller that passes one (the key routes
# never do: their rows hold provider, kind, origin and revision only)
SECRET_FIELDS = frozenset({"password", "password_hash", "key", "key_hash", "raw_key", "token", "api_key", "ciphertext",
                           "llm_keys_secret"})
SECRET_SUFFIXES = ("password", "token", "secret", "_hash")

```

After the `pyproject.toml` and `uv.lock` edits run `cd /d/MRA-plan-23e/backend && uv sync --offline` (or, instead of those two edits, `uv add --offline "cryptography>=50.0"`, which writes the same two lines). The integration test runs only with `MRA_INTEGRATION=1` and Postgres; it is skipped otherwise.

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_llm_keys.py -q`

Expected: 23 passed (the integration test is collected only with `MRA_INTEGRATION=1`)

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23e/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; pre-flight: backend 2757 passed, 18 skipped (the new integration test is skipped)

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(llm): encrypted provider key store bound to provider and origin, secret and rotation CLI (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add backend/tests/unit/test_llm_keys.py backend/tests/integration/test_llm_keys_migration.py backend/pyproject.toml backend/uv.lock backend/app/config.py backend/app/db/models.py backend/migrations/versions/c6e8a0b2d4f6_llm_provider_keys.py backend/app/services/llm_keys.py backend/app/cli/admin.py backend/app/services/audit.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 3: Clients built with the key ring — dialect, prices per kind, redaction

**Files:**
- Modify: `backend/app/services/llm.py`
- Modify: `backend/app/services/llm_probe.py`
- Modify: `backend/app/graph/factory.py`
- Modify: `backend/app/cli/eval.py`
- Modify: `backend/app/worker/harness.py`
- Test (create): `backend/tests/unit/test_provider_clients.py`

**Interfaces:**
- Consumes: `KeyRing`, `KeyChoice`, `resolve_key`, `load_keyring` (Task 2); `FixedPrice`, `role_price`, `key_env`, `provider_origin`, `is_local_origin` (Task 1).
- Produces:
  - `app/services/llm.py`: `redact(text, key)`, `REDACT_MIN = 12`; `estimate_cost(model, in, out, price=None)`; `AnthropicStructuredLLM(..., price=None)`; `OpenAICompatibleStructuredLLM(..., price: ModelInfo | FixedPrice | None, reported_cost=True, effort_field="reasoning")`; provider errors redacted and raised `from None`; `MissingKeyLLM(model, env_name, reason=None)`; `missing_key_reason(role, choice)`; `build_role_llm(role, settings, catalog=None, schema=None, keys=None)`; `build_llms(..., keys=None)`.
  - `probe(role, settings, catalog=None, *, build=build_role_llm, keys=None)` (passes `keys` to `build` only when given; redacts its error); `build_graph_deps(..., keys=None)`; `eval_keys(settings, config_file, maker)` in `app/cli/eval.py`; `build_eval_deps` loads the ring.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_provider_clients.py` (complete):

```python
"""Plan 23e Task 3: clients built with the console's keys. A key goes only to its origin, an OpenAI-compatible server is
spoken to in OpenAI's dialect and charged at the role's price, and a provider error never carries the key."""
import asyncio
import copy
import json

import pytest

from app.cli.eval import eval_keys
from app.config import Settings
from app.graph.factory import build_graph_deps
from app.graph.schemas import QueryPlan, TopicVerdict
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import (
    LimitedLLM,
    LLMError,
    MissingKeyLLM,
    OpenAICompatibleStructuredLLM,
    build_llms,
    build_role_llm,
    estimate_cost,
    redact,
)
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_keys import KeyRing, StoredKey
from app.services.llm_probe import probe
from app.services.model_catalog import FixedPrice
from tests.fake_openai import FakeOpenAIServer, completion_body
from tests.llm_helpers import MINIMAL

KEY = "sk-test-0000000000000000abcd"
ENV_KEY = "sk-env-1111111111111111wxyz"
OK = json.dumps({"allowed": True, "reason": "medical", "english_topic": "metformin"})
SETTINGS = Settings(_env_file=None, openrouter_api_key=ENV_KEY)


@pytest.fixture
def fake_openai():
    server = FakeOpenAIServer().start()
    yield server
    server.stop()


def config(name="local", base_url="http://127.0.0.1:9/api/v1", **role) -> dict:
    raw = copy.deepcopy(MINIMAL)
    raw["providers"][name] = {"kind": "openai_compatible", "base_url": base_url, "require_parameters": False}
    raw["presets"]["cheap"]["guard"] = {"model": "deepseek-chat", "provider": name, "price_in": 1.0,
                                        "price_out": 2.0, **role}
    return raw


def guard(raw: dict):
    return resolve_llm_config(parse_llm_config(raw)).roles["guard"]


def ring(**keys: tuple[str, str]) -> KeyRing:
    return KeyRing({name: StoredKey(value, origin, value[-4:]) for name, (value, origin) in keys.items()}, revision=1)


async def test_a_console_key_reaches_its_server_in_openai_dialect_and_the_role_price_is_charged(fake_openai):
    fake_openai.replies.append(completion_body(OK, cost=99.0, prompt_tokens=1_000_000, completion_tokens=500_000))
    role = guard(config(base_url=fake_openai.url, reasoning_effort="high", fallback_models=["other-model"]))
    llm = build_role_llm(role, SETTINGS, None, keys=ring(local=(KEY, f"http://127.0.0.1:{fake_openai.port}")))
    budget = ReviewBudget(cap_usd=10.0)
    with use_budget(budget):
        res = await LimitedLLM(llm, asyncio.Semaphore(1)).ainvoke("s", "u")
    assert fake_openai.headers[0]["authorization"] == f"Bearer {KEY}"
    body = fake_openai.requests[0]
    assert body["reasoning_effort"] == "high"
    for field in ("reasoning", "models", "provider"):  # OpenRouter-only fields stay at home
        assert field not in body
    assert res.cost_usd == pytest.approx(1.0 + 1.0)  # 1M in at $1 + 0.5M out at $2; the server's "cost" is ignored
    assert budget.spent == pytest.approx(2.0)


async def test_openrouter_keeps_its_reported_cost_and_falls_back_to_the_role_price(fake_openai):
    fake_openai.replies += [completion_body(OK, cost=0.000294), completion_body(OK, cost=None, prompt_tokens=1_000_000,
                                                                                 completion_tokens=0)]
    base = {"model": "m", "api_key": "sk-or-x", "base_url": fake_openai.url, "max_tokens": 64, "max_retries": 0}
    reported = await OpenAICompatibleStructuredLLM(TopicVerdict, price=FixedPrice(5, 5), **base).ainvoke("s", "u")
    assert reported.cost_usd == pytest.approx(0.000294)
    priced = await OpenAICompatibleStructuredLLM(TopicVerdict, price=FixedPrice(5, 5), **base).ainvoke("s", "u")
    assert priced.cost_usd == pytest.approx(5.0)
    raw = copy.deepcopy(MINIMAL)
    raw["presets"]["cheap"]["guard"].update(price_in=5, price_out=5)
    built = build_role_llm(guard(raw), SETTINGS, {})  # not in the catalog: the role's price
    assert built.price == FixedPrice(5, 5) and built.reported_cost is True


def test_an_anthropic_role_price_beats_the_table():
    assert estimate_cost("claude-haiku-4-5", 1_000_000, 0) == pytest.approx(1.0)
    assert estimate_cost("claude-haiku-4-5", 1_000_000, 0, FixedPrice(3, 15)) == pytest.approx(3.0)
    assert estimate_cost("claude-new-9", 1_000_000, 0) == 0.0


def test_the_console_key_beats_env_and_a_moved_origin_gets_none():
    raw = copy.deepcopy(MINIMAL)
    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    assert build_role_llm(guard(raw), SETTINGS, None, keys=console)._key == KEY
    assert build_role_llm(guard(raw), SETTINGS, None)._key == ENV_KEY  # no ring: env, as before
    moved = config("deepseek", "https://api.deepseek.com/v1")
    elsewhere = ring(deepseek=(KEY, "https://api.other.example"))
    llm = build_role_llm(guard(moved), SETTINGS, None, keys=elsewhere)
    assert isinstance(llm, MissingKeyLLM)
    assert llm.reason == ("no key for provider deepseek (the stored key belongs to https://api.other.example; enter "
                          "one for https://api.deepseek.com)")


async def test_a_public_server_never_gets_an_anonymous_call_but_a_local_one_may():
    public = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)
    assert isinstance(public, MissingKeyLLM) and "LLM_KEY_DEEPSEEK" in public.reason
    with pytest.raises(LLMError, match="no key for provider deepseek"):
        await public.ainvoke("s", "u")
    local = build_role_llm(guard(config("ollama", "http://localhost:11434/v1")), SETTINGS, None)
    assert isinstance(local, OpenAICompatibleStructuredLLM) and local._key == "not-needed"
    legacy = copy.deepcopy(MINIMAL)
    legacy["providers"]["openai_compatible"] = {"base_url": "http://10.0.0.5:11434/v1"}
    legacy["presets"]["cheap"]["guard"] = {"model": "m", "provider": "openai_compatible", "price_in": 0, "price_out": 0}
    assert build_role_llm(guard(legacy), SETTINGS, None)._key == "not-needed"  # the legacy entry as before


def test_missing_key_messages_name_the_problem(monkeypatch):
    unreadable = KeyRing(unreadable=frozenset({"deepseek"}), state="bad_secret")
    llm = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None, keys=unreadable)
    assert "cannot be read: LLM_KEYS_SECRET" in llm.reason
    monkeypatch.setenv("LLM_KEY_DEEPSEEK", ENV_KEY)
    llm = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)
    assert llm.reason == ("no key for provider deepseek (LLM_KEY_DEEPSEEK is set, but LLM_KEY_DEEPSEEK_ORIGIN is not "
                          "https://api.deepseek.com)")
    monkeypatch.setenv("LLM_KEY_DEEPSEEK_ORIGIN", "https://api.deepseek.com")
    assert build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)._key == ENV_KEY
    plain = build_role_llm(guard(MINIMAL), Settings(_env_file=None), None)
    assert plain.reason is None and plain.env_name == "OPENROUTER_API_KEY"  # the legacy message is unchanged


def test_redact_hides_the_key_and_any_long_slice_of_it():
    assert redact(f"bad key {KEY} sent", KEY) == "bad key [redacted] sent"
    assert redact(f"key starts {KEY[:14]}… ends …{KEY[-13:]}", KEY) == "key starts [redacted]… ends …[redacted]"
    assert redact("nothing to hide here", KEY) == "nothing to hide here"
    assert redact(f"short {KEY[:11]} stays", KEY) == f"short {KEY[:11]} stays"  # under 12: could be anything
    assert redact("k=sk-short1", "sk-short1") == "k=[redacted]"
    assert redact("text", None) == "text" and redact("", KEY) == ""


async def test_a_provider_error_that_echoes_the_key_is_redacted(fake_openai):
    fake_openai.replies.append((401, {"error": {"message": f"Incorrect API key provided: {KEY}", "code": 401}}))
    role = guard(config(base_url=fake_openai.url))
    llm = build_role_llm(role, SETTINGS, None, keys=ring(local=(KEY, f"http://127.0.0.1:{fake_openai.port}")))
    with pytest.raises(LLMError) as caught:
        await llm.ainvoke("s", "u")
    assert KEY not in str(caught.value) and "[redacted]" in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


async def test_the_probe_uses_the_ring_and_redacts_what_it_reports():
    seen = {}

    def build(role, settings, catalog, schema=None, keys=None):
        seen["keys"] = keys
        raise RuntimeError(f"connection refused while sending {KEY}")

    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    out = await probe(guard(MINIMAL), SETTINGS, None, build=build, keys=console)
    assert seen["keys"] is console and out["ok"] is False
    assert KEY not in out["error"] and "[redacted]" in out["error"]


def test_every_role_and_the_graph_deps_are_built_with_the_ring():
    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    llms = build_llms(SETTINGS, None, resolved=resolve_llm_config(parse_llm_config(MINIMAL)), keys=console)
    assert llms.guard.inner._key == KEY and llms.refiner_critic.inner._key == KEY
    assert llms.with_schema("planner", QueryPlan).inner._key == KEY
    deps = build_graph_deps(SETTINGS, http=None, resolved=resolve_llm_config(parse_llm_config(MINIMAL)), keys=console)
    assert deps.llms.synthesizer.inner._key == KEY


async def test_an_eval_run_reads_the_ring_unless_given_a_config_file(session_factory, tmp_path):
    assert await eval_keys(SETTINGS, str(tmp_path / "llm.yaml"), lambda: session_factory) is None
    loaded = await eval_keys(SETTINGS, None, lambda: session_factory)
    assert isinstance(loaded, KeyRing) and loaded.revision is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_provider_clients.py -q`

Expected: collection error `ImportError: cannot import name 'eval_keys' from 'app.cli.eval'`

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/llm.py` (18 replacements; each `old` occurs exactly once):

1. Replace

```python
- openrouter / openai_compatible → langchain-openai ChatOpenAI (OpenAI chat-completions API)
- anthropic                      → langchain-anthropic ChatAnthropic (json_schema output_config)
Every call returns an LLMResult (parsed value + cost) or raises an LLMError subclass."""
from __future__ import annotations

```

   with

```python
- openrouter / openai_compatible → langchain-openai ChatOpenAI (OpenAI chat-completions API)
- anthropic                      → langchain-anthropic ChatAnthropic (json_schema output_config)
Every call returns an LLMResult (parsed value + cost) or raises an LLMError subclass. Plan 23e: a provider's key comes
from resolve_key (a console key bound to the provider's origin, else env); a provider error's text is redacted with the
key before it leaves this module."""
from __future__ import annotations

```

2. Replace

```python
from app.services.budget import current_budget
from app.services.llm_config import (
    PROVIDER_KEYS,
    HarnessSpec,
    ResolvedLLMConfig,
    ResolvedRole,
    load_llm_config,
)
from app.services.model_catalog import ModelInfo, choose_structured_method

# USD per million tokens (input, output) for direct Anthropic calls. Source: claude-api skill, 2026-09.
```

   with

```python
from app.services.budget import current_budget
from app.services.llm_config import (
    HarnessSpec,
    ResolvedLLMConfig,
    ResolvedRole,
    is_local_origin,
    key_env,
    load_llm_config,
    provider_origin,
)
from app.services.llm_keys import KeyChoice, KeyRing, resolve_key
from app.services.model_catalog import FixedPrice, ModelInfo, choose_structured_method, role_price

# USD per million tokens (input, output) for direct Anthropic calls. Source: claude-api skill, 2026-09.
```

3. Replace

```python


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES_PER_MTOK.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


```

   with

```python


REDACTED = "[redacted]"
REDACT_MIN = 12  # any slice of the key this long or longer is redacted


def estimate_cost(model: str, input_tokens: int, output_tokens: int, price: FixedPrice | None = None) -> float:
    """A direct Anthropic call's cost: the role's own price (Plan 23e), else PRICES_PER_MTOK, else 0."""
    if price is not None:
        return price.cost(input_tokens, output_tokens)
    price_in, price_out = PRICES_PER_MTOK.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


def redact(text: str, key: str | None) -> str:
    """text with the key, and every slice of it of REDACT_MIN or more characters, replaced by [redacted] (Plan 23e): a
    provider may echo the Authorization header, whole or cut, in its error text."""
    if not key or not text:
        return text
    if len(key) < REDACT_MIN:
        return text.replace(key, REDACTED)
    grams = {key[i:i + REDACT_MIN] for i in range(len(key) - REDACT_MIN + 1)}
    covered = [False] * len(text)
    for i in range(len(text) - REDACT_MIN + 1):
        if text[i:i + REDACT_MIN] in grams:
            covered[i:i + REDACT_MIN] = [True] * REDACT_MIN
    out: list[str] = []
    i = 0
    while i < len(text):
        if covered[i]:
            while i < len(text) and covered[i]:
                i += 1
            out.append(REDACTED)
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


```

4. Replace

```python
        timeout: float = 300.0,
        max_retries: int = 2,
    ) -> None:
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        kwargs: dict[str, Any] = {
            "model": model, "api_key": api_key, "max_tokens": max_tokens,
```

   with

```python
        timeout: float = 300.0,
        max_retries: int = 2,
        price: FixedPrice | None = None,
    ) -> None:
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.price = price
        self._key = api_key  # kept only to redact provider errors
        kwargs: dict[str, Any] = {
            "model": model, "api_key": api_key, "max_tokens": max_tokens,
```

5. Replace

```python
        try:
            out = await self._runnable.ainvoke([SystemMessage(system), HumanMessage(user)])
        except anthropic.APIError as exc:
            raise LLMError(f"{self.model}: provider error: {exc}") from exc
        raw = out["raw"]
        stop = (raw.response_metadata or {}).get("stop_reason")
```

   with

```python
        try:
            out = await self._runnable.ainvoke([SystemMessage(system), HumanMessage(user)])
        except anthropic.APIError as exc:  # not chained: the original text is not redacted
            raise LLMError(redact(f"{self.model}: provider error: {exc}", self._key)) from None
        raw = out["raw"]
        stop = (raw.response_metadata or {}).get("stop_reason")
```

6. Replace

```python
        in_tok, out_tok = int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        return LLMResult(
            value=out["parsed"], cost_usd=estimate_cost(self.model, in_tok, out_tok),
            model=self.model, input_tokens=in_tok, output_tokens=out_tok,
        )
```

   with

```python
        in_tok, out_tok = int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        return LLMResult(
            value=out["parsed"], cost_usd=estimate_cost(self.model, in_tok, out_tok, self.price),
            model=self.model, input_tokens=in_tok, output_tokens=out_tok,
        )
```

7. Replace

```python
        fallback_models: list[str] | tuple[str, ...] = (),
        extra_body: dict[str, Any] | None = None,
        price: ModelInfo | None = None,
    ) -> None:
        self.model = model
        self.schema = schema
```

   with

```python
        fallback_models: list[str] | tuple[str, ...] = (),
        extra_body: dict[str, Any] | None = None,
        price: ModelInfo | FixedPrice | None = None,
        reported_cost: bool = True,
        effort_field: str = "reasoning",
    ) -> None:
        """`price` charges a call whose cost the provider does not report, or (reported_cost=False, Plan 23e: any
        server that is not OpenRouter) every call. `effort_field` "reasoning" sends OpenRouter's reasoning object;
        "reasoning_effort" sends OpenAI's top-level field."""
        self.model = model
        self.schema = schema
```

8. Replace

```python
        self.method = "tool_calling" if method == "function_calling" else method
        self.price = price
        body: dict[str, Any] = dict(extra_body or {})
        if reasoning_effort:
            body["reasoning"] = {**body.get("reasoning", {}), "effort": reasoning_effort}
        if require_parameters:
```

   with

```python
        self.method = "tool_calling" if method == "function_calling" else method
        self.price = price
        self.reported_cost = reported_cost
        self._key = api_key  # kept only to redact provider errors
        body: dict[str, Any] = dict(extra_body or {})
        if reasoning_effort and effort_field == "reasoning":
            body["reasoning"] = {**body.get("reasoning", {}), "effort": reasoning_effort}
        if require_parameters:
```

9. Replace

```python
        if top_p is not None:
            kwargs["top_p"] = top_p
        if headers:
            kwargs["default_headers"] = headers
```

   with

```python
        if top_p is not None:
            kwargs["top_p"] = top_p
        if reasoning_effort and effort_field == "reasoning_effort":
            kwargs["reasoning_effort"] = reasoning_effort
        if headers:
            kwargs["default_headers"] = headers
```

10. Replace

```python
        except openai.LengthFinishReasonError as exc:
            raise LLMOutputError(f"{self.model} hit max_tokens before finishing the JSON output") from exc
        except openai.APIError as exc:
            status = getattr(exc, "status_code", "")
            raise LLMError(f"{self.model}: provider error {status}: {exc}") from exc
        raw = out["raw"]
        meta = raw.response_metadata or {}
```

   with

```python
        except openai.LengthFinishReasonError as exc:
            raise LLMOutputError(f"{self.model} hit max_tokens before finishing the JSON output") from exc
        except openai.APIError as exc:  # not chained: the original text is not redacted
            status = getattr(exc, "status_code", "")
            raise LLMError(redact(f"{self.model}: provider error {status}: {exc}", self._key)) from None
        raw = out["raw"]
        meta = raw.response_metadata or {}
```

11. Replace

```python
        in_tok = int(usage.get("prompt_tokens") or (raw.usage_metadata or {}).get("input_tokens", 0))
        out_tok = int(usage.get("completion_tokens") or (raw.usage_metadata or {}).get("output_tokens", 0))
        cost = usage.get("cost")
        if cost is None:
            cost = self.price.cost(in_tok, out_tok) if self.price else 0.0
```

   with

```python
        in_tok = int(usage.get("prompt_tokens") or (raw.usage_metadata or {}).get("input_tokens", 0))
        out_tok = int(usage.get("completion_tokens") or (raw.usage_metadata or {}).get("output_tokens", 0))
        cost = usage.get("cost") if self.reported_cost else None  # an arbitrary server's own figure is not trusted
        if cost is None:
            cost = self.price.cost(in_tok, out_tok) if self.price else 0.0
```

12. Replace

```python
    method = None

    def __init__(self, model: str, env_name: str = "ANTHROPIC_API_KEY") -> None:
        self.model = model
        self.env_name = env_name

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        raise LLMError(f"{self.env_name} is not configured on the worker (needed for model {self.model})")


```

   with

```python
    method = None

    def __init__(self, model: str, env_name: str = "ANTHROPIC_API_KEY", reason: str | None = None) -> None:
        self.model = model
        self.env_name = env_name
        self.reason = reason

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        raise LLMError(self.reason or f"{self.env_name} is not configured on the worker (needed for model {self.model})")


```

13. Replace

```python


def build_role_llm(role: ResolvedRole, settings: Settings, catalog: dict[str, ModelInfo] | None = None,
                   schema: type[BaseModel] | None = None):
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    env_name = PROVIDER_KEYS.get(role.provider, "")  # a provider with a free name has no env key before Plan 23e Task 3
    key = _api_key(settings, env_name) if env_name else ""
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.kind == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, env_name)
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds)
    if not key and role.kind == "openrouter":
        return MissingKeyLLM(spec.model, env_name)
    info = (catalog or {}).get(spec.model) if role.kind == "openrouter" else None
    if spec.reasoning_effort == "none" and role.kind == "openrouter" and (info is None or info.supports("reasoning")):
        # Some models reason by default (Qwen3.5 Flash on Alibaba) and then break structured output; an explicit
```

   with

```python


def missing_key_reason(role: ResolvedRole, choice: KeyChoice) -> str | None:
    """Why a provider has no key (Plan 23e), naming the provider and the problem; None for the plain "variable not
    set" of a legacy name, whose message stays as before."""
    name, env_name, origin = role.provider, key_env(role.provider), provider_origin(role.provider, role.provider_spec)
    if choice.problem == "origin_mismatch":
        return f"no key for provider {name} (the stored key belongs to {choice.bound_origin}; enter one for {origin})"
    if choice.problem == "unreadable":
        return (f"no key for provider {name} (the stored key cannot be read: LLM_KEYS_SECRET is missing or changed; "
                "enter the key again)")
    if choice.problem == "env_origin_missing":
        return f"no key for provider {name} ({env_name} is set, but {env_name}_ORIGIN is not {origin})"
    if role.provider != role.kind and role.provider != "openai_compatible":
        return f"no key for provider {name}: enter one in the admin console, or set {env_name} and {env_name}_ORIGIN"
    return None


def build_role_llm(role: ResolvedRole, settings: Settings, catalog: dict[str, ModelInfo] | None = None,
                   schema: type[BaseModel] | None = None, keys: KeyRing | None = None):
    """`keys` is the console's key ring (Plan 23e); None means env keys only (tests, CLIs without a DB)."""
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    env_name = key_env(role.provider)
    choice = resolve_key(role.provider, ps, keys, settings)
    key = choice.value or ""
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.kind == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds,
                                      price=role_price(role))
    if not key and role.kind == "openrouter":
        return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
    if not key and role.provider != "openai_compatible" and not is_local_origin(provider_origin(role.provider, ps)):
        # a free name on a public host: never an anonymous call (the legacy local server keeps "not-needed")
        return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
    openrouter = role.kind == "openrouter"
    info = (catalog or {}).get(spec.model) if openrouter else None
    if spec.reasoning_effort == "none" and role.kind == "openrouter" and (info is None or info.supports("reasoning")):
        # Some models reason by default (Qwen3.5 Flash on Alibaba) and then break structured output; an explicit
```

14. Replace

```python
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and role.kind == "openrouter",
        fallback_models=spec.fallback_models, extra_body=spec.extra_body, price=info,
    )

```

   with

```python
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and openrouter,
        # fallback models are OpenRouter's `models` field: another server would refuse the request
        fallback_models=spec.fallback_models if openrouter else (), extra_body=spec.extra_body,
        # OpenRouter: its reported cost, else the catalog, else the role's price; any other server: the role's price
        price=(info or role_price(role)) if openrouter else role_price(role), reported_cost=openrouter,
        effort_field="reasoning" if openrouter else "reasoning_effort",
    )

```

15. Replace

```python
def build_llms(settings: Settings, catalog: dict[str, ModelInfo] | None = None, *,
               resolved: ResolvedLLMConfig | None = None, sem: asyncio.Semaphore | None = None,
               config_version: str = "file") -> LLMs:
    """`resolved` defaults to config/llm.yaml. `sem` is the semaphore every role (and escalation) shares: a reload
    passes the worker's current one (Plan 23b), and an llm_concurrency change passes a new one for the reviews that
    start afterwards (Plan 23c); without it a new semaphore of settings.llm_concurrency is made."""
    config = resolved or load_llm_config(settings.llm_config_path, settings.llm_preset)
    sem = sem or asyncio.Semaphore(max(1, settings.llm_concurrency))
    built = {role: LimitedLLM(build_role_llm(r, settings, catalog), sem) for role, r in config.roles.items()
             if role in SCHEMAS}
    if "refiner" in config.roles:
```

   with

```python
def build_llms(settings: Settings, catalog: dict[str, ModelInfo] | None = None, *,
               resolved: ResolvedLLMConfig | None = None, sem: asyncio.Semaphore | None = None,
               config_version: str = "file", keys: KeyRing | None = None) -> LLMs:
    """`resolved` defaults to config/llm.yaml. `sem` is the semaphore every role (and escalation) shares: a reload
    passes the worker's current one (Plan 23b), and an llm_concurrency change passes a new one for the reviews that
    start afterwards (Plan 23c); without it a new semaphore of settings.llm_concurrency is made. `keys` is the console's
    key ring (Plan 23e); None means env keys only."""
    config = resolved or load_llm_config(settings.llm_config_path, settings.llm_preset)
    sem = sem or asyncio.Semaphore(max(1, settings.llm_concurrency))
    built = {role: LimitedLLM(build_role_llm(r, settings, catalog, keys=keys), sem) for role, r in config.roles.items()
             if role in SCHEMAS}
    if "refiner" in config.roles:
```

16. Replace

```python
            refiner_role = refiner_role.with_spec(reasoning_effort="low")
        built["refiner_critic"] = LimitedLLM(
            build_role_llm(refiner_role, settings, catalog, schema=QuestionCritique), sem)
    escalation = None
    if "escalation" in config.roles:
```

   with

```python
            refiner_role = refiner_role.with_spec(reasoning_effort="low")
        built["refiner_critic"] = LimitedLLM(
            build_role_llm(refiner_role, settings, catalog, schema=QuestionCritique, keys=keys), sem)
    escalation = None
    if "escalation" in config.roles:
```

17. Replace

```python
        def escalation(schema: type[BaseModel]) -> StructuredLLM:
            if schema not in cache:
                cache[schema] = LimitedLLM(build_role_llm(esc_role, settings, catalog, schema=schema), sem)
            return cache[schema]

```

   with

```python
        def escalation(schema: type[BaseModel]) -> StructuredLLM:
            if schema not in cache:
                cache[schema] = LimitedLLM(build_role_llm(esc_role, settings, catalog, schema=schema, keys=keys), sem)
            return cache[schema]

```

18. Replace

```python
            raise LLMError(f"preset {config.preset} has no {role} role to bind to {schema.__name__}")
        if (role, schema) not in bound:
            bound[role, schema] = LimitedLLM(build_role_llm(config.roles[role], settings, catalog, schema=schema), sem)
        return bound[role, schema]

```

   with

```python
            raise LLMError(f"preset {config.preset} has no {role} role to bind to {schema.__name__}")
        if (role, schema) not in bound:
            bound[role, schema] = LimitedLLM(build_role_llm(config.roles[role], settings, catalog, schema=schema,
                                                            keys=keys), sem)
        return bound[role, schema]

```

**Edit** `backend/app/services/llm_probe.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.config import Settings
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LimitedLLM, build_role_llm
from app.services.llm_config import ResolvedRole

PROBE_MAX_TOKENS = 512  # reasoning models need some room before they answer
```

   with

```python
from app.config import Settings
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LimitedLLM, build_role_llm, redact
from app.services.llm_config import ResolvedRole
from app.services.llm_keys import KeyRing, resolve_key

PROBE_MAX_TOKENS = 512  # reasoning models need some room before they answer
```

2. Replace

```python


async def probe(role: ResolvedRole, settings: Settings, catalog=None, *, build=build_role_llm) -> dict[str, Any]:
    capped = role.with_spec(max_tokens=min(role.spec.max_tokens, PROBE_MAX_TOKENS),
                            timeout_seconds=min(role.spec.timeout_seconds, PROBE_TIMEOUT_SECONDS),
```

   with

```python


async def probe(role: ResolvedRole, settings: Settings, catalog=None, *, build=build_role_llm,
                keys: KeyRing | None = None) -> dict[str, Any]:
    """`keys` (Plan 23e): the console's key ring, resolved by origin as a worker would (None: env keys only). The error
    text is redacted with the key the call used."""
    capped = role.with_spec(max_tokens=min(role.spec.max_tokens, PROBE_MAX_TOKENS),
                            timeout_seconds=min(role.spec.timeout_seconds, PROBE_TIMEOUT_SECONDS),
```

3. Replace

```python
    # The clients' own timeout is per HTTP attempt and they retry (honouring Retry-After), so bound the whole call.
    deadline = asyncio.timeout(PROBE_TIMEOUT_SECONDS)
    try:
        llm = LimitedLLM(build(capped, settings, catalog, schema=ProbeAnswer), asyncio.Semaphore(1))
        with use_budget(budget):
            async with deadline:
                res = await llm.ainvoke(PROBE_SYSTEM, PROBE_USER)
    except Exception as exc:  # noqa: BLE001 - the console shows the reason; nothing else depends on it
        error = (f"timed out after {PROBE_TIMEOUT_SECONDS:g} s" if deadline.expired()
                 else f"{type(exc).__name__}: {exc}"[:300])
        return {"ok": False, "latency_ms": elapsed(), "cost_usd": round(budget.spent, 6), "model": role.spec.model,
                "error": error}
```

   with

```python
    # The clients' own timeout is per HTTP attempt and they retry (honouring Retry-After), so bound the whole call.
    deadline = asyncio.timeout(PROBE_TIMEOUT_SECONDS)
    built = {"keys": keys} if keys is not None else {}
    try:
        llm = LimitedLLM(build(capped, settings, catalog, schema=ProbeAnswer, **built), asyncio.Semaphore(1))
        with use_budget(budget):
            async with deadline:
                res = await llm.ainvoke(PROBE_SYSTEM, PROBE_USER)
    except Exception as exc:  # noqa: BLE001 - the console shows the reason; nothing else depends on it
        used = resolve_key(role.provider, role.provider_spec, keys, settings).value
        error = (f"timed out after {PROBE_TIMEOUT_SECONDS:g} s" if deadline.expired()
                 else redact(f"{type(exc).__name__}: {exc}", used)[:300])
        return {"ok": False, "latency_ms": elapsed(), "cost_usd": round(budget.spent, 6), "model": role.spec.model,
                "error": error}
```

**Edit** `backend/app/graph/factory.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python

def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None, sources: ActiveSources | None = None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching).
    `sources` (Plan 23d): the search sources in force; env's when None."""
    sources = sources if sources is not None else effective_sources(settings, {})
    if settings.graph_mode == "stub":
```

   with

```python

def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None, sources: ActiveSources | None = None,
                     keys=None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching).
    `sources` (Plan 23d): the search sources in force; env's when None. `keys` (Plan 23e): the console's key ring
    (app.services.llm_keys.KeyRing); None means env keys only."""
    sources = sources if sources is not None else effective_sources(settings, {})
    if settings.graph_mode == "stub":
```

2. Replace

```python
        glossary=glossary,
        sources=sources,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version),
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
```

   with

```python
        glossary=glossary,
        sources=sources,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version,
                        keys=keys),
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
```

**Edit** `backend/app/cli/eval.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
    except Exception as exc:  # e.g. LLM_PRESET names a preset the file does not have
        raise EvalConfigError(f"the model config in use ({effective.label}) is not usable: {_why(exc)}") from exc


```

   with

```python
    except Exception as exc:  # e.g. LLM_PRESET names a preset the file does not have
        raise EvalConfigError(f"the model config in use ({effective.label}) is not usable: {_why(exc)}") from exc


async def eval_keys(settings: Settings, config_file: str | None,
                    session_factory_maker: Callable[[], async_sessionmaker[AsyncSession]]):
    """(Plan 23e) The console's provider keys for an eval run that reads the DB config (None with --config-file: env
    keys only, as before). An unreadable DB is an EvalConfigError."""
    from app.services.llm_keys import load_keyring

    if config_file:
        return None
    try:
        async with session_factory_maker()() as session:
            return await load_keyring(session, settings)
    except Exception as exc:
        raise EvalConfigError(f"cannot read the provider keys ({_why(exc)}); check that Postgres is running and "
                              f"migrated, or pass --config-file PATH") from exc


```

2. Replace

```python
    from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

    resolved, label, runtime = None, "file", None
    if _parser().parse_args(rest).cmd in LLM_COMMANDS:
        try:
            resolved, label = await eval_llm_config(settings, config_file, session_factory_maker)
            runtime = await eval_runtime(settings, config_file, session_factory_maker)
        except EvalConfigError as exc:
```

   with

```python
    from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

    resolved, label, runtime, keys = None, "file", None, None
    if _parser().parse_args(rest).cmd in LLM_COMMANDS:
        try:
            resolved, label = await eval_llm_config(settings, config_file, session_factory_maker)
            keys = await eval_keys(settings, config_file, session_factory_maker)
            runtime = await eval_runtime(settings, config_file, session_factory_maker)
        except EvalConfigError as exc:
```

3. Replace

```python
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(runtime.settings, http, resolved=resolved, config_version=label,
                             glossary=runtime.glossary, sources=runtime.sources)
            if runtime is not None else GraphDeps(settings=settings))
    offline_deps(deps, _parser().parse_args(rest).cmd)
```

   with

```python
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(runtime.settings, http, resolved=resolved, config_version=label,
                             glossary=runtime.glossary, sources=runtime.sources, keys=keys)
            if runtime is not None else GraphDeps(settings=settings))
    offline_deps(deps, _parser().parse_args(rest).cmd)
```

**Edit** `backend/app/worker/harness.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
)
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.llm_store import load_effective
from app.services.llm_validate import unpriced_roles
```

   with

```python
)
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.llm_keys import load_keyring
from app.services.llm_store import load_effective
from app.services.llm_validate import unpriced_roles
```

2. Replace

```python
    async with ctx["session_factory"]() as session:
        effective = await load_effective(session, base)
    resolved = effective.resolve()  # an LLM_PRESET that names no preset fails here, before anything is spent
    runtime = await load_runtime(ctx["session_factory"], base)
```

   with

```python
    async with ctx["session_factory"]() as session:
        effective = await load_effective(session, base)
        keys = await load_keyring(session, base)  # Plan 23e: the console's provider keys, as a review worker uses them
    resolved = effective.resolve()  # an LLM_PRESET that names no preset fails here, before anything is spent
    runtime = await load_runtime(ctx["session_factory"], base)
```

3. Replace

```python
        raise UnpricedModels(unpriced)
    deps = build_graph_deps(runtime.settings, ctx["http"], catalog=catalog, resolved=resolved,
                            config_version=effective.label, glossary=runtime.glossary)
    deps.openalex, deps.mcp, deps.thaijo = None, None, None  # a replay never calls TCI
    return deps, {"llm_config": effective.label, "settings_version": runtime.settings_version,
```

   with

```python
        raise UnpricedModels(unpriced)
    deps = build_graph_deps(runtime.settings, ctx["http"], catalog=catalog, resolved=resolved,
                            config_version=effective.label, glossary=runtime.glossary, keys=keys)
    deps.openalex, deps.mcp, deps.thaijo = None, None, None  # a replay never calls TCI
    return deps, {"llm_config": effective.label, "settings_version": runtime.settings_version,
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_provider_clients.py -q`

Expected: 11 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23e/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; pre-flight: backend 2768 passed, 18 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(llm): build clients with the console's key ring, charge role prices off OpenRouter, redact provider errors (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add backend/tests/unit/test_provider_clients.py backend/app/services/llm.py backend/app/services/llm_probe.py backend/app/graph/factory.py backend/app/cli/eval.py backend/app/worker/harness.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 4: Admin API — write-only key routes, key status, provider test, keys version

**Files:**
- Create: `backend/app/api/admin_keys_llm.py`
- Modify: `backend/app/api/admin_models.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/llm_store.py`
- Modify: `backend/app/services/llm_validate.py`
- Test (create): `backend/tests/unit/test_admin_llm_keys_api.py`
- Test (modify): `backend/tests/unit/test_admin_models_api.py`

**Interfaces:**
- Consumes: Tasks 1–3; `require_admin`, `ip_hash_of`, `deps.limits.hit`, `record`, `load_effective`, `loaded_workers`.
- Produces:
  - `app/api/admin_keys_llm.py`: `GET /admin/llm-keys`, `PUT /admin/llm-keys/{provider}`, `DELETE /admin/llm-keys/{provider}` (registered with `include_in_schema=False`); `keys_state(deps)`; `KEY_RATE = "20/hour"`, `BODY_MAX = 4096`, `BODY_ERROR`, `SECRET_TEXT`.
  - `app/services/llm_store.py`: `KEYS_VERSION_KEY = "mra:llm:keys_version"`, `publish_keys_version(redis, revision)`, `reconcile_keys_version(redis, session_factory)`, `_raise_key` (shared by `publish_version`).
  - `app/services/llm_validate.py`: `validate_document(raw, settings, catalog, keys=None)`, `is_keyless(name, spec)`, `key_status(name, spec, keys, settings)`; the missing-key warnings follow the ring and an origin move of a provider with a stored key is warned about.
  - `GET /admin/llm-config` gains `key_status` and `known_prices`; `keys_present` is true when a console or env key resolves. `POST /admin/llm-models/test` accepts `{provider, model, price_in?, price_out?}` instead of `role`, passes the ring to `probe` and audits `kind` and `key_source`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_admin_llm_keys_api.py` (complete):

```python
"""Plan 23e Task 4: the provider-key routes. A key is write-only: no answer, audit row, log line or Redis value carries
it, a refused key is never quoted, and every write moves mra:llm:keys_version."""
import copy
import json

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select

from app.db.models import AdminAudit, LlmProviderKey
from app.services.llm_store import KEYS_VERSION_KEY
from app.services.model_catalog import ModelInfo
from tests.admin_helpers import CSRF, admin_headers
from tests.llm_helpers import MINIMAL

BASE = "/api/v1/admin"
KEY = "sk-test-0000000000000000abcd"
NEW_KEY = "sk-test-1111111111111111efgh"
SECRET = Fernet.generate_key().decode()
CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs"}))


def with_deepseek(base_url="https://api.deepseek.com/v1") -> dict:
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["deepseek"] = {"kind": "openai_compatible", "base_url": base_url, "require_parameters": False}
    raw["presets"]["cheap"]["extractor"] = {"model": "deepseek-chat", "provider": "deepseek", "price_in": 0.27,
                                            "price_out": 1.1}
    return raw


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    async def load():
        return {CHEAP.id: CHEAP}

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", load)


@pytest.fixture
def secret(app, monkeypatch):
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(SECRET))


@pytest.fixture
def probe_calls(monkeypatch):
    calls = []

    async def fake_probe(role, settings, catalog=None, keys=None):
        calls.append((role, keys))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}

    monkeypatch.setattr("app.api.admin_models.probe", fake_probe)
    return calls


async def save(client, h, raw, base=None):
    r = await client.post(f"{BASE}/llm-config", json={"config": raw, "base_version": base}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def provider(state, name):
    return next(p for p in state["providers"] if p["name"] == name)


async def audit_rows(session_factory):
    async with session_factory() as s:
        return list((await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars())


async def redis_dump(redis) -> str:
    out = []
    for key in await redis.keys("*"):
        kind = await redis.type(key)
        if kind == "string":
            out.append(f"{key}={await redis.get(key)}")
        elif kind == "hash":
            out.append(f"{key}={await redis.hgetall(key)}")
        else:
            out.append(key)
    return "\n".join(out)


async def test_the_state_lists_each_provider_without_any_key(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert (state["writable"], state["reason"], state["keys_version"], state["orphans"]) == (True, None, None, [])
    deepseek = provider(state, "deepseek")
    assert deepseek["kind"] == "openai_compatible" and deepseek["origin"] == "https://api.deepseek.com"
    assert deepseek["used_by"] == ["extractor", "conflict_explainer"]  # conflict_explainer copies the extractor
    assert deepseek["key"]["source"] == "none" and deepseek["key"]["last4"] is None and deepseek["keyless"] is False
    assert deepseek["env"] == {"name": "LLM_KEY_DEEPSEEK", "set": False, "origin_ok": False}
    assert provider(state, "openrouter")["env"]["name"] == "OPENROUTER_API_KEY"


async def test_set_replace_and_delete_never_echo_the_key_anywhere(client, app, session_factory, redis, secret,
                                                                  caplog, capsys):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    bodies = []
    r = await client.put(f"{BASE}/llm-keys/deepseek", json={"key": f"  {KEY}\n"}, headers=h)
    assert r.status_code == 200
    bodies.append(r.text)
    state = r.json()
    key = provider(state, "deepseek")["key"]
    assert (key["source"], key["last4"], key["bound_origin"], key["updated_by"]) == (
        "console", "abcd", "https://api.deepseek.com", "owner")
    assert state["keys_version"] == 1 and state["workers_notified"] is True and await redis.get(KEYS_VERSION_KEY) == "1"
    r = await client.put(f"{BASE}/llm-keys/deepseek", json={"key": NEW_KEY}, headers=h)
    bodies.append(r.text)
    assert provider(r.json(), "deepseek")["key"]["last4"] == "efgh" and r.json()["keys_version"] == 2
    for url in (f"{BASE}/llm-keys", f"{BASE}/llm-config", f"{BASE}/audit"):
        bodies.append((await client.get(url, headers=h)).text)
    bodies.append((await client.post(f"{BASE}/llm-config/validate", json={"config": with_deepseek()}, headers=h)).text)
    r = await client.delete(f"{BASE}/llm-keys/deepseek", headers=h)
    assert r.status_code == 200 and provider(r.json(), "deepseek")["key"]["source"] == "none"
    assert r.json()["keys_version"] == 3 and await redis.get(KEYS_VERSION_KEY) == "3"
    bodies.append(r.text)
    rows = await audit_rows(session_factory)
    actions = [row.action for row in rows if row.action.startswith("llm_key.")]
    assert actions == ["llm_key.set", "llm_key.replace", "llm_key.delete"]
    first = next(row for row in rows if row.action == "llm_key.set")
    assert first.after == {"provider": "deepseek", "kind": "openai_compatible", "origin": "https://api.deepseek.com",
                           "revision": 1} and first.target_id == "deepseek"
    async with session_factory() as s:
        stored = (await s.execute(select(LlmProviderKey))).scalar_one()
    everything = "\n".join([*bodies, json.dumps([[r.before, r.after] for r in rows]), await redis_dump(redis),
                            caplog.text, *capsys.readouterr(), stored.ciphertext or ""])
    for secret_text in (KEY, NEW_KEY, KEY[:-4], NEW_KEY[:-4]):
        assert secret_text not in everything


@pytest.mark.parametrize("payload", [{"key": "short"}, {"key": "sk-has a space-000000"}, {"key": 42},
                                     {"key": "x" * 600}, {"key": "sk-thái-00000000"}])
async def test_a_refused_key_is_never_quoted(client, session_factory, secret, payload):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/openrouter", json=payload, headers=h)
    assert r.status_code == 422
    assert r.json() == {"detail": "the key must be 8 to 512 visible characters without spaces"}
    assert str(payload["key"]) not in r.text


@pytest.mark.parametrize("content", [b"not json", b"[]", b'{"nokey": 1}', b'{"key": "' + b"a" * 5000 + b'"}'])
async def test_a_body_that_is_not_a_small_key_object_is_a_fixed_422(client, session_factory, secret, content):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/openrouter", content=content,
                         headers={**h, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"].startswith("the body must be a JSON object")
    assert "aaaa" not in r.text and "not json" not in r.text


@pytest.mark.parametrize("value,code", [("", "no_secret"), ("not-a-key", "bad_secret")])
async def test_without_a_good_secret_the_tab_is_read_only_but_delete_works(client, app, session_factory, monkeypatch,
                                                                           value, code):
    h = await admin_headers(client, session_factory)
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(SECRET))
    assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)).status_code == 200
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(value))
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert (state["writable"], state["reason"]) == (False, code)
    assert provider(state, "openrouter")["key"]["problem"] == "unreadable"
    r = await client.put(f"{BASE}/llm-keys/openrouter", json={"key": NEW_KEY}, headers=h)
    assert r.status_code == 409 and r.json()["code"] == code and NEW_KEY not in r.text
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)).status_code == 200


async def test_delete_falls_back_to_the_env_key(client, app, session_factory, secret, monkeypatch):
    h = await admin_headers(client, session_factory)
    monkeypatch.setattr(app.state.deps.service.settings, "openrouter_api_key", "sk-or-from-env-0000")
    assert provider((await client.get(f"{BASE}/llm-keys", headers=h)).json(), "openrouter")["key"]["source"] == "env"
    await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)
    assert (await client.get(f"{BASE}/llm-config", headers=h)).json()["key_status"]["openrouter"] == "console"
    r = await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)
    assert provider(r.json(), "openrouter")["key"]["source"] == "env"
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)).status_code == 404  # nothing left


async def test_unknown_providers_and_bad_names(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/groq", json={"key": KEY}, headers=h)
    assert r.status_code == 404 and KEY not in r.text
    assert (await client.put(f"{BASE}/llm-keys/Bad-Name", json={"key": KEY}, headers=h)).status_code == 422
    assert (await client.delete(f"{BASE}/llm-keys/groq", headers=h)).status_code == 404


async def test_the_routes_need_an_admin_the_csrf_header_and_stay_out_of_openapi(client, app, session_factory, secret):
    assert (await client.get(f"{BASE}/llm-keys")).status_code == 401
    h = await admin_headers(client, session_factory)
    no_csrf = {k: v for k, v in h.items() if k not in CSRF}
    assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=no_csrf)).status_code == 403
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=no_csrf)).status_code == 403
    assert not any("llm-keys" in path for path in app.openapi()["paths"])


async def test_key_changes_are_rate_limited(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    for _ in range(20):
        assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)).status_code == 200
    r = await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1


async def test_a_key_left_by_a_removed_provider_is_an_orphan_that_can_be_deleted(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    first = await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    await save(client, h, MINIMAL, base=first)
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert [p["name"] for p in state["providers"]] == ["openrouter"]
    assert state["orphans"][0]["name"] == "deepseek" and state["orphans"][0]["last4"] == "abcd"
    r = await client.delete(f"{BASE}/llm-keys/deepseek", headers=h)
    assert r.status_code == 200 and r.json()["orphans"] == []


async def test_moving_a_providers_origin_silences_its_key_and_validate_says_so_first(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    first = await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    moved = with_deepseek("https://api.other.example/v1")
    report = (await client.post(f"{BASE}/llm-config/validate", json={"config": moved}, headers=h)).json()
    assert report["ok"] is True
    assert ("providers.deepseek: the stored key belongs to https://api.deepseek.com; after saving, deepseek gets no "
            "key until one is entered for https://api.other.example") in report["warnings"]
    await save(client, h, moved, base=first)
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    key = provider(state, "deepseek")["key"]
    assert (key["source"], key["problem"], key["bound_origin"]) == ("none", "origin_mismatch",
                                                                   "https://api.deepseek.com")
    config_state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert config_state["key_status"]["deepseek"] == "origin_mismatch"
    assert config_state["keys_present"]["LLM_KEY_DEEPSEEK"] is False


async def test_the_config_state_reports_key_status_and_known_prices(client, session_factory):
    h = await admin_headers(client, session_factory)
    raw = with_deepseek()
    raw["providers"]["ollama"] = {"kind": "openai_compatible", "base_url": "http://localhost:11434/v1"}
    await save(client, h, raw)
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert state["key_status"] == {"openrouter": "none", "deepseek": "none", "ollama": "not_needed"}
    assert state["known_prices"]["claude-haiku-4-5"] == [1.0, 5.0]
    assert state["keys_present"] == {"OPENROUTER_API_KEY": False, "LLM_KEY_DEEPSEEK": False, "LLM_KEY_OLLAMA": False}


async def test_a_provider_can_be_tested_with_a_model_before_any_preset_uses_it(client, session_factory, secret,
                                                                               probe_calls):
    h = await admin_headers(client, session_factory)
    raw = with_deepseek()
    raw["presets"]["cheap"]["extractor"] = {"model": "vendor/cheap"}  # nothing uses deepseek now
    await save(client, h, raw)
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    r = await client.post(f"{BASE}/llm-models/test", headers=h,
                          json={"provider": "deepseek", "model": "deepseek-chat", "price_in": 0.27, "price_out": 1.1})
    assert r.status_code == 200 and r.json()["ok"] is True
    [(role, keys)] = probe_calls
    assert (role.provider, role.kind, role.spec.model, role.spec.price_in) == (
        "deepseek", "openai_compatible", "deepseek-chat", 0.27)
    assert set(keys.entries) == {"deepseek"}
    row = next(r for r in await audit_rows(session_factory) if r.action == "llm.test")
    assert row.after["kind"] == "openai_compatible" and row.after["key_source"] == "console"
    assert row.after["base_url_host"] == "api.deepseek.com" and KEY not in json.dumps(row.after)
    for body in ({"provider": "deepseek"}, {"provider": "groq", "model": "m"}, {"role": "guard", "provider": "deepseek",
                                                                               "model": "m"}, {}):
        assert (await client.post(f"{BASE}/llm-models/test", json=body, headers=h)).status_code == 422
    assert len(probe_calls) == 1


async def test_a_draft_that_moves_the_origin_tests_without_the_stored_key(client, session_factory, secret,
                                                                         probe_calls):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    moved = with_deepseek("https://api.other.example/v1")
    r = await client.post(f"{BASE}/llm-models/test", json={"config": moved, "role": "extractor"}, headers=h)
    assert r.status_code == 200
    row = next(r for r in await audit_rows(session_factory) if r.action == "llm.test")
    assert row.after["key_source"] == "none" and row.after["base_url_host"] == "api.other.example"
```

**Edit** `backend/tests/unit/test_admin_models_api.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    seen = []

    async def fake_probe(role, settings, catalog=None):
        seen.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}
```

   with

```python
    seen = []

    async def fake_probe(role, settings, catalog=None, keys=None):
        seen.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}
```

2. Replace

```python
    calls = []

    async def fake_probe(role, settings, catalog=None):
        calls.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}
```

   with

```python
    calls = []

    async def fake_probe(role, settings, catalog=None, keys=None):
        calls.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_admin_llm_keys_api.py tests/unit/test_admin_models_api.py -q`

Expected: collection error `ImportError: cannot import name 'KEYS_VERSION_KEY' from 'app.services.llm_store'`

- [ ] **Step 3: Implement**

**New file** `backend/app/api/admin_keys_llm.py` (complete):

```python
"""Admin console: LLM provider keys (Plan 23e). Thin adapters over app/services/llm_keys.py. A key is write-only: no
answer, audit row, log line or Redis value carries it. The PUT body is read and checked here, with fixed messages,
because FastAPI's own 422 quotes the input it refused. Every write audits in its transaction and then raises
mra:llm:keys_version, which workers follow (app/worker/llm_reload.py)."""
from __future__ import annotations

import json
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm_config import (
    CONFIG_ERRORS,
    PROVIDER_KEYS,
    PROVIDER_NAME,
    config_error_summary,
    key_env,
    provider_kind,
    provider_origin,
    resolve_llm_config,
)
from app.services.llm_keys import (
    KEY_TEXT_ERROR,
    KeyTextError,
    cipher,
    clean_key,
    clear_key,
    env_key,
    keys_revision,
    live_rows,
    load_keyring,
    resolve_key,
    secret_state,
    store_key,
)
from app.services.llm_store import load_effective, loaded_workers, publish_keys_version
from app.services.llm_validate import is_keyless
from app.services.review_service import Identity

router = APIRouter()
KEY_RATE = "20/hour"
BODY_MAX = 4096
BODY_ERROR = 'the body must be a JSON object {"key": "..."} of at most 4 KiB'
SECRET_TEXT = {"no_secret": "LLM_KEYS_SECRET is not set on the server: keys cannot be stored from the console",
               "bad_secret": "LLM_KEYS_SECRET on the server is not a list of Fernet keys: keys cannot be stored"}
ProviderName = Annotated[str, Path(pattern=f"^{PROVIDER_NAME.pattern}$", max_length=32)]


def _fail(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, **extra})


async def _limited(deps: AppDeps, identity: Identity) -> JSONResponse | None:
    decision = await deps.limits.hit("llm-key", identity.admin.label, KEY_RATE)
    if decision.allowed:
        return None
    return JSONResponse(status_code=429, content={"detail": "too many key changes; wait and try again"},
                        headers={"Retry-After": str(decision.retry_after)})


async def _body_key(request: Request) -> str:
    """The key from a capped JSON body; KeyTextError (fixed text) for anything else."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > BODY_MAX:
            raise ValueError(BODY_ERROR)
    try:
        body = json.loads(bytes(data) or b"null")
    except ValueError:
        raise ValueError(BODY_ERROR) from None
    if not isinstance(body, dict) or "key" not in body:
        raise ValueError(BODY_ERROR)
    return clean_key(body["key"])


def _env(name: str, origin: str, settings) -> dict[str, Any]:
    variable = key_env(name)
    value, _problem = env_key(name, origin, settings)
    if name in PROVIDER_KEYS:
        return {"name": variable, "set": bool(value), "origin_ok": True}
    return {"name": variable, "set": bool(os.environ.get(variable)), "origin_ok": bool(value)}


async def keys_state(deps: AppDeps) -> dict[str, Any]:
    """Everything the providers tab shows: each configured provider with its key status (never the key), the stored
    keys of providers no longer configured (orphans) and the workers' reports."""
    settings = deps.service.settings
    state = secret_state(settings)
    async with deps.session_factory() as session:
        rows = {row.provider: row for row in await live_rows(session)}
        revision = await keys_revision(session)
        ring = await load_keyring(session, settings)
        try:
            effective = await load_effective(session, settings)
            error = None
        except CONFIG_ERRORS as exc:
            effective, error = None, config_error_summary(exc)
    providers: list[dict[str, Any]] = []
    used: dict[str, list[str]] = {}
    if effective is not None:
        running = settings.llm_preset if effective.source == "file" and settings.llm_preset else None
        try:
            resolved = resolve_llm_config(effective.config, running, where=effective.label)
            for role in resolved.roles.values():
                used.setdefault(role.provider, []).append(role.role)
        except CONFIG_ERRORS:
            pass  # an LLM_PRESET that names no preset: no role is in use, the models page says why
        for name, spec in effective.config.providers.items():
            origin = provider_origin(name, spec)
            choice = resolve_key(name, spec, ring, settings)
            row = rows.get(name)
            live = row is not None and row.ciphertext is not None
            providers.append({
                "name": name, "kind": provider_kind(name, spec), "origin": origin, "used_by": used.get(name, []),
                "keyless": is_keyless(name, spec),
                "key": {"source": choice.source, "problem": choice.problem,
                        "last4": row.last4 if live else None, "bound_origin": row.bound_origin if live else None,
                        "updated_at": row.updated_at if live else None, "updated_by": row.updated_by if live else None},
                "env": _env(name, origin, settings)})
    configured = {p["name"] for p in providers}
    orphans = [{"name": row.provider, "last4": row.last4, "bound_origin": row.bound_origin,
                "updated_at": row.updated_at, "unreadable": row.provider in ring.unreadable}
               for row in rows.values() if row.ciphertext is not None and row.provider not in configured]
    return {"writable": state == "ok", "reason": None if state == "ok" else state, "keys_version": revision,
            "config_version": effective.version if effective is not None else None, "config_error": error,
            "providers": providers, "orphans": orphans, "loaded": await loaded_workers(deps.redis)}


@router.get("/admin/llm-keys")
async def llm_keys(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    return JSONResponse(content=jsonable_encoder(await keys_state(deps)))


async def _answer(deps: AppDeps, revision: int) -> JSONResponse:
    notified = await publish_keys_version(deps.redis, revision)  # False: the workers' poll repairs it from the DB
    state = await keys_state(deps)
    return JSONResponse(content=jsonable_encoder({**state, "workers_notified": notified}))


@router.put("/admin/llm-keys/{provider}")
async def llm_key_set(provider: ProviderName, request: Request, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
    if limited := await _limited(deps, identity):
        return limited
    try:
        key = await _body_key(request)
    except KeyTextError:
        return _fail(422, KEY_TEXT_ERROR)
    except ValueError:
        return _fail(422, BODY_ERROR)
    settings = deps.service.settings
    fernet = cipher(settings)
    if fernet is None:
        state = secret_state(settings)
        return _fail(409, SECRET_TEXT[state], code=state)
    async with deps.session_factory() as session:
        try:
            effective = await load_effective(session, settings)
        except CONFIG_ERRORS as exc:
            return _fail(409, f"the configuration in use cannot be read: {config_error_summary(exc)}")
    spec = effective.config.providers.get(provider)
    if spec is None:
        return _fail(404, f"provider {provider} is not configured; save a version with it first")
    origin = provider_origin(provider, spec)
    async with deps.session_factory() as session, session.begin():
        row, replaced = await store_key(session, fernet, provider, origin, key, by=identity.admin.label)
        await record(session, identity.admin, "llm_key.replace" if replaced else "llm_key.set", target_type="llm_key",
                     target_id=provider, after={"provider": provider, "kind": provider_kind(provider, spec),
                                                "origin": origin, "revision": row.revision},
                     ip_hash=ip_hash_of(identity, deps))
        revision = row.revision
    return await _answer(deps, revision)


@router.delete("/admin/llm-keys/{provider}")
async def llm_key_delete(provider: ProviderName, deps: AppDeps = Depends(get_deps),
                         identity: Identity = Depends(require_admin)):
    """Works without a secret and for providers no longer configured, so an unreadable or orphaned key can always go.
    It does not revoke the key at the provider."""
    if limited := await _limited(deps, identity):
        return limited
    async with deps.session_factory() as session, session.begin():
        row = await clear_key(session, provider, by=identity.admin.label)
        if row is None:
            return _fail(404, f"no stored key for provider {provider}")
        await record(session, identity.admin, "llm_key.delete", target_type="llm_key", target_id=provider,
                     after={"provider": provider, "revision": row.revision}, ip_hash=ip_hash_of(identity, deps))
        revision = row.revision
    return await _answer(deps, revision)
```

**Edit** `backend/app/api/admin_models.py` (9 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import _api_key
from app.services.llm_config import (
    CONFIG_ERRORS,
    LLMConfigError,
    config_error_summary,
    config_error_text,
    has_bad_text,
    parse_llm_config,
    parse_yaml_text,
```

   with

```python
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import PRICES_PER_MTOK
from app.services.llm_config import (
    CONFIG_ERRORS,
    PROVIDER_NAME,
    LLMConfigError,
    ResolvedRole,
    RoleSpec,
    config_error_summary,
    config_error_text,
    has_bad_text,
    key_env,
    parse_llm_config,
    parse_yaml_text,
```

2. Replace

```python
    url_host,
)
from app.services.llm_probe import probe
from app.services.llm_store import (
```

   with

```python
    url_host,
)
from app.services.llm_keys import load_keyring, resolve_key
from app.services.llm_probe import probe
from app.services.llm_store import (
```

3. Replace

```python
    version_out,
)
from app.services.llm_validate import to_yaml, validate_document
from app.services.model_catalog import cached_catalog, catalog_rows, load_live_catalog
from app.services.review_service import Identity, ServiceError
```

   with

```python
    version_out,
)
from app.services.llm_validate import key_status, to_yaml, validate_document
from app.services.model_catalog import cached_catalog, catalog_rows, load_live_catalog
from app.services.review_service import Identity, ServiceError
```

4. Replace

```python

class TestBody(Draft):
    preset: str | None = Field(None, max_length=64)
    role: str = Field(min_length=1, max_length=32)


```

   with

```python

class TestBody(Draft):
    """Test a role of a preset, or (Plan 23e) a provider with a model of its own, so a key can be tried before any
    preset uses it."""

    preset: str | None = Field(None, max_length=64)
    role: str | None = Field(None, min_length=1, max_length=32)
    provider: str | None = Field(None, pattern=f"^{PROVIDER_NAME.pattern}$", max_length=32)
    model: str | None = Field(None, min_length=1, max_length=200)
    price_in: float | None = Field(None, ge=0, le=1000)
    price_out: float | None = Field(None, ge=0, le=1000)


```

5. Replace

```python
    return {"source": "db" if row is not None else "file", "version": row.id if row is not None else None,
            "config": raw, "active_preset": preset if isinstance(preset, str) else "",
            "env_preset": settings.llm_preset, "keys_present": {}, "loaded": loaded,
            "error": config_error_summary(exc)}


```

   with

```python
    return {"source": "db" if row is not None else "file", "version": row.id if row is not None else None,
            "config": raw, "active_preset": preset if isinstance(preset, str) else "",
            "env_preset": settings.llm_preset, "keys_present": {}, "key_status": {}, "known_prices": KNOWN_PRICES,
            "loaded": loaded, "error": config_error_summary(exc)}


# Plan 23e: what a direct Anthropic model costs without a price of its own (USD per 1M tokens, input and output)
KNOWN_PRICES = {model: list(price) for model, price in PRICES_PER_MTOK.items()}


```

6. Replace

```python
            row = await newest_row(session)
            return _unreadable(settings, row, exc, await loaded_workers(deps.redis))
    keys = {p.api_key_env: bool(_api_key(settings, p.api_key_env)) for p in effective.config.providers.values()}
    # The preset the workers run: LLM_PRESET replaces the file's own active_preset while llm.yaml is the source, and a
    # DB version ignores it. Computed directly, not with effective.resolve(): an LLM_PRESET that names no preset must
```

   with

```python
            row = await newest_row(session)
            return _unreadable(settings, row, exc, await loaded_workers(deps.redis))
        ring = await load_keyring(session, settings)
    providers = effective.config.providers
    # keys_present (by variable name, as before) is true when a console or env key resolves (Plan 23e); key_status
    # says which, or why not
    keys = {key_env(name): resolve_key(name, spec, ring, settings).value is not None for name, spec in providers.items()}
    status = {name: key_status(name, spec, ring, settings) for name, spec in providers.items()}
    # The preset the workers run: LLM_PRESET replaces the file's own active_preset while llm.yaml is the source, and a
    # DB version ignores it. Computed directly, not with effective.resolve(): an LLM_PRESET that names no preset must
```

7. Replace

```python
    running = settings.llm_preset if effective.source == "file" and settings.llm_preset else effective.config.active_preset
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": running, "env_preset": settings.llm_preset,
            "keys_present": keys, "loaded": await loaded_workers(deps.redis), "error": None}


```

   with

```python
    running = settings.llm_preset if effective.source == "file" and settings.llm_preset else effective.config.active_preset
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": running, "env_preset": settings.llm_preset, "keys_present": keys, "key_status": status,
            "known_prices": KNOWN_PRICES, "loaded": await loaded_workers(deps.redis), "error": None}


```

8. Replace

```python
@router.post("/admin/llm-config/validate")
async def llm_validate(body: Draft, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    return validate_document(body.raw(), deps.service.settings, await _catalog(deps))


```

   with

```python
@router.post("/admin/llm-config/validate")
async def llm_validate(body: Draft, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    raw = body.raw()
    async with deps.session_factory() as session:
        ring = await load_keyring(session, deps.service.settings)
    return validate_document(raw, deps.service.settings, await _catalog(deps), ring)


```

9. Replace

```python
        raw = body.raw(required=False)
        if raw is not None:  # a draft: its own active preset, or the one asked for
            resolved = resolve_llm_config(parse_llm_config(raw, where="config"), body.preset, where="config")
        else:  # what the workers run: LLM_PRESET applies while llm.yaml is the source, as in the worker
            async with deps.session_factory() as session:
                effective = await load_effective(session, settings)
            resolved = (effective.resolve() if body.preset is None
                        else resolve_llm_config(effective.config, body.preset, where=effective.label))
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    role = resolved.roles.get(body.role)
    if role is None:
        raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
    try:  # which host the call goes to is parsed before the probe, so a bad URL can only ever be a 422, never a spend
        host = url_host(role.provider_spec.base_url)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    result = await probe(role, settings, await _catalog(deps))
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": body.role, "provider": role.provider,
                            "base_url_host": host, "ok": result["ok"], "cost_usd": result["cost_usd"]},
                     ip_hash=ip_hash_of(identity, deps))
    return result
```

   with

```python
        raw = body.raw(required=False)
        if raw is not None:  # a draft: its own active preset, or the one asked for
            config = parse_llm_config(raw, where="config")
            resolved = resolve_llm_config(config, body.preset, where="config")
        else:  # what the workers run: LLM_PRESET applies while llm.yaml is the source, as in the worker
            async with deps.session_factory() as session:
                effective = await load_effective(session, settings)
            config = effective.config
            resolved = (effective.resolve() if body.preset is None
                        else resolve_llm_config(effective.config, body.preset, where=effective.label))
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    try:
        role = _test_role(body, resolved, config)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    try:  # which host the call goes to is parsed before the probe, so a bad URL can only ever be a 422, never a spend
        host = url_host(role.provider_spec.base_url)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    async with deps.session_factory() as session:  # a draft that moves a base_url gets no stored key (Plan 23e)
        ring = await load_keyring(session, settings)
    key_source = resolve_key(role.provider, role.provider_spec, ring, settings).source
    result = await probe(role, settings, await _catalog(deps), keys=ring)
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": role.role, "provider": role.provider,
                            "kind": role.kind, "key_source": key_source, "base_url_host": host, "ok": result["ok"],
                            "cost_usd": result["cost_usd"]},
                     ip_hash=ip_hash_of(identity, deps))
    return result


def _test_role(body: TestBody, resolved, config) -> ResolvedRole:
    """The role a test call probes: a role of the preset, or (Plan 23e) a provider of the configuration with the given
    model and prices. Anything else is a 422."""
    if (body.role is None) == (body.provider is None):
        raise HTTPException(status_code=422, detail="send either role, or provider and model")
    if body.role is not None:
        role = resolved.roles.get(body.role)
        if role is None:
            raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
        return role
    if body.model is None:
        raise HTTPException(status_code=422, detail="model is required with provider")
    spec = config.providers.get(body.provider)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"provider {body.provider} is not configured")
    role_spec = RoleSpec(model=body.model, provider=body.provider, price_in=body.price_in, price_out=body.price_out)
    return ResolvedRole("test", body.provider, spec, role_spec)
```

**Edit** `backend/app/main.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    admin_harness,
    admin_keys,
    admin_models,
    admin_reviews,
```

   with

```python
    admin_harness,
    admin_keys,
    admin_keys_llm,
    admin_models,
    admin_reviews,
```

2. Replace

```python
    app.include_router(admin_dashboard.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_models.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_runtime.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_harness.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
```

   with

```python
    app.include_router(admin_dashboard.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_models.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_keys_llm.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_runtime.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_harness.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
```

**Edit** `backend/app/services/llm_store.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
    resolve_llm_config,
)
from app.services.llm_validate import document_errors, save_error_text
from app.services.review_service import Conflict, NotFound
```

   with

```python
    resolve_llm_config,
)
from app.services.llm_keys import keys_revision
from app.services.llm_validate import document_errors, save_error_text
from app.services.review_service import Conflict, NotFound
```

2. Replace

```python

LLM_VERSION_KEY = "mra:llm:config_version"
LOADED_KEY = "mra:llm:loaded"
# Plan 30: workers re-report every 30 s, so an entry not refreshed for 3 minutes (six missed heartbeats) is a worker that
```

   with

```python

LLM_VERSION_KEY = "mra:llm:config_version"
# Plan 23e: the newest provider-key revision (app/services/llm_keys.py); raised only, like LLM_VERSION_KEY
KEYS_VERSION_KEY = "mra:llm:keys_version"
LOADED_KEY = "mra:llm:loaded"
# Plan 30: workers re-report every 30 s, so an entry not refreshed for 3 minutes (six missed heartbeats) is a worker that
```

3. Replace

```python
    WATCH races or a connection failure): the key then keeps its previous value, so workers do not reload and the
    cache key stays on that version until a later publish succeeds."""
    try:
        for _ in range(PUBLISH_ATTEMPTS):
            async with redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(LLM_VERSION_KEY)
                    stored = _as_id(await pipe.get(LLM_VERSION_KEY))
                    if stored is not None and stored >= version_id:
                        return True
                    pipe.multi()
                    pipe.set(LLM_VERSION_KEY, str(version_id))
                    await pipe.execute()
                    return True
                except WatchError:
                    continue  # another client wrote the key between WATCH and EXEC: read it again
        log.warning("llm_version_publish_contended", version=version_id)
    except Exception:  # noqa: BLE001 - the caller already committed the version; Redis trouble must not fail it
        log.warning("llm_version_publish_failed", version=version_id)
    return False

```

   with

```python
    WATCH races or a connection failure): the key then keeps its previous value, so workers do not reload and the
    cache key stays on that version until a later publish succeeds."""
    return await _raise_key(redis, LLM_VERSION_KEY, version_id, "llm_version")


async def publish_keys_version(redis, revision: int) -> bool:
    """Plan 23e: raise KEYS_VERSION_KEY to a provider-key revision after its write committed, by publish_version's
    rules. False when Redis could not be updated: the workers' 30 s poll reads the DB and repairs it."""
    return await _raise_key(redis, KEYS_VERSION_KEY, revision, "llm_keys_version")


async def _raise_key(redis, key: str, value: int, what: str) -> bool:
    try:
        for _ in range(PUBLISH_ATTEMPTS):
            async with redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(key)
                    stored = _as_id(await pipe.get(key))
                    if stored is not None and stored >= value:
                        return True
                    pipe.multi()
                    pipe.set(key, str(value))
                    await pipe.execute()
                    return True
                except WatchError:
                    continue  # another client wrote the key between WATCH and EXEC: read it again
        log.warning(f"{what}_publish_contended", version=value)
    except Exception:  # noqa: BLE001 - the caller already committed the version; Redis trouble must not fail it
        log.warning(f"{what}_publish_failed", version=value)
    return False

```

4. Replace

```python
    elif stored > newest:
        await redis.set(LLM_VERSION_KEY, str(newest))
    return newest

```

   with

```python
    elif stored > newest:
        await redis.set(LLM_VERSION_KEY, str(newest))
    return newest


async def reconcile_keys_version(redis, session_factory) -> int | None:
    """Plan 23e: make KEYS_VERSION_KEY agree with the DB's newest key revision, by reconcile_version_key's rules, and
    return it (None while llm_provider_keys is empty)."""
    raw = await redis.get(KEYS_VERSION_KEY)
    stored = _as_id(raw)
    async with session_factory() as session:
        newest = await keys_revision(session)
    if newest is None:
        if raw is not None:
            await redis.delete(KEYS_VERSION_KEY)
    elif stored is None or stored < newest:
        await publish_keys_version(redis, newest)
    elif stored > newest:
        await redis.set(KEYS_VERSION_KEY, str(newest))
    return newest

```

**Edit** `backend/app/services/llm_validate.py` (5 replacements; each `old` occurs exactly once):

1. Replace

```python

from app.config import Settings
from app.services.llm import PRICES_PER_MTOK, _api_key
from app.services.llm_config import (
    CONFIG_ERRORS,
```

   with

```python

from app.config import Settings
from app.services.llm import PRICES_PER_MTOK
from app.services.llm_config import (
    CONFIG_ERRORS,
```

2. Replace

```python
)
from app.services.llm_cost import estimate_review_cost
from app.services.model_catalog import ModelInfo, validate_role

```

   with

```python
)
from app.services.llm_cost import estimate_review_cost
from app.services.llm_keys import KeyRing, resolve_key
from app.services.model_catalog import ModelInfo, validate_role

```

3. Replace

```python


def validate_document(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None) -> dict[str, Any]:
    try:
        return _validate(raw, settings, catalog)
    except CONFIG_ERRORS as exc:  # a bad document is a result to show, never a server error
        return {"ok": False, "errors": [config_error_text(exc)], "warnings": [], "cost": {}, "config": None,
```

   with

```python


def validate_document(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None,
                      keys: KeyRing | None = None) -> dict[str, Any]:
    """`keys` (Plan 23e): the console's key ring, so the missing-key warnings follow the keys the workers would use and
    a draft that moves a provider with a stored key to another origin is warned about before it is saved."""
    try:
        return _validate(raw, settings, catalog, keys)
    except CONFIG_ERRORS as exc:  # a bad document is a result to show, never a server error
        return {"ok": False, "errors": [config_error_text(exc)], "warnings": [], "cost": {}, "config": None,
```

4. Replace

```python


def _validate(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None) -> dict[str, Any]:
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
```

   with

```python


def is_keyless(name: str, spec) -> bool:
    """A provider that needs no key: the legacy local server, or an openai_compatible one on a local http origin."""
    return provider_kind(name, spec) == "openai_compatible" and (
        name == "openai_compatible" or is_local_origin(provider_origin(name, spec)))


def key_status(name: str, spec, keys: KeyRing | None, settings: Settings) -> str:
    """One word for a provider's key (Plan 23e): console, env, not_needed (a keyless local server), or the problem
    (origin_mismatch, unreadable, env_origin_missing), else none."""
    choice = resolve_key(name, spec, keys, settings)
    if choice.value:
        return choice.source
    if choice.problem is None and is_keyless(name, spec):
        return "not_needed"
    return choice.problem or "none"


def _validate(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None,
              keys: KeyRing | None = None) -> dict[str, Any]:
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
```

5. Replace

```python
            warnings.append(f"{preset}: no known price for {', '.join(unpriced)}: the review cost cap cannot count "
                            "their calls")
    for name in sorted(used_providers):
        spec = config.providers[name]
        local = provider_kind(name, spec) == "openai_compatible" and (
            name == "openai_compatible" or is_local_origin(provider_origin(name, spec)))
        env_name = key_env(name)
        if not local and not _api_key(settings, env_name):
            warnings.append(f"{env_name} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
            "yaml": to_yaml(normalized)}
```

   with

```python
            warnings.append(f"{preset}: no known price for {', '.join(unpriced)}: the review cost cap cannot count "
                            "their calls")
    for name, spec in config.providers.items():
        choice = resolve_key(name, spec, keys, settings)
        if choice.problem == "origin_mismatch":
            warnings.append(f"providers.{name}: the stored key belongs to {choice.bound_origin}; after saving, {name} "
                            f"gets no key until one is entered for {provider_origin(name, spec)}")
        if name not in used_providers or is_keyless(name, spec) or choice.value:
            continue
        if choice.problem in ("unreadable", "env_origin_missing"):
            warnings.append(f"{name}: no usable key ({choice.problem}): the {name} roles cannot run")
        elif choice.problem is None:
            warnings.append(f"{key_env(name)} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
            "yaml": to_yaml(normalized)}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_admin_llm_keys_api.py tests/unit/test_admin_models_api.py -q`

Expected: 103 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23e/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; pre-flight: backend 2790 passed, 18 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(admin): write-only provider key routes, key status and provider test calls (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add backend/tests/unit/test_admin_llm_keys_api.py backend/tests/unit/test_admin_models_api.py backend/app/api/admin_keys_llm.py backend/app/api/admin_models.py backend/app/main.py backend/app/services/llm_store.py backend/app/services/llm_validate.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 5: Workers follow the keys revision

**Files:**
- Modify: `backend/app/worker/llm_reload.py`
- Modify: `backend/app/worker/runtime_reload.py`
- Test (create): `backend/tests/unit/test_llm_keys_reload.py`

**Interfaces:**
- Consumes: `KEYS_VERSION_KEY`, `reconcile_keys_version`, `publish_keys_version` (Task 4), `load_keyring`, `KeyRing` (Task 2), `build_llms(..., keys=)` (Task 3).
- Produces: `keys_label(revision)`, `keys_problem(ring)`, `initial_keys(ctx)` (called by `init_llms`), `refresh_llms` comparing the config id and the keys revision (ctx keys `llm_keys`, `llm_keys_version`, `llm_keys_error`); `report_state` adds `keys` and `keys_error`; `_wire` and `runtime_reload._rebuild` pass `ctx["llm_keys"]`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_llm_keys_reload.py` (complete):

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_llm_keys_reload.py tests/unit/test_llm_reload.py tests/unit/test_runtime_reload.py -q`

Expected: 7 failed, 59 passed (the worker still builds with the env key and reports no `keys`)

- [ ] **Step 3: Implement**

**Edit** `backend/app/worker/llm_reload.py` (8 replacements; each `old` occurs exactly once):

1. Replace

```python
holding the old graph keep it, so a review never switches models mid-way. A configuration that fails to build keeps the
old models and is reported. Each worker also re-reports its state on every poll (a heartbeat), so `loaded_at` in
LOADED_KEY means "last seen"."""
from __future__ import annotations

```

   with

```python
holding the old graph keep it, so a review never switches models mid-way. A configuration that fails to build keeps the
old models and is reported. Each worker also re-reports its state on every poll (a heartbeat), so `loaded_at` in
LOADED_KEY means "last seen".

Plan 23e: the provider keys entered in the console are a second value the worker follows, the keys revision
(KEYS_VERSION_KEY, mirrored from llm_provider_keys like the config id). A change of either rebuilds the LLMs, under the
same lock, from the DB's config and key ring; a keys-only change keeps the config, its label and the semaphore. A key
ring that cannot be read keeps the old LLMs and is reported as keys_error; so are stored keys this worker cannot decrypt
(a missing or changed LLM_KEYS_SECRET). A running review keeps the key it started with."""
from __future__ import annotations

```

2. Replace

```python
from app.services.llm import build_llms
from app.services.llm_config import ResolvedLLMConfig, load_llm_config
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    load_effective,
    publish_version,
    reconcile_version_key,
    report_loaded,
```

   with

```python
from app.services.llm import build_llms
from app.services.llm_config import ResolvedLLMConfig, load_llm_config
from app.services.llm_keys import KeyRing, load_keyring
from app.services.llm_store import (
    KEYS_VERSION_KEY,
    LLM_VERSION_KEY,
    LOADED_KEY,
    load_effective,
    publish_version,
    reconcile_keys_version,
    reconcile_version_key,
    report_loaded,
```

3. Replace

```python


async def refresh_llms(ctx: dict, *, build_graph_fn=build_graph, poll: bool = False) -> bool:
    """Rebuild the models when the active version changed. True when this call switched to a new version.
    A job start trusts the Redis key (one cheap GET). A poll reads the DB's newest id instead, repairs the key to match
    and clears a load error that is stale because the worker already runs the DB's active id."""
    redis = ctx["events_redis"]
    try:
        if poll:
            newest = await reconcile_version_key(redis, ctx["session_factory"])
            wanted = str(newest) if newest is not None else "file"
            if wanted == ctx.get("llm_version"):
                ctx["llm_error"] = None
        else:
            wanted = await redis.get(LLM_VERSION_KEY)
    except Exception as exc:  # noqa: BLE001 - keep the current models while Redis or the DB is unreachable
        if poll:
            log.warning("llm_poll_reconcile_failed", error=str(exc))
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
            if effective.source == "db" and effective.active_id != wanted:
                # Redis holds a stale id (a lost or out-of-order publish): put the DB's newest back so the next poll
                # sees no change. publish_version only ever raises the key.
                await publish_version(redis, effective.version)
            if effective.active_id == ctx.get("llm_version"):
                return False  # Redis and the DB disagree but this worker already runs what the DB says
            resolved = effective.resolve()
```

   with

```python


def keys_label(revision: int | None) -> str:
    """The keys revision as a worker reports it: "none" while no key was ever stored."""
    return "none" if revision is None else str(revision)


def keys_problem(ring: KeyRing) -> str | None:
    """The heartbeat's keys_error for stored keys this worker cannot read (never a key, only provider names)."""
    if not ring.unreadable:
        return None
    why = ring.state if ring.state != "ok" else "unreadable"
    return f"{why}: stored keys cannot be read for {', '.join(sorted(ring.unreadable))}"


class _KeysUnreadable(Exception):
    """The key ring could not be loaded (the DB failed while reading it)."""


async def _load(ctx: dict, settings):
    """The DB's effective config and key ring, read together."""
    async with ctx["session_factory"]() as session:
        effective = await load_effective(session, settings)
        try:
            ring = await load_keyring(session, settings)
        except Exception as exc:
            raise _KeysUnreadable(str(exc)) from exc
    return effective, ring


async def refresh_llms(ctx: dict, *, build_graph_fn=build_graph, poll: bool = False) -> bool:
    """Rebuild the models when the active version or (Plan 23e) the keys revision changed. True when this call
    switched. A job start trusts the Redis keys (one MGET). A poll reads the DB's newest ids instead, repairs the keys
    to match and clears a load error that is stale because the worker already runs the DB's active id."""
    redis = ctx["events_redis"]
    have_keys = ctx.get("llm_keys_version") or "none"
    try:
        if poll:
            newest = await reconcile_version_key(redis, ctx["session_factory"])
            wanted = str(newest) if newest is not None else "file"
            wanted_keys = keys_label(await reconcile_keys_version(redis, ctx["session_factory"]))
            if wanted == ctx.get("llm_version"):
                ctx["llm_error"] = None
        else:
            wanted, wanted_keys = await redis.mget(LLM_VERSION_KEY, KEYS_VERSION_KEY)  # a missing key is no news
    except Exception as exc:  # noqa: BLE001 - keep the current models while Redis or the DB is unreachable
        if poll:
            log.warning("llm_poll_reconcile_failed", error=str(exc))
        return False
    config_moved = bool(wanted) and wanted != ctx.get("llm_version")
    keys_moved = bool(wanted_keys) and wanted_keys != have_keys
    if not config_moved and not keys_moved:
        return False
    async with ctx["llm_lock"]:
        settings = ctx["settings"]
        try:
            effective, ring = await _load(ctx, settings)
            if config_moved and effective.source == "db" and effective.active_id != wanted:
                # Redis holds a stale id (a lost or out-of-order publish): put the DB's newest back so the next poll
                # sees no change. publish_version only ever raises the key.
                await publish_version(redis, effective.version)
            same_keys = keys_label(ring.revision) == (ctx.get("llm_keys_version") or "none")
            if effective.active_id == ctx.get("llm_version") and same_keys:
                return False  # Redis and the DB disagree but this worker already runs what the DB says
            resolved = effective.resolve()
```

4. Replace

```python
                catalog = await cached_catalog(redis, load_live_catalog) or ctx.get("catalog")
                llms = build_llms(settings, catalog, resolved=resolved, sem=ctx["llm_sem"],
                                  config_version=effective.label)
                deps = dataclasses.replace(ctx["graph_deps"], llms=llms)
                graph = build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None))
        except Exception as exc:  # noqa: BLE001 - keep serving with the models already loaded
            log.error("llm_reload_failed", wanted=wanted, error=str(exc))
```

   with

```python
                catalog = await cached_catalog(redis, load_live_catalog) or ctx.get("catalog")
                llms = build_llms(settings, catalog, resolved=resolved, sem=ctx["llm_sem"],
                                  config_version=effective.label, keys=ring)
                deps = dataclasses.replace(ctx["graph_deps"], llms=llms)
                graph = build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None))
        except _KeysUnreadable as exc:  # keep the models and keys already loaded
            log.error("llm_keys_reload_failed", error=str(exc))
            ctx["llm_keys_error"] = f"could not read the provider keys: {exc}"[:300]
            await report_state(ctx)
            return False
        except Exception as exc:  # noqa: BLE001 - keep serving with the models already loaded
            log.error("llm_reload_failed", wanted=wanted, error=str(exc))
```

5. Replace

```python
        ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, effective.active_id
        ctx["llm_preset"], ctx["llm_error"], ctx["llm_resolved"] = resolved.preset, None, resolved
        if catalog is not None:
            ctx["catalog"] = catalog
        await report_state(ctx)
        log.info("llm_reloaded", version=effective.active_id, preset=resolved.preset)
        return True

```

   with

```python
        ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, effective.active_id
        ctx["llm_preset"], ctx["llm_error"], ctx["llm_resolved"] = resolved.preset, None, resolved
        ctx["llm_keys"], ctx["llm_keys_version"], ctx["llm_keys_error"] = ring, keys_label(ring.revision), keys_problem(ring)
        if catalog is not None:
            ctx["catalog"] = catalog
        await report_state(ctx)
        log.info("llm_reloaded", version=effective.active_id, preset=resolved.preset, keys=ctx["llm_keys_version"])
        return True

```

6. Replace

```python
    preset = ctx.get("llm_preset") or getattr(getattr(ctx.get("graph_deps"), "llms", None), "preset", "") or ""
    extra = {"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file",
             "sources": ctx.get("sources_version") or "env", "runtime_error": ctx.get("runtime_error")}
    await report_loaded(ctx["events_redis"], worker_id(), ctx.get("llm_version") or "file", preset,
                        error=ctx.get("llm_error"), extra=extra)
```

   with

```python
    preset = ctx.get("llm_preset") or getattr(getattr(ctx.get("graph_deps"), "llms", None), "preset", "") or ""
    extra = {"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file",
             "sources": ctx.get("sources_version") or "env", "runtime_error": ctx.get("runtime_error"),
             # Plan 23e: the provider-key revision this worker built its LLMs with, and why stored keys are unusable
             "keys": ctx.get("llm_keys_version") or "none", "keys_error": ctx.get("llm_keys_error")}
    await report_loaded(ctx["events_redis"], worker_id(), ctx.get("llm_version") or "file", preset,
                        error=ctx.get("llm_error"), extra=extra)
```

7. Replace

```python
    deps = build_graph_deps(ctx["settings"], ctx["http"], ctx["events_redis"], ctx["catalog"], resolved=resolved,
                            sem=ctx["llm_sem"], config_version=f"db:{active_id}" if active_id != "file" else "file",
                            glossary=ctx.get("glossary"), sources=ctx.get("sources"))
    return deps, build_graph_fn(deps, checkpointer=checkpointer)


```

   with

```python
    deps = build_graph_deps(ctx["settings"], ctx["http"], ctx["events_redis"], ctx["catalog"], resolved=resolved,
                            sem=ctx["llm_sem"], config_version=f"db:{active_id}" if active_id != "file" else "file",
                            glossary=ctx.get("glossary"), sources=ctx.get("sources"), keys=ctx.get("llm_keys"))
    return deps, build_graph_fn(deps, checkpointer=checkpointer)


async def initial_keys(ctx: dict) -> None:
    """Worker startup (Plan 23e): the console's key ring. A DB that cannot be read starts on env keys only (no ring),
    reports keys_error and leaves the revision unknown, so the first poll loads the ring."""
    try:
        async with ctx["session_factory"]() as session:
            ring = await load_keyring(session, ctx["settings"])
    except Exception as exc:  # noqa: BLE001
        log.error("llm_keys_load_failed", error=str(exc))
        ctx["llm_keys"], ctx["llm_keys_version"] = None, "unknown"
        ctx["llm_keys_error"] = f"could not read the provider keys: {exc}"[:300]
        return
    ctx["llm_keys"], ctx["llm_keys_version"], ctx["llm_keys_error"] = ring, keys_label(ring.revision), keys_problem(ring)


```

8. Replace

```python
    ctx["llm_sem_size"] = max(1, settings.llm_concurrency)  # Plan 23c: refresh_runtime compares it with the setting
    ctx["llm_lock"] = asyncio.Lock()
    resolved, active_id, error = await initial_llm_config(ctx["session_factory"], settings)
    try:
```

   with

```python
    ctx["llm_sem_size"] = max(1, settings.llm_concurrency)  # Plan 23c: refresh_runtime compares it with the setting
    ctx["llm_lock"] = asyncio.Lock()
    await initial_keys(ctx)
    resolved, active_id, error = await initial_llm_config(ctx["session_factory"], settings)
    try:
```

**Edit** `backend/app/worker/runtime_reload.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
            sem, size = asyncio.Semaphore(want), want
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary,
                               sources=runtime.sources)
```

   with

```python
            sem, size = asyncio.Semaphore(want), want
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"), keys=ctx.get("llm_keys"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary,
                               sources=runtime.sources)
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_llm_keys_reload.py tests/unit/test_llm_reload.py tests/unit/test_runtime_reload.py -q`

Expected: 66 passed

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23e/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; pre-flight: backend 2799 passed, 18 skipped

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(worker): rebuild models when provider keys change, report the keys revision (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add backend/tests/unit/test_llm_keys_reload.py backend/app/worker/llm_reload.py backend/app/worker/runtime_reload.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 6: Frontend — the providers tab, provider dropdown and prices, e2e

**Files:**
- Modify: `frontend/src/lib/admin-types.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/lib/admin-models.ts`
- Create: `frontend/src/lib/provider-templates.ts`
- Modify: `frontend/src/lib/admin-copy.ts`
- Modify: `frontend/src/components/admin/worker-versions.tsx`
- Create: `frontend/src/components/admin/models-providers.tsx`
- Modify: `frontend/src/components/admin/models-presets.tsx`
- Modify: `frontend/src/components/admin/models-view.tsx`
- Test (create): `frontend/src/components/admin/models-providers.test.tsx`
- Test (create): `frontend/src/components/admin/models-provider-fields.test.tsx`
- Test (create): `frontend/src/lib/admin-models-providers.test.ts`
- Test (create): `frontend/src/test/admin-keys-fixtures.ts`
- Test (create): `frontend/e2e/admin-providers.spec.ts`

**Interfaces:**
- Consumes: the routes and fields of Tasks 4–5 (`/admin/llm-keys`, `key_status`, `known_prices`, the test route's `provider`/`model`, the heartbeat's `keys`/`keys_error`).
- Produces: types `ProviderKind`, `KeyStatus`, `ProviderKeyRow`, `OrphanKey`, `LlmKeysState`, `LlmKeysWrite`, `TestBody`, `LlmRoleSpec.price_in/price_out`, `LoadedWorker.keys/keys_error`; `adminApi.llmKeys`, `setLlmKey`, `deleteLlmKey`; `keyEnv`, `providerKind`, `providerOrigin`, `KIND_LABEL`, `PROVIDER_NAME`, `MAX_PROVIDERS`, `missingKeys`, `providersInUse`, `addProvider`, `removeProvider` (`missingKeyEnvs` kept, now on `missingKeys`); `PROVIDER_TEMPLATES`; `ModelsProviders`, `keyStatusText`, `READ_ONLY_TEXT`; `ModelsPresets({..., knownPrices})` with `ProviderCell`; `WorkerVersions` field `keys`; the tab `providers` ("ผู้ให้บริการและคีย์") with the save bar; `ACTION_LABEL` for `llm_key.*`.

- [ ] **Step 0: Install the frontend dependencies once**

Run: `cd /d/MRA-plan-23e/frontend && npm ci`

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/components/admin/models-providers.test.tsx` (complete):

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc, LlmKeysState } from "@/lib/admin-types";
import { mockAdminFetch } from "@/test/admin-fetch";
import { DEEPSEEK_ROW, KEYS_CONFIG, KEYS_STATE, OPENROUTER_ROW, row } from "@/test/admin-keys-fixtures";
import { ModelsProviders, keyStatusText } from "./models-providers";

afterEach(() => { vi.unstubAllGlobals(); });

const KEY = "sk-test-0000000000000000abcd";

function show(state: LlmKeysState = KEYS_STATE, draft: LlmConfigDoc = KEYS_CONFIG, handler?: Parameters<typeof mockAdminFetch>[0]) {
  const fetch = mockAdminFetch((method, path, body) =>
    handler?.(method, path, body) ?? (method === "GET" && path === "/llm-keys" ? [200, state] : undefined));
  const setDraft = vi.fn();
  render(<ModelsProviders draft={draft} setDraft={setDraft} fail={(e) => (e instanceof Error ? e.message : String(e))} />);
  return { fetch, setDraft };
}

const item = async (name: string) => {
  const list = await screen.findByRole("list", { name: "ผู้ให้บริการ" });
  return within(list).getAllByRole("listitem").find((li) => li.textContent?.startsWith(name))!;
};

describe("keyStatusText", () => {
  it("says where each key comes from, or why there is none, and never more of a key than its last 4", () => {
    expect(keyStatusText(DEEPSEEK_ROW)).toBe("ตั้งจากหน้านี้ ••••a1b2");
    expect(keyStatusText(OPENROUTER_ROW)).toBe("ใช้ค่าจาก .env");
    expect(keyStatusText(row({ key: { source: "none", last4: null, updated_at: null } }))).toBe("ยังไม่มีคีย์");
    expect(keyStatusText(row({ keyless: true, key: { source: "none", last4: null } }))).toBe("ไม่ต้องใช้คีย์");
    expect(keyStatusText(row({ origin: "https://x.example", key: { source: "none", problem: "origin_mismatch" } })))
      .toBe("คีย์ที่เก็บไว้ผูกกับ https://api.deepseek.com — ใส่คีย์ใหม่สำหรับ https://x.example");
    expect(keyStatusText(row({ key: { source: "env", problem: "unreadable" } })))
      .toBe("ถอดรหัสคีย์ที่เก็บไว้ไม่ได้ (LLM_KEYS_SECRET เปลี่ยนไป) — ใส่ใหม่หรือลบ");
    expect(keyStatusText(row({ key: { source: "none", problem: "env_origin_missing" } })))
      .toBe("มี LLM_KEY_DEEPSEEK ใน .env แต่ไม่มี LLM_KEY_DEEPSEEK_ORIGIN ที่ตรงกับ https://api.deepseek.com");
  });
});

describe("ModelsProviders", () => {
  it("lists each provider with its kind, origin, roles and key status", async () => {
    show();
    const deepseek = await item("deepseek");
    expect(deepseek).toHaveTextContent("OpenAI-compatible · https://api.deepseek.com");
    expect(deepseek).toHaveTextContent("ใช้กับ: extractor");
    expect(deepseek).toHaveTextContent("ตั้งจากหน้านี้ ••••a1b2");
    expect(deepseek).toHaveTextContent("แก้ล่าสุดโดย owner");
    expect(within(deepseek).getByRole("button", { name: "เปลี่ยนคีย์ของ deepseek" })).toBeInTheDocument();
    expect(within(await item("openrouter")).getByRole("button", { name: "ใส่คีย์ของ openrouter" })).toBeInTheDocument();
  });

  it("sends a typed key once and clears the field, whether the save works or not", async () => {
    let fail = true;
    const { fetch } = show(KEYS_STATE, KEYS_CONFIG, (method, path) => {
      if (method === "PUT" && path === "/llm-keys/openrouter") {
        if (fail) { fail = false; return [409, { detail: "LLM_KEYS_SECRET is not set on the server", code: "no_secret" }]; }
        return [200, { ...KEYS_STATE, workers_notified: true,
          providers: [{ ...OPENROUTER_ROW, key: { ...DEEPSEEK_ROW.key, last4: "abcd", bound_origin: "https://openrouter.ai" } }, DEEPSEEK_ROW] }];
      }
      return undefined;
    });
    fireEvent.click(within(await item("openrouter")).getByRole("button", { name: "ใส่คีย์ของ openrouter" }));
    const field = screen.getByLabelText("คีย์ของ openrouter");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    fireEvent.change(field, { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("LLM_KEYS_SECRET is not set");
    expect(screen.getByLabelText("คีย์ของ openrouter")).toHaveValue("");  // refused: not kept
    fireEvent.change(screen.getByLabelText("คีย์ของ openrouter"), { target: { value: `${KEY} ` } }); // the server trims
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    expect(await screen.findByText(/บันทึกแล้ว: worker ใช้คีย์ชุดนี้/)).toBeInTheDocument();
    expect(screen.queryByLabelText("คีย์ของ openrouter")).not.toBeInTheDocument();
    expect(await item("openrouter")).toHaveTextContent("ตั้งจากหน้านี้ ••••abcd");
    const puts = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts.map(([url, init]) => [String(url), JSON.parse(String(init?.body))])).toEqual([
      ["/api/v1/admin/llm-keys/openrouter", { key: KEY }], ["/api/v1/admin/llm-keys/openrouter", { key: `${KEY} ` }]]);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it("asks before deleting a key and says what happens after", async () => {
    const { fetch } = show(KEYS_STATE, KEYS_CONFIG, (method, path) => (method === "DELETE" && path === "/llm-keys/deepseek"
      ? [200, { ...KEYS_STATE, workers_notified: false, providers: [OPENROUTER_ROW, row({ key: { source: "none", last4: null, updated_at: null } })] }]
      : undefined));
    fireEvent.click(within(await item("deepseek")).getByRole("button", { name: "ลบคีย์ของ deepseek" }));
    expect(screen.getByText(/หลังลบจะใช้คีย์จาก .env ถ้ามี/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบคีย์" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    expect(await screen.findByText(/แจ้ง worker ไม่สำเร็จ/)).toBeInTheDocument();
    expect(await item("deepseek")).toHaveTextContent("ยังไม่มีคีย์");
  });

  it("is read-only without a usable secret, but a key can still be deleted", async () => {
    show({ ...KEYS_STATE, writable: false, reason: "no_secret" });
    expect(await screen.findByText("ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ใส่คีย์ของ|เปลี่ยนคีย์ของ/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบคีย์ของ deepseek" })).toBeInTheDocument();
  });

  it("asks for a saved version before a key for a provider that is only in the draft", async () => {
    const draft = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, groq: { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1" } } };
    const { setDraft } = show(KEYS_STATE, draft);
    const groq = await item("groq");
    expect(groq).toHaveTextContent("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
    expect(within(groq).queryByRole("button", { name: /คีย์/ })).not.toBeInTheDocument();
    fireEvent.click(within(groq).getByRole("button", { name: "เอา groq ออกจากร่าง" }));
    expect(setDraft.mock.calls[0][0].providers.groq).toBeUndefined();
  });

  it("warns that moving a provider to another origin in the draft silences its stored key", async () => {
    const moved = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, deepseek: { kind: "openai_compatible", base_url: "https://api.other.example/v1" } } };
    show(KEYS_STATE, moved);
    expect(await item("deepseek")).toHaveTextContent("เมื่อบันทึก คีย์ที่เก็บไว้จะหยุดใช้");
    const path = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, deepseek: { kind: "openai_compatible", base_url: "https://api.deepseek.com/beta" } } };
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    show(KEYS_STATE, path);
    expect(await item("deepseek")).not.toHaveTextContent("เมื่อบันทึก");  // a path change keeps the key
  });

  it("adds a provider from a template, or a custom one, to the draft", async () => {
    const { setDraft } = show();
    await item("deepseek");
    fireEvent.change(screen.getByLabelText("แม่แบบ"), { target: { value: "groq" } });
    expect(screen.getByLabelText("ชื่อ")).toHaveValue("groq");
    expect(screen.getByLabelText("base URL")).toHaveValue("https://api.groq.com/openai/v1");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(setDraft.mock.calls[0][0].providers.groq).toEqual(
      { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1", require_parameters: false });
    expect(screen.getByRole("status")).toHaveTextContent("เพิ่ม groq ลงร่างแล้ว");
    fireEvent.change(screen.getByLabelText("แม่แบบ"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("base URL"), { target: { value: "https://x.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(screen.getByRole("status")).toHaveTextContent("มีผู้ให้บริการชื่อ deepseek อยู่แล้ว");
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "Bad-Name" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(screen.getByRole("status")).toHaveTextContent("ชื่อใช้ได้เฉพาะ a-z");
    expect(setDraft).toHaveBeenCalledTimes(1);
  });

  it("tests a provider through a role that uses it, or a model typed for it", async () => {
    const unused = row({ name: "groq", used_by: [], origin: "https://api.groq.com" });
    const { fetch } = show({ ...KEYS_STATE, providers: [DEEPSEEK_ROW, unused] }, KEYS_CONFIG, (method, path) =>
      method === "POST" && path === "/llm-models/test" ? [200, { ok: true, latency_ms: 300, cost_usd: 0.0001, model: "m", error: null }] : undefined);
    fireEvent.click(within(await item("deepseek")).getByRole("button", { name: "ทดสอบ deepseek" }));
    expect(await screen.findByText(/ใช้ได้ · 300 ms/)).toBeInTheDocument();
    const groq = await item("groq");
    expect(within(groq).getByRole("button", { name: "ทดสอบ groq" })).toBeDisabled();
    fireEvent.change(within(groq).getByLabelText("model สำหรับทดสอบ groq"), { target: { value: "llama-3.3-70b" } });
    fireEvent.click(within(groq).getByRole("button", { name: "ทดสอบ groq" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(2));
    const bodies = fetch.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(String(i?.body)));
    expect(bodies).toEqual([{ role: "extractor" }, { provider: "groq", model: "llama-3.3-70b" }]);
  });

  it("lists keys left by removed providers, and which key revision each worker runs", async () => {
    show({ ...KEYS_STATE, orphans: [{ name: "together", last4: "9f0e", bound_origin: "https://api.together.xyz", updated_at: null, unreadable: false }],
      loaded: [...KEYS_STATE.loaded, { worker: "worker-2:9", version: "3", preset: "cheap", loaded_at: "2026-10-14T09:00:00Z", error: null, keys: "3" }] });
    expect(await screen.findByText(/••••9f0e/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบคีย์ของ together" })).toBeInTheDocument();
    expect(screen.getByText(/worker-2:9/)).toHaveTextContent("ยังใช้คีย์ชุดเดิม");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });
});
```

**New file** `frontend/src/components/admin/models-provider-fields.test.tsx` (complete):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { KEYS_CONFIG, KEYS_STATE } from "@/test/admin-keys-fixtures";
import { STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsPresets } from "./models-presets";
import { ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
const SEEN = Date.parse("2026-10-14T09:00:00Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function presets(draft: LlmConfigDoc, knownPrices?: Record<string, [number, number]>) {
  const setDraft = vi.fn();
  render(<ModelsPresets draft={draft} setDraft={setDraft} fail={String} knownPrices={knownPrices} />);
  return setDraft;
}

describe("Presets tab provider and prices (Plan 23e)", () => {
  it("picks a role's provider from the draft's providers, with the default as the empty choice", () => {
    const setDraft = presets(KEYS_CONFIG);
    const select = screen.getByLabelText("provider ของ guard");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(
      ["ค่าเริ่มต้น (openrouter)", "openrouter (OpenRouter)", "deepseek (OpenAI-compatible)"]);
    fireEvent.change(select, { target: { value: "deepseek" } });
    expect(setDraft.mock.calls[0][0].presets.cheap.guard.provider).toBe("deepseek");
    fireEvent.change(screen.getByLabelText("provider ของ extractor"), { target: { value: "" } });
    expect(setDraft.mock.calls[1][0].presets.cheap.extractor.provider).toBeNull();
  });

  it("asks for prices off OpenRouter and shows a missing one", () => {
    const unpriced = { ...KEYS_CONFIG, presets: { ...KEYS_CONFIG.presets,
      cheap: { ...KEYS_CONFIG.presets.cheap, extractor: { model: "deepseek-chat", provider: "deepseek" } } } };
    const setDraft = presets(unpriced);
    expect(screen.queryByLabelText(/ราคา input ของ guard/)).not.toBeInTheDocument();  // OpenRouter: the catalog prices it
    expect(screen.getByText("ต้องใส่ราคา input และ output (USD ต่อ 1M token)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ราคา input ของ extractor (USD ต่อ 1M token)"), { target: { value: "0.27" } });
    expect(setDraft.mock.calls[0][0].presets.cheap.extractor.price_in).toBe(0.27);
  });

  it("shows an Anthropic model's known price as the placeholder and needs no typed price for it", () => {
    const direct = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, anthropic: {} },
      presets: { ...KEYS_CONFIG.presets, cheap: { ...KEYS_CONFIG.presets.cheap, guard: { model: "claude-haiku-4-5", provider: "anthropic" } } } };
    presets(direct, { "claude-haiku-4-5": [1, 5] });
    expect(screen.getByLabelText("ราคา input ของ guard (USD ต่อ 1M token)")).toHaveAttribute("placeholder", "1");
    expect(screen.getByLabelText("ราคา output ของ guard (USD ต่อ 1M token)")).toHaveAttribute("placeholder", "5");
    expect(screen.queryByText(/ต้องใส่ราคา/)).not.toBeInTheDocument();
  });
});

describe("ModelsView providers tab (Plan 23e)", () => {
  const routes = (method: string, path: string): [number, unknown] | undefined => {
    if (path === "/llm-config") {
      return [200, { ...STATE, config: KEYS_CONFIG, key_status: { openrouter: "env", deepseek: "origin_mismatch" }, known_prices: {} }];
    }
    if (path.startsWith("/llm-config/versions")) return [200, VERSIONS];
    if (path === "/llm-keys") return [200, KEYS_STATE];
    return undefined;
  };

  it("has the tab after Presets, warns in the header about an unusable key and keeps the save bar", async () => {
    mockAdminFetch(routes);
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText("deepseek: คีย์ที่เก็บไว้ผูกกับ origin อื่น: role ที่ใช้ provider นี้จะรันไม่ได้")).toBeInTheDocument();
    const tabs = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }))
      .filter((b) => b.closest('[aria-label="ส่วนของหน้า"]')).map((b) => b.textContent);
    expect(tabs).toContain("ผู้ให้บริการและคีย์");
    fireEvent.click(screen.getByRole("button", { name: "ผู้ให้บริการและคีย์" }));
    expect(await screen.findByRole("list", { name: "ผู้ให้บริการ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" })).toBeInTheDocument();
  });
});
```

**New file** `frontend/src/lib/admin-models-providers.test.ts` (complete):

```ts
import { describe, expect, it } from "vitest";
import { KEYS_CONFIG } from "@/test/admin-keys-fixtures";
import { STATE } from "@/test/admin-model-fixtures";
import { addProvider, keyEnv, missingKeyEnvs, missingKeys, providerKind, providerOrigin, providersInUse, removeProvider } from "./admin-models";
import type { LlmConfigState } from "./admin-types";
import { PROVIDER_TEMPLATES } from "./provider-templates";

const state = (over: Partial<LlmConfigState>): LlmConfigState => ({ ...STATE, config: KEYS_CONFIG, ...over });

describe("provider helpers (Plan 23e)", () => {
  it("names the one variable a provider's env key may come from", () => {
    expect(keyEnv("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(keyEnv("openai_compatible")).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(keyEnv("deepseek")).toBe("LLM_KEY_DEEPSEEK");
  });

  it("reads a kind, inferring it for the legacy names", () => {
    expect(providerKind("anthropic", {})).toBe("anthropic");
    expect(providerKind("deepseek", { kind: "openai_compatible" })).toBe("openai_compatible");
  });

  it("gives the origin a key is bound to: scheme, host and a non-default port", () => {
    expect(providerOrigin("deepseek", { base_url: "https://API.deepseek.com:443/v1" })).toBe("https://api.deepseek.com");
    expect(providerOrigin("ollama", { base_url: "http://localhost:11434/v1" })).toBe("http://localhost:11434");
    expect(providerOrigin("openrouter", {})).toBe("https://openrouter.ai");
    expect(providerOrigin("anthropic", undefined)).toBe("https://api.anthropic.com");
    expect(providerOrigin("x", { base_url: "not a url" })).toBe("");
  });

  it("adds an OpenAI-compatible provider and removes one only while nothing uses it", () => {
    const added = addProvider(KEYS_CONFIG, "groq", "https://api.groq.com/openai/v1");
    expect(added.providers.groq).toEqual({ kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1", require_parameters: false });
    expect(KEYS_CONFIG.providers.groq).toBeUndefined();
    expect(() => addProvider(added, "groq", "https://x.example")).toThrow();
    expect(removeProvider(added, "groq").providers.groq).toBeUndefined();
    expect(() => removeProvider(KEYS_CONFIG, "deepseek")).toThrow(/in use/);
    expect(providersInUse(KEYS_CONFIG)).toEqual(new Set(["openrouter", "deepseek"]));
  });

  it("offers the seven templates with an editable name and base URL each", () => {
    expect(PROVIDER_TEMPLATES.map((t) => t.name)).toEqual(["openai", "gemini", "deepseek", "groq", "mistral", "together", "ollama"]);
    expect(PROVIDER_TEMPLATES.every((t) => /^[a-z][a-z0-9_]*$/.test(t.name) && /^https?:\/\//.test(t.baseUrl))).toBe(true);
  });
});

describe("missingKeys (Plan 23e)", () => {
  it("follows key_status: a console or env key is fine, a problem or none is not, a local server needs none", () => {
    expect(missingKeys(state({ key_status: { openrouter: "console", deepseek: "env" } }))).toEqual([]);
    expect(missingKeys(state({ key_status: { openrouter: "none", deepseek: "origin_mismatch" } }))).toEqual([
      { provider: "deepseek", env: "LLM_KEY_DEEPSEEK", status: "origin_mismatch" },
      { provider: "openrouter", env: "OPENROUTER_API_KEY", status: "none" },
    ]);
    expect(missingKeys(state({ key_status: { openrouter: "not_needed", deepseek: "unreadable" } })).map((m) => m.status)).toEqual(["unreadable"]);
  });

  it("falls back to keys_present by variable when the answer has no key_status", () => {
    expect(missingKeyEnvs(state({ keys_present: { OPENROUTER_API_KEY: false, LLM_KEY_DEEPSEEK: false } })))
      .toEqual(["LLM_KEY_DEEPSEEK", "OPENROUTER_API_KEY"]);
  });

  it("only counts providers the running preset uses", () => {
    expect(missingKeys(state({ active_preset: "better", key_status: { openrouter: "env", deepseek: "none" } }))).toEqual([]);
  });
});
```

**New file** `frontend/src/test/admin-keys-fixtures.ts` (complete):

```ts
import type { LlmConfigDoc, LlmKeysState, ProviderKeyRow } from "@/lib/admin-types";
import { CONFIG } from "./admin-model-fixtures";

/** Plan 23e fixtures: a draft with OpenRouter and DeepSeek, and the provider-key state the API answers for it. */
export const KEYS_CONFIG: LlmConfigDoc = {
  ...CONFIG,
  providers: {
    ...CONFIG.providers,
    deepseek: { kind: "openai_compatible", base_url: "https://api.deepseek.com/v1", require_parameters: false },
  },
  presets: {
    ...CONFIG.presets,
    cheap: { ...CONFIG.presets.cheap, extractor: { model: "deepseek-chat", provider: "deepseek", price_in: 0.27, price_out: 1.1 } },
  },
};

const noKey: ProviderKeyRow["key"] = { source: "none", problem: null, last4: null, bound_origin: null, updated_at: null, updated_by: null };

export const OPENROUTER_ROW: ProviderKeyRow = {
  name: "openrouter", kind: "openrouter", origin: "https://openrouter.ai", used_by: ["guard", "planner"], keyless: false,
  key: { ...noKey, source: "env" }, env: { name: "OPENROUTER_API_KEY", set: true, origin_ok: true },
};
export const DEEPSEEK_ROW: ProviderKeyRow = {
  name: "deepseek", kind: "openai_compatible", origin: "https://api.deepseek.com", used_by: ["extractor"], keyless: false,
  key: { source: "console", problem: null, last4: "a1b2", bound_origin: "https://api.deepseek.com",
    updated_at: "2026-10-14T09:00:00Z", updated_by: "owner" },
  env: { name: "LLM_KEY_DEEPSEEK", set: false, origin_ok: false },
};

export const KEYS_STATE: LlmKeysState = {
  writable: true, reason: null, keys_version: 4, config_version: 3, config_error: null,
  providers: [OPENROUTER_ROW, DEEPSEEK_ROW], orphans: [],
  loaded: [{ worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-14T09:00:00Z", error: null, keys: "4" }],
};

export const row = (over: Omit<Partial<ProviderKeyRow>, "key"> & { key?: Partial<ProviderKeyRow["key"]> }): ProviderKeyRow =>
  ({ ...DEEPSEEK_ROW, ...over, key: { ...DEEPSEEK_ROW.key, ...over.key } });
```

**New file** `frontend/e2e/admin-providers.spec.ts` (complete):

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { LlmConfigDoc, LlmConfigState, LlmKeysState, LlmVersion, ProviderKeyRow, ValidateReport } from "../src/lib/admin-types";
import { CONFIG, STATE, VERSIONS } from "../src/test/admin-model-fixtures";
import { mockApi } from "./mock-api";

/**
 * Plan 23e: the "ผู้ให้บริการและคีย์" tab of /admin/models against a stateful fake of /api/v1/admin (same origin). The
 * fake keeps versions and stored keys; it answers a key only with its last 4 characters, as the real API does. A
 * request it does not know is answered 404 and listed in `calls.unmocked`, which each test expects to stay empty. No
 * provider and no network is ever reached.
 */
const KEY = "sk-test-0000000000000000abcd";
const NEW_KEY = "sk-test-1111111111111111efgh";
interface Stored { last4: string; origin: string; at: string }
interface Calls { puts: { name: string; body: unknown; csrf: string | undefined }[]; deletes: string[]; saves: LlmConfigDoc[]; unmocked: string[] }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const LEGACY_KEYS: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai_compatible: "OPENAI_COMPATIBLE_API_KEY" };
const ok = (config: LlmConfigDoc): ValidateReport => ({ ok: true, errors: [], warnings: [], cost: {}, config, yaml: `${JSON.stringify(config)}\n` });

function originOf(name: string, spec: Record<string, unknown>): string {
  const base = typeof spec.base_url === "string" ? spec.base_url : name === "anthropic" ? "https://api.anthropic.com" : "https://openrouter.ai";
  return new URL(base).origin;
}

async function mockProviders(page: Page, { writable = true } = {}) {
  const calls: Calls = { puts: [], deletes: [], saves: [], unmocked: [] };
  const versions: (LlmVersion & { config: LlmConfigDoc })[] = [{ ...clone(VERSIONS.items[0]), config: clone(CONFIG) }];
  const keys = new Map<string, Stored>();
  let revision = 0;
  const config = () => versions[0].config;
  const keyRow = (name: string, spec: Record<string, unknown>): ProviderKeyRow => {
    const stored = keys.get(name);
    const origin = originOf(name, spec);
    const kind = (typeof spec.kind === "string" ? spec.kind : name) as ProviderKeyRow["kind"];
    const used = Object.entries(config().presets[config().active_preset])
      .filter(([, r]) => (r.provider ?? config().default_provider ?? "openrouter") === name).map(([role]) => role);
    const env = LEGACY_KEYS[name] ?? `LLM_KEY_${name.toUpperCase()}`;
    return {
      name, kind, origin, used_by: used, keyless: false,
      key: stored
        ? { source: "console", problem: null, last4: stored.last4, bound_origin: stored.origin, updated_at: stored.at, updated_by: "owner" }
        : { source: name === "openrouter" ? "env" : "none", problem: null, last4: null, bound_origin: null, updated_at: null, updated_by: null },
      env: { name: env, set: name === "openrouter", origin_ok: name === "openrouter" },
    };
  };
  const keysState = (): LlmKeysState => ({
    writable, reason: writable ? null : "no_secret", keys_version: revision || null, config_version: versions[0].id, config_error: null,
    providers: Object.entries(config().providers).map(([n, s]) => keyRow(n, s)), orphans: [],
    loaded: [{ worker: "worker-1:7", version: String(versions[0].id), preset: "cheap", loaded_at: new Date().toISOString(), error: null,
      keys: "none" }], // this fake worker never catches up: the page says so
  });
  const configState = (): LlmConfigState => ({
    ...clone(STATE), version: versions[0].id, config: clone(config()),
    key_status: Object.fromEntries(Object.keys(config().providers).map((n) => [n, keys.has(n) ? "console" : n === "openrouter" ? "env" : "none"])),
    known_prices: { "claude-haiku-4-5": [1, 5] },
    loaded: [{ ...STATE.loaded[0], version: String(versions[0].id), loaded_at: new Date().toISOString() }],
  });

  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/llm-config" && method === "GET") return reply(200, configState());
    if (path === "/llm-config/versions" && method === "GET") {
      return reply(200, { items: versions.map(({ config: _c, ...v }) => v), next: null }); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
    if (path === "/llm-config/validate" && method === "POST") return reply(200, ok((req.postDataJSON() as { config: LlmConfigDoc }).config));
    if (path === "/llm-config" && method === "POST") {
      const body = req.postDataJSON() as { config: LlmConfigDoc; base_version: number };
      calls.saves.push(body.config);
      const id = versions[0].id + 1;
      versions.unshift({ ...clone(VERSIONS.items[0]), id, created_at: new Date().toISOString(), config: clone(body.config), changes: {} });
      return reply(201, { ...versions[0], config: undefined, workers_notified: true });
    }
    if (path === "/llm-keys" && method === "GET") return reply(200, keysState());
    const named = path.match(/^\/llm-keys\/([a-z][a-z0-9_]*)$/);
    if (named && method === "PUT") {
      const body = req.postDataJSON() as { key: string };
      calls.puts.push({ name: named[1], body, csrf: req.headers()["x-mra-admin"] });
      const spec = config().providers[named[1]];
      if (!spec) return reply(404, { detail: `provider ${named[1]} is not configured` });
      if (!writable) return reply(409, { detail: "LLM_KEYS_SECRET is not set on the server", code: "no_secret" });
      revision += 1;
      const key = body.key.trim();
      keys.set(named[1], { last4: key.slice(-4), origin: originOf(named[1], spec), at: new Date().toISOString() });
      return reply(200, { ...keysState(), workers_notified: true });
    }
    if (named && method === "DELETE") {
      calls.deletes.push(named[1]);
      if (!keys.delete(named[1])) return reply(404, { detail: "no stored key" });
      revision += 1;
      return reply(200, { ...keysState(), workers_notified: true });
    }
    if (path === "/llm-models/test" && method === "POST") return reply(200, { ok: true, latency_ms: 420, cost_usd: 0.0001, model: "m", error: null });
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
  return calls;
}

const tab = (page: Page, name: string) => page.getByRole("group", { name: "ส่วนของหน้า" }).getByRole("button", { name, exact: true });
const providerItem = (page: Page, name: string) =>
  page.getByRole("list", { name: "ผู้ให้บริการ" }).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

async function openProviders(page: Page) {
  await page.goto("/admin/models");
  await expect(page.getByRole("heading", { level: 1, name: "โมเดล" })).toBeVisible();
  await tab(page, "ผู้ให้บริการและคีย์").click();
  await expect(providerItem(page, "openrouter")).toContainText("ใช้ค่าจาก .env");
}

async function audit(page: Page, label: string) {
  await test.step(label, async () => {
    await page.evaluate(() => document.fonts.ready);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), `${label}: serious or critical axe violations`).toEqual([]);
  });
}

test("add DeepSeek from a template, save it, then set, replace and delete its key", async ({ page }) => {
  await mockApi(page);
  const calls = await mockProviders(page);
  await openProviders(page);

  await page.getByLabel("แม่แบบ").selectOption("deepseek");
  await expect(page.getByLabel("base URL")).toHaveValue("https://api.deepseek.com/v1");
  await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
  await expect(providerItem(page, "deepseek")).toContainText("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  expect(calls.saves[0].providers.deepseek).toEqual({ kind: "openai_compatible", base_url: "https://api.deepseek.com/v1", require_parameters: false });
  await page.reload();
  await tab(page, "ผู้ให้บริการและคีย์").click();
  const deepseek = providerItem(page, "deepseek");
  await expect(deepseek).toContainText("ยังไม่มีคีย์");

  await deepseek.getByRole("button", { name: "ใส่คีย์ของ deepseek" }).click();
  await page.getByLabel("คีย์ของ deepseek").fill(KEY);
  await page.getByRole("button", { name: "บันทึกคีย์" }).click();
  await expect(deepseek).toContainText("ตั้งจากหน้านี้ ••••abcd");
  await deepseek.getByRole("button", { name: "เปลี่ยนคีย์ของ deepseek" }).click();
  await expect(page.getByLabel("คีย์ของ deepseek")).toHaveValue(""); // never filled back in
  await page.getByLabel("คีย์ของ deepseek").fill(NEW_KEY);
  await page.getByRole("button", { name: "บันทึกคีย์" }).click();
  await expect(deepseek).toContainText("ตั้งจากหน้านี้ ••••efgh");
  await expect(page.getByRole("list", { name: "worker" }).last()).toContainText("ยังใช้คีย์ชุดเดิม"); // the fake worker is on revision 0
  await deepseek.getByRole("button", { name: "ลบคีย์ของ deepseek" }).click();
  await page.getByRole("button", { name: "ยืนยันลบคีย์" }).click();
  await expect(deepseek).toContainText("ยังไม่มีคีย์");

  expect(calls.puts.map((p) => [p.name, p.body, p.csrf])).toEqual([["deepseek", { key: KEY }, "1"], ["deepseek", { key: NEW_KEY }, "1"]]);
  expect(calls.deletes).toEqual(["deepseek"]);
  const html = await page.content();
  expect(html).not.toContain(KEY);
  expect(html).not.toContain(NEW_KEY);
  expect(calls.unmocked).toEqual([]);
});

test("a role on DeepSeek gets a provider dropdown and price fields in the presets tab", async ({ page }) => {
  await mockApi(page);
  const calls = await mockProviders(page);
  await page.goto("/admin/models");
  await tab(page, "ผู้ให้บริการและคีย์").click();
  await page.getByLabel("แม่แบบ").selectOption("deepseek");
  await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
  await tab(page, "Presets").click();
  await page.getByLabel("provider ของ extractor").selectOption("deepseek");
  await expect(page.getByText("ต้องใส่ราคา input และ output (USD ต่อ 1M token)")).toBeVisible();
  await page.getByLabel("ราคา input ของ extractor (USD ต่อ 1M token)").fill("0.27");
  await page.getByLabel("ราคา output ของ extractor (USD ต่อ 1M token)").fill("1.1");
  await expect(page.getByText("ต้องใส่ราคา")).toHaveCount(0);
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 4 จาก DB")).toBeVisible();
  expect(calls.saves[0].presets.cheap.extractor).toMatchObject({ provider: "deepseek", price_in: 0.27, price_out: 1.1 });
  expect(calls.unmocked).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`providers tab at ${width}px (${scheme}): at rest, key form, a stored key, read-only — no sideways scroll, axe-clean`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      const calls = await mockProviders(page);
      const at = (what: string) => `${what} · ${width}px ${scheme}`;
      await openProviders(page);
      await audit(page, at("at rest"));
      const openrouter = providerItem(page, "openrouter");
      await openrouter.getByRole("button", { name: "ใส่คีย์ของ openrouter" }).click();
      await audit(page, at("key form open"));
      await page.getByLabel("คีย์ของ openrouter").fill(KEY);
      await page.getByRole("button", { name: "บันทึกคีย์" }).click();
      await expect(openrouter).toContainText("ตั้งจากหน้านี้ ••••abcd");
      await openrouter.getByRole("button", { name: "ลบคีย์ของ openrouter" }).click();
      await audit(page, at("a stored key, delete asking to be confirmed"));
      await page.getByLabel("แม่แบบ").selectOption("ollama");
      await page.getByRole("button", { name: "เพิ่มลงร่าง" }).click();
      await expect(providerItem(page, "ollama")).toContainText("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
      await audit(page, at("a provider only in the draft"));
      expect(calls.unmocked).toEqual([]);
    });
  }
  test(`providers tab read-only without LLM_KEYS_SECRET (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await mockProviders(page, { writable: false });
    await openProviders(page);
    await expect(page.getByText("ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET")).toBeVisible();
    await expect(page.getByRole("button", { name: /ใส่คีย์ของ/ })).toHaveCount(0);
    await audit(page, `read-only · ${scheme}`);
  });
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23e/frontend && npx vitest run src/components/admin/models-providers.test.tsx src/components/admin/models-provider-fields.test.tsx src/lib/admin-models-providers.test.ts src/lib/admin-models.test.ts src/components/admin/models-view.test.tsx src/components/admin/models-presets.test.tsx`

Expected: the new test files fail (their modules and the providers tab do not exist yet)

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/admin-types.ts` (3 replacements; each `old` occurs exactly once):

1. Replace

```ts
  reasoning_effort?: string | null; structured_output?: string; timeout_seconds?: number; fallback_models?: string[];
  extra_body?: Record<string, unknown>;
}
export interface LlmConfigDoc {
  active_preset: string; default_provider?: string; providers: Record<string, Record<string, unknown>>;
```

   with

```ts
  reasoning_effort?: string | null; structured_output?: string; timeout_seconds?: number; fallback_models?: string[];
  extra_body?: Record<string, unknown>;
  /** Plan 23e: USD per 1M tokens, both or neither; required off OpenRouter. */
  price_in?: number | null; price_out?: number | null;
}
/** Plan 23e: a provider's kind; the three legacy names have the kind of their name. */
export type ProviderKind = "openrouter" | "anthropic" | "openai_compatible";
export interface LlmConfigDoc {
  active_preset: string; default_provider?: string; providers: Record<string, Record<string, unknown>>;
```

2. Replace

```ts
  worker: string; version: string; preset: string; loaded_at: string; error: string | null;
  settings?: string | null; glossary?: string | null; sources?: string | null; runtime_error?: string | null;
}
export interface LlmConfigState {
  source: "db" | "file"; version: number | null; config: LlmConfigDoc; active_preset: string; env_preset: string | null;
  keys_present: Record<string, boolean>; loaded: LoadedWorker[];
  /** Plan 23c: set when the configuration in use no longer passes validation (a version saved under older rules, or a
   * broken llm.yaml while no version exists). `config` is then as stored and `keys_present` is empty. */
```

   with

```ts
  worker: string; version: string; preset: string; loaded_at: string; error: string | null;
  settings?: string | null; glossary?: string | null; sources?: string | null; runtime_error?: string | null;
  /** Plan 23e: the provider-key revision the worker built its models with ("none" before any key), and why stored
   * keys cannot be used there. */
  keys?: string | null; keys_error?: string | null;
}
/** Plan 23e: one word for a provider's key: where it comes from, or why there is none. */
export type KeyStatus = "console" | "env" | "not_needed" | "none" | "origin_mismatch" | "unreadable" | "env_origin_missing";
export interface LlmConfigState {
  source: "db" | "file"; version: number | null; config: LlmConfigDoc; active_preset: string; env_preset: string | null;
  keys_present: Record<string, boolean>; loaded: LoadedWorker[];
  /** Plan 23e: each provider's key status, and the code's prices of direct Anthropic models (USD per 1M tokens). */
  key_status?: Record<string, KeyStatus>; known_prices?: Record<string, [number, number]>;
  /** Plan 23c: set when the configuration in use no longer passes validation (a version saved under older rules, or a
   * broken llm.yaml while no version exists). `config` is then as stored and `keys_present` is empty. */
```

3. Replace

```ts
}
export interface ProbeResult { ok: boolean; latency_ms: number; cost_usd: number; model: string; error: string | null }
export type LlmDraft = { config: LlmConfigDoc } | { yaml: string };
export interface CatalogQuery { q?: string; structured?: boolean; reasoning?: boolean; max_price?: number | null }
```

   with

```ts
}
export interface ProbeResult { ok: boolean; latency_ms: number; cost_usd: number; model: string; error: string | null }
/** Plan 23e: the provider keys (/api/v1/admin/llm-keys). Mirrors backend/app/api/admin_keys_llm.py. A key is never sent
 * back: only where it comes from, its last 4 characters and the origin it is bound to. */
export interface ProviderKeyRow {
  name: string; kind: ProviderKind; origin: string; used_by: string[]; keyless: boolean;
  key: {
    source: "console" | "env" | "none"; problem: "origin_mismatch" | "unreadable" | "env_origin_missing" | null;
    last4: string | null; bound_origin: string | null; updated_at: string | null; updated_by: string | null;
  };
  env: { name: string; set: boolean; origin_ok: boolean };
}
export interface OrphanKey { name: string; last4: string | null; bound_origin: string | null; updated_at: string | null; unreadable: boolean }
export interface LlmKeysState {
  writable: boolean; reason: "no_secret" | "bad_secret" | null; keys_version: number | null; config_version: number | null;
  config_error: string | null; providers: ProviderKeyRow[]; orphans: OrphanKey[]; loaded: LoadedWorker[];
}
/** The answer of a key write: the whole state, and whether the workers were told (false: they find out within 30 s). */
export type LlmKeysWrite = LlmKeysState & { workers_notified: boolean };
/** A test call: a role of a preset, or (Plan 23e) a provider with a model of its own. */
export type TestBody = Partial<LlmDraft> & { preset?: string } & (
  { role: string } | { provider: string; model: string; price_in?: number; price_out?: number });
export type LlmDraft = { config: LlmConfigDoc } | { yaml: string };
export interface CatalogQuery { q?: string; structured?: boolean; reasoning?: boolean; max_price?: number | null }
```

**Edit** `frontend/src/lib/admin-api.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
  AdminKey, AdminMe, AdminReview, AdminStatus, AuditEntry, CatalogModel, CatalogQuery, Dashboard, FieldError, GlossaryReport, GlossaryState,
  GlossaryTerm, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessStartBody, HarnessState, LlmConfigDoc,
  LlmConfigState, LlmDraft, LlmSaveResult, LlmVersion, MintedKey, Page, ProbeResult, RuntimeKind, RuntimeVersion, SavedVersion,
  SettingValue, SettingsReport, SettingsState, SourcesReport, SourcesState, ValidateReport,
} from "./admin-types";

```

   with

```ts
  AdminKey, AdminMe, AdminReview, AdminStatus, AuditEntry, CatalogModel, CatalogQuery, Dashboard, FieldError, GlossaryReport, GlossaryState,
  GlossaryTerm, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessStartBody, HarnessState, LlmConfigDoc,
  LlmConfigState, LlmDraft, LlmKeysState, LlmKeysWrite, LlmSaveResult, LlmVersion, MintedKey, Page, ProbeResult, RuntimeKind,
  RuntimeVersion, SavedVersion, SettingValue, SettingsReport, SettingsState, SourcesReport, SourcesState, TestBody, ValidateReport,
} from "./admin-types";

```

2. Replace

```ts
    return call<{ items: CatalogModel[]; available: boolean }>(`/llm-models${qs ? `?${qs}` : ""}`);
  },
  testLlm: (body: Partial<LlmDraft> & { preset?: string; role: string }) =>
    call<ProbeResult>("/llm-models/test", send("POST", body)),
  settings: () => call<SettingsState>("/settings"),
  validateSettings: (values: Record<string, SettingValue>) => call<SettingsReport>("/settings/validate", send("POST", { values })),
```

   with

```ts
    return call<{ items: CatalogModel[]; available: boolean }>(`/llm-models${qs ? `?${qs}` : ""}`);
  },
  testLlm: (body: TestBody) => call<ProbeResult>("/llm-models/test", send("POST", body)),
  /** Plan 23e: provider keys. The key travels only in the PUT body and is never answered back. */
  llmKeys: () => call<LlmKeysState>("/llm-keys"),
  setLlmKey: (provider: string, key: string) => call<LlmKeysWrite>(`/llm-keys/${enc(provider)}`, send("PUT", { key })),
  deleteLlmKey: (provider: string) => call<LlmKeysWrite>(`/llm-keys/${enc(provider)}`, send("DELETE")),
  settings: () => call<SettingsState>("/settings"),
  validateSettings: (values: Record<string, SettingValue>) => call<SettingsReport>("/settings/validate", send("POST", { values })),
```

**Edit** `frontend/src/lib/admin-models.ts` (4 replacements; each `old` occurs exactly once):

1. Replace

```ts
import type { LlmConfigDoc, LlmConfigState, LlmRoleSpec } from "./admin-types";

// Mirrors resolve_llm_config in backend/app/services/llm_config.py: which roles a preset resolves, and from what.
```

   with

```ts
import type { KeyStatus, LlmConfigDoc, LlmConfigState, LlmRoleSpec, ProviderKind } from "./admin-types";

// Mirrors resolve_llm_config in backend/app/services/llm_config.py: which roles a preset resolves, and from what.
```

2. Replace

```ts
/** A local server's key is optional, and the backend's validator skips this provider too. */
const KEY_OPTIONAL = "openai_compatible";

/** The provider each role of `preset` really calls (an override's, else the role's own, else the default), sorted and
```

   with

```ts
/** A local server's key is optional, and the backend's validator skips this provider too. */
const KEY_OPTIONAL = "openai_compatible";
/** Mirrors PROVIDER_KEYS and key_env in backend/app/services/llm_config.py (Plan 23e). */
const LEGACY_KEYS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai_compatible: "OPENAI_COMPATIBLE_API_KEY",
};
const DEFAULT_ORIGINS: Record<string, string> = { openrouter: "https://openrouter.ai", anthropic: "https://api.anthropic.com" };
export const PROVIDER_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_PROVIDERS = 12;
/** Statuses with which the provider's roles cannot run. */
const NO_KEY: ReadonlySet<KeyStatus> = new Set<KeyStatus>(["none", "origin_mismatch", "unreadable", "env_origin_missing"]);

/** The one variable a provider's env key may come from. */
export const keyEnv = (name: string): string => LEGACY_KEYS[name] ?? `LLM_KEY_${name.toUpperCase()}`;

/** A provider's kind: its `kind`, or its name for the three legacy names. */
export function providerKind(name: string, spec: Record<string, unknown> | undefined): ProviderKind {
  const kind = spec?.kind;
  return (typeof kind === "string" ? kind : name) as ProviderKind;
}

/** The origin (scheme://host[:port]) a provider's calls go to, which a stored key is bound to; "" when it does not parse. */
export function providerOrigin(name: string, spec: Record<string, unknown> | undefined): string {
  const base = spec?.base_url;
  if (typeof base !== "string" || base === "") return DEFAULT_ORIGINS[providerKind(name, spec)] ?? "";
  try {
    return new URL(base).origin;
  } catch {
    return "";
  }
}

export const KIND_LABEL: Record<ProviderKind, string> = {
  openrouter: "OpenRouter", anthropic: "Anthropic", openai_compatible: "OpenAI-compatible",
};

export interface MissingKey { provider: string; env: string; status: KeyStatus }

/** Providers a role of the running preset uses whose key is missing or unusable (Plan 23e: from `key_status`, which
 * knows console keys, origins and local servers). An answer without `key_status` falls back to `keys_present` by
 * variable name, where the legacy local server never counts and a variable the service did not report is no warning. */
export function missingKeys(state: LlmConfigState): MissingKey[] {
  const out: MissingKey[] = [];
  for (const name of usedProviders(state.config, state.active_preset)) {
    const spec = state.config.providers[name];
    if (!spec) continue;
    const status = state.key_status?.[name];
    if (status !== undefined) {
      if (NO_KEY.has(status)) out.push({ provider: name, env: keyEnv(name), status });
      continue;
    }
    if (name === KEY_OPTIONAL) continue;
    const env = typeof spec.api_key_env === "string" ? spec.api_key_env : keyEnv(name);
    if (state.keys_present[env] === false) out.push({ provider: name, env, status: "none" });
  }
  return out;
}

/** The provider each role of `preset` really calls (an override's, else the role's own, else the default), sorted and
```

3. Replace

```ts

/** Key variables that are not set although a role of the running preset (`state.active_preset`, which the service
 * resolves with LLM_PRESET already) needs them. Providers that are merely declared, and openai_compatible, never
 * appear. A variable the service did not report is not a warning. */
export function missingKeyEnvs(state: LlmConfigState): string[] {
  const missing = new Set<string>();
  for (const name of usedProviders(state.config, state.active_preset)) {
    if (name === KEY_OPTIONAL) continue;
    const env = state.config.providers[name]?.api_key_env;
    if (typeof env === "string" && state.keys_present[env] === false) missing.add(env);
  }
  return [...missing];
}

```

   with

```ts

/** Key variables that are not set although a role of the running preset (`state.active_preset`, which the service
 * resolves with LLM_PRESET already) needs them; missingKeys by variable name. */
export function missingKeyEnvs(state: LlmConfigState): string[] {
  return [...new Set(missingKeys(state).map((m) => m.env))];
}

/** The providers any role of any preset, or an override, uses (removing one of these would break the draft). */
export function providersInUse(config: LlmConfigDoc): Set<string> {
  const used = new Set<string>(Object.keys(config.presets).flatMap((p) => usedProviders(config, p)));
  for (const override of Object.values(config.overrides ?? {})) {
    if (typeof override.provider === "string") used.add(override.provider);
  }
  used.add(config.default_provider ?? DEFAULT_PROVIDER);
  return used;
}

```

4. Replace

```ts
  return { ...clone(doc), active_preset: name };
}
```

   with

```ts
  return { ...clone(doc), active_preset: name };
}

/** Plan 23e: add an OpenAI-compatible provider to the draft (it becomes real with the next saved version). */
export function addProvider(doc: LlmConfigDoc, name: string, baseUrl: string): LlmConfigDoc {
  if (doc.providers[name]) throw new Error(`provider ${name} exists`);
  const out = clone(doc);
  out.providers[name] = { kind: "openai_compatible", base_url: baseUrl, require_parameters: false };
  return out;
}

export function removeProvider(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  if (providersInUse(doc).has(name)) throw new Error(`provider ${name} is in use`);
  const out = clone(doc);
  delete out.providers[name];
  return out;
}
```

**New file** `frontend/src/lib/provider-templates.ts` (complete):

```ts
/** Ready-made OpenAI-compatible providers for the admin models page (Plan 23e). They are editable defaults copied into
 * the draft; the backend neither knows nor trusts them. The base URLs come from Claude's knowledge (2026-06), not a
 * fetch: the first "ทดสอบ" confirms them. `keyFrom` says where the admin gets a key (null: a local server needs none). */
export interface ProviderTemplate { id: string; label: string; name: string; baseUrl: string; keyFrom: string | null }

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: "openai", label: "OpenAI", name: "openai", baseUrl: "https://api.openai.com/v1", keyFrom: "platform.openai.com" },
  { id: "gemini", label: "Gemini (OpenAI-compatible endpoint)", name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", keyFrom: "Google AI Studio" },
  { id: "deepseek", label: "DeepSeek", name: "deepseek", baseUrl: "https://api.deepseek.com/v1", keyFrom: "platform.deepseek.com" },
  { id: "groq", label: "Groq", name: "groq", baseUrl: "https://api.groq.com/openai/v1", keyFrom: "console.groq.com" },
  { id: "mistral", label: "Mistral", name: "mistral", baseUrl: "https://api.mistral.ai/v1", keyFrom: "console.mistral.ai" },
  { id: "together", label: "Together", name: "together", baseUrl: "https://api.together.xyz/v1", keyFrom: "api.together.ai" },
  { id: "ollama", label: "Ollama (เครื่องนี้)", name: "ollama", baseUrl: "http://host.docker.internal:11434/v1", keyFrom: null },
];
```

**Edit** `frontend/src/lib/admin-copy.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
  "glossary.save": "บันทึกอภิธานศัพท์", "glossary.restore": "ย้อนอภิธานศัพท์", "glossary.reset": "กลับไปใช้อภิธานศัพท์ตั้งต้น",
  "harness.start": "เริ่มรัน harness", "harness.cancel": "ยกเลิก harness run",
};

```

   with

```ts
  "glossary.save": "บันทึกอภิธานศัพท์", "glossary.restore": "ย้อนอภิธานศัพท์", "glossary.reset": "กลับไปใช้อภิธานศัพท์ตั้งต้น",
  "harness.start": "เริ่มรัน harness", "harness.cancel": "ยกเลิก harness run",
  "llm_key.set": "ใส่คีย์ผู้ให้บริการ", "llm_key.replace": "เปลี่ยนคีย์ผู้ให้บริการ", "llm_key.delete": "ลบคีย์ผู้ให้บริการ",
  "llm_key.rotate": "เข้ารหัสคีย์ผู้ให้บริการใหม่ (CLI)",
};

```

**Edit** `frontend/src/components/admin/worker-versions.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary" | "sources"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
```

   with

```tsx
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. Plan 23e: field "keys" is the provider-key revision, with keys_error as its failure. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary" | "sources" | "keys"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
```

2. Replace

```tsx
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "glossary" ? "file" : "env");
        const other = version !== expected;
        const changing = other && settling;
        const stale = isStale(w.loaded_at, now);
        const off = (other && !changing) || Boolean(w.runtime_error) || stale;
        return (
          <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-2 py-1" : "text-muted"}>
            {`${w.worker} · ${other ? `ยังใช้ ${version}` : "ตรงกับที่ใช้งาน"} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
            {changing ? ` · กำลังเปลี่ยนเป็น ${expected} (ภายใน 30 วินาที)` : ""}
            {w.runtime_error ? ` · โหลดไม่สำเร็จ: ${w.runtime_error}` : ""}
            {stale ? " · ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)" : ""}
          </li>
```

   with

```tsx
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "glossary" ? "file" : field === "keys" ? "none" : "env");
        const other = version !== expected;
        const changing = other && settling;
        const stale = isStale(w.loaded_at, now);
        const failure = field === "keys" ? w.keys_error : w.runtime_error;
        const off = (other && !changing) || Boolean(failure) || stale;
        const lag = field === "keys" ? "ยังใช้คีย์ชุดเดิม" : `ยังใช้ ${version}`;
        return (
          <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-2 py-1" : "text-muted"}>
            {`${w.worker} · ${other ? lag : "ตรงกับที่ใช้งาน"} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
            {changing ? ` · กำลังเปลี่ยนเป็น ${expected} (ภายใน 30 วินาที)` : ""}
            {failure ? ` · โหลดไม่สำเร็จ: ${failure}` : ""}
            {stale ? " · ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)" : ""}
          </li>
```

**New file** `frontend/src/components/admin/models-providers.tsx` (complete):

```tsx
"use client";

import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import { KIND_LABEL, MAX_PROVIDERS, PROVIDER_NAME, addProvider, providerOrigin, providersInUse, removeProvider } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmKeysState, LlmKeysWrite, OrphanKey, ProbeResult, ProviderKeyRow } from "@/lib/admin-types";
import { PROVIDER_TEMPLATES } from "@/lib/provider-templates";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";
import { WorkerVersions } from "./worker-versions";

/** Why the tab cannot store keys (Plan 23e): the server has no usable LLM_KEYS_SECRET. Deleting still works. */
export const READ_ONLY_TEXT: Record<"no_secret" | "bad_secret", string> = {
  no_secret: "ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET",
  bad_secret: "ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: LLM_KEYS_SECRET ไม่ถูกต้อง",
};
const LEGACY = new Set(["openrouter", "anthropic", "openai_compatible"]);
const CUSTOM = "custom";

/** One line for a provider's key, in Thai. A key itself is never shown: at most its last 4 characters. */
export function keyStatusText(row: ProviderKeyRow): string {
  const { key, env } = row;
  if (key.problem === "origin_mismatch") return `คีย์ที่เก็บไว้ผูกกับ ${key.bound_origin} — ใส่คีย์ใหม่สำหรับ ${row.origin}`;
  if (key.problem === "unreadable") return "ถอดรหัสคีย์ที่เก็บไว้ไม่ได้ (LLM_KEYS_SECRET เปลี่ยนไป) — ใส่ใหม่หรือลบ";
  if (key.problem === "env_origin_missing") return `มี ${env.name} ใน .env แต่ไม่มี ${env.name}_ORIGIN ที่ตรงกับ ${row.origin}`;
  if (key.source === "console") return key.last4 ? `ตั้งจากหน้านี้ ••••${key.last4}` : "ตั้งจากหน้านี้";
  if (key.source === "env") return "ใช้ค่าจาก .env";
  return row.keyless ? "ไม่ต้องใช้คีย์" : "ยังไม่มีคีย์";
}

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
    ? <span className="text-sm">{`ใช้ได้ · ${result.latency_ms} ms · $${result.cost_usd.toFixed(4)}`}</span>
    : <span className="text-sm text-err">{`ใช้ไม่ได้: ${result.error ?? "ไม่ทราบสาเหตุ"}`}</span>;
}

/** One configured provider: its key status and the key and test actions. */
function ProviderRow({ row, draftSpec, writable, onWrite, fail }: {
  row: ProviderKeyRow; draftSpec: Record<string, unknown> | undefined; writable: boolean;
  onWrite: (state: LlmKeysWrite) => void; fail: (e: unknown) => string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [probe, setProbe] = useState<ProbeResult | "running" | null>(null);
  const keyId = useId();
  const modelId = useId();
  const stored = row.key.updated_at !== null;
  const moved = stored && draftSpec !== undefined && providerOrigin(row.name, draftSpec) !== row.origin;
  const problem = row.key.problem !== null || (row.key.source === "none" && !row.keyless);

  function close() {
    setOpen(false);
    setText("");
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onWrite(await adminApi.setLlmKey(row.name, text));
      setOpen(false);
      setError(null);
    } catch (err) {
      setError(fail(err));
    } finally {
      setText(""); // never kept: not after a save, not after a refusal
      setBusy(false);
    }
  }

  async function remove() {
    try {
      onWrite(await adminApi.deleteLlmKey(row.name));
      setError(null);
    } catch (err) {
      setError(fail(err));
    }
  }

  async function test() {
    setProbe("running");
    try {
      const body = row.used_by.length > 0 ? { role: row.used_by[0] } : { provider: row.name, model: model.trim() };
      setProbe(await adminApi.testLlm(body));
    } catch (err) {
      setProbe(null);
      setError(fail(err));
    }
  }

  return (
    <li className="grid gap-2 border-b border-rule py-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)]">
      <div className="min-w-0">
        <p className="font-display font-semibold">{row.name}</p>
        <p className="text-sm text-muted">{`${KIND_LABEL[row.kind] ?? row.kind} · ${row.origin}`}</p>
        <p className="text-sm text-muted">{row.used_by.length > 0 ? `ใช้กับ: ${row.used_by.join(", ")}` : "ยังไม่มี role ใช้"}</p>
      </div>
      <div className="grid min-w-0 gap-2">
        <p className={problem ? "rounded-sm bg-warn-bg px-3 py-1 break-words" : "break-words"}>
          {keyStatusText(row)}
          {stored && row.key.updated_by && row.key.updated_at
            ? <span className="block text-sm text-muted">{`แก้ล่าสุดโดย ${row.key.updated_by} เมื่อ ${formatWhen(row.key.updated_at)}`}</span>
            : null}
        </p>
        {moved && <p className="rounded-sm bg-warn-bg px-3 py-1 text-sm">เมื่อบันทึก คีย์ที่เก็บไว้จะหยุดใช้ (origin ในร่างไม่ตรงกับที่ผูกไว้)</p>}
        {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-1 text-sm">{error}</p>}
        {open ? (
          <form onSubmit={save} className="grid gap-2">
            <label htmlFor={keyId} className="label">{`คีย์ของ ${row.name}`}</label>
            <input id={keyId} type="password" autoComplete="off" spellCheck={false} value={text} className={INPUT}
              onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BUTTON_PRIMARY} disabled={busy || text.trim() === ""}>บันทึกคีย์</button>
              <button type="button" className={BUTTON_GHOST} onClick={close}>ยกเลิก</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {writable && !row.keyless && (
              <button type="button" className={BUTTON_GHOST} aria-label={`${stored ? "เปลี่ยนคีย์" : "ใส่คีย์"}ของ ${row.name}`}
                onClick={() => setOpen(true)}>{stored ? "เปลี่ยนคีย์" : "ใส่คีย์"}</button>
            )}
            {stored && (
              <ConfirmButton label="ลบคีย์" confirmLabel="ยืนยันลบคีย์" name={`ลบคีย์ของ ${row.name}`} onConfirm={remove}
                hint="หลังลบจะใช้คีย์จาก .env ถ้ามี การลบไม่ได้ยกเลิกคีย์ที่ผู้ให้บริการ ให้ยกเลิกที่หน้าเว็บของผู้ให้บริการด้วย" />
            )}
          </div>
        )}
        <div className="grid gap-1">
          {row.used_by.length === 0 && (
            <>
              <label htmlFor={modelId} className="label">{`model สำหรับทดสอบ ${row.name}`}</label>
              <input id={modelId} value={model} className={INPUT} onChange={(e) => setModel(e.target.value)} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_GHOST} aria-label={`ทดสอบ ${row.name}`}
              disabled={probe === "running" || (row.used_by.length === 0 && model.trim() === "")} onClick={test}>ทดสอบ</button>
            <span className="text-sm text-muted">ทดสอบใช้เงินจริงไม่เกิน $0.05</span>
          </div>
          {probe === "running" && <span role="status" className="text-sm text-muted">กำลังทดสอบ…</span>}
          {probe && probe !== "running" && <span role="status"><ProbeLine result={probe} /></span>}
        </div>
      </div>
    </li>
  );
}

function OrphanRow({ orphan, onWrite, fail }: { orphan: OrphanKey; onWrite: (s: LlmKeysWrite) => void; fail: (e: unknown) => string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="grid gap-1 border-b border-rule py-3">
      <p className="break-words">
        <span className="font-display font-semibold">{orphan.name}</span>
        {` · ${orphan.last4 ? `••••${orphan.last4}` : "คีย์ที่เก็บไว้"} · ${orphan.bound_origin ?? ""}`}
        {orphan.unreadable ? " · ถอดรหัสไม่ได้" : ""}
      </p>
      {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-1 text-sm">{error}</p>}
      <div>
        <ConfirmButton label="ลบคีย์" confirmLabel="ยืนยันลบคีย์" name={`ลบคีย์ของ ${orphan.name}`}
          onConfirm={async () => { try { onWrite(await adminApi.deleteLlmKey(orphan.name)); } catch (e) { setError(fail(e)); } }} />
      </div>
    </li>
  );
}

/** "เพิ่มผู้ให้บริการ": an OpenAI-compatible provider from a template (or a name and base URL of one's own) into the
 * draft; the page's save bar makes it a new version. */
function AddProvider({ draft, setDraft }: { draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void }) {
  const [template, setTemplate] = useState(PROVIDER_TEMPLATES[0].id);
  const [name, setName] = useState(PROVIDER_TEMPLATES[0].name);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_TEMPLATES[0].baseUrl);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { template: useId(), name: useId(), url: useId() };
  const chosen = PROVIDER_TEMPLATES.find((t) => t.id === template);

  function pick(id: string) {
    setTemplate(id);
    const t = PROVIDER_TEMPLATES.find((x) => x.id === id);
    setName(t ? t.name : "");
    setBaseUrl(t ? t.baseUrl : "");
    setNote(null);
  }

  function add() {
    const n = name.trim();
    const url = baseUrl.trim();
    if (!PROVIDER_NAME.test(n)) return setNote({ ok: false, text: "ชื่อใช้ได้เฉพาะ a-z, 0-9 และ _ ขึ้นต้นด้วยตัวอักษร ไม่เกิน 32 ตัว" });
    if (draft.providers[n]) return setNote({ ok: false, text: `มีผู้ให้บริการชื่อ ${n} อยู่แล้ว` });
    if (Object.keys(draft.providers).length >= MAX_PROVIDERS) return setNote({ ok: false, text: `มีผู้ให้บริการได้ไม่เกิน ${MAX_PROVIDERS} ราย` });
    if (!/^https?:\/\/\S+$/.test(url)) return setNote({ ok: false, text: "ใส่ base URL ที่ขึ้นต้นด้วย https:// (หรือ http:// สำหรับเครื่องนี้)" });
    setDraft(addProvider(draft, n, url));
    setNote({ ok: true, text: `เพิ่ม ${n} ลงร่างแล้ว: กด "บันทึกเป็นเวอร์ชันใหม่" แล้วจึงใส่คีย์ได้ จากนั้นเลือก ${n} ให้ role ในแท็บ Presets พร้อมราคา` });
  }

  return (
    <section aria-labelledby={`${ids.template}-title`} className="mt-8">
      <h2 id={`${ids.template}-title`} className="font-display text-xl font-semibold">เพิ่มผู้ให้บริการ</h2>
      <p className="mt-1 text-sm text-muted">ผู้ให้บริการที่ใช้ API แบบ OpenAI ค่าในแม่แบบเป็นค่าตั้งต้นที่แก้ได้ กด &quot;ทดสอบ&quot; ครั้งแรกเพื่อยืนยัน</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <label htmlFor={ids.template} className="label">แม่แบบ</label>
          <select id={ids.template} value={template} className={INPUT} onChange={(e) => pick(e.target.value)}>
            {PROVIDER_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value={CUSTOM}>กำหนดเอง</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.name} className="label">ชื่อ</label>
          <input id={ids.name} value={name} className={INPUT} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.url} className="label">base URL</label>
          <input id={ids.url} value={baseUrl} className={INPUT} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      </div>
      {chosen && <p className="mt-2 text-sm text-muted">{chosen.keyFrom ? `ขอคีย์ได้ที่ ${chosen.keyFrom}` : "เซิร์ฟเวอร์ในเครื่องไม่ต้องใช้คีย์ (ราคา 0)"}</p>}
      <div className="mt-3"><button type="button" className={BUTTON_PRIMARY} onClick={add}>เพิ่มลงร่าง</button></div>
      {note && <p role="status" className={`mt-3 rounded-sm px-3 py-2 ${note.ok ? "bg-info-bg" : "bg-warn-bg"}`}>{note.text}</p>}
    </section>
  );
}

/** The "ผู้ให้บริการและคีย์" tab (Plan 23e): each provider's key status, write-only key entry, delete and a test call;
 * providers that exist only in the unsaved draft; adding a provider from a template; and which key revision each
 * worker runs. A key typed here is sent once and never shown again. */
export function ModelsProviders({ draft, setDraft, fail }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
}) {
  const [state, setState] = useState<LlmKeysState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => adminApi.llmKeys()
    .then((s) => { setState(s); setReadAt(Date.now()); setError(null); })
    .catch((e: unknown) => setError(fail(e))), [fail]);
  useEffect(() => { void load(); }, [load]);

  const wrote = useCallback((s: LlmKeysWrite) => {
    setState(s);
    setReadAt(Date.now());
    setNote(s.workers_notified ? "บันทึกแล้ว: worker ใช้คีย์ชุดนี้ตั้งแต่งานถัดไป (ภายใน 30 วินาที) รีวิวที่กำลังทำอยู่ใช้คีย์เดิมจนจบ" : WORKERS_NOT_NOTIFIED);
  }, []);

  if (!state) {
    return error ? <p role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">{error}</p>
      : <p role="status" className="mt-6 text-muted">กำลังโหลด…</p>;
  }
  const saved = new Set(state.providers.map((p) => p.name));
  const draftOnly = Object.keys(draft.providers).filter((n) => !saved.has(n));
  const inUse = providersInUse(draft);
  const expected = state.keys_version === null ? "none" : String(state.keys_version);

  return (
    <section aria-label="ผู้ให้บริการและคีย์" className="mt-6">
      {state.reason && (
        <div className="rounded-sm bg-warn-bg px-4 py-3">
          <p>{READ_ONLY_TEXT[state.reason]}</p>
          <p className="text-sm">ดูวิธีสร้างใน .env.example (ลบคีย์ที่เก็บไว้ได้เสมอ)</p>
        </div>
      )}
      {state.config_error && <p className="mt-3 rounded-sm bg-warn-bg px-4 py-2">{`อ่านการตั้งค่าที่ใช้อยู่ไม่ได้: ${state.config_error}`}</p>}
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {note && <p role="status" className="mt-3 rounded-sm bg-info-bg px-4 py-2">{note}</p>}
      <p className="mt-3 text-sm text-muted">
        คีย์ที่ใส่จากหน้านี้เก็บแบบเข้ารหัสและใช้แทนคีย์ใน .env ระบบไม่แสดงคีย์กลับมาอีก (เห็นได้แค่ 4 ตัวท้าย)
        คีย์ผูกกับ origin ของผู้ให้บริการ ถ้าเปลี่ยน base_url ไป origin อื่นต้องใส่คีย์ใหม่
      </p>
      <ul aria-label="ผู้ให้บริการ" className="mt-3 border-t border-rule">
        {state.providers.map((row) => (
          <ProviderRow key={row.name} row={row} draftSpec={draft.providers[row.name]} writable={state.writable}
            onWrite={wrote} fail={fail} />
        ))}
        {draftOnly.map((name) => (
          <li key={name} className="grid gap-2 border-b border-rule py-4">
            <p><span className="font-display font-semibold">{name}</span>{` · ${providerOrigin(name, draft.providers[name])}`}</p>
            <p className="text-sm">บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้</p>
            {!LEGACY.has(name) && (
              <div>
                <button type="button" className={BUTTON_GHOST} disabled={inUse.has(name)}
                  onClick={() => setDraft(removeProvider(draft, name))}>{`เอา ${name} ออกจากร่าง`}</button>
                {inUse.has(name) && <span className="ml-2 text-sm text-muted">มี role ใช้อยู่ เปลี่ยน role ก่อน</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {state.orphans.length > 0 && (
        <section aria-label="คีย์ของผู้ให้บริการที่ไม่มีในการตั้งค่าแล้ว" className="mt-6">
          <h2 className="font-display text-xl font-semibold">คีย์ที่ค้างอยู่</h2>
          <p className="text-sm text-muted">ผู้ให้บริการเหล่านี้ไม่มีในการตั้งค่าที่ใช้อยู่แล้ว ลบคีย์ได้</p>
          <ul className="mt-2 border-t border-rule">
            {state.orphans.map((o) => <OrphanRow key={o.name} orphan={o} onWrite={wrote} fail={fail} />)}
          </ul>
        </section>
      )}
      <AddProvider draft={draft} setDraft={setDraft} />
      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">คีย์ที่ worker ใช้</h2>
        <WorkerVersions loaded={state.loaded} field="keys" expected={expected} now={readAt} />
      </section>
    </section>
  );
}
```

**Edit** `frontend/src/components/admin/models-presets.tsx` (4 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { ROLE_ORDER, copyPreset, deletePreset, setActive, setRole } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmRoleSpec, ProbeResult } from "@/lib/admin-types";
import { ConfirmButton } from "./confirm-button";
```

   with

```tsx
import { useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { KIND_LABEL, ROLE_ORDER, copyPreset, deletePreset, providerKind, setActive, setRole } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmRoleSpec, ProbeResult } from "@/lib/admin-types";
import { ConfirmButton } from "./confirm-button";
```

2. Replace

```tsx
}

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
```

   with

```tsx
}

/** Plan 23e: a role's provider, picked from the draft's providers ("" = the default provider), and its prices when the
 * provider is not OpenRouter (USD per 1M tokens; required there, so the review cost cap counts the calls). An Anthropic
 * model the code prices already shows that price as the placeholder. */
function ProviderCell({ role, spec, draft, knownPrices, edit }: {
  role: string; spec: LlmRoleSpec; draft: LlmConfigDoc; knownPrices?: Record<string, [number, number]>;
  edit: (role: string, patch: Partial<LlmRoleSpec>) => void;
}) {
  const names = Object.keys(draft.providers);
  const chosen = spec.provider ?? "";
  const options = chosen && !names.includes(chosen) ? [...names, chosen] : names;
  const effective = chosen || draft.default_provider || "openrouter";
  const kind = providerKind(effective, draft.providers[effective]);
  const known = kind === "anthropic" ? knownPrices?.[spec.model] : undefined;
  const unpriced = kind !== "openrouter" && !known && (spec.price_in == null || spec.price_out == null);
  return (
    <div className="grid gap-1">
      <select aria-label={`provider ของ ${role}`} value={chosen} className={`${INPUT} w-44`}
        onChange={(e) => edit(role, { provider: e.target.value || null })}>
        <option value="">{`ค่าเริ่มต้น (${draft.default_provider ?? "openrouter"})`}</option>
        {options.map((name) => {
          const k = providerKind(name, draft.providers[name]);
          return <option key={name} value={name}>{`${name} (${KIND_LABEL[k] ?? k})`}</option>;
        })}
      </select>
      {kind !== "openrouter" && (
        <div className="grid grid-cols-2 gap-1">
          <input aria-label={`ราคา input ของ ${role} (USD ต่อ 1M token)`} type="number" min={0} max={1000} step={0.01}
            className={`${INPUT} w-24`} placeholder={known ? String(known[0]) : "input"} value={spec.price_in ?? ""}
            onChange={(e) => edit(role, { price_in: num(e.target.value) ?? null })} />
          <input aria-label={`ราคา output ของ ${role} (USD ต่อ 1M token)`} type="number" min={0} max={1000} step={0.01}
            className={`${INPUT} w-24`} placeholder={known ? String(known[1]) : "output"} value={spec.price_out ?? ""}
            onChange={(e) => edit(role, { price_out: num(e.target.value) ?? null })} />
        </div>
      )}
      {unpriced && <span className="text-sm text-err">ต้องใส่ราคา input และ output (USD ต่อ 1M token)</span>}
    </div>
  );
}

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
```

3. Replace

```tsx

/** The presets tab: pick a preset, edit its roles in the draft, copy, delete, make it active, test a role. */
export function ModelsPresets({ draft, setDraft, fail }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
}) {
  const [preset, setPreset] = useState(draft.active_preset);
```

   with

```tsx

/** The presets tab: pick a preset, edit its roles in the draft, copy, delete, make it active, test a role. */
export function ModelsPresets({ draft, setDraft, fail, knownPrices }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
  /** Plan 23e: the code's prices of direct Anthropic models, by model id (USD per 1M tokens, input and output). */
  knownPrices?: Record<string, [number, number]>;
}) {
  const [preset, setPreset] = useState(draft.active_preset);
```

4. Replace

```tsx
                  <td className={TD}><input aria-label={`model ของ ${role}`} value={spec.model} className={INPUT}
                    onChange={(e) => edit(role, { model: e.target.value })} /></td>
                  <td className={TD}><input aria-label={`provider ของ ${role}`} value={spec.provider ?? ""} className={`${INPUT} w-32`}
                    placeholder={draft.default_provider ?? "openrouter"} onChange={(e) => edit(role, { provider: e.target.value || null })} /></td>
                  <td className={TD}><input aria-label={`max_tokens ของ ${role}`} type="number" min={1} max={128000} className={`${INPUT} w-28`}
                    value={spec.max_tokens ?? ""} onChange={(e) => edit(role, { max_tokens: num(e.target.value) })} /></td>
```

   with

```tsx
                  <td className={TD}><input aria-label={`model ของ ${role}`} value={spec.model} className={INPUT}
                    onChange={(e) => edit(role, { model: e.target.value })} /></td>
                  <td className={TD}><ProviderCell role={role} spec={spec} draft={draft} knownPrices={knownPrices} edit={edit} /></td>
                  <td className={TD}><input aria-label={`max_tokens ของ ${role}`} type="number" min={1} max={128000} className={`${INPUT} w-28`}
                    value={spec.max_tokens ?? ""} onChange={(e) => edit(role, { max_tokens: num(e.target.value) })} /></td>
```

**Edit** `frontend/src/components/admin/models-view.tsx` (7 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { missingKeyEnvs, sameConfig } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";
```

   with

```tsx
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { type MissingKey, missingKeys, sameConfig } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";
```

2. Replace

```tsx
import { ModelsHistory } from "./models-history";
import { ModelsPresets } from "./models-presets";
import { ModelsSaveBar, type WriteTracker } from "./models-save-bar";
import { ModelsYaml } from "./models-yaml";
```

   with

```tsx
import { ModelsHistory } from "./models-history";
import { ModelsPresets } from "./models-presets";
import { ModelsProviders } from "./models-providers";
import { ModelsSaveBar, type WriteTracker } from "./models-save-bar";
import { ModelsYaml } from "./models-yaml";
```

3. Replace

```tsx
import { useWorkerFollowUp } from "./use-worker-follow-up";

export type ModelsTab = "presets" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [["presets", "Presets"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"]];

/** Why the save is refused while the YAML box holds text that is not the draft. */
```

   with

```tsx
import { useWorkerFollowUp } from "./use-worker-follow-up";

export type ModelsTab = "presets" | "providers" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [
  ["presets", "Presets"], ["providers", "ผู้ให้บริการและคีย์"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"],
];

/** A header warning for a provider the running preset uses without a usable key (Plan 23e). */
function missingKeyText({ provider, env, status }: MissingKey): string {
  const cannot = "role ที่ใช้ provider นี้จะรันไม่ได้";
  if (status === "origin_mismatch") return `${provider}: คีย์ที่เก็บไว้ผูกกับ origin อื่น: ${cannot}`;
  if (status === "unreadable") return `${provider}: ถอดรหัสคีย์ที่เก็บไว้ไม่ได้: ${cannot}`;
  if (status === "env_origin_missing") return `${provider}: ${env}_ORIGIN ไม่ตรงกับ origin ของ provider: ${cannot}`;
  if (env.startsWith("LLM_KEY_")) return `${provider}: ยังไม่มีคีย์ (ใส่ได้ที่แท็บ "ผู้ให้บริการและคีย์"): ${cannot}`;
  return `${env} ยังไม่ได้ตั้ง: ${cannot}`; // a legacy name: worded as before Plan 23e
}

/** Why the save is refused while the YAML box holds text that is not the draft. */
```

4. Replace

```tsx
  const [mountedAt] = useState(() => Date.now());
  const at = now ?? mountedAt;
  const missing = missingKeyEnvs(state);
  const wanted = wantedVersion(state);
  return (
```

   with

```tsx
  const [mountedAt] = useState(() => Date.now());
  const at = now ?? mountedAt;
  const missing = missingKeys(state);
  const wanted = wantedVersion(state);
  return (
```

5. Replace

```tsx
        ? <p className="rounded-sm bg-info-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} มีผลอยู่ (ใช้ llm.yaml)`}</p>
        : <p className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} ไม่มีใน presets: worker จะเริ่มไม่ได้`}</p>)}
      {missing.map((name) => (
        <p key={name} className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`${name} ยังไม่ได้ตั้ง: role ที่ใช้ provider นี้จะรันไม่ได้`}</p>
      ))}
      <ul className="text-sm" aria-label="worker">
```

   with

```tsx
        ? <p className="rounded-sm bg-info-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} มีผลอยู่ (ใช้ llm.yaml)`}</p>
        : <p className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} ไม่มีใน presets: worker จะเริ่มไม่ได้`}</p>)}
      {missing.map((m) => (
        <p key={m.provider} className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{missingKeyText(m)}</p>
      ))}
      <ul className="text-sm" aria-label="worker">
```

6. Replace

```tsx
          </div>
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} writes={track} />}
          {tab === "presets" && <ModelsPresets draft={edit.doc} setDraft={setDraft} fail={fail} />}
          {(tab === "yaml" || yamlPending) && (
            <div hidden={tab !== "yaml"}>
```

   with

```tsx
          </div>
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} writes={track} />}
          {tab === "presets" && <ModelsPresets draft={edit.doc} setDraft={setDraft} fail={fail} knownPrices={state.known_prices} />}
          {tab === "providers" && <ModelsProviders draft={edit.doc} setDraft={setDraft} fail={fail} />}
          {(tab === "yaml" || yamlPending) && (
            <div hidden={tab !== "yaml"}>
```

7. Replace

```tsx
          )}
          {tab === "catalog" && <ModelsCatalog draft={edit.doc} setDraft={setDraft} />}
          {(tab === "presets" || tab === "yaml") && (
            <>
              {moved && (
```

   with

```tsx
          )}
          {tab === "catalog" && <ModelsCatalog draft={edit.doc} setDraft={setDraft} />}
          {(tab === "presets" || tab === "providers" || tab === "yaml") && (
            <>
              {moved && (
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23e/frontend && npx vitest run src/components/admin/models-providers.test.tsx src/components/admin/models-provider-fields.test.tsx src/lib/admin-models-providers.test.ts src/lib/admin-models.test.ts src/components/admin/models-view.test.tsx src/components/admin/models-presets.test.tsx`

Expected: 6 files, 122 tests passed

- [ ] **Step 5: The full frontend suite, typecheck, lint and the touched e2e specs**

Run: `cd /d/MRA-plan-23e/frontend && npm test && npm run typecheck && npm run lint`

Then the two e2e specs this plan touches (they build the app and serve it with a mocked API; Docker is not used). When port 3100 is free:

```bash
cd /d/MRA-plan-23e/frontend && npx playwright test e2e/admin-providers.spec.ts e2e/admin-models.spec.ts
```

When 3100 is taken, write this file with the Write tool to `D:\MRA-plan-23e\frontend\pw-alt.config.mjs`, run `npx playwright test -c pw-alt.config.mjs e2e/admin-providers.spec.ts e2e/admin-models.spec.ts`, then delete it (it is never committed):

```js
import { defineConfig, devices } from "@playwright/test";
const PORT = 3123;
export default defineConfig({
  testDir: "./e2e", outputDir: "./test-results", fullyParallel: true, retries: 0, reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: `npm run build && npx next start -p ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: false,
    timeout: 300000, env: { PUBLIC_API_URL: "http://api.mock" } },
});
```

Expected: frontend 158 files, 1684 tests, all passing except the known-flaky timeouts (pre-flight: 3, which passed alone); typecheck and eslint clean; e2e 19 passed (both specs, 1440 and 390 px, light and dark).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(web): providers and keys tab, provider dropdown and prices in presets (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add frontend/src/components/admin/models-providers.test.tsx frontend/src/components/admin/models-provider-fields.test.tsx frontend/src/lib/admin-models-providers.test.ts frontend/src/test/admin-keys-fixtures.ts frontend/e2e/admin-providers.spec.ts frontend/src/lib/admin-types.ts frontend/src/lib/admin-api.ts frontend/src/lib/admin-models.ts frontend/src/lib/provider-templates.ts frontend/src/lib/admin-copy.ts frontend/src/components/admin/worker-versions.tsx frontend/src/components/admin/models-providers.tsx frontend/src/components/admin/models-presets.tsx frontend/src/components/admin/models-view.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 7: Docs and final checks

**Files:**
- Modify: `docs/api.md`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `backend/app/services/runtime_settings.py` (docstring only)
- Test (create): `backend/tests/unit/test_provider_keys_docs.py`

**Interfaces:**
- Consumes: the behaviour of Tasks 1–6; `BODY_MAX`, `KEY_RATE` (`app/api/admin_keys_llm.py`), `MAX_PROVIDERS`, `PROVIDER_NAME`, `KEY_MIN`, `KEY_MAX`, `KEY_TEXT_ERROR`, `KEYS_VERSION_KEY`.
- Produces: the "Provider keys (Plan 23e)" section of `docs/api.md` and the matching edits in "Model management" (routes table, state, documents, validate, test call, workers); `LLM_KEYS_SECRET` and an `LLM_KEY_<NAME>`/`_ORIGIN` example in `.env.example`; one README line; the `runtime_settings.py` docstring no longer lists provider keys as env-only; a docs test.

This task ends at the docs commit and the final checks. The merge, the root `CLAUDE.md` lines, the secret in `.env`,
the docker rebuild and the smoke check are done by the controller afterwards (see "After the plan (controller)"
below); the implementer does none of them.

- [ ] **Step 1: Docs**

**Edit** `docs/api.md` (6 replacements; each `old` occurs exactly once):

1. Replace

```markdown
| `POST /admin/llm-config/reset` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/llm-models?q=&structured=&reasoning=&max_price=&limit=100` (1–500) | 200 `{items, available}`, the OpenRouter catalog | 401, 403, 422 |
| `POST /admin/llm-models/test` `{config \| yaml, preset?, role}` (the document is optional) | 200 `{ok, latency_ms, cost_usd, model, error}` | 401, 403, 422, 429 |

**State.** `GET /admin/llm-config` answers `{source, version, config, active_preset, env_preset, keys_present, loaded, error}`:
- `source` is `"db"` (a saved version is in use) or `"file"` (none is saved, so `llm.yaml` is in use). `version` is
  that version's id, or null for `"file"`. `config` is the document in use.
- `active_preset` is the preset the workers run: `LLM_PRESET` while `llm.yaml` is the source, otherwise the version's
  own `active_preset`. `env_preset` is the `LLM_PRESET` setting (null when unset), reported even when it is ignored.
- `keys_present` is `{ENV_NAME: bool}` for the key variable of each configured provider. Provider API keys never reach
  the database, the API or the console; the console sees only whether each one is set.
- `loaded` lists the workers, see "Workers" below.
- `error` is null normally. When the newest saved version, or `llm.yaml` while no version is saved, no longer passes validation, the route still answers **200** with the stored `config`, an empty `keys_present` and `error` set to the reason, and the console offers restore and reset. The reason is one line: a schema error names the field path and the rule (plus a count of further errors), never the stored value or a YAML snippet.
```

   with

```markdown
| `POST /admin/llm-config/reset` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/llm-models?q=&structured=&reasoning=&max_price=&limit=100` (1–500) | 200 `{items, available}`, the OpenRouter catalog | 401, 403, 422 |
| `POST /admin/llm-models/test` `{config \| yaml, preset?, role}` or (Plan 23e) `{config \| yaml, provider, model, price_in?, price_out?}` (the document is optional) | 200 `{ok, latency_ms, cost_usd, model, error}` | 401, 403, 422, 429 |

**State.** `GET /admin/llm-config` answers `{source, version, config, active_preset, env_preset, keys_present, key_status, known_prices, loaded, error}`:
- `source` is `"db"` (a saved version is in use) or `"file"` (none is saved, so `llm.yaml` is in use). `version` is
  that version's id, or null for `"file"`. `config` is the document in use.
- `active_preset` is the preset the workers run: `LLM_PRESET` while `llm.yaml` is the source, otherwise the version's
  own `active_preset`. `env_preset` is the `LLM_PRESET` setting (null when unset), reported even when it is ignored.
- `keys_present` is `{ENV_NAME: bool}` for the key variable of each configured provider (`LLM_KEY_<NAME>` for a provider
  with a free name): true when a key resolves for it, from the console or from env (Plan 23e). `key_status` is
  `{provider: console | env | not_needed | none | origin_mismatch | unreadable | env_origin_missing}` (see "Provider
  keys (Plan 23e)"). `known_prices` is `{model: [input, output]}`, the code's prices of direct Anthropic models in USD
  per 1M tokens. No key ever reaches an answer; the console sees only where each one comes from.
- `loaded` lists the workers, see "Workers" below.
- `error` is null normally. When the newest saved version, or `llm.yaml` while no version is saved, no longer passes validation, the route still answers **200** with the stored `config`, an empty `keys_present` and `error` set to the reason, and the console offers restore and reset. The reason is one line: a schema error names the field path and the rule (plus a count of further errors), never the stored value or a YAML snippet.
```

2. Replace

```markdown
- Each provider is pinned to its own key name: `openrouter` uses `OPENROUTER_API_KEY`, `anthropic` uses
  `ANTHROPIC_API_KEY` and `openai_compatible` uses `OPENAI_COMPATIBLE_API_KEY`. A draft cannot name another variable,
  so it cannot make the server send another secret, or one provider's key to another host.
- The `openrouter` and `anthropic` hosts are pinned: a `base_url`, when given, must be `https://openrouter.ai/…` and
  `https://api.anthropic.com/…` respectively (the whole host; no user info, port or look-alike suffix). The `openrouter`
```

   with

```markdown
- Each provider is pinned to its own key name: `openrouter` uses `OPENROUTER_API_KEY`, `anthropic` uses
  `ANTHROPIC_API_KEY` and `openai_compatible` uses `OPENAI_COMPATIBLE_API_KEY`. A draft cannot name another variable,
  so it cannot make the server send another secret, or one provider's key to another host. Since Plan 23e
  `api_key_env` may be left out, and a provider may have a free name with a `kind` (see "Provider keys (Plan 23e)"):
  its only variable is `LLM_KEY_<NAME>`.
- The `openrouter` and `anthropic` hosts are pinned: a `base_url`, when given, must be `https://openrouter.ai/…` and
  `https://api.anthropic.com/…` respectively (the whole host; no user info, port or look-alike suffix). The `openrouter`
```

3. Replace

```markdown

**Validate.** `POST /admin/llm-config/validate` checks a draft and saves nothing. A document that breaks one of the
rules above answers **200** `{ok: false, errors: [message], warnings: [], cost: {}, config: null, yaml: null}`. The
YAML-text refusals listed under "Documents" (text that does not parse, is not a mapping, an alias, `!!binary`, nesting
too deep), and a body with both or neither of `config` and `yaml`, are 422. For a valid draft:
```

   with

```markdown

**Validate.** `POST /admin/llm-config/validate` checks a draft and saves nothing. A document that breaks one of the
rules above answers **200** `{ok: false, errors: [message], warnings: [], cost: {}, config: null, yaml: null}`. Since
Plan 23e that includes every role off OpenRouter without `price_in` and `price_out` and a `default_provider` that is not
configured (`errors` may then hold several messages; save, restore and reset refuse the same document with 422). The
YAML-text refusals listed under "Documents" (text that does not parse, is not a mapping, an alias, `!!binary`, nesting
too deep), and a body with both or neither of `config` and `yaml`, are 422. For a valid draft:
```

4. Replace

```markdown
  not parse. A request body that fails the route's own schema, and a refused sign-in or CSRF header (401, 403), use none.
- Every answered test writes an `llm.test` audit row of its own: `target_type` `llm_model`, `target_id` the model id (cut
  to 64 characters) and `after` `{preset, role, provider, base_url_host, ok, cost_usd}`. `base_url_host` is only the host
  of the role's `base_url` (null without one), never the key or the full URL.

**Audit.** Save, restore and reset write `llm_config.save`, `llm_config.restore` and `llm_config.reset` with
```

   with

```markdown
  not parse. A request body that fails the route's own schema, and a refused sign-in or CSRF header (401, 403), use none.
- Every answered test writes an `llm.test` audit row of its own: `target_type` `llm_model`, `target_id` the model id (cut
  to 64 characters) and `after` `{preset, role, provider, kind, key_source, base_url_host, ok, cost_usd}`.
  `base_url_host` is only the host of the role's `base_url` (null without one), never the key or the full URL;
  `key_source` is `console`, `env` or `none` (Plan 23e).
- Plan 23e: instead of `role`, a body may name a configured `provider` and a `model` (with optional `price_in` and
  `price_out`), so a key can be tried before any preset uses it (`role` in the audit row is then `test`). Send one of
  the two forms; both or neither is 422, as is an unknown provider. Keys are resolved as a worker would, so a draft that
  moves a provider's `base_url` to another origin is tested without its stored key.

**Audit.** Save, restore and reset write `llm_config.save`, `llm_config.restore` and `llm_config.reset` with
```

5. Replace

```markdown
- A worker started with `GRAPH_MODE=stub` records the version it sees without building any LLM.
- Each worker reports itself in the Redis hash `mra:llm:loaded`. The field is `<hostname>:<pid>` and the value is JSON
  `{version, preset, loaded_at, error, settings, glossary, runtime_error}` (the last three came with Plan 23c, see
  "Runtime settings, glossary and harness"). `version` is the id as text or `"file"`, and `error` is null or the last error
  (up to 300 characters). A worker reports at start, after each reload and at every 30-second check, so `loaded_at`
  means **last seen**, not when the version was loaded. A worker that shuts down cleanly removes its entry.
  `GET /admin/llm-config` returns the entries as
  `loaded: [{worker, version, preset, loaded_at, error, settings, glossary, runtime_error}]`, leaving out
  those not refreshed for 3 minutes (Plan 30; six missed checks) and removing them, and any entry that does not parse,
  from the hash; the console calls a worker "not reporting" after 2 minutes.
```

   with

```markdown
- A worker started with `GRAPH_MODE=stub` records the version it sees without building any LLM.
- Each worker reports itself in the Redis hash `mra:llm:loaded`. The field is `<hostname>:<pid>` and the value is JSON
  `{version, preset, loaded_at, error, settings, glossary, runtime_error, sources, keys, keys_error}` (settings,
  glossary and runtime_error came with Plan 23c, sources with 23d, keys and keys_error with 23e: see "Provider keys
  (Plan 23e)"). `version` is the id as text or `"file"`, and `error` is null or the last error
  (up to 300 characters). A worker reports at start, after each reload and at every 30-second check, so `loaded_at`
  means **last seen**, not when the version was loaded. A worker that shuts down cleanly removes its entry.
  `GET /admin/llm-config` returns the entries as
  `loaded: [{worker, version, preset, loaded_at, error, settings, glossary, runtime_error, sources, keys, keys_error}]`, leaving out
  those not refreshed for 3 minutes (Plan 30; six missed checks) and removing them, and any entry that does not parse,
  from the hash; the console calls a worker "not reporting" after 2 minutes.
```

6. Replace

```markdown
  environment (an env change after the save); env's engines are then searched until a version that turns one on is
  saved. A stored entry that no longer validates is skipped; neither ever answers 500.

## Paper count and pool (Plan 21)
```

   with

```markdown
  environment (an env change after the save); env's engines are then searched until a version that turns one on is
  saved. A stored entry that no longer validates is skipped; neither ever answers 500.

### Provider keys (Plan 23e)

The Models page has a tab "ผู้ให้บริการและคีย์": an admin enters, replaces or removes an LLM provider's API key there,
adds an OpenAI-compatible provider from a template, and tests it, without editing `.env` or restarting anything.

| Method and path | Success | Errors |
|---|---|---|
| `GET /admin/llm-keys` | 200 the state below | 401, 403 |
| `PUT /admin/llm-keys/{provider}` `{"key": "..."}` | 200 the state plus `workers_notified` | 401, 403, 404, 409, 422, 429 |
| `DELETE /admin/llm-keys/{provider}` | 200 the state plus `workers_notified` | 401, 403, 404, 422, 429 |

- **Write-only.** A key is never answered back, logged, written to the audit log or to Redis. The state shows where
  each key comes from, its last 4 characters (none for a key under 12 characters) and the origin it is bound to.
- **Storage.** Keys live in the `llm_provider_keys` table, one row per provider name, outside the config versions (a
  restore never brings an old key back). Each is a Fernet token of `{"v": 1, "provider", "origin", "key"}` under
  `LLM_KEYS_SECRET`: one or more comma-separated Fernet keys (newest first; the first encrypts, all decrypt), env
  only, read once per process. Generate one with `python -m app.cli.admin llm-keys-secret`. To rotate, put a new key
  in front (`new,old`), restart, run `python -m app.cli.admin rotate-llm-keys` (audited as `llm_key.rotate`), then
  remove the old key and restart again. Losing the secret makes the stored keys unreadable: enter them again (keep a
  backup of `.env`; a database backup alone holds only ciphertext).
- **Without a usable secret** the tab is read-only: `GET` answers `writable: false` with `reason` `no_secret` or
  `bad_secret`, `PUT` is **409** `{detail, code}` with the same code, and `DELETE` still works (it needs no secret).
- **PUT body.** Read by the handler itself (at most 4 KiB, a JSON object with `key`), never by a schema, because a
  schema's 422 quotes the refused input. The key is stripped of surrounding whitespace and must then be 8 to 512
  visible ASCII characters without spaces; otherwise **422** with the fixed message
  "the key must be 8 to 512 visible characters without spaces".
  A body that is not such an object is a fixed 422 too. `{provider}` must be a provider
  name (`^[a-z][a-z0-9_]{0,31}$`, else 422) configured in the version in use (else **404**: save a version with it
  first). At most **20 key changes per hour per admin** (PUT and DELETE together), else **429** with `Retry-After`.
- **DELETE** keeps the row as a tombstone (no key, a new revision) and answers 404 when there is no stored key. It
  works for a provider no longer configured (an "orphan"). It does not revoke the key at the provider.
- **Audit.** `llm_key.set`, `llm_key.replace` and `llm_key.delete`, `target_type` `llm_key`, `target_id` the provider;
  `after` is `{provider, kind, origin, revision}` (delete: `{provider, revision}`), never any part of the key.
  `api_key`, `ciphertext` and `llm_keys_secret` are also dropped from every audit row by name.

**State.** `{writable, reason, keys_version, config_version, config_error, providers, orphans, loaded}`:
- `providers`: one entry per provider of the configuration in use, `{name, kind, origin, used_by, keyless, key, env}`.
  `used_by` lists the roles of the running preset that call it; `keyless` is true for a local server that needs no key.
  `key` is `{source, problem, last4, bound_origin, updated_at, updated_by}`: `source` `console`, `env` or `none`;
  `problem` null, `origin_mismatch` (the stored key belongs to another origin), `unreadable` (it cannot be decrypted)
  or `env_origin_missing` (`LLM_KEY_<NAME>` is set without a matching `LLM_KEY_<NAME>_ORIGIN`). `env` is
  `{name, set, origin_ok}`: the variable, whether it is non-empty, and whether its origin matches.
- `orphans`: stored keys of providers no longer configured, `{name, last4, bound_origin, updated_at, unreadable}`.
- `keys_version` is the newest revision (null before any key was stored); `loaded` are the worker reports.

**Which key a call uses.** A console key whose bound origin equals the provider's origin; else, when a console key is
bound to another origin, none (no fallback to env, or a `base_url` change would redirect the env key); else the env
key. `openrouter`, `anthropic` and `openai_compatible` read `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and
`OPENAI_COMPATIBLE_API_KEY` as before. A provider with a free name reads only `LLM_KEY_<NAME>` from the process
environment, and only when `LLM_KEY_<NAME>_ORIGIN` is its origin. The origin is `scheme://host[:port]` of `base_url`
(default port dropped; a path change keeps it), or `https://openrouter.ai` and `https://api.anthropic.com` for those
two without a `base_url`. A free-named provider on a public host with no key gets no anonymous call; a local server
(http to `localhost`, `127.0.0.1`, `::1` or `host.docker.internal`, or the legacy `openai_compatible` entry) is sent
`not-needed`. Provider error text is redacted with the key (the key and any 12-character slice of it) before it is
shown or logged.

**Providers.** `kind` is `openrouter`, `anthropic` or `openai_compatible`; the three legacy names have the kind of their
name and may leave it out, and the first two kinds exist only under their own names. Any other name
(`^[a-z][a-z0-9_]{0,31}$`, at most 12 providers) is an `openai_compatible` provider whose `base_url` must be https to a
host name or a global IP address, or http to the four local names above; no user info, query or fragment, and no
private, link-local or metadata address literal. Fallback models are sent to OpenRouter only (validate warns), and the
reasoning effort goes to an OpenAI-compatible server as `reasoning_effort`. The console's templates (OpenAI, Gemini's
OpenAI-compatible endpoint, DeepSeek, Groq, Mistral, Together, Ollama) only prefill a name and a base URL.

**Prices.** Off OpenRouter no catalog prices a call, so every role whose provider is `openai_compatible`, and every
Anthropic model the code has no price for, needs `price_in` and `price_out` (USD per 1M tokens, both or neither,
0-1000; 0 is fine for a local server). Validate, save, restore and reset refuse a document without them; a version
saved before Plan 23e still loads and charges 0 for those roles, as before. An `openai_compatible` call is charged at
the role's price (a cost the server reports is ignored); an OpenRouter call at its reported cost, else the catalog, else
the role's price; an Anthropic call at the role's price, else the code's table. The per-review cap and the daily USD
counter count these charges.

**Workers.** A key write raises the Redis key `mra:llm:keys_version` to its revision (`workers_notified` false: Redis
could not be updated). A worker compares it with the revision it built its models with at each job start, and the
database's newest revision every 30 seconds (repairing the Redis key), and rebuilds its models on the same
configuration and semaphore; a running review keeps the key it started with. Its report in `mra:llm:loaded` gains
`keys` (the revision, `"none"` before any key) and `keys_error` (stored keys it cannot read, or a failed load; the
key ring is then the old one, or env keys only). The result cache key does not change with a key: a key changes
neither the models nor the prompts.

## Paper count and pool (Plan 21)
```

**Edit** `.env.example` (1 replacement; each `old` occurs exactly once):

1. Replace

```
# --- LLM (models & presets: backend/config/llm.yaml; llm.yaml and LLM_PRESET apply until a version is saved in the admin console) ---
OPENROUTER_API_KEY=
# LLM_PRESET=budget        # budget | balanced | claude | gemini | claude_direct (no effect once a version is saved in the admin console)
ANTHROPIC_API_KEY=          # only for the claude_direct preset

# --- infra (compose service names) ---
```

   with

```
# --- LLM (models & presets: backend/config/llm.yaml; llm.yaml and LLM_PRESET apply until a version is saved in the admin console) ---
OPENROUTER_API_KEY=         # a key entered in the admin console (/admin/models, "ผู้ให้บริการและคีย์") overrides this one
# LLM_PRESET=budget        # budget | balanced | claude | gemini | claude_direct (no effect once a version is saved in the admin console)
ANTHROPIC_API_KEY=          # only for the claude_direct preset
# Plan 23e: the master key that encrypts provider keys entered in the admin console. Without it the console cannot
# store keys (env keys still work). Generate: docker compose run --rm api python -m app.cli.admin llm-keys-secret
# (or: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"). Comma-separate a new
# key in front of the old one to rotate (then run app.cli.admin rotate-llm-keys). Keep a backup of this file: losing it
# makes the stored keys unreadable.
LLM_KEYS_SECRET=
# A provider with a free name (e.g. deepseek) may also take its key from env, bound to its origin:
# LLM_KEY_DEEPSEEK=
# LLM_KEY_DEEPSEEK_ORIGIN=https://api.deepseek.com

# --- infra (compose service names) ---
```

**Edit** `README.md` (1 replacement; each `old` occurs exactly once):

1. Replace

```markdown
  `docs/api.md` → Admin API.
  Models: change presets and per-role models at `/admin/models`; each save is a version you can restore; workers pick it up within 30 seconds.
  Settings, glossary and harness: change limits and the Thai glossary at `/admin/settings` and `/admin/glossary` (versioned, restorable, live within 30 seconds); read and compare Cochrane harness reports and start a capped run at `/admin/harness` (`docker compose --profile harness up -d harness`).
  Search sources: turn each of the eight SearXNG engines and ThaiJO off or on at `/admin/sources` (versioned, restorable, live within 30 seconds; a running review keeps its sources; `GET /api/v1/status` lists the ones in use).
```

   with

```markdown
  `docs/api.md` → Admin API.
  Models: change presets and per-role models at `/admin/models`; each save is a version you can restore; workers pick it up within 30 seconds.
  Provider keys: enter, replace or delete LLM provider keys and add OpenAI-compatible providers (OpenAI, Gemini, DeepSeek, Groq, Mistral, Together, Ollama) in the "ผู้ให้บริการและคีย์" tab of `/admin/models`; keys are stored encrypted with `LLM_KEYS_SECRET` (set it in `.env`, see `.env.example`) and are never shown again.
  Settings, glossary and harness: change limits and the Thai glossary at `/admin/settings` and `/admin/glossary` (versioned, restorable, live within 30 seconds); read and compare Cochrane harness reports and start a capped run at `/admin/harness` (`docker compose --profile harness up -d harness`).
  Search sources: turn each of the eight SearXNG engines and ThaiJO off or on at `/admin/sources` (versioned, restorable, live within 30 seconds; a running review keeps its sources; `GET /api/v1/status` lists the ones in use).
```

**Edit** `backend/app/services/runtime_settings.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
"""Runtime settings the admin console may change (Plan 23c). Only the names in SPECS can be changed; secrets, URLs,
proxy trust, Turnstile, salts, admin sign-in rules, provider keys and HARNESS_MAX_USD stay env-only. A saved version
stores only the values the admin set; the env value (Settings) stays the default for every other name, so
{"values": {}} means "env everywhere". Reading never fails: a stored value that no longer validates is skipped."""
```

   with

```python
"""Runtime settings the admin console may change (Plan 23c). Only the names in SPECS can be changed; secrets, URLs,
proxy trust, Turnstile, salts, admin sign-in rules and HARNESS_MAX_USD stay env-only. LLM provider keys may also be
entered in the console since Plan 23e, stored encrypted outside these versions (app/services/llm_keys.py). A saved version
stores only the values the admin set; the env value (Settings) stays the default for every other name, so
{"values": {}} means "env everywhere". Reading never fails: a stored value that no longer validates is skipped."""
```

**New file** `backend/tests/unit/test_provider_keys_docs.py` (complete):

```python
"""Plan 23e: the docs and .env.example say what the provider-key feature does, with the numbers the code uses."""
from pathlib import Path

from app.api.admin_keys_llm import BODY_MAX, KEY_RATE
from app.services.llm_config import MAX_PROVIDERS, PROVIDER_NAME
from app.services.llm_keys import KEY_MAX, KEY_MIN, KEY_TEXT_ERROR
from app.services.llm_store import KEYS_VERSION_KEY

ROOT = Path(__file__).resolve().parents[3]
API_MD = (ROOT / "docs" / "api.md").read_text(encoding="utf-8")
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")


def section() -> str:
    start = API_MD.index("### Provider keys (Plan 23e)")
    return API_MD[start:API_MD.index("\n## ", start)]


def test_the_api_doc_lists_the_key_routes_and_their_rules():
    text = section()
    for route in ("`GET /admin/llm-keys`", "`PUT /admin/llm-keys/{provider}`", "`DELETE /admin/llm-keys/{provider}`"):
        assert route in text
    assert KEY_TEXT_ERROR in text and f"{KEY_MIN} to {KEY_MAX}" in text
    assert f"{BODY_MAX // 1024} KiB" in text and f"{KEY_RATE.split('/')[0]} key changes per hour" in text
    assert KEYS_VERSION_KEY in text and f"at most {MAX_PROVIDERS} providers" in text
    assert f"`^{PROVIDER_NAME.pattern}$`" in text
    for word in ("llm_key.set", "llm_key.replace", "llm_key.delete", "llm_key.rotate", "origin_mismatch",
                 "env_origin_missing", "LLM_KEY_<NAME>_ORIGIN", "rotate-llm-keys", "llm-keys-secret"):
        assert word in text


def test_the_model_management_section_mentions_the_new_fields():
    assert "key_status" in API_MD and "known_prices" in API_MD
    assert "{config \\| yaml, provider, model, price_in?, price_out?}" in API_MD
    assert "sources, keys, keys_error}" in API_MD


def test_env_example_has_the_master_secret_and_a_bound_env_key_example():
    assert "\nLLM_KEYS_SECRET=\n" in ENV_EXAMPLE
    assert "# LLM_KEY_DEEPSEEK_ORIGIN=https://api.deepseek.com" in ENV_EXAMPLE
    assert "app.cli.admin llm-keys-secret" in ENV_EXAMPLE
```

Then run: `cd /d/MRA-plan-23e/backend && uv run pytest tests/unit/test_provider_keys_docs.py tests/unit/test_api_docs_limits.py tests/unit/test_openapi_docs.py -q`

Expected: 13 passed

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-plan-23e/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-23e/frontend && npm test && npm run typecheck && npm run lint`

Expected: all pass (pre-flight: backend 2802 passed, 18 skipped, ruff clean; frontend 158 files, 1684 tests (known-flaky timeouts aside), typecheck and eslint clean). The new integration test (`tests/integration/test_llm_keys_migration.py`) needs a Postgres it may wipe (`MRA_INTEGRATION=1` and `TEST_DATABASE_URL`); the live stack's Postgres must never be used for it, so leave it unrun unless a separate one is available, and say so in the report.

- [ ] **Step 3: Commit**

Write the message with the Write tool to `D:\MRA-plan-23e\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
docs(api): provider keys, provider kinds and prices, keys heartbeat (Plan 23e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23e && git add docs/api.md .env.example README.md backend/app/services/runtime_settings.py backend/tests/unit/test_provider_keys_docs.py
git commit -F .superpowers/commit-msg.txt
```

---

## After the plan (controller)

Not part of any task: the controller does these after the whole-branch review, in its own session.
- **Merge** `plan-23e-provider-keys` into master with `--no-ff`. The main worktree's uncommitted owner entries (for
  example `infra/searxng/limiter.toml.new`) are never staged or changed.
- **Root `CLAUDE.md`** (committed file only; the owner may have working-tree edits). In the Plan 23c line, replace
  "(`app/services/config_store.py`; secrets, URLs and `HARNESS_MAX_USD` stay env-only)" with
  "(`app/services/config_store.py`; secrets, URLs and `HARNESS_MAX_USD` stay env-only, except LLM provider keys (Plan 23e))",
  and add:

```text
- Provider keys (Plan 23e): LLM provider API keys may be entered in the admin console (`/admin/models` → "ผู้ให้บริการและคีย์"), stored in `llm_provider_keys` as Fernet tokens of `{v, provider, origin, key}` under `LLM_KEYS_SECRET` (env only, comma-separated for rotation; `python -m app.cli.admin llm-keys-secret|rotate-llm-keys`), never in a config version, write-only (`app/api/admin_keys_llm.py` answers source, last 4 and origin only; the PUT body is read in code; audit rows never hold a key). `app/services/llm_keys.py` `resolve_key`: a console key bound to the provider's origin beats env; a key bound to another origin gives no key and no env fallback; a provider with a free name (`kind: openai_compatible`, `^[a-z][a-z0-9_]{0,31}$`) reads only `LLM_KEY_<NAME>` with a matching `LLM_KEY_<NAME>_ORIGIN`, needs https (or local http) and a public host, and never calls a public host without a key. Every role off OpenRouter needs `price_in`/`price_out` (validate and save refuse it; stored versions still load); an OpenAI-compatible call is charged at the role's price. Provider errors pass `redact()`. Workers follow `mra:llm:keys_version` (heartbeat `keys`, `keys_error`); a key is not part of the cache key.
```

- **The secret, never printed.** Write the script below with the Write tool to
  `D:\MedicalReviewerAgent\.superpowers\set_llm_keys_secret.py` (git-ignored; no heredoc), run it against the root
  `.env` (it adds `LLM_KEYS_SECRET` only when there is no non-empty one, and prints only whether it did), then delete it.
  Tell the owner to keep a backup of `.env` outside the repository: losing the secret makes stored keys unreadable.

```python
"""Plan 23e: give the root .env a LLM_KEYS_SECRET once, never printing it. Usage: python set_llm_keys_secret.py <.env>"""
import sys
from pathlib import Path

from cryptography.fernet import Fernet

env = Path(sys.argv[1])
lines = env.read_text(encoding="utf-8").splitlines()
if any(line.startswith("LLM_KEYS_SECRET=") and line.split("=", 1)[1].strip() for line in lines):
    print("LLM_KEYS_SECRET is already set: left as it is")
else:
    lines = [line for line in lines if not line.startswith("LLM_KEYS_SECRET=")]
    lines.append(f"LLM_KEYS_SECRET={Fernet.generate_key().decode()}")
    with env.open("w", encoding="utf-8", newline="\n") as out:
        out.write("\n".join(lines) + "\n")
    print("LLM_KEYS_SECRET set (the value is not shown)")
```

```bash
cd /d/MedicalReviewerAgent/backend && uv run python ../.superpowers/set_llm_keys_secret.py ../.env && rm ../.superpowers/set_llm_keys_secret.py
grep -c "^LLM_KEYS_SECRET=." ../.env    # 1; never cat or echo the value
```

- **Docker rebuild and the smoke check, spending nothing.** A fake key (`sk-fake-0000000000001234`) on a fake provider
  (`http://localhost:9/v1`) that only a new, inactive preset uses; no review, no "ทดสอบ", no provider call (validate
  may fetch the free OpenRouter model list, as the console does). Write the script with the Write tool to
  `D:\MedicalReviewerAgent\.superpowers\smoke23e.py`, copy it into the api container, run it, then delete both copies.

```python
"""Plan 23e smoke check, spending nothing: a fake key on a fake provider that no role of the active preset uses (the
only preset that names it is a new, inactive one), no review, no test call, no provider call. Run inside the api
container: it mints a temporary admin API key, drives the admin API on 127.0.0.1:8000, looks for the key in Redis and
the audit log, then revokes the temporary key. It prints the config version ids it created, for the clean-up."""
import asyncio
import copy
import sys
import time

import httpx
from sqlalchemy import String, cast, func, or_, select

FAKE_KEY = "sk-fake-0000000000001234"
BASE = "http://127.0.0.1:8000/api/v1/admin"


def fake_draft(config: dict, port: int) -> dict:
    draft = copy.deepcopy(config)
    draft.setdefault("providers", {})["fake"] = {"kind": "openai_compatible", "base_url": f"http://localhost:{port}/v1",
                                                 "require_parameters": False}
    smoke = copy.deepcopy(draft["presets"][draft["active_preset"]])
    smoke["guard"] = {"model": "fake-model", "provider": "fake", "price_in": 0, "price_out": 0}
    draft["presets"]["smoke23e"] = smoke
    return draft


def fake_row(state: dict) -> dict:
    return next(p for p in state["providers"] if p["name"] == "fake")


async def run(client: httpx.AsyncClient, wait_seconds: float = 40.0) -> list[int]:
    created: list[int] = []
    state = (await client.get("/llm-keys")).json()
    print("writable", state["writable"], state["reason"])
    if not state["writable"]:
        sys.exit("LLM_KEYS_SECRET is missing or bad: stop")
    current = (await client.get("/llm-config")).json()
    saved = await client.post("/llm-config", json={"config": fake_draft(current["config"], 9),
                                                   "base_version": current["version"], "note": "Plan 23e smoke (no spend)"})
    print("save", saved.status_code)
    created.append(saved.json()["id"])
    put = await client.put("/llm-keys/fake", json={"key": FAKE_KEY})
    row = fake_row(put.json())["key"]
    print("set", put.status_code, row["source"], f"last4={row['last4']}", row["bound_origin"],
          "key in answer", FAKE_KEY in put.text, "notified", put.json()["workers_notified"])
    revision = str(put.json()["keys_version"])
    deadline = time.monotonic() + wait_seconds
    loaded: list[dict] = []
    while time.monotonic() < deadline:
        loaded = (await client.get("/llm-keys")).json()["loaded"]
        if loaded and all(w.get("keys") == revision for w in loaded):
            break
        await asyncio.sleep(5)
    print("workers on revision", revision, [w.get("keys") for w in loaded], [w.get("keys_error") for w in loaded])
    moved = fake_draft(current["config"], 10)
    report = (await client.post("/llm-config/validate", json={"config": moved})).json()
    print("validate warns", any("stored key belongs to http://localhost:9" in w for w in report["warnings"]))
    saved = await client.post("/llm-config", json={"config": moved, "base_version": created[-1],
                                                   "note": "Plan 23e smoke: origin moved"})
    created.append(saved.json()["id"])
    row = fake_row((await client.get("/llm-keys")).json())["key"]
    print("moved", row["source"], row["problem"], row["bound_origin"])
    gone = await client.delete("/llm-keys/fake")
    row = fake_row(gone.json())["key"]
    print("deleted", gone.status_code, row["source"], row["problem"])
    every = "\n".join([(await client.get(path)).text for path in ("/llm-keys", "/llm-config", "/audit")])
    print("key in any answer", FAKE_KEY in every)
    print("created versions", created)
    return created


async def leaks(session_factory, redis) -> None:
    """Looks for the fake key in every Redis string, hash and list, and in every audit row."""
    found = 0
    async for key in redis.scan_iter("*"):
        kind = await redis.type(key)
        if kind == "string":
            values = [await redis.get(key)]
        elif kind == "hash":
            values = list((await redis.hgetall(key)).values())
        elif kind == "list":
            values = await redis.lrange(key, 0, -1)
        else:
            values = []
        found += sum(FAKE_KEY in str(v) for v in values)
    print("key in redis", found > 0)
    from app.db.models import AdminAudit

    async with session_factory() as session:
        hits = await session.scalar(select(func.count()).select_from(AdminAudit).where(or_(
            cast(AdminAudit.after, String).contains(FAKE_KEY), cast(AdminAudit.before, String).contains(FAKE_KEY))))
    print("key in audit", hits > 0)


async def main() -> None:
    from redis.asyncio import Redis

    from app.config import get_settings
    from app.db.session import make_engine, make_session_factory
    from app.services.api_keys import mint_key, revoke_key

    settings = get_settings()
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    async with factory() as session, session.begin():
        raw, row = await mint_key(session, "smoke-23e", daily_quota=1, is_admin=True)
        prefix = row.key_prefix
    try:
        async with httpx.AsyncClient(base_url=BASE, headers={"X-API-Key": raw}, timeout=30) as client:
            await run(client)
        await leaks(factory, redis)
    finally:
        async with factory() as session, session.begin():
            await revoke_key(session, prefix)
        await redis.aclose()
        await engine.dispose()
        print("temporary admin key revoked")


if __name__ == "__main__":
    asyncio.run(main())
```

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d   # one backend image; migrate runs c6e8a0b2d4f6
docker compose ps                                                                                  # api healthy, worker up
docker compose cp .superpowers/smoke23e.py api:/tmp/smoke23e.py
docker compose exec -T api python /tmp/smoke23e.py
docker compose exec -T api rm /tmp/smoke23e.py && rm .superpowers/smoke23e.py
docker compose logs api worker 2>&1 | grep -c "sk-fake-0000000000001234"                          # 0
```

Expected (the pre-flight ran the script's API part in-process, with no worker):
- `writable True None`, `save 201`;
- `set 200 console last4=1234 http://localhost:9 key in answer False notified True`;
- `workers on revision <n> ['<n>', …] [None, …]` (every worker within 40 s; the pre-flight had none);
- `validate warns True`, `moved none origin_mismatch http://localhost:9`, `deleted 200 none None`;
- `key in any answer False`, `key in redis False`, `key in audit False`, `created versions [a, b]`,
  `temporary admin key revoked`; the log grep prints `0`.

Then clean up so the live configuration is what it was (the precedent of Plans 23b and 23c): delete the two versions
the script created and the tombstone, and drop both Redis mirrors; the workers' next poll goes back to the previous
version (or `llm.yaml`) and the empty keys table, and the cache generation is the one before the smoke.

```bash
docker compose exec -T postgres psql -U mra -d mra -c "DELETE FROM llm_config_versions WHERE id IN (<a>, <b>); DELETE FROM llm_provider_keys WHERE provider = 'fake';"
docker compose exec -T redis redis-cli DEL mra:llm:config_version mra:llm:keys_version
```

- **Record:** remove the worktree (keep the branch) and update the memory notes: Plan 23e merged; `prompt_version`
  unchanged (`2026-10-14.1`); `LLM_KEYS_SECRET` set in `.env` (owner to back it up); the owner presses "ทดสอบ" with a
  real key himself; the `admin`/`admin` sign-in risk (spec section 11) told to the owner again.
