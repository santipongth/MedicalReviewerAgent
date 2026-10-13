"""The Thai glossary as a versioned document kind (Plan 23c, app/services/config_store.py). Terms are validated here;
messages name the cell ("terms.3.th") and never repeat its text, so a lone surrogate cannot break the response. The
Redis mirror carries only the version: the API needs it for the cache key, and workers read the terms from the DB."""
from __future__ import annotations

import re
from typing import Any

from app.config import Settings
from app.harness.glossary import ActiveGlossary, render_glossary, seed_document
from app.services.config_store import DocKind, DocumentError
from app.services.llm_config import has_bad_text

GLOSSARY_KEY = "mra:glossary:active"
TERMS_MAX = 200
EN_MAX = 120
TH_MAX = 120
ABBR_MAX = 24
TERM_NOTE_MAX = 300
RENDERED_MAX = 4000
FIELDS = ("en", "th", "abbr", "note")
_THAI = re.compile(r"[ก-๛]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")  # C0, DEL, C1 and the Unicode line/paragraph separators


def _text(value: Any, path: str, *, required: bool, max_len: int, errors: list[dict[str, Any]]) -> str | None:
    """A clean, trimmed value, or None (blank optional values become None)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            errors.append({"field": path, "message": f"{path}: required"})
        return None
    if not isinstance(value, str):
        errors.append({"field": path, "message": f"{path}: must be text"})
        return None
    if has_bad_text(value) or _CONTROL.search(value):
        errors.append({"field": path, "message": f"{path}: holds a control or invalid character"})
        return None
    value = value.strip()
    if len(value) > max_len:
        errors.append({"field": path, "message": f"{path}: at most {max_len} characters"})
        return None
    return value


def validate_glossary(raw: Any, settings: Settings | None = None) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(raw, dict) or set(raw) - {"terms"} or not isinstance(raw.get("terms"), list):
        raise DocumentError([{"field": None, "message": 'the document must be {"terms": [...]}'}])
    terms = raw["terms"]
    if not terms:
        raise DocumentError([{"field": "terms", "message": "the glossary needs at least one term"}])
    if len(terms) > TERMS_MAX:
        raise DocumentError([{"field": "terms", "message": f"at most {TERMS_MAX} terms"}])
    errors: list[dict[str, Any]] = []
    warnings: list[str] = []
    out: list[dict[str, Any]] = []
    aliases_seen: dict[str, int] = {}
    thai_seen: dict[str, int] = {}
    for i, term in enumerate(terms):
        path = f"terms.{i}"
        if not isinstance(term, dict) or set(term) - set(FIELDS):
            errors.append({"field": path, "message": f"{path}: a term has en, th, abbr and note only"})
            continue
        en = _text(term.get("en"), f"{path}.en", required=True, max_len=EN_MAX, errors=errors)
        th = _text(term.get("th"), f"{path}.th", required=True, max_len=TH_MAX, errors=errors)
        abbr = _text(term.get("abbr"), f"{path}.abbr", required=False, max_len=ABBR_MAX, errors=errors)
        note = _text(term.get("note"), f"{path}.note", required=False, max_len=TERM_NOTE_MAX, errors=errors)
        for field, value in (("en", en), ("th", th), ("abbr", abbr)):
            if value and (";" in value or "=" in value):
                errors.append({"field": f"{path}.{field}", "message": f"{path}.{field}: ';' and '=' are not allowed"})
        for field, value in (("th", th), ("abbr", abbr)):
            if value and ("(" in value or ")" in value):
                errors.append({"field": f"{path}.{field}",
                               "message": f"{path}.{field}: no brackets (the abbreviation has its own field)"})
        if th and not _THAI.search(th):
            errors.append({"field": f"{path}.th", "message": f"{path}.th: must contain Thai"})
        if en:
            aliases = [a.strip().lower() for a in en.split("/")]
            if not all(aliases):
                errors.append({"field": f"{path}.en", "message": f"{path}.en: an empty alias around '/'"})
            for alias in filter(None, aliases):
                if alias in aliases_seen:
                    errors.append({"field": f"{path}.en",
                                   "message": f"{path}.en: also listed in terms.{aliases_seen[alias]}"})
                else:
                    aliases_seen[alias] = i
        if th:
            if th in thai_seen:
                warnings.append(f"terms.{thai_seen[th]} and {path} share one Thai term")
            else:
                thai_seen[th] = i
        out.append({"en": en, "th": th, "abbr": abbr, "note": note})
    if errors:
        raise DocumentError(errors)
    rendered = render_glossary(out)
    if len(rendered) > RENDERED_MAX:
        raise DocumentError([{"field": "terms", "message": f"the glossary renders to {len(rendered)} characters; "
                                                            f"at most {RENDERED_MAX} fit the prompt"}])
    return {"terms": out}, warnings


def summarize_glossary(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """Terms added, removed and changed (by English term), for history and the audit log; at most 50 names each."""
    def keyed(doc):
        return {t["en"].lower(): t for t in ((doc or {}).get("terms") or []) if isinstance(t, dict) and t.get("en")}

    a, b = keyed(old), keyed(new)
    out: dict[str, Any] = {}
    for name, items in (("added", sorted(b.keys() - a.keys())), ("removed", sorted(a.keys() - b.keys())),
                        ("changed", sorted(k for k in a.keys() & b.keys() if a[k] != b[k]))):
        if items:
            out[name] = items[:50]
            if len(items) > 50:
                out[f"{name}_count"] = len(items)
    return out


GLOSSARY_KIND = DocKind(name="glossary", redis_key=GLOSSARY_KEY, validate=validate_glossary,
                        summarize=summarize_glossary, seed=seed_document, mirror=lambda document: {})


def active_glossary_from(row) -> ActiveGlossary:
    return ActiveGlossary(row.version, render_glossary(row.document["terms"]))
