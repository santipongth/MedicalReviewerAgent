from __future__ import annotations

import html
import re

# Known tag names only (HTML, JATS, MathML; optional "jats:"/"mml:" prefix; strict attribute grammar), so clinical
# notation survives: "p<0.001", "aged >65", "ALT <ULN in 40 patients and >3xULN in 12". A superscript opens with "^"
# so a power never reads as a different number ("10<jats:sup>9</jats:sup>/L" -> "10^9/L", not "109/L"); other inline
# tags join with no space ("CO<sub>2</sub>" -> "CO2"); every other known tag becomes a space. Tags are removed before entities
# are unescaped, so "&lt;" stays a literal "<". Same rules as infra/searxng/engines/mra_markup.py (keep in step).
_INLINE_NAMES = r"sub|sup|i|b|em|strong|span|u|small|italic|bold|sc|underline|monospace"
_BLOCK_NAMES = (
    r"p|sec|title|abstract|br|hr|div|list|list-item|ext-link|xref|h[1-6]|a|label|ul|ol|li"
    r"|table|thead|tbody|tfoot|tr|td|th|caption|table-wrap|inline-formula|disp-formula"
    r"|named-content|break|math|mi|mo|mn|ms|mtext|mrow|msub|msup|msubsup|mfrac|msqrt|mroot"
    r"|mover|munder|munderover|mspace|mstyle|mtable|mtr|mtd|semantics|annotation"
)
_ATTRS = r"""(?:\s+[A-Za-z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*/?"""


def _tag(names: str) -> re.Pattern[str]:
    return re.compile(rf"<(?:/(?:(?:jats|mml):)?(?:{names})\s*|(?:(?:jats|mml):)?(?:{names}){_ATTRS})>",
                      re.IGNORECASE)


_SUP_OPEN = re.compile(rf"<(?:(?:jats|mml):)?sup{_ATTRS}>", re.IGNORECASE)
_INLINE_TAG = _tag(_INLINE_NAMES)
_TAG = _tag(_BLOCK_NAMES)
_WS = re.compile(r"\s+")
_PMID = re.compile(r"(?:ncbi\.nlm\.nih\.gov/pubmed|pubmed\.ncbi\.nlm\.nih\.gov|europepmc\.org/article/MED)/(\d+)")
_ARXIV = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE)
_DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)


def strip_markup(value: str | None) -> str:
    if not value:
        return ""
    return _WS.sub(" ", html.unescape(_TAG.sub(" ", _INLINE_TAG.sub("", _SUP_OPEN.sub("^", value))))).strip()


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = _DOI_PREFIX.sub("", value.strip()).strip().lower()
    return doi if doi.startswith("10.") else None


def normalize_title(value: str | None) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").lower()))


def pmid_from_url(url: str | None) -> str | None:
    match = _PMID.search(url or "")
    return match.group(1) if match else None


def arxiv_id_from_url(url: str | None) -> str | None:
    match = _ARXIV.search(url or "")
    return match.group(1) if match else None


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + " …"
