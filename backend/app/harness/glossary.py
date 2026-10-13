"""The Thai glossary the localizer's prompt carries (Plan 23c). While the admin console has saved no glossary, the
built-in GLOSSARY text (app/harness/localize.py) is used verbatim, so the localizer prompt is byte-identical to before
23c. A saved glossary is a list of terms rendered as "en = th (ABBR)" joined by "; ". Validation and storage live in
app/services/glossary_store.py; this module stays pure."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.harness.localize import GLOSSARY

_ABBR = re.compile(r"\(([^)]+)\)\s*$")


@dataclass(frozen=True)
class ActiveGlossary:
    version: int | None  # None: the built-in glossary
    text: str  # what the localizer prompt carries

    @property
    def label(self) -> str:
        return "file" if self.version is None else str(self.version)


SEED_GLOSSARY = ActiveGlossary(None, GLOSSARY["th"])


def seed_document() -> dict[str, Any]:
    """The built-in glossary as a document: one term per "en = th (ABBR)" entry, case kept."""
    terms = []
    for part in GLOSSARY["th"].split(";"):
        if "=" not in part:
            continue
        en, th = (s.strip() for s in part.split("=", 1))
        m = _ABBR.search(th)
        terms.append({"en": en, "th": _ABBR.sub("", th).strip(), "abbr": m.group(1).strip() if m else None,
                      "note": None})
    return {"terms": terms}


def render_term(term: dict[str, Any]) -> str:
    text = f"{term['en']} = {term['th']}"
    return f"{text} ({term['abbr']})" if term.get("abbr") else text


def render_glossary(terms: list[dict[str, Any]]) -> str:
    return "; ".join(render_term(t) for t in terms)


def glossary_of(deps: Any) -> ActiveGlossary:
    """The glossary a graph run uses: the deps' own (set when the worker loads, so one review keeps one), else the
    built-in one."""
    glossary = getattr(deps, "glossary", None)
    return glossary if isinstance(glossary, ActiveGlossary) else SEED_GLOSSARY
