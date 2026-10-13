"""Per-review cost cap. The worker opens a budget around one review's graph run; every LLM call made inside it
(any node, any parallel branch: asyncio tasks inherit the context) is charged to it, and once it is spent further
calls are refused, so the review finishes with what it already has instead of running up the bill."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import Settings
    from app.schemas.review import ReviewOptions

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


def review_cost_cap(settings: Settings, options: ReviewOptions) -> float:
    """USD cap for one review: base + per analysed paper + per screened candidate, never above the hard ceiling."""
    cap = (settings.review_cost_base_usd + settings.review_cost_per_paper_usd * options.max_papers
           + settings.review_cost_per_candidate_usd * options.candidate_limit)
    return min(cap, settings.max_cost_per_review_usd)


def worst_case_review_cap(settings: Settings) -> float:
    """The largest cap any request can get: the most papers and candidates the form allows (Plan 23c: shared by
    admission control and the settings validation)."""
    from app.schemas.review import ReviewOptions

    return review_cost_cap(settings, ReviewOptions(max_papers=ReviewOptions.bound("max_papers"),
                                                   candidate_limit=ReviewOptions.bound("candidate_limit")))
