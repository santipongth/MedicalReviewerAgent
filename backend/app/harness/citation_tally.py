"""Plan 22a eval: counts the [Pn] references the narrative steps proposed and the ones strip_unknown_citations
removed (not in the review's papers). Like the per-review budget, a contextvar that asyncio tasks inherit; it is
only set by the eval runner, so production runs are unaffected."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

_current: ContextVar[CitationTally | None] = ContextVar("citation_tally", default=None)


@dataclass
class CitationTally:
    proposed: int = 0
    stripped: int = 0


def current_tally() -> CitationTally | None:
    return _current.get()


@contextmanager
def use_tally(tally: CitationTally | None) -> Iterator[CitationTally | None]:
    token = _current.set(tally)
    try:
        yield tally
    finally:
        _current.reset(token)
