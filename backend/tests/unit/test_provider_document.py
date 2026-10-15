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
    # other spellings of 127.0.0.1 that resolvers accept, local or private names over https, IPv4 inside IPv6
    "https://2130706433/v1", "https://0x7f000001/v1", "https://127.1/v1", "https://0177.0.0.1/v1",
    "https://0x7f.0.0.1/v1", "https://localhost/v1", "https://localhost./v1", "https://api.localhost/v1",
    "https://host.docker.internal/v1", "https://metadata.google.internal/v1", "https://api.deepseek.com./v1",
    "https://printer.local/v1", "https://router.home.arpa/v1", "https://ollama/v1",
    "https://[64:ff9b::a9fe:a9fe]/v1", "https://[::ffff:127.0.0.1]/v1", "https://[2002:7f00:1::]/v1",
    "https://[64:ff9b:1::a9fe:a9fe]/v1", "https://api_x.example.com/v1", "https://-bad.example.com/v1",
])
def test_a_free_name_cannot_point_at_an_internal_or_disguised_address(url):
    with pytest.raises(LLMConfigError, match="base_url"):
        parse_llm_config(with_provider("deepseek", base_url=url))


@pytest.mark.parametrize("url", [
    "https://" + "a" * 250 + ".example.com/v1",  # origin over 255: the stored key's bound_origin column
    "https://api.deepseek.com/" + "a" * 2100,  # base_url over 2048
])
def test_a_base_url_too_long_for_the_origin_column_or_the_cap_is_refused(url):
    with pytest.raises(LLMConfigError, match="base_url"):
        parse_llm_config(with_provider("deepseek", base_url=url))
    parse_llm_config(with_provider("deepseek", base_url="https://" + "a" * 60 + ".example.com/v1"))


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


def test_a_local_server_without_a_price_is_not_unpriced_but_a_remote_legacy_one_is():
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["ollama"] = {"kind": "openai_compatible", "base_url": "http://localhost:11434/v1"}
    raw["providers"]["openai_compatible"] = {"base_url": "http://10.0.0.5:11434/v1"}
    raw["presets"]["cheap"]["extractor"] = {"model": "llama3", "provider": "ollama"}
    raw["presets"]["cheap"]["screener"] = {"model": "llama3", "provider": "openai_compatible"}
    resolved = resolve_llm_config(parse_llm_config(raw))
    assert unpriced_roles(resolved, None) == ["screener"]


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
