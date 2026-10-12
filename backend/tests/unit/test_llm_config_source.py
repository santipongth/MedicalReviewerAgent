import asyncio

import pytest

from app.config import Settings
from app.services.llm import build_llms
from app.services.llm_config import (
    LLMConfigError,
    load_llm_config,
    parse_llm_config,
    resolve_llm_config,
)
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
