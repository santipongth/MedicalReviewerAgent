from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any

from app.services.llm import LLMResult


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
