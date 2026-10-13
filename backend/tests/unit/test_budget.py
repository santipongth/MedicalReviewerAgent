import asyncio

import pytest

from app.graph.schemas import TopicVerdict
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import BudgetExceeded, LimitedLLM
from tests.fakes import FakeStructuredLLM


def verdict(s, u):
    return TopicVerdict(allowed=True, reason="ok", english_topic="x")


async def test_calls_beyond_the_cap_are_refused_without_reaching_the_model():
    inner = FakeStructuredLLM("m", verdict, cost=0.01)
    llm = LimitedLLM(inner, asyncio.Semaphore(4))
    budget = ReviewBudget(cap_usd=0.015)
    with use_budget(budget):
        await llm.ainvoke("s", "u")
        await llm.ainvoke("s", "u")  # spent 0.01 < cap when it started
        with pytest.raises(BudgetExceeded, match="cost cap"):
            await llm.ainvoke("s", "u")
    assert len(inner.calls) == 2 and round(budget.spent, 3) == 0.02
    await llm.ainvoke("s", "u")  # outside a review budget: no cap


async def test_calls_queued_on_the_semaphore_are_refused_once_the_first_call_spends_the_cap():
    async def slow(s, u):
        await asyncio.sleep(0.01)
        return verdict(s, u)

    inner = FakeStructuredLLM("m", slow, cost=0.02)
    llm = LimitedLLM(inner, asyncio.Semaphore(1))
    budget = ReviewBudget(cap_usd=0.015)
    with use_budget(budget):
        results = await asyncio.gather(*(llm.ainvoke("s", f"u{i}") for i in range(5)), return_exceptions=True)
    # every call passed the pre-check (nothing spent yet); only the first reached the model
    assert len(inner.calls) == 1 and round(budget.spent, 3) == 0.02
    assert sum(isinstance(r, BudgetExceeded) for r in results) == 4
    assert all("cost cap" in str(r) for r in results if isinstance(r, BudgetExceeded))


async def test_each_run_has_its_own_budget():
    inner = FakeStructuredLLM("m", verdict, cost=0.01)
    llm = LimitedLLM(inner, asyncio.Semaphore(4))

    async def run(cap):
        b = ReviewBudget(cap_usd=cap)
        with use_budget(b):
            for _ in range(3):
                try:
                    await llm.ainvoke("s", "u")
                except BudgetExceeded:
                    pass
        return round(b.spent, 3)

    assert await asyncio.gather(run(0.005), run(1.0)) == [0.01, 0.03]


def test_review_cost_cap_scales_with_papers_and_pool_and_the_ceiling_clamps():
    from app.config import Settings
    from app.schemas.review import ReviewOptions
    from app.services.budget import review_cost_cap
    s = Settings(_env_file=None)
    assert review_cost_cap(s, ReviewOptions(max_papers=30, candidate_limit=60)) == pytest.approx(0.25)
    assert review_cost_cap(s, ReviewOptions(max_papers=50, candidate_limit=120)) == pytest.approx(0.40)
    assert review_cost_cap(s, ReviewOptions(max_papers=5, candidate_limit=120)) == pytest.approx(0.13)
    tight = Settings(_env_file=None, max_cost_per_review_usd=0.30)
    assert review_cost_cap(tight, ReviewOptions(max_papers=50, candidate_limit=120)) == 0.30
