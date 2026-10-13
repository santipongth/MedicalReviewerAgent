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
