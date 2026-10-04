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


# Share of the text budget per section: Results carry the numbers the extractor needs.
SECTION_WEIGHTS = {"Abstract": 0.12, "Methods": 0.23, "Results": 0.40, "Discussion": 0.15, "Conclusions": 0.10}


def _allocate(lengths: list[int], weights: list[float], budget: int) -> list[int]:
    """Weighted shares; a section shorter than its share gives the rest to the others."""
    alloc = [0] * len(lengths)
    active = set(range(len(lengths)))
    remaining = budget
    while active:
        total_w = sum(weights[i] for i in active)
        fits = [i for i in active if lengths[i] <= remaining * weights[i] / total_w]
        if not fits:
            for i in active:
                alloc[i] = max(500, int(remaining * weights[i] / total_w))
            break
        for i in fits:
            alloc[i] = lengths[i]
            remaining -= lengths[i]
            active.discard(i)
    return alloc


def assemble_sections(parts: list[tuple[str, str]], max_chars: int) -> str | None:
    parts = [(n, t) for n, t in parts if t]
    if not parts:
        return None
    overhead = sum(len(f"## {n}\n\n\n") for n, _ in parts)
    shares = _allocate([len(t) for _, t in parts], [SECTION_WEIGHTS.get(n, 0.1) for n, _ in parts],
                       max(0, max_chars - overhead))
    return "\n\n".join(f"## {name}\n{truncate(text, share)}"
                         for (name, text), share in zip(parts, shares, strict=True))[:max_chars]


# PDF text from Crawl4AI is often run-on ("... manuscript. REFERENCES 1. Siegel RL ..."), so also
# accept a references heading that is immediately followed by the first numbered entry.
_REFERENCES_INLINE = re.compile(
    r"\b(references|bibliography|literature cited)\b\s*:?\s+(?=\[?1[\].)]\s)", re.IGNORECASE
)


def drop_references(text: str) -> str:
    starts = [m.start() for m in _REFERENCES.finditer(text)]
    starts += [m.start() for m in _REFERENCES_INLINE.finditer(text)]
    if starts and max(starts) > len(text) * 0.4:
        return text[: max(starts)]
    return text


_HEADING = re.compile(r"^(#{1,4})\s+(.+?)\s*$", re.MULTILINE)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_NUMBERING = re.compile(r"^[\d.\s]+")


def clean_markdown(md: str) -> str:
    return " ".join(_LINK.sub(r"\1", _IMAGE.sub("", md)).split())


def extract_markdown_sections(md: str, *, max_chars: int) -> str | None:
    """Abstract + Methods/Results/Discussion/Conclusions from a rendered article page.

    A matched heading owns everything up to the next heading of the same or higher level, so
    numbered subsections (2.1, 2.3.1, ...) stay inside their parent section."""
    heads = list(_HEADING.finditer(md))
    abstract: str | None = None
    buckets: dict[str, list[str]] = {}
    owned_until = -1
    for i, h in enumerate(heads):
        if h.start() < owned_until:
            continue
        level = len(h.group(1))
        end = next((x.start() for x in heads[i + 1 :] if len(x.group(1)) <= level), len(md))
        label = _NUMBERING.sub("", h.group(2)).lower()
        if label.startswith("abstract") and abstract is None:
            abstract, owned_until = md[h.end() : end], end
        elif name := classify_heading(label):
            buckets.setdefault(name, []).append(md[h.end() : end])
            owned_until = end
    if not buckets:
        return None
    parts = [("Abstract", clean_markdown(abstract))] if abstract else []
    parts += [(name, clean_markdown(" ".join(buckets[name]))) for name, _ in SECTION_RULES if name in buckets]
    return assemble_sections(parts, max_chars)


def pdf_markdown_text(md: str, *, max_chars: int) -> str:
    return truncate(" ".join(drop_references(md).split()), max_chars)
