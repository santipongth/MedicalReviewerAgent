"""API keys: unlock higher quotas, webhooks, cancellation and admin endpoints. Only SHA-256 hashes are stored."""
from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class ApiKeyInfo:
    id: uuid.UUID
    name: str
    daily_quota: int
    is_admin: bool
    key_hash: str
