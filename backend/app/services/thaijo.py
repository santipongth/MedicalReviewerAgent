"""ThaiJO (Thai Journals Online, TCI) as a search source (Plan 24). Abstract only, no crawling:
- search: `POST {base}/articles/search` (titles and metadata, no abstract); only health-category hits are kept;
- detail: `GET {base}/articles/{id}` for the English abstract of each hit taken into the pool (cached by id);
- OAI-PMH `GetRecord` (oai_dc) on the journal's own host, for the papers actually read: volume, issue, pages, ISSN,
  licence and article type.
Never `pdf_url`, never the HTML article page. The API is undocumented: every call is soft (the caller keeps going
without ThaiJO), spaced by HttpClient's per-host interval, never redirected and never retried."""
from __future__ import annotations

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.graph.schemas import Candidate
from app.services.http import HttpClient
from app.services.text import normalize_doi, strip_markup, truncate
from app.services.urlsafety import is_allowed_host, is_public_http_url

DOMAIN = "tci-thaijo.org"
_HEALTH = re.compile(r"health\d{2}", re.ASCII)  # health01-health05 seen 2026-10-13
_ARTICLE_ID = re.compile(r"(health\d{2})-(\d{1,10})", re.ASCII)
_ARTICLE_PATH = re.compile(r"/index\.php/([A-Za-z0-9_-]{1,64})/article/view/(\d{1,10})/?", re.ASCII)
MIN_ABSTRACT_CHARS = 150  # as retrieval.MIN_ABSTRACT_CHARS
MIN_LATIN_SHARE = 0.9  # an "English" abstract that is mostly Thai script is not one
MAX_ABSTRACT_CHARS = 6000  # bounds what an untrusted source can put into a prompt (seen: 800-2,600)
BUDDHIST_ERA_OFFSET = 543
PER_PAGE = 20
QUERIES = 3  # planner queries searched in ThaiJO
EXTRA_DETAILS = 5  # detail calls beyond the share cap, for hits without an English abstract
CONCURRENCY = 3
CACHE_PREFIX = "mra:thaijo:"
USER_AGENT = "MedicalReviewerAgent/0.1 (research; contact via repository)"


def gregorian_year(value: Any) -> int | None:
    """ThaiJO years are sometimes Buddhist era (2567): above 2400, 543 is subtracted."""
    text = str(value or "")
    ascii_digits = text.isascii() and text.isdigit() and len(text) <= 6
    year = value if isinstance(value, int) else int(text) if ascii_digits else None
    if year is not None and year > 2400:
        year -= BUDDHIST_ERA_OFFSET
    return year if year is not None and 1800 <= year <= 2100 else None


def article_link(url: Any, article_id: str | None = None) -> tuple[str, str, str] | None:
    """(host, journal path, submission id) of a ThaiJO article page, or None. Only https on *.tci-thaijo.org, with the
    article-view path and no query; when `article_id` is given its number must be the page's submission id."""
    if not isinstance(url, str) or len(url) > 300 or not is_allowed_host(url, DOMAIN):
        return None
    parsed = httpx.URL(url)
    match = _ARTICLE_PATH.fullmatch(parsed.path)
    if not match or parsed.query or parsed.fragment:
        return None
    if article_id is not None:
        id_match = _ARTICLE_ID.fullmatch(article_id)
        if not id_match or id_match.group(2) != match.group(2):
            return None
    return parsed.host.lower(), match.group(1), match.group(2)


def _text(value: Any, limit: int = 600) -> str:
    return truncate(strip_markup(value if isinstance(value, str) else ""), limit)


def _lang(value: Any, *, english_first: bool = True) -> Any:
    """The en_US entry of a {en_US, th_TH} field, else th_TH (or the reverse)."""
    if not isinstance(value, dict):
        return None
    order = ("en_US", "th_TH") if english_first else ("th_TH", "en_US")
    return next((value[k] for k in order if value.get(k)), None)


def english_abstract(detail: Any) -> str | None:
    """The detail record's English abstract, as plain text, when it is at least MIN_ABSTRACT_CHARS long and written in
    Latin script; else None ("-" and Thai text filed as English are seen)."""
    raw = ((detail or {}).get("abstracts") or {}).get("en_US") if isinstance(detail, dict) else None
    text = strip_markup(raw if isinstance(raw, str) else "")
    if len(text) < MIN_ABSTRACT_CHARS:
        return None
    letters = [ch for ch in text if ch.isalpha()]
    if not letters or sum(ch.isascii() for ch in letters) < MIN_LATIN_SHARE * len(letters):
        return None
    return truncate(text, MAX_ABSTRACT_CHARS)


