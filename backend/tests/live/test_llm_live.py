import os
from pathlib import Path

import pytest

from app.config import Settings
from app.services.llm import build_llms

pytestmark = pytest.mark.live
REPO_CONFIG = str(Path(__file__).parents[2] / "config" / "llm.yaml")


async def test_guard_round_trip_through_openrouter_budget_preset():
    if not os.environ.get("OPENROUTER_API_KEY"):
        pytest.skip("set OPENROUTER_API_KEY")
    llms = build_llms(Settings(_env_file=None, llm_config_path=REPO_CONFIG,
                               openrouter_api_key=os.environ["OPENROUTER_API_KEY"]))
    res = await llms.guard.ainvoke(
        "Decide if the topic is a biomedical research question.",
        "<topic>metformin and colorectal cancer risk</topic>",
    )
    assert res.value.allowed is True and res.cost_usd >= 0


async def test_guard_round_trip_direct_anthropic():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("set ANTHROPIC_API_KEY")
    llms = build_llms(Settings(_env_file=None, llm_config_path=REPO_CONFIG, llm_preset="claude_direct",
                               anthropic_api_key=os.environ["ANTHROPIC_API_KEY"]))
    res = await llms.guard.ainvoke(
        "Decide if the topic is a biomedical research question.",
        "<topic>metformin and colorectal cancer risk</topic>",
    )
    assert res.value.allowed is True and res.cost_usd > 0
