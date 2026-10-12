from __future__ import annotations

import inspect
import re
from collections.abc import Callable
from typing import Any

from app.services.llm import LLMResult

_ENGLISH_WORD = re.compile(r"\b(?!P\d+\b)[A-Za-z]+\b")


def to_thai(text: str) -> str:
    """A fake Thai translation the localisation completeness check accepts: every English word becomes "ไทย";
    numbers and [Pn] citations stay as written. The "TH " marker is an abbreviation, so the check ignores it."""
    return "TH " + _ENGLISH_WORD.sub("ไทย", text)


class FakeStructuredLLM:
    def __init__(self, model: str, responder: Callable[[str, str], Any], cost: float = 0.01) -> None:
        self.model = model
        self.responder = responder
        self.cost = cost
        self.calls: list[tuple[str, str]] = []

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        self.calls.append((system, user))
        value = self.responder(system, user)
        if inspect.isawaitable(value):
            value = await value
        if isinstance(value, BaseException):
            raise value
        return LLMResult(value=value, cost_usd=self.cost, model=self.model, input_tokens=100, output_tokens=10)


def bind_by_role(llms, overrides=None):
    """Test double for LLMs.for_schema: fakes answer whatever their responder returns, so binding a role to another
    schema reuses that role's current fake (read at call time); `overrides` maps a schema to a fake factory. Every
    request is recorded in `.requests` so a test can assert which schema a call asked for."""
    overrides = overrides or {}

    def for_schema(role, schema):
        for_schema.requests.append((role, schema))
        return overrides[schema](role) if schema in overrides else getattr(llms, role)

    for_schema.requests = []
    return for_schema
