"""Progress events from graph nodes.

Inside a running graph this is LangGraph's custom stream writer (consumed by the worker's
EventSink). Outside a runnable context — e.g. a node called directly in a unit test —
LangGraph 1.2 raises, so we fall back to a no-op writer."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langgraph.config import get_stream_writer


def _noop(_chunk: Any) -> None:
    return None


def progress_writer() -> Callable[[Any], None]:
    try:
        return get_stream_writer()
    except RuntimeError:
        return _noop
