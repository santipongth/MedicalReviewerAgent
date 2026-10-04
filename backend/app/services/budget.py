"""Per-review cost cap. The worker opens a budget around one review's graph run; every LLM call made inside it
(any node, any parallel branch: asyncio tasks inherit the context) is charged to it, and once it is spent further
calls are refused, so the review finishes with what it already has instead of running up the bill."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

_current: ContextVar[ReviewBudget | None] = ContextVar("review_budget", default=None)


@dataclass
class ReviewBudget:
    cap_usd: float
    spent: float = 0.0

    @property
    def exhausted(self) -> bool:
        return self.spent >= self.cap_usd

    def charge(self, usd: float) -> None:
        self.spent += max(0.0, usd)


def current_budget() -> ReviewBudget | None:
    return _current.get()


@contextmanager
def use_budget(budget: ReviewBudget | None) -> Iterator[ReviewBudget | None]:
    token = _current.set(budget)
    try:
        yield budget
    finally:
        _current.reset(token)
