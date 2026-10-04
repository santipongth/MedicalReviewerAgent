import os

import pytest

from app.config import Settings
from app.services.llm import build_llms

pytestmark = pytest.mark.live


async def test_guard_round_trip_against_real_api():
    llms = build_llms(Settings(_env_file=None, anthropic_api_key=os.environ["ANTHROPIC_API_KEY"]))
    res = await llms.guard.ainvoke(
        "Decide if the topic is a biomedical research question.",
        "<topic>metformin and colorectal cancer risk</topic>",
    )
    assert res.value.allowed is True and res.cost_usd > 0
