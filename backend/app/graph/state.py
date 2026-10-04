from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class ReviewState(TypedDict, total=False):
    review_id: str
    topic: str
    language: str
    options: dict[str, Any]
    # Parallel branches (Send fan-out, added in Plan 2) append to these; reducers merge them.
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
    result: dict[str, Any] | None
