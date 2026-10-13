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
