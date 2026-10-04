from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AppDeps:
    """Runtime dependencies shared by API routes (kept out of app.main to avoid import cycles)."""

    session_factory: Any
    redis: Any
    queue: Any
    event_sink: Any
