"""The search sources as a versioned document kind (Plan 23d, app/services/config_store.py), beside 23c's settings and
glossary. A document is {"sources": {id: bool}} holding only the sources that differ from env (entries equal to the
env default are dropped on save); reset appends {"sources": {}}. Messages name the field and never repeat a submitted
key or value."""
from __future__ import annotations

from typing import Any

from app.config import Settings
from app.services.config_store import DocKind, DocumentError
from app.services.sources import BY_ID, SOURCES, env_defaults

SOURCES_KEY = "mra:sources:active"
SHAPE = 'the document must be {"sources": {id: true or false}}'
NO_SEARXNG = ("at least one source searched through SearXNG must stay on: ThaiJO alone gives at most 1/8 of the "
              "pool, and paper search uses SearXNG only")
WARN_BIOMEDICAL = ("PubMed and Europe PMC are both off: the two biomedical indexes are off; reviews will find far "
                   "fewer clinical studies")
WARN_EUROPEPMC = ("Europe PMC is off, so the Europe PMC RCT search of meta-analyses is off too (abstract enrichment "
                  "and the citation network stay on)")
WARN_THAIJO = "ThaiJO on: this turns on calls to TCI that THAIJO_ENABLED has off"


def validate_sources(raw: Any, settings: Settings) -> tuple[dict[str, Any], list[str]]:
    """`settings` is the env (base) settings: a draft is judged on top of env, never on top of other overrides."""
    if not isinstance(raw, dict) or set(raw) - {"sources"} or not isinstance(raw.get("sources", {}), dict):
        raise DocumentError([{"field": None, "message": SHAPE}])
    errors: list[dict[str, Any]] = []
    values: dict[str, bool] = {}
    for key, value in raw.get("sources", {}).items():
        if key not in BY_ID:
            if not any(e["field"] == "sources" for e in errors):
                errors.append({"field": "sources", "message": "sources: unknown source"})
        elif not isinstance(value, bool):
            errors.append({"field": f"sources.{key}", "message": f"sources.{key}: must be true or false"})
        else:
            values[key] = value
    if errors:
        raise DocumentError(errors)
    env = env_defaults(settings)
    on = {**env, **values}
    if not any(on[s.id] for s in SOURCES if s.kind == "searxng"):
        raise DocumentError([{"field": "sources", "message": NO_SEARXNG}])
    warnings = []
    if not on["pubmed"] and not on["europepmc"]:
        warnings.append(WARN_BIOMEDICAL)
    if not on["europepmc"]:
        warnings.append(WARN_EUROPEPMC)
    if on["thaijo"] and not settings.thaijo_enabled:
        warnings.append(WARN_THAIJO)
    return {"sources": {s.id: values[s.id] for s in SOURCES if s.id in values and values[s.id] != env[s.id]}}, warnings


def summarize_sources(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """What the version changed against the one before, per source: `env → off`, `on → env`, ... (the document holds
    differences from env, so "env" means the source follows the environment)."""
    a, b = (old or {}).get("sources") or {}, (new or {}).get("sources") or {}

    def show(v: Any) -> str:
        return "env" if v is None else ("on" if v is True else "off" if v is False else "?")

    return {s.id: f"{show(a.get(s.id))} → {show(b.get(s.id))}" for s in SOURCES if a.get(s.id) != b.get(s.id)}


SOURCES_KIND = DocKind(name="sources", redis_key=SOURCES_KEY, validate=validate_sources,
                       summarize=summarize_sources, seed=lambda: {"sources": {}},
                       mirror=lambda document: {"sources": dict(document.get("sources") or {})})