@dataclass(frozen=True)
class ThaiJoHit:
    id: str
    title: str
    article_url: str
    authors: list[str] = field(default_factory=list)
    journal: str | None = None
    year: int | None = None
    doi: str | None = None


def parse_hit(h: Any) -> ThaiJoHit | None:
    """A search hit in a health category with a well-formed id and article page, else None."""
    if not isinstance(h, dict) or not isinstance(h.get("category"), str) or not _HEALTH.fullmatch(h["category"]):
        return None
    hid = h.get("id")
    if (not isinstance(hid, str) or not hid.startswith(f"{h['category']}-")
            or not article_link(h.get("article_url"), hid)):
        return None
    title = _text(_lang(h.get("titles")), 500).rstrip(".")
    if not title:
        return None
    names = _lang(h.get("authors"))
    authors = [" ".join(_text(a, 120).split()) for a in names if isinstance(a, str)] if isinstance(names, list) else []
    journal = _text(_lang(h.get("journal_name")), 300) or None
    return ThaiJoHit(id=hid, title=title, article_url=h["article_url"], authors=[a for a in authors if a][:20],
                     journal=journal, year=gregorian_year(h.get("year")),
                     doi=normalize_doi(h["doi"]) if isinstance(h.get("doi"), str) else None)


def to_candidate(hit: ThaiJoHit, abstract: str) -> Candidate:
    return Candidate(title=hit.title, abstract=abstract, abstract_source="thaijo", doi=hit.doi, year=hit.year,
                     journal=hit.journal, authors=list(hit.authors), url=hit.article_url,
                     thaijo_url=hit.article_url, engines=["thaijo"])


def query_words(query: str) -> str:
    """Words, spaces and hyphens only, at most 200 characters: the search never carries user syntax."""
    return " ".join(re.sub(r"[^\w\s-]", " ", query or "").split())[:200]


# ---- OAI-PMH --------------------------------------------------------------------------------------------------
_OAI = "{http://www.openarchives.org/OAI/2.0/}"
_OAI_DC = "{http://www.openarchives.org/OAI/2.0/oai_dc/}dc"
_DC = "{http://purl.org/dc/elements/1.1/}"
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
MAX_XML_BYTES = 512_000
# xml.etree never fetches external entities, but an internal DTD can still expand entities ("billion laughs"); an
# OAI-PMH record never needs one, so any document with a DTD or entity declaration is refused before parsing.
_DTD = re.compile(rb"<!\s*(?:DOCTYPE|ENTITY)", re.IGNORECASE)
_ISSN = re.compile(r"\d{4}-\d{3}[\dX]", re.ASCII)
_VOLUME = re.compile(r"\bVol\.?\s*([0-9A-Za-z-]{1,10})|ปีที่\s*([0-9A-Za-z-]{1,10})")
_ISSUE = re.compile(r"\bNo\.?\s*([0-9A-Za-z-]{1,10})|ฉบับที่\s*([0-9A-Za-z-]{1,10})")
_PAGES = re.compile(r"[A-Za-z]?\d{1,6}(?:\s*[-–]\s*[A-Za-z]?\d{1,6})?", re.ASCII)
_LICENSE = re.compile(r"https?://creativecommons\.org/(?:licenses|publicdomain)/[a-z-]{2,20}/\d\.\d/?", re.ASCII)


class UnsafeXml(ValueError):
    pass


