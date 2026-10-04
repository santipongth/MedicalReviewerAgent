"""Section selection shared by JATS (Europe PMC) and rendered pages (Crawl4AI markdown)."""
from __future__ import annotations

import re

from app.services.text import truncate

# Order matters: this is the order sections appear in the extracted text.
SECTION_RULES = (
    ("Methods", ("method", "materials", "patients and", "study design", "participants")),
    ("Results", ("result", "findings")),
    ("Discussion", ("discussion",)),
    ("Conclusions", ("conclusion",)),
)
_REFERENCES = re.compile(r"\n[ \t#*]*(references|bibliography|literature cited)[ \t*]*\n", re.IGNORECASE)


def classify_heading(label: str) -> str | None:
    label = label.lower()
    for name, needles in SECTION_RULES:
        if any(n in label for n in needles):
            return name
    return None


def assemble_sections(parts: list[tuple[str, str]], max_chars: int) -> str | None:
    parts = [(n, t) for n, t in parts if t]
    if not parts:
        return None
    overhead = sum(len(f"## {n}\n\n\n") for n, _ in parts)
    share = max(500, (max_chars - overhead) // len(parts))
    return "\n\n".join(f"## {name}\n{truncate(text, share)}" for name, text in parts)[:max_chars]


def drop_references(text: str) -> str:
    matches = list(_REFERENCES.finditer(text))
    if matches and matches[-1].start() > len(text) * 0.4:
        return text[: matches[-1].start()]
    return text
