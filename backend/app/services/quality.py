from __future__ import annotations

import re

from app.services.text import normalize_title

_SECTION_WORDS = re.compile(
    r"\b(introduction|background|methods?|results?|discussion|conclusions?|references)\b", re.IGNORECASE
)


def looks_like_fulltext(text: str, title: str, *, pdf: bool) -> bool:
    """Reject cookie/consent banners, login or paywall stubs, and pages for a different paper."""
    if len(text) < (5000 if pdf else 3000):
        return False
    kinds = {m.group(1).lower().rstrip("s") for m in _SECTION_WORDS.finditer(text)}
    if len(kinds) < 2:
        return False
    words = [w for w in normalize_title(title).split() if len(w) >= 4]
    if words:
        low = text.lower()
        if sum(1 for w in words if w in low) / len(words) < 0.5:
            return False
    return True