def _first_group(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return next((g for g in match.groups() if g), None) if match else None


def parse_oai_record(body: bytes, identifier: str) -> dict[str, Any] | None:
    """The bibliographic fields of an oai_dc GetRecord answer: `{volume, issue, pages, issn[], license, article_type}`
    (each null or empty when absent), or None when the record is missing, deleted or not the one asked for, or holds
    none of them. Raises UnsafeXml for a DTD or an oversized body, and ET.ParseError for broken XML."""
    # PKP answers in UTF-8. A NUL byte or a UTF-16/32 byte-order mark means another encoding, which expat would
    # autodetect and which would hide a DTD from the ASCII check below, so it is refused.
    if (len(body) > MAX_XML_BYTES or _DTD.search(body) or b"\x00" in body
            or body.startswith((b"\xfe\xff", b"\xff\xfe"))):
        raise UnsafeXml("refused: DTD, oversized or non-UTF-8 OAI-PMH answer")
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise
    except ValueError as exc:  # e.g. a declared encoding expat cannot decode
        raise UnsafeXml("refused: unsupported encoding in OAI-PMH answer") from exc
    record = root.find(f"{_OAI}GetRecord/{_OAI}record")
    if record is None:
        return None
    header = record.find(f"{_OAI}header")
    if header is None or header.get("status") == "deleted" or header.findtext(f"{_OAI}identifier") != identifier:
        return None
    dc = record.find(f"{_OAI}metadata/{_OAI_DC}")
    if dc is None:
        return None

    def values(tag: str) -> list[tuple[str, str]]:
        return [((e.get(_XML_LANG) or "").lower(), _text(e.text, 300)) for e in dc.findall(f"{_DC}{tag}")]

    sources = values("source")
    issn = list(dict.fromkeys(v.upper() for _, v in sources if _ISSN.fullmatch(v.upper())))
    citation = next((v for lang, v in sources if lang.startswith("en") and ";" in v), None) or next(
        (v for _, v in sources if ";" in v), "")
    parts = [p.strip() for p in citation.split(";")]
    issue_text = "; ".join(parts[1:])  # after the journal name, which may itself hold "No."
    pages = parts[-1] if len(parts) >= 3 and _PAGES.fullmatch(parts[-1]) else None
    licence = next((v for _, v in values("rights") if _LICENSE.fullmatch(v)), None)
    article_type = next((v for lang, v in values("type") if lang.startswith("en") and v
                         and not v.startswith("info:")), None)
    bib = {"volume": _first_group(_VOLUME, issue_text), "issue": _first_group(_ISSUE, issue_text),
           "pages": re.sub(r"\s*[-–]\s*", "-", pages) if pages else None, "issn": issn,
           "license": licence, "article_type": truncate(article_type, 80) if article_type else None}
    return bib if any(bib.values()) else None


class ThaiJoClient:
    def __init__(self, http: HttpClient, base_url: str, *, cache=None, timeout: float = 5.0,
                 cache_ttl: int = 604800, resolver=None) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.cache = cache  # a Redis client (decode_responses=True) or None: the cache is optional
        self.timeout = timeout
        self.cache_ttl = cache_ttl
        self.resolver = resolver  # DNS resolver for the OAI host check (tests pass a fake)
        self._headers = {"User-Agent": USER_AGENT}

    async def _cache_get(self, key: str) -> Any:
        if self.cache is None:
            return None
        try:
            raw = await self.cache.get(CACHE_PREFIX + key)
            return json.loads(raw) if raw else None
        except Exception:  # noqa: BLE001 - a cache failure only costs a request
            return None

    async def _cache_set(self, key: str, value: Any) -> None:
        if self.cache is None:
            return
        try:
            await self.cache.set(CACHE_PREFIX + key, json.dumps(value), ex=self.cache_ttl)
        except Exception:  # noqa: BLE001
            return

    async def search(self, query: str) -> list[ThaiJoHit]:
        """One page of hits for the query, health categories only, in ThaiJO's order. Raises on any failure."""
        words = query_words(query)
        if not words:
            return []
        resp = await self.http.post(
            f"{self.base_url}/articles/search", headers=self._headers, timeout=self.timeout, retries=0,
            follow_redirects=False,
            json={"q": words, "page": 1, "per_page": PER_PAGE, "highlight": False, "facets": False})
        resp.raise_for_status()
        hits = resp.json().get("hits")
        parsed: list[ThaiJoHit] = []
        for raw in hits if isinstance(hits, list) else []:
            try:
                hit = parse_hit(raw)
            except Exception:  # noqa: BLE001 - one malformed hit never drops the others
                hit = None
            if hit:
                parsed.append(hit)
        return parsed

    async def abstract(self, article_id: str, stats: dict[str, int] | None = None) -> str | None:
        """The English abstract of one article (None when it has none or is unknown), cached by id. Raises on any
        other failure."""
        if not _ARTICLE_ID.fullmatch(article_id):
            return None
        cached = await self._cache_get(f"abs:{article_id}")
        if isinstance(cached, dict) and "en" in cached:
            if stats is not None:
                stats["cache_hits"] = stats.get("cache_hits", 0) + 1
            return cached["en"] if isinstance(cached["en"], str) else None
        resp = await self.http.get(f"{self.base_url}/articles/{article_id}", headers=self._headers,
                                   timeout=self.timeout, retries=0, follow_redirects=False)
        if resp.status_code == 404:
            text = None
        else:
            resp.raise_for_status()
            text = english_abstract(resp.json())
        await self._cache_set(f"abs:{article_id}", {"en": text})
        return text

    async def collect(self, queries: list[str], *, limit: int, out: list[Candidate], stats: dict[str, int]) -> None:
        """Candidates with an English abstract, at most `limit`, appended to `out` in ThaiJO's rank order
        (round-robin across the queries, a hit found twice kept once). Fills `out` and `stats` in place, so a caller
        that times out keeps what arrived. Raises only when every search failed."""
        for k in ("hits", "detailed", "no_abstract", "search_failed", "detail_failed", "cache_hits"):
            stats.setdefault(k, 0)
        qs = [q for q in dict.fromkeys(query_words(q) for q in queries) if q][:QUERIES]
        if limit <= 0 or not qs:
            return
        results = await asyncio.gather(*(self.search(q) for q in qs), return_exceptions=True)
        failed = [r for r in results if isinstance(r, BaseException)]
        for exc in failed:
            if not isinstance(exc, Exception):  # cancellation is never swallowed
                raise exc
        if len(failed) == len(results):
            raise failed[0]
        stats["search_failed"] = len(failed)
        lists = [r for r in results if not isinstance(r, BaseException)]
        hits: list[ThaiJoHit] = []
        seen: set[str] = set()
        for rank in range(max((len(v) for v in lists), default=0)):
            for v in lists:
                if rank < len(v) and v[rank].id not in seen:
                    seen.add(v[rank].id)
                    hits.append(v[rank])
        stats["hits"] = len(hits)
        budget = min(len(hits), limit + EXTRA_DETAILS)
        tried = 0
        # CONCURRENCY details at a time, kept in rank order; a timeout loses at most the batch in flight
        while len(out) < limit and tried < budget:
            batch = hits[tried: tried + min(CONCURRENCY, limit - len(out), budget - tried)]
            tried += len(batch)
            stats["detailed"] = tried
            texts = await asyncio.gather(*(self.abstract(h.id, stats) for h in batch), return_exceptions=True)
            for hit, text in zip(batch, texts, strict=True):
                if isinstance(text, BaseException):
                    if not isinstance(text, Exception):
                        raise text
                    stats["detail_failed"] += 1
                elif text is None:
                    stats["no_abstract"] += 1
                else:
                    out.append(to_candidate(hit, text))

    async def record(self, article_url: str) -> dict[str, Any] | None:
        """Bibliographic fields from the journal's OAI-PMH record of a ThaiJO article page (`parse_oai_record`),
        cached; None when the page is not a ThaiJO article or the record is missing. The host comes from the page
        URL, so it must be a *.tci-thaijo.org host that resolves to public addresses only. Raises on any other
        failure."""
        link = article_link(article_url)
        if link is None:
            return None
        host, journal, submission = link
        key = f"oai:{host}:{submission}"
        cached = await self._cache_get(key)
        if isinstance(cached, dict) and "bib" in cached and (cached["bib"] is None or isinstance(cached["bib"], dict)):
            return cached["bib"]  # anything else is a corrupt entry: a miss
        # Residual risks: DNS may change between this check and the request (TLS to a *.tci-thaijo.org name limits
        # it); the body is read whole before the size check, so only the timeout bounds it (the host is allow-listed).
        url = f"https://{host}/index.php/{journal}/oai"
        if not await is_public_http_url(url, self.resolver):
            raise PermissionError(f"OAI host {host} does not resolve to public addresses")
        identifier = f"oai:{host}:article/{submission}"
        resp = await self.http.get(url, params={"verb": "GetRecord", "metadataPrefix": "oai_dc",
                                                "identifier": identifier},
                                   headers=self._headers, timeout=self.timeout, retries=0, follow_redirects=False)
        resp.raise_for_status()
        bib = parse_oai_record(resp.content, identifier)
        await self._cache_set(key, {"bib": bib})
        return bib
