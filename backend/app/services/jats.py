from __future__ import annotations

import xml.etree.ElementTree as ET

from app.services.sections import SECTION_RULES, assemble_sections, classify_heading


def _text(el: ET.Element) -> str:
    return " ".join("".join(el.itertext()).split())


def extract_jats_text(xml: str, *, max_chars: int) -> str | None:
    """Abstract + Methods/Results/Discussion/Conclusions from a JATS article, within budget.

    References, acknowledgements, figures-only content and the introduction are dropped."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    sections: dict[str, list[str]] = {}
    body = root.find("body")
    if body is not None:
        for sec in body.findall("sec"):
            name = classify_heading(f"{sec.get('sec-type') or ''} {sec.findtext('title') or ''}")
            if name:
                title = sec.find("title")
                if title is not None:
                    sec.remove(title)
                sections.setdefault(name, []).append(_text(sec))
    if not sections:
        return None
    abstract_el = root.find(".//article-meta/abstract")
    parts: list[tuple[str, str]] = []
    if abstract_el is not None:
        parts.append(("Abstract", _text(abstract_el)))
    parts += [(name, " ".join(sections[name])) for name, _ in SECTION_RULES if name in sections]
    return assemble_sections(parts, max_chars)
