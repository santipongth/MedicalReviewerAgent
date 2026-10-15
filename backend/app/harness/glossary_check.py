"""Plan 22a: does a Thai translation use the glossary's Thai term for each glossary term in its English source?
Pure and measurement-only here; Plan 28 enforces it in localize. Items with no Thai script (kept in English by the
localization fallback) are skipped, not counted as misses."""
from __future__ import annotations

import re
from dataclasses import dataclass

_THAI = re.compile(r"[฀-๿]")
_ABBR = re.compile(r"\(([^)]+)\)\s*$")


@dataclass(frozen=True)
class GlossaryTerm:
    english: tuple[str, ...]
    thai: str
    abbr: str | None


def parse_glossary(text: str) -> list[GlossaryTerm]:
    terms: list[GlossaryTerm] = []
    for part in text.split(";"):
        if "=" not in part:
            continue
        en, th = (s.strip() for s in part.split("=", 1))
        m = _ABBR.search(th)
        abbr = m.group(1).strip() if m else None
        thai = _ABBR.sub("", th).strip()
        aliases = tuple(a.strip().lower() for a in en.split("/") if a.strip())
        if aliases and thai:
            terms.append(GlossaryTerm(aliases, thai, abbr))
    return terms


def default_terms() -> list[GlossaryTerm]:
    from app.harness.localize import GLOSSARY
    return parse_glossary(GLOSSARY["th"])


def _forms(alias: str) -> list[str]:
    """The alias and its plural or singular (last word only): `trial`/`trials`, `study`/`studies`, `events`/`event`."""
    low = alias.lower()
    forms = [alias, alias + "s", alias + "es"]
    if low.endswith("y"):
        forms.append(alias[:-1] + "ies")
    if low.endswith("ies"):
        forms.append(alias[:-3] + "y")
    if low.endswith("es"):
        forms.append(alias[:-2])
    if low.endswith("s"):
        forms.append(alias[:-1])
    return list(dict.fromkeys(forms))


def _mentions(source: str, alias: str) -> bool:
    """Plural-aware (Plan 31); the bare word `sensitivity` does not match inside `sensitivity analysis`."""
    alternatives = "|".join(re.escape(f) for f in sorted(_forms(alias), key=len, reverse=True))
    tail = r"(?!\s+analys[ie]s)" if alias.lower() == "sensitivity" else ""
    return re.search(rf"(?<![A-Za-z])(?:{alternatives})(?![A-Za-z]){tail}", source, re.IGNORECASE) is not None


def check_pair(source_en: str, text_th: str, terms: list[GlossaryTerm]) -> list[tuple[str, bool]]:
    if not text_th or not _THAI.search(text_th):
        return []
    return [(t.english[0], t.thai in text_th) for t in terms if any(_mentions(source_en, a) for a in t.english)]
