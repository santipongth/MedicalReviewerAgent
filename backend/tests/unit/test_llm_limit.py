import asyncio

from app.config import Settings
from app.graph.schemas import TopicVerdict
from app.services.llm import LimitedLLM, build_llms
from tests.fakes import FakeStructuredLLM


async def test_limited_llm_caps_in_flight():
    state = {"now": 0, "peak": 0}

    async def slow(system, user):
        state["now"] += 1
        state["peak"] = max(state["peak"], state["now"])
        await asyncio.sleep(0.01)
        state["now"] -= 1
        return TopicVerdict(allowed=True, reason="ok", english_topic="x")

    inner = FakeStructuredLLM("m", slow)
    llm = LimitedLLM(inner, asyncio.Semaphore(3))
    await asyncio.gather(*(llm.ainvoke("s", f"u{i}") for i in range(20)))
    assert state["peak"] == 3 and len(inner.calls) == 20
    assert llm.model == "m"  # attributes are forwarded to the wrapped model


def test_build_llms_shares_one_semaphore_across_roles_and_escalation():
    llms = build_llms(Settings(_env_file=None, openrouter_api_key="sk-or-x", llm_concurrency=5))
    assert isinstance(llms.extractor, LimitedLLM) and isinstance(llms.localizer, LimitedLLM)
    assert llms.extractor.sem is llms.localizer.sem is llms.extractor_secondary.sem
    assert llms.escalation(TopicVerdict).sem is llms.extractor.sem
    assert llms.extractor.sem._value == 5


def test_with_schema_binds_the_roles_model_to_another_schema():
    llms = build_llms(Settings(_env_file=None, openrouter_api_key="sk-or-x"))
    bound = llms.with_schema("planner", TopicVerdict)
    assert isinstance(bound, LimitedLLM) and bound.sem is llms.planner.sem  # same per-process limit and budget
    assert bound.model == llms.planner.model and bound.schema is TopicVerdict
    assert llms.planner.schema is not TopicVerdict  # the role's own LLM keeps its schema
    assert llms.with_schema("planner", TopicVerdict) is bound


def test_with_schema_without_a_factory_is_an_error_never_the_roles_own_llm():
    import pytest

    from app.services.llm import LLMError, LLMs
    role = FakeStructuredLLM("m", lambda s, u: None)
    llms = LLMs(guard=role, planner=role, screener=role, extractor=role, synthesizer=role)
    with pytest.raises(LLMError, match="planner"):
        llms.with_schema("planner", TopicVerdict)


def test_with_schema_for_a_role_the_preset_lacks_is_an_llm_error():
    import pytest

    from app.services.llm import LLMError
    llms = build_llms(Settings(_env_file=None, openrouter_api_key="sk-or-x"))
    with pytest.raises(LLMError, match="no-such-role"):
        llms.with_schema("no-such-role", TopicVerdict)
