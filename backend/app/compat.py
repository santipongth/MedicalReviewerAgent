"""Platform shims. psycopg's async mode cannot run on Windows' default ProactorEventLoop.

Host-side (Windows) entrypoints use these; Linux containers are unaffected:
- `run_async(coro)` for scripts (alembic env, setup_checkpointer)
- `uvicorn app.main:app --loop app.compat:selector_loop_factory` for the dev server
"""
from __future__ import annotations

import asyncio
import selectors
import sys
from collections.abc import Coroutine
from typing import Any, TypeVar

T = TypeVar("T")


def selector_loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop(selectors.SelectSelector())


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    if sys.platform == "win32":
        return asyncio.run(coro, loop_factory=selector_loop_factory)
    return asyncio.run(coro)
