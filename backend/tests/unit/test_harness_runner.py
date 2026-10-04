import pytest

from app.graph.schemas import TopicVerdict
from app.harness.runner import HarnessRunner
from app.services.llm import LLMOutputError, LLMRefusal
from tests.fakes import FakeStructuredLLM


def verdict(reason="ok"):
    return TopicVerdict(allowed=True, reason=reason, english_topic="t")


def must_say_good(v):
    return [] if v.reason == "good" else [f"reason must be 'good', got '{v.reason}'"]


async def test_passes_first_time_without_repair():
    llm = FakeStructuredLLM("m", lambda s, u: verdict("good"))
    res = await HarnessRunner(max_repairs=2).call(llm, "sys", "user", schema=TopicVerdict, validate=must_say_good)
    assert res.ok and res.attempts == 1 and not res.repaired and not res.escalated
    assert res.cost == pytest.approx(0.01)


async def test_repairs_with_problem_feedback():
    answers = iter([verdict("bad"), verdict("good")])
    llm = FakeStructuredLLM("m", lambda s, u: next(answers))
    res = await HarnessRunner(max_repairs=2).call(llm, "sys", "user", schema=TopicVerdict, validate=must_say_good)
    assert res.ok and res.repaired and res.attempts == 2
    assert "reason must be 'good'" in llm.calls[1][1] and llm.calls[1][1].startswith("user")


async def test_output_errors_are_repaired_too():
    answers = iter([LLMOutputError("bad json"), verdict("good")])
    llm = FakeStructuredLLM("m", lambda s, u: next(answers))
    res = await HarnessRunner(max_repairs=1).call(llm, "sys", "user", schema=TopicVerdict, validate=must_say_good)
    assert res.ok and res.attempts == 2 and "bad json" in llm.calls[1][1]


async def test_escalates_after_repairs_fail():
    small = FakeStructuredLLM("small", lambda s, u: verdict("bad"))
    big = FakeStructuredLLM("big", lambda s, u: verdict("good"), cost=0.05)
    runner = HarnessRunner(max_repairs=1, escalation=lambda schema: big)
    res = await runner.call(small, "sys", "user", schema=TopicVerdict, validate=must_say_good)
    assert res.ok and res.escalated and res.value.reason == "good"
    assert len(small.calls) == 2 and len(big.calls) == 1
    assert res.cost == pytest.approx(0.07)


async def test_failure_without_escalation_returns_last_value_and_problems():
    small = FakeStructuredLLM("small", lambda s, u: verdict("bad"))
    res = await HarnessRunner(max_repairs=1, escalate_on=()).call(
        small, "sys", "user", schema=TopicVerdict, validate=must_say_good,
        escalation_llm=FakeStructuredLLM("big", lambda s, u: verdict("good")))
    assert not res.ok and res.value.reason == "bad" and res.problems and not res.escalated


async def test_escalation_failure_is_not_fatal():
    small = FakeStructuredLLM("small", lambda s, u: LLMOutputError("garbage"))
    big = FakeStructuredLLM("big", lambda s, u: LLMOutputError("still garbage"))
    res = await HarnessRunner(max_repairs=0, escalation=lambda schema: big).call(
        small, "sys", "user", schema=TopicVerdict)
    assert not res.ok and res.value is None and res.escalated


async def test_refusal_propagates():
    llm = FakeStructuredLLM("m", lambda s, u: LLMRefusal("no"))
    with pytest.raises(LLMRefusal):
        await HarnessRunner().call(llm, "s", "u", schema=TopicVerdict)


async def test_force_escalation_for_disagreement():
    big = FakeStructuredLLM("big", lambda s, u: verdict("good"))
    runner = HarnessRunner(escalation=lambda schema: big)
    res = await runner.escalate("sys", "user", schema=TopicVerdict, reason="disagreement")
    assert res.ok and res.escalated and res.value.reason == "good"
    assert await HarnessRunner(escalate_on=("repair_failed",), escalation=lambda s: big).escalate(
        "sys", "user", schema=TopicVerdict, reason="disagreement") is None
