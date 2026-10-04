from __future__ import annotations

import html
import re

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_PMID = re.compile(r"(?:ncbi\.nlm\.nih\.gov/pubmed|pubmed\.ncbi\.nlm\.nih\.gov)/(\d+)")
_ARXIV = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE)
_DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)


def strip_markup(value: str | None) -> str:
    if not value:
        return ""
    return _WS.sub(" ", html.unescape(_TAG.sub(" ", value))).strip()


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
