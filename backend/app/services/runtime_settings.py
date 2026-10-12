"""Runtime settings the admin console may change (Plan 23c). Only the names in SPECS can be changed; secrets, URLs,
proxy trust, Turnstile, salts, admin sign-in rules, provider keys and HARNESS_MAX_USD stay env-only. A saved version
stores only the values the admin set; the env value (Settings) stays the default for every other name, so
{"values": {}} means "env everywhere". Reading never fails: a stored value that no longer validates is skipped."""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

from app.config import Settings
from app.logging import get_logger
from app.services.budget import worst_case_review_cap
from app.services.config_store import DocKind, DocumentError
from app.services.llm_config import has_bad_text

log = get_logger(__name__)

SETTINGS_KEY = "mra:settings:active"
RATE_RE = re.compile(r"^[1-9][0-9]{0,4}/(second|minute|hour|day)$")


@dataclass(frozen=True)
class SettingSpec:
    name: str
    kind: Literal["rate", "int", "float"]
    group: Literal["limits", "capacity", "cost", "workers", "cache"]
    applies: Literal["api", "worker", "both"]
    min: float | None = None
    max: float | None = None


SPECS: tuple[SettingSpec, ...] = (
    SettingSpec("review_rate_limit", "rate", "limits", "api"),
    SettingSpec("api_key_rate_limit", "rate", "limits", "api"),
    SettingSpec("paper_search_rate_limit", "rate", "limits", "api"),
    SettingSpec("sse_max_per_ip", "int", "limits", "api", 1, 50),
    SettingSpec("max_queued_reviews", "int", "capacity", "api", 1, 1000),
    SettingSpec("max_reviews_per_day", "int", "capacity", "api", 1, 100_000),
    SettingSpec("max_usd_per_day", "float", "capacity", "api", 0.1, 1000.0),
    SettingSpec("review_cost_base_usd", "float", "cost", "both", 0.0, 1.0),
    SettingSpec("review_cost_per_paper_usd", "float", "cost", "both", 0.0, 0.1),
    SettingSpec("review_cost_per_candidate_usd", "float", "cost", "both", 0.0, 0.01),
    SettingSpec("max_cost_per_review_usd", "float", "cost", "both", 0.05, 5.0),
    SettingSpec("llm_concurrency", "int", "workers", "worker", 1, 64),
    SettingSpec("result_cache_ttl_seconds", "int", "cache", "api", 0, 2_592_000),
)
BY_NAME = {s.name: s for s in SPECS}


def _fmt(value: float | None) -> str:
    return "?" if value is None else (str(int(value)) if float(value).is_integer() else str(value))


def coerce(spec: SettingSpec, value: Any) -> str | int | float:
    """The value in the setting's type; ValueError with a message that never repeats the value."""
    if spec.kind == "rate":
        text = value.strip() if isinstance(value, str) else ""
        if not RATE_RE.match(text):
            raise ValueError("must look like 5/hour (1-99999 per second, minute, hour or day)")
        return text
    number = value if isinstance(value, int | float) and not isinstance(value, bool) else None
    if number is None:  # bool is an int subclass, and True is not a count
        raise ValueError("must be a number")
    if spec.kind == "int":
        if isinstance(number, float):
            if not number.is_integer():
                raise ValueError("must be a whole number")
            number = int(number)
    else:
        try:
            number = float(number)
        except OverflowError:  # an integer beyond the float range: still one ValueError, never a 500
            raise ValueError("must be a finite number") from None
        if not math.isfinite(number):
            raise ValueError("must be a finite number")
    if (spec.min is not None and number < spec.min) or (spec.max is not None and number > spec.max):
        raise ValueError(f"must be between {_fmt(spec.min)} and {_fmt(spec.max)}")
    return number


def apply_overrides(base: Settings, values: dict[str, Any]) -> Settings:
    """The env settings with the saved values; anything unknown or invalid is skipped with a log line."""
    update: dict[str, Any] = {}
    for name, value in (values or {}).items():
        spec = BY_NAME.get(name)
        if spec is None:
            log.warning("runtime_setting_unknown", name=str(name)[:64])
            continue
        try:
            update[name] = coerce(spec, value)
        except ValueError:
            log.warning("runtime_setting_invalid", name=name)
    return base.model_copy(update=update) if update else base


def validate_settings(raw: Any, settings: Settings) -> tuple[dict[str, Any], list[str]]:
    """`settings` is the env (base) settings: overrides always apply to env values, never to other overrides."""
    if not isinstance(raw, dict) or set(raw) - {"values"} or not isinstance(raw.get("values", {}), dict):
        raise DocumentError([{"field": None, "message": 'the document must be {"values": {name: value}}'}])
    errors: list[dict[str, Any]] = []
    values: dict[str, Any] = {}
    for name, value in raw.get("values", {}).items():
        spec = BY_NAME.get(name)
        if spec is None:
            safe = None if has_bad_text(name) else str(name)[:64]
            errors.append({"field": safe, "message": f"{safe} cannot be changed in the console" if safe
                           else "a setting name holds an invalid character"})
            continue
        try:
            values[name] = coerce(spec, value)
        except ValueError as exc:
            errors.append({"field": name, "message": f"{name}: {exc}"})
    if errors:
        raise DocumentError(errors)
    effective = apply_overrides(settings, values)
    worst = worst_case_review_cap(effective)
    if worst > effective.max_usd_per_day:
        raise DocumentError([{"field": "max_usd_per_day", "message": (
            f"max_usd_per_day (${effective.max_usd_per_day:.2f}) is below the largest per-review cap "
            f"(${worst:.2f}); no review could be admitted")}])
    warnings = []
    if effective.max_usd_per_day < 5 * worst:
        warnings.append(f"the daily budget holds only {int(effective.max_usd_per_day // worst)} reviews at their "
                        "largest cap; admission reserves that much for each queued or running review")
    if "llm_concurrency" in values:
        warnings.append("llm_concurrency applies to reviews that start after the workers reload; reviews already "
                        "running keep the old limit")
    return {"values": values}, warnings


def summarize_settings(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    a, b = (old or {}).get("values") or {}, (new or {}).get("values") or {}

    def show(v: Any) -> str:
        return "env" if v is None else str(v)

    return {n: f"{show(a.get(n))} → {show(b.get(n))}" for n in sorted(set(a) | set(b)) if a.get(n) != b.get(n)}


def spec_out(spec: SettingSpec) -> dict[str, Any]:
    return asdict(spec)


SETTINGS_KIND = DocKind(name="settings", redis_key=SETTINGS_KEY, validate=validate_settings,
                        summarize=summarize_settings, seed=lambda: {"values": {}},
                        mirror=lambda document: {"values": dict(document.get("values") or {})})
