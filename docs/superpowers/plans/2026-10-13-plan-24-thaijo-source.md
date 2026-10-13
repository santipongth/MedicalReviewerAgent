# Plan 24: ThaiJO as a Search Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Thai Journals Online (TCI's ThaiJO) as an optional search source: Thai health studies with an English abstract join the candidate pool under a share cap, the papers that are read get volume, issue, pages, ISSN, licence and type from the journal's OAI-PMH record, and the report names and links the source. It ships off (`THAIJO_ENABLED=false`) until the owner has TCI's answer.

**Architecture:**
- **Client** (`app/services/thaijo.py`): search (`POST /api/v1/articles/search`, health categories filtered here), detail (`GET /api/v1/articles/{id}`, English abstract, cached by id) and OAI-PMH `GetRecord` (bibliographic fields, cached, host checked). Never `pdf_url`, never the HTML page. No retries, no redirects, an identifying User-Agent, 0.2 s per-host spacing.
- **Search node** (`retrieval.make_search`): ThaiJO runs alongside SearXNG under its own 12 s budget and becomes one more round-robin list, at most `min(15, candidate_limit // 8)` candidates. Failures are soft (`errors`, `quality.thaijo`, a log line).
- **OAI step** (`app/graph/nodes/thaijo.py`): a `thaijo_metadata` node sent from `select_top` beside `read_paper` for the selected ThaiJO papers only; `finalize` adds `thaijo_url` and `bib` to each paper.
- **Report:** the "ThaiJO" source label (Methods, title block, PRISMA), the article-page link (source rail, references) and `Year;Vol(Issue):Pages` in Vancouver references, backend Markdown and frontend alike.
- **Cache key:** `+thaijo` while the flag is on. No prompt or LLM schema changes, so `prompt_version` stays.

**Tech Stack:** Python 3.12, httpx, LangGraph, stdlib `xml.etree`, Redis (fakeredis in tests), respx; Next.js 16, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-24-thaijo-source-design.md`

**Worktree:** `D:\MRA-plan-24` (branch `plan-24-thaijo`).
- It was created from master `5658db0` (Plans 22a, 23a, 23b and 23c merged). Its first commit holds the spec, this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-24-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-24/backend` or `cd /d/MRA-plan-24/frontend`.
- The frontend needs `npm ci` once (Task 8).
- **Existing interfaces this plan uses**, checked against master `5658db0` on 2026-10-13:
  - `HttpClient(timeout, user_agent, min_interval, retries, backoff, transport, sleep)`, `.get(url, *, params, headers, timeout, retries)`, `DEFAULT_MIN_INTERVAL`, `RETRY_STATUSES`;
  - `is_public_http_url(url, resolver)`; `strip_markup`, `normalize_doi`, `truncate` (`app/services/text.py`);
  - `Candidate` (`app/graph/schemas.py`), `merge_candidates` and `SCALARS`/`_SOURCE_RANK` (`app/services/dedupe.py`);
  - `make_search`, `make_enrich`, `MIN_ABSTRACT_CHARS` and the `per_query` round-robin with `trials:` keys (`app/graph/nodes/retrieval.py`);
  - `route_to_reading(state, external_enabled, citations_enabled)` and `_add_review_nodes` (`app/graph/graph.py`), `GraphDeps`, `build_graph_deps(settings, http, redis, catalog, *, resolved, sem, config_version, glossary)`;
  - `make_finalize`'s `out_papers` dict (`app/graph/nodes/synthesis.py`), `summarize_quality` (`app/harness/quality.py`), `ReviewService._version()`;
  - `_citation_parts`/`vancouver`/`render_markdown` (`app/services/report.py`), `citationParts`/`vancouver` (`src/lib/citation.ts`), `SOURCE_NAME`/`sourceNames` (`src/lib/report-view.ts`), `sourceRows` (`src/lib/prisma-flow.ts`), `Links` in `source-rail.tsx`, `ID_NAME` in `references.tsx`;
  - test helpers `tests/unit/test_nodes_retrieval.py` (`ABSTRACT`, `FakeSearxng`, `FakeEpmc`), `tests/unit/test_review_graph.py` (`ABSTRACT`, `make_deps`, `run`), `tests/unit/test_plan20_task6.py` (`FULL`, `_review`), the `client`/`app` fixtures (`tests/conftest.py`), `resultFixture` (`src/test/fixtures`).
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** none new, backend or frontend. `defusedxml` is not a dependency: OAI XML is parsed with stdlib `xml.etree.ElementTree` after refusing any body that contains `<!DOCTYPE` or `<!ENTITY` (any case) or is over 512,000 bytes.
- **Off by default:** `THAIJO_ENABLED` (env only, default `false`). It is not one of the 23c console settings (that set stays exactly 13). Nothing in this plan turns it on outside a test or the controller's one-command smoke check.
- **Never:** `pdf_url` (read, stored or linked), the HTML article page, Thai abstracts in the result, real ThaiJO responses in the repository. Test data is synthetic (`backend/tests/unit/thaijo_data.py`).
- **Requests:** User-Agent `MedicalReviewerAgent/0.1 (research; contact via repository)`; `retries=0`; `follow_redirects=False`; per request `THAIJO_REQUEST_TIMEOUT_SECONDS` (5); whole search and OAI step `THAIJO_TIMEOUT_SECONDS` (12); `www.tci-thaijo.org` spaced 0.2 s per process; detail lookups 3 at a time in rank order, at most cap + 5 per review; at most 3 planner queries, `per_page` 20, page 1; OAI 2 at a time, only for selected ThaiJO papers.
- **Candidates:** health categories (`^health\d{2}$`) only; id `^<category>-\d{1,10}$`; `article_url` must pass `article_link` (https, `tci-thaijo.org` or a subdomain, default port, no user info, `/index.php/<journal>/article/view/<id>`, no query, and its id must equal the hit's); English abstract ≥ 150 characters after `strip_markup`, ≥ 90% Latin letters, capped at 6,000; a year above 2400 has 543 subtracted, outside 1800–2100 it is null; `abstract_source="thaijo"`, `engines=["thaijo"]`, `url = thaijo_url = article_url`.
- **Share cap:** `min(settings.thaijo_max_candidates, options.candidate_limit // 8)` (120 → 15, 60 → 7, 40 → 5, 20 → 2).
- **Redis keys:** `mra:thaijo:abs:{id}` = `{"en": str | null}` and `mra:thaijo:oai:{host}:{submission}` = `{"bib": dict | null}`, TTL `THAIJO_CACHE_TTL_SECONDS` (604800). Errors are never cached; a Redis failure is ignored.
- **Result:** each `papers[]` entry gains `thaijo_url` and `bib` (`{volume, issue, pages, issn[], license, article_type}` or null); `methods.sources.thaijo`; `quality.thaijo` (absent while off). The cache key gains `+thaijo` while on.
- **Prompts:** unchanged. `prompt_version` stays `2026-10-12.1`; `tests/unit/test_prompts_by_type.py` is not touched.
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\`, which corrupts regexes. Use the editor tools.
- **Commits:** each message is written to a file and committed with `git commit -F <file>` (`-F -` with a heredoc fails on this host), using the session's scratchpad directory (below as `$MSG`, e.g. `$SCRATCH/commit-msg.txt`). Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Do not touch** `D:\MedicalReviewerAgent` until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`.

## Review Focus

1. **SSRF and redirects** (Tasks 1, 3, 4):
   - `article_link` refuses other hosts, look-alike hosts, http, ports, user info, queries, non-article paths and a mismatched id (Task 3, `test_article_links_are_checked_against_the_host_the_path_and_the_id`).
   - `record()` never calls a host outside ThaiJO, the PDF link or a private address, and never follows a redirect (Task 4, `test_record_never_calls_a_host_outside_thaijo_or_a_private_address`, `test_record_does_not_follow_redirects_and_raises_on_errors`); the search never follows one either (Task 3, `test_search_never_follows_a_redirect`; Task 1, `test_follow_redirects_false_returns_the_redirect_instead_of_leaving_the_host`).
2. **XML** (Task 4): a DTD (any case), an entity declaration, an oversized body and broken XML are refused (`test_a_dtd_or_an_oversized_answer_is_refused_before_parsing`).
3. **Soft-fail and the share cap** (Task 5): a failing or slow ThaiJO never fails the search and keeps what arrived (`test_a_failing_thaijo_never_fails_the_search`, `test_a_slow_thaijo_is_cut_at_its_timeout_and_keeps_what_arrived`); the cap follows the pool (`test_the_share_cap_is_at_most_15_and_an_eighth_of_the_pool`, `test_the_cap_follows_the_pool_size`); with the flag off nothing changes (`test_without_thaijo_nothing_changes`, `test_the_client_exists_only_when_enabled`).
4. **Untrusted text and the abstract rule** (Task 3): markup stripped, entities unescaped, Thai text under `en_US` and `"-"` refused, 150-character floor, 6,000-character cap (`test_english_abstract_needs_150_latin_characters`); only health hits with valid pages (`test_parse_hit_keeps_health_hits_with_a_valid_page_only`).
5. **Load on TCI** (Tasks 1, 3): no retry on 5xx (`test_search_posts_the_words_with_an_identifying_agent_and_no_retry`), cached abstracts including misses (`test_abstracts_are_cached_by_id_including_the_ones_that_are_missing`), at most cap + 5 lookups (`test_collect_keeps_rank_order_dedupes_and_stops_at_the_limit`).
6. **Cache key and eval** (Task 5): turning the flag on starts a new cache generation (`test_turning_thaijo_on_starts_a_new_cache_generation`); a frozen pool names `thaijo` when it was searched (`test_a_frozen_pool_names_thaijo_when_it_was_searched`).
7. **References agree** (Tasks 7, 8): the backend and the frontend produce the same string for the same ThaiJO paper (`test_a_thaijo_reference_has_volume_issue_pages_and_its_page`, "adds volume, issue, pages and the article page (the backend's rules, byte for byte)"), and never link a page outside ThaiJO.

---

### Task 1: HTTP POST, a no-redirect option, the host allow-list and ThaiJO spacing

**Files:**
- Modify: `backend/app/services/http.py`
- Modify: `backend/app/services/urlsafety.py`
- Test: `backend/tests/unit/test_http_post_and_hosts.py`

**Interfaces:**
- Consumes: `HttpClient` and `DEFAULT_MIN_INTERVAL` as on master.
- Produces:
  - `HttpClient.get(url, *, params=None, headers=None, timeout=None, retries=None, follow_redirects=None)` (new keyword; None keeps following redirects).
  - `HttpClient.post(url, *, json=None, headers=None, timeout=None, retries=None, follow_redirects=None)`, with the same per-host spacing and retry rules as `get`.
  - `HttpClient._send(method, url, *, params, json, headers, timeout, retries, follow_redirects)`.
  - `DEFAULT_MIN_INTERVAL["www.tci-thaijo.org"] == 0.2`.
  - `is_allowed_host(url: str, domain: str) -> bool` in `app/services/urlsafety.py`.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_http_post_and_hosts.py` (new file, complete):

```python
import httpx
import respx

from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.urlsafety import is_allowed_host


async def _nosleep(_):
    return None


@respx.mock
async def test_post_sends_json_and_retries_like_get():
    route = respx.post("https://api.example.org/s").mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json={"hits": []})])
    client = HttpClient(retries=1, backoff=0.1, sleep=_nosleep)
    resp = await client.post("https://api.example.org/s", json={"q": "metformin"})
    await client.aclose()
    assert resp.status_code == 200 and route.call_count == 2
    assert route.calls[-1].request.content == b'{"q":"metformin"}'


@respx.mock
async def test_follow_redirects_false_returns_the_redirect_instead_of_leaving_the_host():
    respx.get("https://a.example.org/x").mock(
        return_value=httpx.Response(302, headers={"Location": "http://169.254.169.254/latest"}))
    other = respx.get("http://169.254.169.254/latest").mock(return_value=httpx.Response(200))
    client = HttpClient(retries=0, sleep=_nosleep)
    resp = await client.get("https://a.example.org/x", follow_redirects=False)
    await client.aclose()
    assert resp.status_code == 302 and other.call_count == 0


def test_thaijo_api_is_spaced_like_europe_pmc():
    assert DEFAULT_MIN_INTERVAL["www.tci-thaijo.org"] == 0.2


def test_allowed_host_takes_only_https_on_the_domain():
    ok = ["https://he01.tci-thaijo.org/index.php/x/oai", "https://www.tci-thaijo.org/api/v1/articles/search",
          "https://tci-thaijo.org/", "https://HE02.TCI-THAIJO.ORG/a", "https://he01.tci-thaijo.org:443/a"]
    bad = ["http://he01.tci-thaijo.org/a", "https://tci-thaijo.org.evil.example/a", "https://eviltci-thaijo.org/a",
           "https://user@he01.tci-thaijo.org/a", "https://he01.tci-thaijo.org:8443/a", "https://169.254.169.254/",
           "ftp://he01.tci-thaijo.org/a", "not a url", ""]
    assert all(is_allowed_host(u, "tci-thaijo.org") for u in ok)
    assert not any(is_allowed_host(u, "tci-thaijo.org") for u in bad)
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_http_post_and_hosts.py -q`
Expected: collection error, `ImportError: cannot import name 'is_allowed_host' from 'app.services.urlsafety'`.

- [ ] **Step 3: Implement**

`backend/app/services/http.py` (replace the whole file with):

```python
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

RETRY_STATUSES = {429, 500, 502, 503, 504}
# ThaiJO (Plan 24): at most 5 requests a second per process to its undocumented API (politeness; no published limit).
DEFAULT_MIN_INTERVAL = {"www.ebi.ac.uk": 0.2, "www.tci-thaijo.org": 0.2}


class HttpClient:
    """Shared outbound client: per-host minimum spacing + retry with exponential backoff."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        user_agent: str = "MedicalReviewerAgent/0.1 (+literature review)",
        min_interval: dict[str, float] | None = None,
        retries: int = 3,
        backoff: float = 0.5,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    ) -> None:
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": user_agent},
            follow_redirects=True,
            transport=transport,
        )
        self._min_interval = dict(min_interval or {})
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self.retries = retries
        self.backoff = backoff
        self._sleep = sleep

    async def _throttle(self, host: str) -> None:
        interval = self._min_interval.get(host)
        if not interval:
            return
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = self._last.get(host, 0.0) + interval - time.monotonic()
            if wait > 0:
                await self._sleep(wait)
            self._last[host] = time.monotonic()

    async def get(
        self, url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None,
        timeout: float | None = None, retries: int | None = None, follow_redirects: bool | None = None,
    ) -> httpx.Response:
        return await self._send("GET", url, params=params, headers=headers, timeout=timeout, retries=retries,
                                follow_redirects=follow_redirects)

    async def post(
        self, url: str, *, json: Any = None, headers: dict[str, str] | None = None, timeout: float | None = None,
        retries: int | None = None, follow_redirects: bool | None = None,
    ) -> httpx.Response:
        """POST with a JSON body, under the same per-host spacing and retry rules as `get`."""
        return await self._send("POST", url, json=json, headers=headers, timeout=timeout, retries=retries,
                                follow_redirects=follow_redirects)

    async def _send(
        self, method: str, url: str, *, params: dict[str, Any] | None = None, json: Any = None,
        headers: dict[str, str] | None = None, timeout: float | None = None, retries: int | None = None,
        follow_redirects: bool | None = None,
    ) -> httpx.Response:
        """`follow_redirects=False` refuses to leave the asked host (a 3xx comes back as the response); None keeps
        the client's default (follow)."""
        host = httpx.URL(url).host
        retries = self.retries if retries is None else retries
        for attempt in range(retries + 1):
            await self._throttle(host)
            try:
                kwargs: dict[str, Any] = {"params": params, "headers": headers}
                if json is not None:
                    kwargs["json"] = json
                if timeout is not None:
                    kwargs["timeout"] = timeout
                if follow_redirects is not None:
                    kwargs["follow_redirects"] = follow_redirects
                resp = await self._client.request(method, url, **kwargs)
            except httpx.TransportError:
                if attempt == retries:
                    raise
            else:
                if resp.status_code not in RETRY_STATUSES or attempt == retries:
                    return resp
            await self._sleep(self.backoff * 2**attempt)
        raise AssertionError("unreachable")

    async def aclose(self) -> None:
        await self._client.aclose()
```

`backend/app/services/urlsafety.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)
```

   with:

```python
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)


def is_allowed_host(url: str, domain: str) -> bool:
    """True only for an https URL on `domain` or one of its subdomains, with no user info and the default port.

    Guards outbound calls whose URL comes from a third-party response (ThaiJO's article_url, Plan 24): such a URL
    must not make the server call any other host."""
    try:
        parsed = httpx.URL(url)
    except Exception:  # noqa: BLE001 - an unparsable URL is never allowed
        return False
    host = (parsed.host or "").lower().rstrip(".")
    return (parsed.scheme == "https" and not parsed.userinfo and parsed.port in (None, 443)
            and (host == domain or host.endswith(f".{domain}")))
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_http_post_and_hosts.py tests/unit/test_http_and_searxng.py -q`
Expected: 39 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2135 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/services/http.py backend/app/services/urlsafety.py backend/tests/unit/test_http_post_and_hosts.py
cat > "$MSG" <<'EOF'
feat(http): POST, a per-call no-redirect option, an https host allow-list and ThaiJO spacing (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 2: Settings, the candidate's ThaiJO fields and de-duplication

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/graph/schemas.py`
- Modify: `backend/app/services/dedupe.py`
- Test: `backend/tests/unit/test_thaijo_candidate.py`

**Interfaces:**
- Consumes: `EuropePmcClient.TRIAL_TIMEOUT` (8.0), `Settings.openalex_timeout_seconds`, `Settings.searxng_timeout_seconds`.
- Produces:
  - `Settings.thaijo_enabled: bool = False`, `thaijo_url = "https://www.tci-thaijo.org/api/v1"`, `thaijo_max_candidates = 15`, `thaijo_timeout_seconds = 12.0`, `thaijo_request_timeout_seconds = 5.0`, `thaijo_cache_ttl_seconds = 604800`.
  - `Candidate.abstract_source` accepts `"thaijo"`; `Candidate.thaijo_url: str | None = None`.
  - `dedupe.SCALARS` includes `"thaijo_url"`; `_SOURCE_RANK["thaijo"] == 1`.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_thaijo_candidate.py` (new file, complete):

```python
from app.config import Settings
from app.graph.schemas import Candidate
from app.services.dedupe import merge_candidates
from app.services.europepmc import EuropePmcClient

ART = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
ABSTRACT = ("Background: a synthetic abstract written for tests. Methods: a cross-sectional survey of 120 adults "
            "in a district hospital. Results: adherence was 71.5%. Conclusion: support programmes are needed.")


def test_thaijo_is_off_by_default_and_faster_than_the_other_sources():
    s = Settings(_env_file=None)
    assert s.thaijo_enabled is False and s.thaijo_url == "https://www.tci-thaijo.org/api/v1"
    assert s.thaijo_max_candidates == 15 and s.thaijo_cache_ttl_seconds == 7 * 86400
    assert s.thaijo_timeout_seconds < s.searxng_timeout_seconds
    assert s.thaijo_request_timeout_seconds < min(s.openalex_timeout_seconds, EuropePmcClient.TRIAL_TIMEOUT)


def test_a_thaijo_record_keeps_its_page_link_when_merged_with_a_search_hit():
    hit = Candidate(title="Medication adherence among older adults with hypertension in a district hospital",
                    abstract=ABSTRACT[:90], abstract_source="snippet", doi="10.9999/demo.1",
                    url="https://doi.org/10.9999/demo.1", engines=["crossref"])
    thai = Candidate(title="Medication Adherence among Older Adults with Hypertension in a District Hospital.",
                     abstract=ABSTRACT, abstract_source="thaijo", year=2024, url=ART, thaijo_url=ART,
                     engines=["thaijo"])
    (merged,) = merge_candidates([hit, thai])
    assert merged.thaijo_url == ART and merged.url == "https://doi.org/10.9999/demo.1"  # first hit's url stays
    assert merged.abstract == ABSTRACT and merged.abstract_source == "thaijo"  # beats the snippet
    assert merged.engines == ["crossref", "thaijo"] and merged.pdf_url is None


def test_candidates_from_other_sources_carry_no_thaijo_link():
    assert Candidate(title="x").thaijo_url is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_candidate.py -q`
Expected: 3 failed (`AttributeError: 'Settings' object has no attribute 'thaijo_enabled'`, a `ValidationError` for `abstract_source="thaijo"`, `AttributeError: 'Candidate' object has no attribute 'thaijo_url'`).

- [ ] **Step 3: Implement**

`backend/app/config.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    citations_timeout_seconds: float = 20.0  # whole citation step; a failure never fails the review
    http_timeout_seconds: float = 30.0
```

   with:

```python
    citations_timeout_seconds: float = 20.0  # whole citation step; a failure never fails the review
    # ThaiJO (Plan 24): Thai journals through TCI's undocumented search API, off until the owner has TCI's answer to the
    # permission letter. Env only (not a console setting). The share cap keeps Thai studies an addition to the
    # international evidence: at most thaijo_max_candidates, and at most 1/8 of candidate_limit.
    thaijo_enabled: bool = False
    thaijo_url: str = "https://www.tci-thaijo.org/api/v1"
    thaijo_max_candidates: int = 15
    thaijo_timeout_seconds: float = 12.0  # the whole ThaiJO search (below searxng_timeout_seconds); the OAI step too
    thaijo_request_timeout_seconds: float = 5.0  # per request, no retries (below every other source's timeout)
    thaijo_cache_ttl_seconds: int = 604800  # abstracts and OAI records cached in Redis by article id (7 days)
    http_timeout_seconds: float = 30.0
```

`backend/app/graph/schemas.py`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    # SearXNG engine (engine: pubmed, europe pmc, doaj, plos, openaire), or a search-engine snippet,
    # which is often truncated and only counts as an abstract when it looks complete (see retrieval.usable_abstract).
    abstract_source: Literal["europepmc", "arxiv", "engine", "snippet"] | None = None
```

   with:

```python
    # SearXNG engine (engine: pubmed, europe pmc, doaj, plos, openaire), the English abstract a ThaiJO journal
    # published (thaijo, Plan 24), or a search-engine snippet,
    # which is often truncated and only counts as an abstract when it looks complete (see retrieval.usable_abstract).
    abstract_source: Literal["europepmc", "arxiv", "engine", "thaijo", "snippet"] | None = None
```

2. Replace:

```python
    engines: list[str] = Field(default_factory=list)

```

   with:

```python
    engines: list[str] = Field(default_factory=list)
    # Plan 24: the ThaiJO article page (https://<journal host>.tci-thaijo.org/index.php/<journal>/article/view/<id>),
    # checked when parsed; the report links it and the OAI-PMH step reads the record from its host. Never a PDF.
    thaijo_url: str | None = None

```

`backend/app/services/dedupe.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
SCALARS = ("title", "doi", "pmid", "pmcid", "arxiv_id", "year", "journal", "url", "pdf_url")


# Curated Europe PMC records win, then full abstracts from an engine/arXiv, then search snippets.
_SOURCE_RANK = {"europepmc": 2, "arxiv": 1, "engine": 1, "snippet": 0}
```

   with:

```python
SCALARS = ("title", "doi", "pmid", "pmcid", "arxiv_id", "year", "journal", "url", "pdf_url", "thaijo_url")


# Curated Europe PMC records win, then full abstracts from an engine/arXiv/ThaiJO, then search snippets.
_SOURCE_RANK = {"europepmc": 2, "arxiv": 1, "engine": 1, "thaijo": 1, "snippet": 0}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_candidate.py tests/unit/test_dedupe.py -q`
Expected: 11 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2138 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/config.py backend/app/graph/schemas.py backend/app/services/dedupe.py backend/tests/unit/test_thaijo_candidate.py
cat > "$MSG" <<'EOF'
feat(thaijo): settings (off by default), the candidate's thaijo_url and "thaijo" abstracts in de-duplication (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 3: The ThaiJO client — search, English abstracts and the cache

**Files:**
- Create: `backend/app/services/thaijo.py`
- Create: `backend/tests/unit/thaijo_data.py` (synthetic responses)
- Test: `backend/tests/unit/test_thaijo_client.py`

**Interfaces:**
- Consumes: Task 1 (`HttpClient.post`, `follow_redirects`, `is_allowed_host`), Task 2 (`Candidate.thaijo_url`, `abstract_source="thaijo"`), `strip_markup`, `normalize_doi`, `truncate`.
- Produces (`app/services/thaijo.py`):
  - constants `DOMAIN`, `MIN_ABSTRACT_CHARS = 150`, `MIN_LATIN_SHARE = 0.9`, `MAX_ABSTRACT_CHARS = 6000`, `BUDDHIST_ERA_OFFSET = 543`, `PER_PAGE = 20`, `QUERIES = 3`, `EXTRA_DETAILS = 5`, `CONCURRENCY = 3`, `CACHE_PREFIX = "mra:thaijo:"`, `USER_AGENT`;
  - `gregorian_year(value) -> int | None`; `article_link(url, article_id=None) -> (host, journal, submission) | None`; `english_abstract(detail) -> str | None`; `query_words(query) -> str`;
  - `ThaiJoHit(id, title, article_url, authors, journal, year, doi)` (frozen dataclass); `parse_hit(h) -> ThaiJoHit | None`; `to_candidate(hit, abstract) -> Candidate`;
  - `ThaiJoClient(http, base_url, *, cache=None, timeout=5.0, cache_ttl=604800, resolver=None)` with `.search(query) -> list[ThaiJoHit]`, `.abstract(article_id, stats=None) -> str | None`, `.collect(queries, *, limit, out, stats) -> None` (fills `out` and `stats` in place; `stats` keys `hits, detailed, no_abstract, search_failed, detail_failed, cache_hits`; raises only when every search failed).
- Produces (tests): `tests/unit/thaijo_data.py` with `API`, `URL1`, `URL2`, `hit()`, `HITS`, `SEARCH`, `ABSTRACT1`, `ABSTRACT2_RAW`, `ABSTRACT2`, `detail()`, `DETAILS`, `NOT_FOUND`.

- [ ] **Step 1: Write the synthetic data and the failing test**

`backend/tests/unit/thaijo_data.py` (new file, complete):

```python
"""Synthetic ThaiJO responses for tests (Plan 24). The shapes follow what the API returned on 2026-10-13 (field lists in
the Plan 24 spec, section 3); every title, name and abstract here is invented. Never paste a real response here."""
from __future__ import annotations

API = "https://www.tci-thaijo.org/api/v1"
URL1 = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
URL2 = "https://he02.tci-thaijo.org/index.php/demo2/article/view/900002"


def hit(id: str, url: str, *, en: str | None = None, th: str | None = None, year: int = 2024,
        doi: str | None = None, category: str | None = None) -> dict:
    """One search hit as the search endpoint returns it (no abstract)."""
    submission = int(id.split("-")[1])
    return {
        "article_url": url,
        "authors": {"en_US": ["Somchai  Demo", "Malee Example"], "th_TH": ["สมชาย ตัวอย่าง", "มาลี ตัวอย่าง"]},
        "category": category or id.split("-")[0],
        "date_published": "2024-03-01T00:00:00+07:00",
        "doi": doi,
        "id": id,
        "issue_id": 1001,
        "issue_url": "https://he01.tci-thaijo.org/index.php/demo/issue/view/1001",
        "journal_id": 7,
        "journal_name": {"en_US": "Journal of Demo Health Sciences", "th_TH": "วารสารวิทยาศาสตร์สุขภาพตัวอย่าง"},
        "journal_path": "demo",
        "journal_url": "https://he01.tci-thaijo.org/index.php/demo",
        "keywords": {"en_US": ["adherence"], "th_TH": ["การใช้ยา"]},
        "languages": ["en_US", "th_TH"],
        "publication_id": 5000,
        "submission_id": submission,
        "thumbnail_url": None,
        "titles": {k: v for k, v in (("en_US", en), ("th_TH", th)) if v},
        "year": year,
    }


HITS = [
    hit("health01-900001", URL1, en="Medication Adherence among Older Adults with Hypertension in a District Hospital",
        th="การใช้ยาตามสั่งของผู้สูงอายุ"),
    hit("health02-900002", URL2, en="A Nurse-Led Telephone Follow-up Programme after Stroke: a Quasi-experimental Study",
        year=2567, doi="https://doi.org/10.9999/DEMO.2"),
    hit("social01-900003", "https://so01.tci-thaijo.org/index.php/soc/article/view/900003",
        en="Household Spending on Medicines in Rural Provinces"),
    hit("health01-900004", "https://evil.example/index.php/demo/article/view/900004",
        en="An Article Whose Page Is on Another Host"),
    hit("health03-900005", "https://he03.tci-thaijo.org/index.php/demo3/article/view/900005",
        th="ผลของโปรแกรมส่งเสริมสุขภาพต่อพฤติกรรมการออกกำลังกาย"),
    hit("health01-900006", "https://he01.tci-thaijo.org/index.php/demo/article/view/123",
        en="A Hit Whose Page Names Another Submission"),
]
SEARCH = {"hits": HITS, "total": 6, "page": 1, "per_page": 20, "processing_time_ms": 12, "facets": None}

ABSTRACT1 = ("Background: Older adults with hypertension often stop their medicines. Objective: To describe adherence "
             "and its factors in a district hospital. Methods: A cross-sectional survey of 240 patients aged 60 years "
             "or more used a structured questionnaire. Results: Adherence was good in 172 patients (71.7%); living "
             "alone was associated with poor adherence (OR 2.10, 95% CI 1.15 to 3.84). Conclusion: Follow-up should "
             "target people who live alone.")
ABSTRACT2_RAW = ("<p>This quasi-experimental study compared 60 stroke survivors who received nurse telephone calls for 12 "
                 "weeks with 60 who received usual care. Mean self-care scores rose from 2.1 to 3.4 in the programme "
                 "group and from 2.2 to 2.5 in the comparison group (p &lt; 0.001). Readmission within 90 days was 5% "
                 "and 15%.</p>")
ABSTRACT2 = ("This quasi-experimental study compared 60 stroke survivors who received nurse telephone calls for 12 "
             "weeks with 60 who received usual care. Mean self-care scores rose from 2.1 to 3.4 in the programme "
             "group and from 2.2 to 2.5 in the comparison group (p < 0.001). Readmission within 90 days was 5% "
             "and 15%.")


def detail(h: dict, en: str, th: str = "บทคัดย่อภาษาไทยสำหรับการทดสอบ") -> dict:
    """The detail endpoint's record: the hit's fields plus abstracts, pages, pdf_url and seq."""
    return {**h, "abstracts": {"en_US": en, "th_TH": th}, "abstracts_raw": {"en_US": f"<p>{en}</p>", "th_TH": th},
            "pages": "45-58", "pdf_url": f"{h['article_url']}/555", "seq": 1.0}


DETAILS = {
    "health01-900001": detail(HITS[0], ABSTRACT1),
    "health02-900002": detail(HITS[1], ABSTRACT2_RAW),
    "health03-900005": detail(HITS[4], "-"),
}
NOT_FOUND = {"error": "Article 'health01-0' not found", "code": "NOT_FOUND"}

```

`backend/tests/unit/test_thaijo_client.py` (new file, complete):

```python
import asyncio
import json

import fakeredis.aioredis
import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.thaijo import (
    USER_AGENT,
    ThaiJoClient,
    article_link,
    english_abstract,
    gregorian_year,
    parse_hit,
    query_words,
)
from tests.unit.thaijo_data import (
    ABSTRACT1,
    ABSTRACT2,
    API,
    DETAILS,
    HITS,
    NOT_FOUND,
    SEARCH,
    URL1,
    URL2,
    detail,
    hit,
)


async def _nosleep(_):
    return None


def _client(cache=None):
    return ThaiJoClient(HttpClient(retries=3, sleep=_nosleep), API, cache=cache, timeout=5.0, cache_ttl=600)


def _details_route():
    def answer(request):
        article_id = request.url.path.rsplit("/", 1)[1]
        return (httpx.Response(200, json=DETAILS[article_id]) if article_id in DETAILS
                else httpx.Response(404, json=NOT_FOUND))
    return respx.get(url__regex=rf"{API}/articles/[\w-]+$").mock(side_effect=answer)


def test_years_in_the_buddhist_era_become_gregorian():
    assert gregorian_year(2567) == 2024 and gregorian_year("2546") == 2003 and gregorian_year(2024) == 2024
    assert gregorian_year(None) is None and gregorian_year("n/a") is None and gregorian_year(99999) is None


def test_article_links_are_checked_against_the_host_the_path_and_the_id():
    assert article_link(URL1) == ("he01.tci-thaijo.org", "demo", "900001")
    assert article_link(URL1, "health01-900001") == ("he01.tci-thaijo.org", "demo", "900001")
    assert article_link(URL1, "health01-900002") is None  # the page names another submission
    for bad in ["http://he01.tci-thaijo.org/index.php/demo/article/view/1",
                "https://evil.example/index.php/demo/article/view/1",
                "https://he01.tci-thaijo.org.evil.example/index.php/demo/article/view/1",
                "https://he01.tci-thaijo.org/index.php/demo/article/view/1?x=1",
                "https://he01.tci-thaijo.org/index.php/demo/article/download/1/2",
                "https://he01.tci-thaijo.org/index.php/../oai/article/view/1", None, 7]:
        assert article_link(bad) is None, bad


def test_parse_hit_keeps_health_hits_with_a_valid_page_only():
    parsed = [parse_hit(h) for h in HITS]
    assert [p.id if p else None for p in parsed] == ["health01-900001", "health02-900002", None, None,
                                                    "health03-900005", None]
    first, second, _, _, thai_only, _ = parsed
    assert first.authors == ["Somchai Demo", "Malee Example"] and first.journal == "Journal of Demo Health Sciences"
    assert second.year == 2024 and second.doi == "10.9999/demo.2"
    assert thai_only.title == "ผลของโปรแกรมส่งเสริมสุขภาพต่อพฤติกรรมการออกกำลังกาย"  # no English title: the Thai one
    assert parse_hit(hit("health01-900001", URL1, en="x", category="Health01")) is None
    assert parse_hit({"id": "health01-1"}) is None and parse_hit("x") is None


def test_english_abstract_needs_150_latin_characters():
    assert english_abstract(DETAILS["health01-900001"]) == ABSTRACT1
    assert english_abstract(DETAILS["health02-900002"]) == ABSTRACT2  # markup stripped, entities unescaped
    assert english_abstract(DETAILS["health03-900005"]) is None  # "-"
    assert english_abstract(detail(HITS[0], "บทคัดย่อ " * 40)) is None  # Thai text filed as English
    assert english_abstract(detail(HITS[0], "word " * 2000)).endswith(" …")  # capped at 6,000 characters
    assert english_abstract(None) is None and english_abstract({"abstracts": None}) is None


def test_query_words_drop_syntax():
    assert query_words('metformin "type 2" (diabetes) OR x:y') == "metformin type 2 diabetes OR x y"
    assert query_words("") == ""


@respx.mock
async def test_search_posts_the_words_with_an_identifying_agent_and_no_retry():
    route = respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(200, json=SEARCH))
    hits = await _client().search("adherence; hypertension!")
    assert [h.id for h in hits] == ["health01-900001", "health02-900002", "health03-900005"]
    sent = route.calls[0].request
    assert json.loads(sent.content) == {"q": "adherence hypertension", "page": 1, "per_page": 20,
                                        "highlight": False, "facets": False}
    assert sent.headers["user-agent"] == USER_AGENT
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().search("adherence")
    assert respx.calls.call_count == 2  # the 503 was not retried


@respx.mock
async def test_search_never_follows_a_redirect():
    respx.post(f"{API}/articles/search").mock(
        return_value=httpx.Response(302, headers={"Location": "http://10.0.0.1/"}))
    inner = respx.post("http://10.0.0.1/").mock(return_value=httpx.Response(200, json=SEARCH))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().search("adherence")
    assert inner.call_count == 0


@respx.mock
async def test_abstracts_are_cached_by_id_including_the_ones_that_are_missing():
    route = _details_route()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    client, stats = _client(redis), {}
    assert await client.abstract("health01-900001", stats) == ABSTRACT1
    assert await client.abstract("health01-424242", stats) is None  # 404: unknown
    assert await client.abstract("health01-900001", stats) == ABSTRACT1
    assert await client.abstract("health01-424242", stats) is None
    assert route.call_count == 2 and stats["cache_hits"] == 2
    assert await redis.ttl("mra:thaijo:abs:health01-900001") == 600
    assert await client.abstract("../admin", stats) is None and route.call_count == 2  # never asked


@respx.mock
async def test_a_dead_cache_costs_a_request_and_nothing_else():
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("down")

        async def set(self, *_, **__):
            raise ConnectionError("down")

    route = _details_route()
    assert await _client(DeadRedis()).abstract("health01-900001") == ABSTRACT1 and route.call_count == 1


@respx.mock
async def test_collect_keeps_rank_order_dedupes_and_stops_at_the_limit():
    first = {**SEARCH, "hits": [HITS[0], HITS[4]]}
    second = {**SEARCH, "hits": [HITS[1], HITS[0]]}

    def answer(request):
        return httpx.Response(200, json=first if json.loads(request.content)["q"] == "q one" else second)

    respx.post(f"{API}/articles/search").mock(side_effect=answer)
    details = _details_route()
    out, stats = [], {}
    await _client().collect(["q one", "q two", "q one"], limit=5, out=out, stats=stats)
    assert [c.thaijo_url for c in out] == [URL1, URL2]  # 900001, 900002; 900005 has no English abstract
    assert out[1].year == 2024 and out[1].abstract_source == "thaijo" and out[1].engines == ["thaijo"]
    assert out[0].url == URL1 and out[0].pdf_url is None
    assert stats == {"hits": 3, "detailed": 3, "no_abstract": 1, "search_failed": 0, "detail_failed": 0,
                     "cache_hits": 0}
    assert details.call_count == 3
    out, stats = [], {}
    await _client().collect(["q one", "q two"], limit=1, out=out, stats=stats)
    assert len(out) == 1 and stats["detailed"] == 1


@respx.mock
async def test_collect_survives_one_failed_search_and_counts_failed_details():
    def answer(request):
        if json.loads(request.content)["q"] == "bad":
            return httpx.Response(500)
        return httpx.Response(200, json=SEARCH)

    respx.post(f"{API}/articles/search").mock(side_effect=answer)
    respx.get(f"{API}/articles/health01-900001").mock(return_value=httpx.Response(502))
    respx.get(f"{API}/articles/health02-900002").mock(return_value=httpx.Response(200, json=DETAILS["health02-900002"]))
    respx.get(f"{API}/articles/health03-900005").mock(return_value=httpx.Response(200, json=DETAILS["health03-900005"]))
    out, stats = [], {}
    await _client().collect(["good", "bad"], limit=15, out=out, stats=stats)
    assert [c.thaijo_url for c in out] == [URL2]
    assert stats["search_failed"] == 1 and stats["detail_failed"] == 1 and stats["no_abstract"] == 1


@respx.mock
async def test_collect_raises_when_every_search_failed():
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(500))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().collect(["a", "b"], limit=5, out=[], stats={})


async def test_collect_with_no_room_or_no_words_asks_nothing():
    out, stats = [], {}
    await _client().collect(["a"], limit=0, out=out, stats=stats)
    await _client().collect(["!!!"], limit=5, out=out, stats=stats)
    assert out == [] and stats["hits"] == 0


@respx.mock
async def test_a_timeout_keeps_the_candidates_already_collected(monkeypatch):
    monkeypatch.setattr("app.services.thaijo.CONCURRENCY", 1)  # one detail per batch
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(200, json=SEARCH))
    respx.get(f"{API}/articles/health01-900001").mock(return_value=httpx.Response(200, json=DETAILS["health01-900001"]))

    async def slow(_request):
        await asyncio.sleep(5)
        return httpx.Response(200, json=DETAILS["health02-900002"])

    respx.get(f"{API}/articles/health02-900002").mock(side_effect=slow)
    out, stats = [], {}
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(_client().collect(["q"], limit=5, out=out, stats=stats), 0.5)
    assert [c.thaijo_url for c in out] == [URL1]
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_client.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.services.thaijo'`.

- [ ] **Step 3: Implement**

`backend/app/services/thaijo.py` (new file, complete):

```python
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
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.graph.schemas import Candidate
from app.services.http import HttpClient
from app.services.text import normalize_doi, strip_markup, truncate
from app.services.urlsafety import is_allowed_host

DOMAIN = "tci-thaijo.org"
_HEALTH = re.compile(r"health\d{2}")  # health01-health05 seen 2026-10-13
_ARTICLE_ID = re.compile(r"(health\d{2})-(\d{1,10})")
_ARTICLE_PATH = re.compile(r"/index\.php/([A-Za-z0-9_-]{1,64})/article/view/(\d{1,10})/?")
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
    year = value if isinstance(value, int) else int(value) if str(value or "").isdigit() else None
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
        return [h for h in map(parse_hit, hits if isinstance(hits, list) else []) if h]

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
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_client.py -q`
Expected: 14 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2152 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/services/thaijo.py backend/tests/unit/thaijo_data.py backend/tests/unit/test_thaijo_client.py
cat > "$MSG" <<'EOF'
feat(thaijo): client for the search and detail API: health hits, English abstracts, cache by id (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 4: OAI-PMH records — parsing without DTDs, host checks and the cache

**Files:**
- Modify: `backend/app/services/thaijo.py`
- Modify: `backend/tests/unit/thaijo_data.py` (append the OAI answers)
- Test: `backend/tests/unit/test_thaijo_oai.py`

**Interfaces:**
- Consumes: Task 3 (`article_link`, `_text`, `_cache_get`/`_cache_set`, `ThaiJoClient.resolver`, `USER_AGENT` headers), `is_public_http_url`.
- Produces:
  - `MAX_XML_BYTES = 512_000`; `class UnsafeXml(ValueError)`;
  - `parse_oai_record(body: bytes, identifier: str) -> dict | None` returning `{"volume", "issue", "pages", "issn": [...], "license", "article_type"}`; raises `UnsafeXml` or `ET.ParseError`;
  - `ThaiJoClient.record(article_url) -> dict | None` (raises `PermissionError` for a host that resolves to a non-public address, `httpx.HTTPStatusError` for an error or redirect answer).
- Produces (tests): `OAI_URL1`, `OAI_ID1`, `oai_record()`, `FULL_SOURCES`, `FULL_RIGHTS`, `FULL_TYPES`, `OAI_FULL`, `OAI_NO_PAGES`, `OAI_MISSING`, `OAI_BOMB` in `thaijo_data.py`.

- [ ] **Step 1: Append the synthetic OAI answers to `thaijo_data.py` and write the failing test**

`backend/tests/unit/thaijo_data.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
NOT_FOUND = {"error": "Article 'health01-0' not found", "code": "NOT_FOUND"}

```

   with:

```python
NOT_FOUND = {"error": "Article 'health01-0' not found", "code": "NOT_FOUND"}


# ---- OAI-PMH GetRecord answers (oai_dc), shaped as the journal servers answered on 2026-10-13 ----------------------
OAI_URL1 = "https://he01.tci-thaijo.org/index.php/demo/oai"
OAI_ID1 = "oai:he01.tci-thaijo.org:article/900001"


def oai_record(identifier: str = OAI_ID1, *, sources: str = "", rights: str = "", types: str = "",
               status: str = "") -> bytes:
    header_status = f' status="{status}"' if status else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://he01.tci-thaijo.org/lib/pkp/xml/oai2.xsl" ?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <responseDate>2026-10-13T04:00:00Z</responseDate>
 <request verb="GetRecord" metadataPrefix="oai_dc" identifier="{identifier}">{OAI_URL1}</request>
 <GetRecord><record>
  <header{header_status}><identifier>{identifier}</identifier><datestamp>2024-03-01T00:00:00Z</datestamp>
   <setSpec>demo:ART</setSpec></header>
  <metadata>
   <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title xml:lang="en-US">Medication Adherence among Older Adults with Hypertension in a District Hospital</dc:title>
    <dc:creator>ตัวอย่าง, สมชาย</dc:creator>
    <dc:description xml:lang="en-US">An invented abstract; the OAI step never reads it.</dc:description>
    <dc:date>2024-03-01</dc:date>
    {types}
    <dc:format>application/pdf</dc:format>
    <dc:identifier>https://he01.tci-thaijo.org/index.php/demo/article/view/900001</dc:identifier>
    {sources}
    <dc:language>tha</dc:language>
    <dc:relation>https://he01.tci-thaijo.org/index.php/demo/article/view/900001/555</dc:relation>
    {rights}
   </oai_dc:dc>
  </metadata>
 </record></GetRecord>
</OAI-PMH>
""".encode()


FULL_SOURCES = """<dc:source xml:lang="en-US">Journal of Demo Health Sciences; Vol. 17 No. 4 (2024): Oct-Dec; 1048-1066</dc:source>
    <dc:source xml:lang="th-TH">วารสารวิทยาศาสตร์สุขภาพตัวอย่าง; ปีที่ 17 ฉบับที่ 4 (2024): ต.ค.-ธ.ค.; 1048-1066</dc:source>
    <dc:source>3027-613x</dc:source>
    <dc:source>2985-1750</dc:source>"""
FULL_RIGHTS = """<dc:rights xml:lang="th-TH">ลิขสิทธิ์ (c) 2024 วารสารวิทยาศาสตร์สุขภาพตัวอย่าง</dc:rights>
    <dc:rights xml:lang="th-TH">https://creativecommons.org/licenses/by-nc-nd/4.0</dc:rights>"""
FULL_TYPES = """<dc:type>info:eu-repo/semantics/article</dc:type>
    <dc:type>info:eu-repo/semantics/publishedVersion</dc:type>
    <dc:type xml:lang="en-US">Peer-reviewed article</dc:type>
    <dc:type xml:lang="th-TH">บทความที่ผ่านการประเมิน</dc:type>"""
OAI_FULL = oai_record(sources=FULL_SOURCES, rights=FULL_RIGHTS, types=FULL_TYPES)
# no pages and no article type (seen on another journal): "Vol. 11 No. 2 (2024): Vol.11 No.2"
OAI_NO_PAGES = oai_record(sources='<dc:source xml:lang="en-US">Journal of Demo Health Sciences; Vol. 11 No. 2 (2024): '
                                  'Vol.11 No.2</dc:source>\n    <dc:source>2985-1750</dc:source>',
                          rights='<dc:rights xml:lang="th-TH">http://creativecommons.org/licenses/by-nc-nd/4.0</dc:rights>',
                          types="<dc:type>info:eu-repo/semantics/article</dc:type>")
OAI_MISSING = f"""<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
 <responseDate>2026-10-13T04:00:00Z</responseDate>
 <request verb="GetRecord" metadataPrefix="oai_dc" identifier="{OAI_ID1}">{OAI_URL1}</request>
 <error code="idDoesNotExist">No matching identifier in this repository</error></OAI-PMH>
""".encode()
OAI_BOMB = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><responseDate>&lol2;</responseDate></OAI-PMH>
"""
```

`backend/tests/unit/test_thaijo_oai.py` (new file, complete):

```python
import xml.etree.ElementTree as ET

import fakeredis.aioredis
import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.thaijo import ThaiJoClient, UnsafeXml, parse_oai_record
from tests.unit.thaijo_data import (
    API,
    OAI_BOMB,
    OAI_FULL,
    OAI_ID1,
    OAI_MISSING,
    OAI_NO_PAGES,
    OAI_URL1,
    URL1,
    oai_record,
)

FULL = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["3027-613X", "2985-1750"],
        "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}


async def _nosleep(_):
    return None


async def _public(_host):
    return ["1.1.1.1"]  # a fake resolver: no DNS lookups in tests


async def _private(_host):
    return ["10.0.0.5"]


def _client(cache=None, resolver=_public):
    return ThaiJoClient(HttpClient(retries=3, sleep=_nosleep), API, cache=cache, timeout=5.0, cache_ttl=600,
                        resolver=resolver)


def test_full_record_gives_volume_issue_pages_issn_licence_and_type():
    assert parse_oai_record(OAI_FULL, OAI_ID1) == FULL


def test_a_record_without_pages_or_type_keeps_what_it_has():
    assert parse_oai_record(OAI_NO_PAGES, OAI_ID1) == {
        "volume": "11", "issue": "2", "pages": None, "issn": ["2985-1750"],
        "license": "http://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": None}


def test_missing_deleted_foreign_or_empty_records_give_none():
    assert parse_oai_record(OAI_MISSING, OAI_ID1) is None
    assert parse_oai_record(oai_record(status="deleted", sources="<dc:source>2985-1750</dc:source>"), OAI_ID1) is None
    assert parse_oai_record(OAI_FULL, "oai:he01.tci-thaijo.org:article/900002") is None  # not the record asked for
    assert parse_oai_record(oai_record(), OAI_ID1) is None  # nothing bibliographic in it


def test_a_dtd_or_an_oversized_answer_is_refused_before_parsing():
    with pytest.raises(UnsafeXml):
        parse_oai_record(OAI_BOMB, OAI_ID1)
    with pytest.raises(UnsafeXml):
        parse_oai_record(b"<!doctype x>" + OAI_FULL, OAI_ID1)
    with pytest.raises(UnsafeXml):
        parse_oai_record(OAI_FULL + b" " * 600_000, OAI_ID1)
    with pytest.raises(ET.ParseError):
        parse_oai_record(b"<OAI-PMH><unclosed></OAI-PMH>", OAI_ID1)


def test_markup_in_a_field_is_stripped_and_long_types_are_cut():
    types = '<dc:type xml:lang="en-US">&lt;b&gt;Research&lt;/b&gt; article ' + "x" * 200 + "</dc:type>"
    bib = parse_oai_record(oai_record(types=types), OAI_ID1)
    assert bib["article_type"].startswith("Research article") and len(bib["article_type"]) <= 82


@respx.mock
async def test_record_reads_the_journal_host_from_the_page_and_caches_the_answer():
    route = respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_FULL))
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    client = _client(redis)
    assert await client.record(URL1) == FULL
    assert await client.record(URL1) == FULL
    assert route.call_count == 1
    params = dict(route.calls[0].request.url.params)
    assert params == {"verb": "GetRecord", "metadataPrefix": "oai_dc", "identifier": OAI_ID1}
    assert await redis.ttl("mra:thaijo:oai:he01.tci-thaijo.org:900001") == 600


@respx.mock
async def test_a_missing_record_is_cached_as_none():
    route = respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_MISSING))
    client = _client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    assert await client.record(URL1) is None and await client.record(URL1) is None
    assert route.call_count == 1


@respx.mock
async def test_record_never_calls_a_host_outside_thaijo_or_a_private_address():
    any_call = respx.route().mock(return_value=httpx.Response(200, content=OAI_FULL))
    for url in ["https://evil.example/index.php/demo/article/view/900001",
                "https://he01.tci-thaijo.org.evil.example/index.php/demo/article/view/900001",
                "http://he01.tci-thaijo.org/index.php/demo/article/view/900001",
                "https://he01.tci-thaijo.org/index.php/demo/article/view/900001/555"]:  # the PDF link
        assert await _client().record(url) is None
    assert any_call.call_count == 0
    with pytest.raises(PermissionError):
        await _client(resolver=_private).record(URL1)
    assert any_call.call_count == 0


@respx.mock
async def test_record_does_not_follow_redirects_and_raises_on_errors():
    respx.get(OAI_URL1).mock(return_value=httpx.Response(301, headers={"Location": "http://10.0.0.5/oai"}))
    inner = respx.get("http://10.0.0.5/oai").mock(return_value=httpx.Response(200, content=OAI_FULL))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().record(URL1)
    assert inner.call_count == 0
    respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_BOMB))
    with pytest.raises(UnsafeXml):
        await _client().record(URL1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_oai.py -q`
Expected: collection error, `ImportError: cannot import name 'UnsafeXml' from 'app.services.thaijo'`.

- [ ] **Step 3: Implement**

`backend/app/services/thaijo.py`: 4 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
import re
from dataclasses import dataclass, field
```

   with:

```python
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
```

2. Replace:

```python
from app.services.urlsafety import is_allowed_host
```

   with:

```python
from app.services.urlsafety import is_allowed_host, is_public_http_url
```

3. Replace:

```python

class ThaiJoClient:
```

   with:

```python

# ---- OAI-PMH --------------------------------------------------------------------------------------------------
_OAI = "{http://www.openarchives.org/OAI/2.0/}"
_OAI_DC = "{http://www.openarchives.org/OAI/2.0/oai_dc/}dc"
_DC = "{http://purl.org/dc/elements/1.1/}"
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
MAX_XML_BYTES = 512_000
# xml.etree never fetches external entities, but an internal DTD can still expand entities ("billion laughs"); an
# OAI-PMH record never needs one, so any document with a DTD or entity declaration is refused before parsing.
_DTD = re.compile(rb"<!\s*(?:DOCTYPE|ENTITY)", re.IGNORECASE)
_ISSN = re.compile(r"\d{4}-\d{3}[\dX]")
_VOLUME = re.compile(r"\bVol\.?\s*([0-9A-Za-z-]{1,10})|ปีที่\s*([0-9A-Za-z-]{1,10})")
_ISSUE = re.compile(r"\bNo\.?\s*([0-9A-Za-z-]{1,10})|ฉบับที่\s*([0-9A-Za-z-]{1,10})")
_PAGES = re.compile(r"[A-Za-z]?\d{1,6}(?:\s*[-–]\s*[A-Za-z]?\d{1,6})?")
_LICENSE = re.compile(r"https?://creativecommons\.org/(?:licenses|publicdomain)/[a-z-]{2,20}/\d\.\d/?")


class UnsafeXml(ValueError):
    pass


def _first_group(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return next((g for g in match.groups() if g), None) if match else None


def parse_oai_record(body: bytes, identifier: str) -> dict[str, Any] | None:
    """The bibliographic fields of an oai_dc GetRecord answer: `{volume, issue, pages, issn[], license, article_type}`
    (each null or empty when absent), or None when the record is missing, deleted or not the one asked for, or holds
    none of them. Raises UnsafeXml for a DTD or an oversized body, and ET.ParseError for broken XML."""
    if len(body) > MAX_XML_BYTES or _DTD.search(body):
        raise UnsafeXml("refused: DTD or oversized OAI-PMH answer")
    root = ET.fromstring(body)
    record = root.find(f"{_OAI}GetRecord/{_OAI}record")
    header = record.find(f"{_OAI}header") if record is not None else None
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
```

4. Replace:

```python
                    out.append(to_candidate(hit, text))
```

   with:

```python
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
        if isinstance(cached, dict) and "bib" in cached:
            return cached["bib"] if isinstance(cached["bib"], dict) else None
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
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_oai.py tests/unit/test_thaijo_client.py -q`
Expected: 23 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2161 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/services/thaijo.py backend/tests/unit/thaijo_data.py backend/tests/unit/test_thaijo_oai.py
cat > "$MSG" <<'EOF'
feat(thaijo): OAI-PMH GetRecord for volume, issue, pages, ISSN, licence and type; DTDs refused, host checked (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 5: The search node takes ThaiJO under a share cap; wiring, telemetry, cache key and eval engines

**Files:**
- Modify: `backend/app/graph/graph.py` (`GraphDeps.thaijo` only)
- Modify: `backend/app/graph/factory.py`
- Modify: `backend/app/graph/nodes/retrieval.py`
- Modify: `backend/app/harness/quality.py`
- Modify: `backend/app/services/review_service.py`
- Modify: `backend/app/evals/freeze.py`
- Modify: `backend/app/cli/eval.py`
- Test: `backend/tests/unit/test_thaijo_search_node.py`

**Interfaces:**
- Consumes: Task 2 settings; Task 3 `ThaiJoClient.collect` and its `stats` keys; `get_logger`.
- Produces:
  - `GraphDeps.thaijo: Any = None`; `build_thaijo(settings, http, redis=None) -> ThaiJoClient | None` (`app/graph/factory.py`), used by `build_graph_deps` (None in stub mode or when the flag is off).
  - `retrieval.THAIJO_SHARE = 8`; `thaijo_cap(settings, options) -> int`; `async thaijo_search(deps, queries, options) -> (list[Candidate], entry)` (never raises; `entry` = the collect stats + `cap`, `kept`, `seconds`, and `failed` or `timed_out`); `thaijo_errors(entry, timeout) -> list[str]`.
  - The search entry in `quality` gains `thaijo` (only when ThaiJO ran); `per_query["thaijo:"]`; `per_source["thaijo"]`.
  - `summarize_quality(...)["thaijo"]` = the search entry's block, plus `metadata: {asked, found, failed, timed_out}` from a `thaijo_metadata` stage entry (Task 6 writes it).
  - `ReviewService._version()` appends `+thaijo` while `settings.thaijo_enabled`.
  - `freeze_engines(settings) -> list[str]` (`app/evals/freeze.py`), used by `app/cli/eval.py`'s `freeze`.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_thaijo_search_node.py` (new file, complete):

```python
import asyncio

import fakeredis.aioredis

from app.config import Settings
from app.evals.freeze import freeze_engines
from app.graph.factory import build_graph_deps, build_thaijo
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import make_enrich, make_search, thaijo_cap, thaijo_errors
from app.graph.schemas import Candidate
from app.harness.quality import summarize_quality
from app.schemas.review import ReviewOptions
from app.services.http import HttpClient
from app.services.thaijo import ThaiJoClient
from tests.unit.test_nodes_retrieval import ABSTRACT, FakeEpmc, FakeSearxng

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/{}"


def thai(i: int) -> Candidate:
    return Candidate(title=f"Thai cohort {i} on metformin adherence in district hospitals", abstract=ABSTRACT,
                     abstract_source="thaijo", url=URL.format(i), thaijo_url=URL.format(i), engines=["thaijo"])


class FakeThaiJo:
    def __init__(self, cands=(), *, fail=None, slow=False, stats=None):
        self.cands, self.fail, self.slow, self.stats, self.calls = list(cands), fail, slow, stats or {}, []

    async def collect(self, queries, *, limit, out, stats):
        self.calls.append((list(queries), limit))
        stats.update({"hits": len(self.cands), "detailed": len(self.cands), **self.stats})
        for c in self.cands[:limit]:
            out.append(c)
            if self.slow:
                await asyncio.sleep(5)
        if self.fail:
            raise self.fail


def _deps(thaijo=None, **kw):
    settings = Settings(_env_file=None, searxng_pages=1, thaijo_timeout_seconds=kw.pop("timeout", 12.0))
    hits = {"q1": [Candidate(title=f"Search hit {i} about metformin", doi=f"10.1/{i}", abstract=ABSTRACT,
                             abstract_source="engine", engines=["pubmed"]) for i in range(3)]}
    return GraphDeps(settings=settings, searxng=FakeSearxng(hits), europepmc=FakeEpmc([]), thaijo=thaijo, **kw)


STATE = {"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}}


def test_the_share_cap_is_at_most_15_and_an_eighth_of_the_pool():
    s = Settings(_env_file=None)
    caps = [thaijo_cap(s, ReviewOptions(candidate_limit=n, max_papers=5)) for n in (120, 60, 40, 20)]
    assert caps == [15, 7, 5, 2]
    assert thaijo_cap(Settings(_env_file=None, thaijo_max_candidates=0), ReviewOptions()) == 0


async def test_thaijo_hits_join_the_round_robin_and_count_as_their_own_source():
    fake = FakeThaiJo([thai(1), thai(2)])
    out = await make_search(_deps(fake))(STATE)
    titles = [c["title"] for c in out["candidates"]]
    assert titles[:2] == ["Search hit 0 about metformin", "Thai cohort 1 on metformin adherence in district hospitals"]
    assert len(titles) == 5 and out["errors"] == []
    assert out["search_stats"]["per_source"] == {"pubmed": 3, "thaijo": 2}
    assert fake.calls == [(["q1"], 15)]
    entry = out["quality"][0]["thaijo"]
    assert entry["cap"] == 15 and entry["kept"] == 2 and entry["hits"] == 2 and "seconds" in entry


async def test_the_cap_follows_the_pool_size():
    fake = FakeThaiJo([thai(i) for i in range(20)])
    out = await make_search(_deps(fake))({**STATE, "options": {"candidate_limit": 40, "max_papers": 10}})
    assert fake.calls[0][1] == 5 and out["search_stats"]["per_source"]["thaijo"] == 5


async def test_a_failing_thaijo_never_fails_the_search():
    out = await make_search(_deps(FakeThaiJo(fail=RuntimeError("down"))))(STATE)
    assert len(out["candidates"]) == 3 and "thaijo" not in out["search_stats"]["per_source"]
    assert out["errors"] == ["ThaiJO search failed: RuntimeError"]
    assert out["quality"][0]["thaijo"]["failed"] == "RuntimeError"


async def test_a_slow_thaijo_is_cut_at_its_timeout_and_keeps_what_arrived():
    out = await make_search(_deps(FakeThaiJo([thai(1), thai(2)], slow=True), timeout=0.2))(STATE)
    assert [c["thaijo_url"] for c in out["candidates"] if c["thaijo_url"]] == [URL.format(1)]
    assert out["errors"] == ["ThaiJO search timed out after 0.2 s; kept 1 candidate(s)"]
    assert out["quality"][0]["thaijo"]["timed_out"] is True


def test_lost_requests_are_reported():
    entry = {"kept": 3, "search_failed": 1, "detail_failed": 2}
    assert thaijo_errors(entry, 12.0) == ["ThaiJO: 1 search(es) and 2 abstract lookup(s) failed"]
    assert thaijo_errors({"kept": 0}, 12.0) == []


async def test_without_thaijo_nothing_changes():
    out = await make_search(_deps())(STATE)
    assert "thaijo" not in out["quality"][0] and out["search_stats"]["per_source"] == {"pubmed": 3}


async def test_enrich_keeps_thaijo_candidates_with_their_link():
    found = (await make_search(_deps(FakeThaiJo([thai(1)])))(STATE))["candidates"]
    out = await make_enrich(_deps())({"candidates": found, "options": STATE["options"]})
    kept = [c for c in out["candidates"] if c["thaijo_url"]]
    assert [c["abstract_source"] for c in kept] == ["thaijo"] and kept[0]["pdf_url"] is None


def test_the_client_exists_only_when_enabled():
    http = HttpClient()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    assert build_thaijo(Settings(_env_file=None), http, redis) is None
    client = build_thaijo(Settings(_env_file=None, thaijo_enabled=True, thaijo_request_timeout_seconds=4.0), http, redis)
    assert isinstance(client, ThaiJoClient) and client.cache is redis and client.timeout == 4.0
    assert client.base_url == "https://www.tci-thaijo.org/api/v1" and client.cache_ttl == 604800
    on = Settings(_env_file=None, thaijo_enabled=True, graph_mode="stub")
    assert build_graph_deps(on, http).thaijo is None  # the stub graph never searches


def test_quality_reports_the_thaijo_block_and_the_metadata_step():
    entries = [{"stage": "search", "thaijo": {"hits": 9, "kept": 4, "cap": 15}},
               {"stage": "thaijo_metadata", "asked": 3, "found": 2, "failed": 1}]
    got = summarize_quality(entries, None)["thaijo"]
    assert got == {"hits": 9, "kept": 4, "cap": 15,
                   "metadata": {"asked": 3, "found": 2, "failed": 1, "timed_out": False}}
    assert "thaijo" not in summarize_quality([{"stage": "search"}], None)


def test_a_frozen_pool_names_thaijo_when_it_was_searched():
    assert "thaijo" not in freeze_engines(Settings(_env_file=None))
    assert freeze_engines(Settings(_env_file=None, thaijo_enabled=True))[-1] == "thaijo"


async def test_turning_thaijo_on_starts_a_new_cache_generation(client, app):
    body = {"topic": "metformin adherence in older adults", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=body)).json()
    assert (await client.post("/api/v1/reviews", json=body)).json()["review_id"] == first["review_id"]
    app.state.deps.service.settings.thaijo_enabled = True
    again = (await client.post("/api/v1/reviews", json=body)).json()
    assert again["review_id"] != first["review_id"]
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_search_node.py -q`
Expected: collection error, `ImportError: cannot import name 'freeze_engines' from 'app.evals.freeze'`.

- [ ] **Step 3: Implement**

`backend/app/graph/graph.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    glossary: Any = None  # app.harness.glossary.ActiveGlossary; None → the built-in glossary (Plan 23c)

```

   with:

```python
    glossary: Any = None  # app.harness.glossary.ActiveGlossary; None → the built-in glossary (Plan 23c)
    thaijo: Any = None  # app.services.thaijo.ThaiJoClient (Plan 24); None → ThaiJO is never searched

```

`backend/app/graph/factory.py`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.services.searxng import SearxngClient

```

   with:

```python
from app.services.searxng import SearxngClient
from app.services.thaijo import ThaiJoClient

```

2. Replace:

```python
    )
```

   with:

```python
        thaijo=build_thaijo(settings, http, redis),
    )


def build_thaijo(settings: Settings, http: HttpClient, redis=None) -> ThaiJoClient | None:
    """The ThaiJO client when THAIJO_ENABLED (Plan 24), else None. `redis` (decode_responses=True) caches abstracts
    and OAI records by article; without it nothing is cached."""
    if not settings.thaijo_enabled:
        return None
    return ThaiJoClient(http, settings.thaijo_url, cache=redis, timeout=settings.thaijo_request_timeout_seconds,
                        cache_ttl=settings.thaijo_cache_ttl_seconds)
```

`backend/app/graph/nodes/retrieval.py`: 5 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.schemas.review import ReviewOptions
from app.services.dedupe import PaperIndex, merge_candidates
```

   with:

```python
from app.logging import get_logger
from app.schemas.review import ReviewOptions
from app.services.dedupe import PaperIndex, merge_candidates

log = get_logger(__name__)
```

2. Replace:

```python

def make_search(deps):
```

   with:

```python

# ---- ThaiJO (Plan 24) ------------------------------------------------------------------------------------------
THAIJO_SHARE = 8  # ThaiJO may fill at most 1/8 of the candidate pool


def thaijo_cap(settings, options: ReviewOptions) -> int:
    """The most ThaiJO candidates one review takes: thaijo_max_candidates, and at most 1/8 of candidate_limit, so Thai
    studies add to the international evidence and never displace it (120 -> 15, 60 -> 7, 20 -> 2)."""
    return max(0, min(settings.thaijo_max_candidates, options.candidate_limit // THAIJO_SHARE))


async def thaijo_search(deps, queries: list[str], options: ReviewOptions) -> tuple[list[Candidate], dict]:
    """ThaiJO candidates for the planner's queries and the search entry's `thaijo` block. Never raises (cancellation
    aside): a failure or a timeout leaves what arrived, and the block says what went wrong."""
    started = time.perf_counter()
    cap = thaijo_cap(deps.settings, options)
    out: list[Candidate] = []
    stats: dict = {}
    try:
        await asyncio.wait_for(deps.thaijo.collect(queries, limit=cap, out=out, stats=stats),
                               deps.settings.thaijo_timeout_seconds)
    except TimeoutError:
        stats["timed_out"] = True
    except Exception as exc:  # noqa: BLE001 - an optional source: the review goes on without it
        stats["failed"] = type(exc).__name__
    return out, {**stats, "cap": cap, "kept": len(out), "seconds": round(time.perf_counter() - started, 3)}


def thaijo_errors(entry: dict, timeout: float) -> list[str]:
    """`errors` lines for a ThaiJO search that failed, timed out or lost requests (none when it went well)."""
    out = []
    if entry.get("failed"):
        out.append(f"ThaiJO search failed: {entry['failed']}")
    if entry.get("timed_out"):
        out.append(f"ThaiJO search timed out after {timeout:g} s; kept {entry['kept']} candidate(s)")
    lost = [f"{entry[k]} {name}" for k, name in (("search_failed", "search(es)"),
                                                 ("detail_failed", "abstract lookup(s)")) if entry.get(k)]
    if lost:
        out.append(f"ThaiJO: {' and '.join(lost)} failed")
    return out


def make_search(deps):
```

3. Replace:

```python

        results = await asyncio.gather(
```

   with:

```python

        # Plan 24: ThaiJO runs alongside SearXNG (its own timeout is shorter), only when enabled
        thaijo = (asyncio.ensure_future(thaijo_search(deps, queries, options))
                  if getattr(deps, "thaijo", None) is not None else None)
        results = await asyncio.gather(
```

4. Replace:

```python
                trial_hits += len(res)
        # Plan 20 Task 10: one more Europe PMC RCT search for the trial acronyms the first round names, scoped to the
```

   with:

```python
                trial_hits += len(res)
        thaijo_entry: dict | None = None
        if thaijo is not None:  # its own list in the round-robin too, after the trial searches
            thaijo_hits, thaijo_entry = await thaijo
            per_query["thaijo:"] = thaijo_hits
            if failures := thaijo_errors(thaijo_entry, deps.settings.thaijo_timeout_seconds):
                errors.extend(failures)
                log.warning("thaijo_search_degraded", failed=thaijo_entry.get("failed"),
                            timed_out=bool(thaijo_entry.get("timed_out")), kept=thaijo_entry["kept"],
                            search_failed=thaijo_entry.get("search_failed", 0),
                            detail_failed=thaijo_entry.get("detail_failed", 0))
        # Plan 20 Task 10: one more Europe PMC RCT search for the trial acronyms the first round names, scoped to the
```

5. Replace:

```python
            entry |= {"trial_failed": trial_failed, "trial_names": names, "trial_name_hits": len(name_hits)}
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
```

   with:

```python
            entry |= {"trial_failed": trial_failed, "trial_names": names, "trial_name_hits": len(name_hits)}
        if thaijo_entry is not None:  # Plan 24
            entry["thaijo"] = thaijo_entry
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
```

`backend/app/harness/quality.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
        extra["europepmc_failures"] = epmc_failed
    enrich = by_stage.get("enrich") or []
```

   with:

```python
        extra["europepmc_failures"] = epmc_failed
    # Plan 24: what the ThaiJO search and the OAI-PMH step did; absent when ThaiJO is off
    if search and "thaijo" in search[-1]:
        extra["thaijo"] = dict(search[-1]["thaijo"])
    oai = by_stage.get("thaijo_metadata") or []
    if oai:
        extra.setdefault("thaijo", {})["metadata"] = {k: oai[-1].get(k, 0) for k in ("asked", "found", "failed")} | {
            "timed_out": bool(oai[-1].get("timed_out"))}
    enrich = by_stage.get("enrich") or []
```

`backend/app/services/review_service.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
            version = f"{version}+g{glossary}"
        return version
```

   with:

```python
            version = f"{version}+g{glossary}"
        if self.settings.thaijo_enabled:  # Plan 24: a pool with ThaiJO is a different search
            version = f"{version}+thaijo"
        return version
```

`backend/app/evals/freeze.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.graph.graph import build_freeze_graph, initial_state

```

   with:

```python
from app.graph.graph import build_freeze_graph, initial_state


def freeze_engines(settings) -> list[str]:
    """The sources a frozen pool was searched with: the SearXNG engines, plus thaijo when it was on (Plan 24)."""
    engines = [e.strip() for e in str(settings.searxng_engines).split(",") if e.strip()]
    return engines + (["thaijo"] if settings.thaijo_enabled else [])

```

`backend/app/cli/eval.py`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.evals.freeze import freeze_all
```

   with:

```python
from app.evals.freeze import freeze_all, freeze_engines
```

2. Replace:

```python
        engines = [e.strip() for e in str(deps.settings.searxng_engines).split(",") if e.strip()]
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=engines)
```

   with:

```python
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=freeze_engines(deps.settings))
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_search_node.py tests/unit/test_nodes_retrieval.py -q`
Expected: 28 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2173 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/graph/graph.py backend/app/graph/factory.py backend/app/graph/nodes/retrieval.py backend/app/harness/quality.py backend/app/services/review_service.py backend/app/evals/freeze.py backend/app/cli/eval.py backend/tests/unit/test_thaijo_search_node.py
cat > "$MSG" <<'EOF'
feat(search): ThaiJO beside SearXNG under a share cap, soft-failing, with quality.thaijo and +thaijo in the cache key (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 6: The OAI-PMH step for the papers read, and the result fields

**Files:**
- Create: `backend/app/graph/nodes/thaijo.py`
- Modify: `backend/app/graph/state.py`
- Modify: `backend/app/graph/nodes/screening.py`
- Modify: `backend/app/graph/graph.py`
- Modify: `backend/app/graph/nodes/synthesis.py`
- Test: `backend/tests/unit/test_thaijo_metadata.py`

**Interfaces:**
- Consumes: Task 4 `ThaiJoClient.record`; Task 5 `GraphDeps.thaijo`, `quality.thaijo` summarising; `route_to_reading`, `_add_review_nodes`, `make_finalize`.
- Produces:
  - `app/graph/nodes/thaijo.py`: `CONCURRENCY = 2`; `thaijo_papers(selected) -> [{"ref", "thaijo_url"}]`; `make_thaijo_metadata(deps)` → node returning `{"thaijo_bib": {ref: bib}, "quality": [{"stage": "thaijo_metadata", "asked", "failed", "found", "seconds", ["timed_out"]}]}`.
  - `ReviewState.thaijo_bib: dict | None`.
  - `route_to_reading(state, external_enabled=None, citations_enabled=None, thaijo_enabled=None)`: adds `Send("thaijo_metadata", {"papers": [...]})` when enabled and a selected candidate has `thaijo_url`.
  - Graph node `thaijo_metadata` → `normalize_outcomes` (in `_add_review_nodes`, so the eval graph has it too).
  - Each `result.papers[]` entry gains `"thaijo_url"` and `"bib"`.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_thaijo_metadata.py` (new file, complete):

```python
import asyncio

from langgraph.types import Send

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.screening import route_to_reading
from app.graph.nodes.thaijo import make_thaijo_metadata, thaijo_papers
from app.graph.schemas import Candidate
from tests.unit.test_review_graph import ABSTRACT, make_deps, run

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/{}"
BIB = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["2985-1750"],
       "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}


class FakeRecords:
    def __init__(self, bibs=None, fail=(), slow=()):
        self.bibs, self.fail, self.slow, self.calls = bibs or {}, set(fail), set(slow), []

    async def record(self, url):
        self.calls.append(url)
        if url in self.fail:
            raise RuntimeError("oai down")
        if url in self.slow:
            await asyncio.sleep(5)
        return self.bibs.get(url)


def _deps(fake, timeout=12.0):
    return GraphDeps(settings=Settings(_env_file=None, thaijo_timeout_seconds=timeout), thaijo=fake)


def _selected(*urls):
    return [{"ref": f"P{i}", "candidate": {"title": "t", "thaijo_url": u}} for i, u in enumerate(urls, 1)]


def test_only_papers_from_thaijo_are_asked():
    sel = _selected(URL.format(1), None, URL.format(3))
    assert thaijo_papers(sel) == [{"ref": "P1", "thaijo_url": URL.format(1)}, {"ref": "P3", "thaijo_url": URL.format(3)}]


def test_the_route_adds_one_metadata_step_only_when_enabled_and_needed():
    state = {"selected": _selected(URL.format(1), None), "options": {}, "topic": "t"}
    sends = route_to_reading(state, thaijo_enabled=lambda: True)
    meta = [s for s in sends if isinstance(s, Send) and s.node == "thaijo_metadata"]
    assert len(meta) == 1 and meta[0].arg == {"papers": [{"ref": "P1", "thaijo_url": URL.format(1)}]}
    assert not [s for s in route_to_reading(state, thaijo_enabled=lambda: False) if s.node == "thaijo_metadata"]
    no_thai = {"selected": _selected(None), "options": {}, "topic": "t"}
    assert not [s for s in route_to_reading(no_thai, thaijo_enabled=lambda: True) if s.node == "thaijo_metadata"]


async def test_the_node_collects_records_and_survives_failures():
    fake = FakeRecords({URL.format(1): BIB}, fail={URL.format(2)})
    papers = thaijo_papers(_selected(URL.format(1), URL.format(2), URL.format(3)))
    out = await make_thaijo_metadata(_deps(fake))({"papers": papers})
    assert out["thaijo_bib"] == {"P1": BIB}
    (entry,) = out["quality"]
    assert (entry["stage"], entry["asked"], entry["found"], entry["failed"]) == ("thaijo_metadata", 3, 1, 1)


async def test_a_slow_journal_server_is_cut_at_the_timeout_and_keeps_what_arrived():
    fake = FakeRecords({URL.format(1): BIB}, slow={URL.format(2)})
    papers = thaijo_papers(_selected(URL.format(1), URL.format(2)))
    out = await make_thaijo_metadata(_deps(fake, timeout=0.2))({"papers": papers})
    assert out["thaijo_bib"] == {"P1": BIB} and out["quality"][0]["timed_out"] is True


class FakeThaiJo(FakeRecords):
    async def collect(self, queries, *, limit, out, stats):
        stats.update({"hits": 1, "detailed": 1})
        out.append(Candidate(title="Thai cohort about metformin and colorectal cancer", abstract=f"Thai. {ABSTRACT}",
                             abstract_source="thaijo", url=URL.format(7), thaijo_url=URL.format(7),
                             engines=["thaijo"]))


async def test_a_review_with_thaijo_links_the_page_and_carries_the_record():
    deps = make_deps()
    deps.thaijo = FakeThaiJo({URL.format(7): BIB})
    values, _ = await run(deps, options={"max_papers": 30, "candidate_limit": 40})
    r = values["result"]
    (thai,) = [p for p in r["papers"] if p["thaijo_url"]]
    assert thai["thaijo_url"] == URL.format(7) and thai["url"] == URL.format(7) and thai["bib"] == BIB
    others = [p for p in r["papers"] if not p["thaijo_url"]]
    assert others and all(p["bib"] is None and p["thaijo_url"] is None for p in others)
    assert r["methods"]["sources"]["thaijo"] == 1
    assert r["quality"]["thaijo"]["metadata"] == {"asked": 1, "found": 1, "failed": 0, "timed_out": False}
    assert deps.thaijo.calls == [URL.format(7)]


async def test_a_review_without_thaijo_has_null_fields_and_no_block():
    values, _ = await run(make_deps())
    r = values["result"]
    assert all(p["thaijo_url"] is None and p["bib"] is None for p in r["papers"])
    assert "thaijo" not in r["quality"] and "thaijo" not in (r["methods"]["sources"] or {})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_metadata.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.graph.nodes.thaijo'`.

- [ ] **Step 3: Implement**

`backend/app/graph/nodes/thaijo.py` (new file, complete):

```python
"""OAI-PMH bibliographic metadata for the selected ThaiJO papers (Plan 24), in parallel with reading: volume, issue,
pages, ISSN, licence and article type, for the papers actually read (at most max_papers), never the whole pool.
Metadata only, never text for a prompt. Any failure is soft: the paper keeps its search metadata."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from app.logging import get_logger

log = get_logger(__name__)
CONCURRENCY = 2  # OAI-PMH requests in flight per review (the journal servers are small)


def thaijo_papers(selected: list[dict[str, Any]]) -> list[dict[str, str]]:
    """`{ref, thaijo_url}` of the selected papers that came from ThaiJO."""
    return [{"ref": s["ref"], "thaijo_url": url} for s in selected
            if (url := (s.get("candidate") or {}).get("thaijo_url"))]


def make_thaijo_metadata(deps):
    async def thaijo_metadata(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        papers = payload.get("papers") or []
        found: dict[str, dict[str, Any]] = {}
        stats: dict[str, Any] = {"asked": len(papers), "failed": 0}
        gate = asyncio.Semaphore(CONCURRENCY)

        async def one(paper: dict[str, str]) -> None:
            try:
                async with gate:
                    bib = await deps.thaijo.record(paper["thaijo_url"])
            except Exception as exc:  # noqa: BLE001 - metadata only; the paper keeps its search metadata
                stats["failed"] += 1
                log.warning("thaijo_oai_failed", ref=paper["ref"], error=type(exc).__name__)
                return
            if bib:
                found[paper["ref"]] = bib

        try:
            await asyncio.wait_for(asyncio.gather(*(one(p) for p in papers)), deps.settings.thaijo_timeout_seconds)
        except TimeoutError:
            stats["timed_out"] = True
            log.warning("thaijo_oai_timed_out", asked=len(papers), found=len(found))
        return {"thaijo_bib": found,
                "quality": [{"stage": "thaijo_metadata", **stats, "found": len(found),
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return thaijo_metadata
```

`backend/app/graph/state.py`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    citations: dict[str, Any] | None  # {edges, cited_by, coverage, source_note}; soft-fails to null coverage
    papers: Annotated[list[dict[str, Any]], operator.add]  # {ref, candidate, relevance, card, error}
```

   with:

```python
    citations: dict[str, Any] | None  # {edges, cited_by, coverage, source_note}; soft-fails to null coverage
    thaijo_bib: dict[str, Any] | None  # Plan 24: ref -> OAI-PMH {volume, issue, pages, issn, license, article_type}
    papers: Annotated[list[dict[str, Any]], operator.add]  # {ref, candidate, relevance, card, error}
```

`backend/app/graph/nodes/screening.py`: 3 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.progress import progress_writer
```

   with:

```python
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.nodes.thaijo import thaijo_papers
from app.graph.progress import progress_writer
```

2. Replace:

```python
def route_to_reading(state: ReviewState, external_enabled=None, citations_enabled=None) -> list[Send] | str:
    """One read_paper per selected paper, plus one external_enrich when external MCP tools are configured
```

   with:

```python
def route_to_reading(state: ReviewState, external_enabled=None, citations_enabled=None,
                     thaijo_enabled=None) -> list[Send] | str:
    """One read_paper per selected paper, plus one external_enrich when external MCP tools are configured, one
    fetch_citations, and (Plan 24) one thaijo_metadata when ThaiJO is on and a selected paper came from it
```

3. Replace:

```python
                                                          for s in selected]}))
    return sends
```

   with:

```python
                                                          for s in selected]}))
    if thaijo_enabled is not None and thaijo_enabled() and (thai := thaijo_papers(selected)):
        sends.append(Send("thaijo_metadata", {"papers": thai}))
    return sends
```

`backend/app/graph/graph.py`: 4 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
    synthesis,
)
```

   with:

```python
    synthesis,
    thaijo,
)
```

2. Replace:

```python
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations) → normalize_outcomes
```

   with:

```python
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations, thaijo_metadata) → normalize_outcomes
```

3. Replace:

```python
    b.add_node("fetch_citations", citations.make_fetch_citations(deps))
    b.add_node("normalize_outcomes", synthesis.make_normalize_outcomes(deps))
```

   with:

```python
    b.add_node("fetch_citations", citations.make_fetch_citations(deps))
    b.add_node("thaijo_metadata", thaijo.make_thaijo_metadata(deps))
    b.add_node("normalize_outcomes", synthesis.make_normalize_outcomes(deps))
```

4. Replace:

```python
                citations_enabled=lambda: deps.openalex is not None),
        ["read_paper", "external_enrich", "fetch_citations", "normalize_outcomes"],
    )
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("external_enrich", "normalize_outcomes")
    b.add_edge("fetch_citations", "normalize_outcomes")
```

   with:

```python
                citations_enabled=lambda: deps.openalex is not None,
                thaijo_enabled=lambda: getattr(deps, "thaijo", None) is not None),
        ["read_paper", "external_enrich", "fetch_citations", "thaijo_metadata", "normalize_outcomes"],
    )
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("external_enrich", "normalize_outcomes")
    b.add_edge("fetch_citations", "normalize_outcomes")
    b.add_edge("thaijo_metadata", "normalize_outcomes")
```

`backend/app/graph/nodes/synthesis.py`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
        left_out = set(design_excluded(state))  # Plan 20 Task 6: listed with a note, never used as evidence
        for p in papers:
```

   with:

```python
        left_out = set(design_excluded(state))  # Plan 20 Task 6: listed with a note, never used as evidence
        bibs = state.get("thaijo_bib") or {}  # Plan 24: OAI-PMH metadata of the ThaiJO papers
        for p in papers:
```

2. Replace:

```python
                "design_excluded": p["ref"] in left_out,
            })
```

   with:

```python
                "design_excluded": p["ref"] in left_out,
                "thaijo_url": c.get("thaijo_url"), "bib": bibs.get(p["ref"]),
            })
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_metadata.py tests/unit/test_citations.py tests/unit/test_review_graph.py -q`
Expected: 41 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2179 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/graph/nodes/thaijo.py backend/app/graph/state.py backend/app/graph/nodes/screening.py backend/app/graph/graph.py backend/app/graph/nodes/synthesis.py backend/tests/unit/test_thaijo_metadata.py
cat > "$MSG" <<'EOF'
feat(graph): OAI-PMH metadata for the ThaiJO papers read, beside reading; papers carry thaijo_url and bib (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 7: Markdown references — volume, issue, pages and the ThaiJO page

**Files:**
- Modify: `backend/app/services/report.py`
- Test: `backend/tests/unit/test_thaijo_report.py`

**Interfaces:**
- Consumes: Task 3 `article_link`; Task 6 `papers[].thaijo_url`, `papers[].bib`; `_citation_parts`, `vancouver`, `render_markdown`.
- Produces: `_citation_parts(p)` adds `Year;Vol(Issue):Pages.` (`Year:Pages.` with pages only, `Vol:Pages.` without a year) from `p["bib"]`, and the identifier `("ThaiJO", url, url)` when `article_link(p["thaijo_url"])` passes. Papers without `bib`/`thaijo_url` keep their exact reference.

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/test_thaijo_report.py` (new file, complete):

```python
from app.graph.nodes.stub_result import stub_result
from app.services.report import render_markdown, vancouver
from tests.unit.test_plan20_task6 import FULL, _review

URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
BIB = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["2985-1750"],
       "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}
THAI = {"title": "Medication adherence among older adults with hypertension", "authors": ["Somchai Demo"],
        "journal": "Journal of Demo Health Sciences", "year": 2024, "thaijo_url": URL, "bib": BIB}


def test_a_thaijo_reference_has_volume_issue_pages_and_its_page():
    assert vancouver(THAI) == ("Demo S. Medication adherence among older adults with hypertension. Journal of Demo "
                               f"Health Sciences. 2024;17(4):1048-1066. ThaiJO: {URL}.")


def test_partial_bibliographic_fields_are_left_out_never_invented():
    def ref(**bib):
        return vancouver({"title": "T", "year": 2024, "bib": bib})

    assert ref(volume="11", issue="2") == "T. 2024;11(2)."
    assert ref(pages="e265234") == "T. 2024:e265234."
    assert vancouver({"title": "T", "bib": {"volume": "11", "pages": "45-58"}}) == "T. 11:45-58."
    assert vancouver({"title": "T", "year": 2024, "bib": None}) == "T. 2024."


def test_other_papers_keep_their_reference():
    assert vancouver({**FULL, "bib": None, "thaijo_url": None}) == vancouver(FULL)


def test_a_page_outside_thaijo_is_never_linked():
    for url in ["https://evil.example/index.php/demo/article/view/1", f"{URL}/555", "javascript:alert(1)"]:
        assert "ThaiJO" not in vancouver({**THAI, "thaijo_url": url})


def test_markdown_links_the_thaijo_page():
    r = stub_result("t", "en", "slr")
    r["papers"][0] |= {"thaijo_url": URL, "bib": BIB, "doi": None, "pmid": None, "pmcid": None}
    p1 = next(x for x in render_markdown(_review(r)).splitlines() if x.startswith("- [P1] "))
    assert f"ThaiJO: [{URL}]({URL})." in p1 and ";17(4):1048-1066." in p1
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_report.py -q`
Expected: 3 failed (`AssertionError`: the reference ends `… 2024.` with no volume or link; `'T. 2024.' == 'T. 2024;11(2).'`; no `ThaiJO:` link in the Markdown line).

- [ ] **Step 3: Implement**

`backend/app/services/report.py`: 4 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```python
from app.harness.meta import DESIGN_GROUP_LABEL

```

   with:

```python
from app.harness.meta import DESIGN_GROUP_LABEL
from app.services.thaijo import article_link

```

2. Replace:

```python
    carries (no volume, issue or pages: the search sources do not give them); a missing part is left out. The title
    and journal stay in their own language. Mirrors frontend `src/lib/citation.ts`."""
```

   with:

```python
    carries: volume, issue and pages only for ThaiJO papers (`bib`, from OAI-PMH, Plan 24; the other sources do not
    give them); a missing part is left out. The title and journal stay in their own language. Mirrors frontend
    `src/lib/citation.ts`."""
```

3. Replace:

```python
    if p.get("year"):
        text.append(f"{p['year']}.")
```

   with:

```python
    bib = p.get("bib") if isinstance(p.get("bib"), dict) else {}
    volume, issue, pages = (_clean(bib.get(k)) for k in ("volume", "issue", "pages"))
    where = volume + (f"({issue})" if issue else "")
    date = _clean(p.get("year"))
    date = f"{date};{where}" if date and where else date or where
    date = f"{date}:{pages}" if date and pages else date or pages
    if date:  # NLM: "2024;17(4):1048-1066.", "2024:e265234."
        text.append(f"{date}.")
```

4. Replace:

```python
        ids.append(("PMCID", _pmcid(p.get("pmcid")), f"https://pmc.ncbi.nlm.nih.gov/articles/{_pmcid(p.get('pmcid'))}/"))
    return text, ids
```

   with:

```python
        ids.append(("PMCID", _pmcid(p.get("pmcid")), f"https://pmc.ncbi.nlm.nih.gov/articles/{_pmcid(p.get('pmcid'))}/"))
    if article_link(p.get("thaijo_url")):  # Plan 24: the ThaiJO article page (checked again; never the PDF)
        ids.append(("ThaiJO", p["thaijo_url"], p["thaijo_url"]))
    return text, ids
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_thaijo_report.py tests/unit/test_plan20_task6.py -q`
Expected: 49 passed.

- [ ] **Step 5: Full suite and lint**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (pre-flight: 2184 passed, 41 skipped), ruff clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add backend/app/services/report.py backend/tests/unit/test_thaijo_report.py
cat > "$MSG" <<'EOF'
feat(report): Vancouver Year;Vol(Issue):Pages and the ThaiJO page link in the Markdown export (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 8: Frontend — the ThaiJO label, the page link and the reference

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/citation.ts`
- Modify: `frontend/src/lib/report-view.ts`
- Modify: `frontend/src/components/review/references.tsx`
- Modify: `frontend/src/components/review/source-rail.tsx`
- Test: `frontend/src/lib/thaijo.test.tsx`

**Interfaces:**
- Consumes: Task 6 result fields; Task 7's reference string (the frontend must match it byte for byte).
- Produces:
  - `PaperBib` and `Paper.thaijo_url?`, `Paper.bib?` (`src/lib/types.ts`);
  - `thaijoHref(url) -> string | null`, `CitationInput` with `thaijo_url` and `bib`, `CitationId.label` adds `"ThaiJO"`, `citationParts` adds the date part with `bib` and the ThaiJO id (`src/lib/citation.ts`);
  - `SOURCE_NAME.thaijo = "ThaiJO"` (so `sourceNames` and `sourceRows` name it);
  - `ID_NAME.ThaiJO = "ThaiJO"` in `references.tsx`; a "ThaiJO" link in the source rail's `Links`.
- No DESIGN.md change: the link reuses the rail's existing link style; no new colours, fonts or components.

- [ ] **Step 0: Install once**

Run: `cd /d/MRA-plan-24/frontend && npm ci`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/thaijo.test.tsx` (new file, complete):

```tsx
// Plan 24: ThaiJO papers in the report: the source label, the article-page link, and volume/issue/pages in references.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReferencesSection } from "@/components/review/references";
import { SourceRail } from "@/components/review/source-rail";
import { resultFixture } from "@/test/fixtures";
import { citationParts, thaijoHref, vancouver } from "./citation";
import { sourceRows } from "./prisma-flow";
import { sourceNames } from "./report-view";
import type { Paper, PaperBib } from "./types";

const URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001";
const BIB: PaperBib = { volume: "17", issue: "4", pages: "1048-1066", issn: ["2985-1750"],
  license: "https://creativecommons.org/licenses/by-nc-nd/4.0", article_type: "Peer-reviewed article" };
const THAI = { title: "Medication adherence among older adults with hypertension", authors: ["Somchai Demo"],
  journal: "Journal of Demo Health Sciences", year: 2024, thaijo_url: URL, bib: BIB };

describe("ThaiJO references", () => {
  it("adds volume, issue, pages and the article page (the backend's rules, byte for byte)", () => {
    expect(vancouver(THAI)).toBe("Demo S. Medication adherence among older adults with hypertension. Journal of Demo " +
      `Health Sciences. 2024;17(4):1048-1066. ThaiJO: ${URL}.`);
  });

  it("leaves partial fields out and never invents them", () => {
    const ref = (bib: Partial<PaperBib>) => vancouver({ title: "T", year: 2024, bib: bib as PaperBib });
    expect(ref({ volume: "11", issue: "2" })).toBe("T. 2024;11(2).");
    expect(ref({ pages: "e265234" })).toBe("T. 2024:e265234.");
    expect(vancouver({ title: "T", bib: { volume: "11", pages: "45-58" } as PaperBib })).toBe("T. 11:45-58.");
    expect(vancouver({ title: "T", year: 2024, bib: null })).toBe("T. 2024.");
  });

  it("links only a ThaiJO article page, never a PDF or another host", () => {
    expect(thaijoHref(URL)).toBe(URL);
    for (const bad of [`${URL}/555`, "https://evil.example/index.php/demo/article/view/1",
      "https://tci-thaijo.org.evil.example/index.php/demo/article/view/1", "http://he01.tci-thaijo.org/index.php/demo/article/view/1",
      "javascript:alert(1)", null, undefined]) {
      expect(thaijoHref(bad)).toBeNull();
    }
    expect(citationParts({ ...THAI, thaijo_url: `${URL}/555` }).ids).toEqual([]);
  });
});

describe("ThaiJO as a source", () => {
  it("is named ThaiJO in the methods, the title block and PRISMA", () => {
    expect(sourceNames({ pubmed: 3, thaijo: 2 })).toEqual(["PubMed", "ThaiJO"]);
    expect(sourceRows({ thaijo: 2 }, "th")).toEqual([{ key: "thaijo", label: "ThaiJO", value: 2 }]);
  });

  it("the source rail links the article page", () => {
    const p: Paper = { ...structuredClone(resultFixture.papers![0]), doi: null, pmid: null, pmcid: null, url: URL,
      thaijo_url: URL, bib: BIB };
    render(<SourceRail paper={p} lang="en" />);
    const link = screen.getByRole("link", { name: /ThaiJO/ });
    expect(link).toHaveAttribute("href", URL);
    expect(document.querySelectorAll(`a[href="${URL}"]`)).toHaveLength(1);
  });

  it("the reference list links the page with an accessible name", () => {
    const p: Paper = { ...structuredClone(resultFixture.papers![0]), ref: "P1", doi: null, pmid: null, pmcid: null,
      thaijo_url: URL, bib: BIB };
    render(<ReferencesSection papers={[p]} lang="th" onSelect={() => {}} type="slr" />);
    const link = screen.getByRole("link", { name: new RegExp(`^ThaiJO ${URL.replace(/[.?]/g, "\\$&")}`) });
    expect(link).toHaveAttribute("href", URL);
    expect(document.querySelector("[data-citation]")?.textContent).toContain(";17(4):1048-1066.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /d/MRA-plan-24/frontend && npx vitest run src/lib/thaijo.test.tsx`
Expected: 6 failed (`AssertionError` on the reference strings, `TypeError: thaijoHref is not a function`, the source names, no ThaiJO link).

- [ ] **Step 3: Implement**

`frontend/src/lib/types.ts`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```ts

export interface Paper {
```

   with:

```ts

/** Plan 24: bibliographic fields from the journal's OAI-PMH record (ThaiJO papers only); any of them can be null. */
export interface PaperBib {
  volume: string | null;
  issue: string | null;
  pages: string | null;
  issn: string[];
  license: string | null;
  article_type: string | null;
}

export interface Paper {
```

2. Replace:

```ts
  design_excluded?: boolean;
}
```

   with:

```ts
  design_excluded?: boolean;
  /** Plan 24: the ThaiJO article page (never a PDF); null for papers from other sources, absent before Plan 24. */
  thaijo_url?: string | null;
  /** Plan 24: OAI-PMH bibliographic fields of a ThaiJO paper; null when it has none, absent before Plan 24. */
  bib?: PaperBib | null;
}
```

`frontend/src/lib/citation.ts`: 4 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```ts
// Plan 20 Task 6: references in Vancouver (ICMJE) style and how to cite the report. Pure, no React. The result carries
// no volume, issue or pages (the search sources do not give them), so a reference is built from authors, title,
// journal, year and the identifiers only; a missing part is left out, never invented. Titles and journals stay in their
// own language. The backend's Markdown export (app/services/report.py `vancouver`) follows the same rules.
```

   with:

```ts
// Plan 20 Task 6: references in Vancouver (ICMJE) style and how to cite the report. Pure, no React. A reference is
// built from authors, title, journal, year and the identifiers; volume, issue and pages only for ThaiJO papers (`bib`,
// from the journal's OAI-PMH record, Plan 24: the other search sources do not give them). A missing part is left
// out, never invented. Titles and journals stay in their own language. The backend's Markdown export
// (app/services/report.py `vancouver`) follows the same rules.
```

2. Replace:

```ts
export type CitationInput = Partial<Pick<Paper, "title" | "authors" | "journal" | "year" | "doi" | "pmid" | "pmcid">>;

export interface CitationId {
  label: "doi" | "PMID" | "PMCID";
  value: string;
  href: string;
```

   with:

```ts
export type CitationInput = Partial<Pick<Paper, "title" | "authors" | "journal" | "year" | "doi" | "pmid" | "pmcid" | "thaijo_url" | "bib">>;

export interface CitationId {
  label: "doi" | "PMID" | "PMCID" | "ThaiJO";
  value: string;
  href: string;
}

/** A ThaiJO article page (https on *.tci-thaijo.org, the article-view path), as the backend checks it; else null. */
export function thaijoHref(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https:\/\/(?:[a-z0-9-]+\.)*tci-thaijo\.org\/index\.php\/[A-Za-z0-9_-]{1,64}\/article\/view\/\d{1,10}\/?$/i.test(u) ? u : null;
```

3. Replace:

```ts
  if (p.year) text.push(`${p.year}.`);
```

   with:

```ts
  const volume = clean(p.bib?.volume);
  const issue = clean(p.bib?.issue);
  const pages = clean(p.bib?.pages);
  const where = volume + (issue ? `(${issue})` : "");
  let date = clean(p.year);
  date = date && where ? `${date};${where}` : date || where;
  date = date && pages ? `${date}:${pages}` : date || pages;
  if (date) text.push(`${date}.`); // NLM: "2024;17(4):1048-1066.", "2024:e265234."
```

4. Replace:

```ts
  if (pmcid) ids.push({ label: "PMCID", value: pmcid, href: pmcHref(pmcid) });
  return { text, ids };
```

   with:

```ts
  if (pmcid) ids.push({ label: "PMCID", value: pmcid, href: pmcHref(pmcid) });
  const thaijo = thaijoHref(p.thaijo_url);
  if (thaijo) ids.push({ label: "ThaiJO", value: thaijo, href: thaijo });
  return { text, ids };
```

`frontend/src/lib/report-view.ts`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```ts
  semanticscholar: "Semantic Scholar", crossref: "Crossref", arxiv: "arXiv", doaj: "DOAJ", openaire: "OpenAIRE",
};
```

   with:

```ts
  semanticscholar: "Semantic Scholar", crossref: "Crossref", arxiv: "arXiv", doaj: "DOAJ", openaire: "OpenAIRE",
  thaijo: "ThaiJO",
};
```

`frontend/src/components/review/references.tsx`: 1 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```tsx
const ID_NAME: Record<CitationId["label"], string> = { doi: "DOI", PMID: "PubMed", PMCID: "PubMed Central" };

/** The anchor of a paper's reference (`#ref-P3`): the source rail links here. */
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central); the text is never translated. */
```

   with:

```tsx
const ID_NAME: Record<CitationId["label"], string> = { doi: "DOI", PMID: "PubMed", PMCID: "PubMed Central", ThaiJO: "ThaiJO" };

/** The anchor of a paper's reference (`#ref-P3`): the source rail links here. */
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central, the ThaiJO page); the text is never translated. */
```

`frontend/src/components/review/source-rail.tsx`: 2 replacement(s), applied in order (each `old` occurs exactly once).

1. Replace:

```tsx
import { designLabel, isNonQuantitative } from "@/lib/charts-data";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
```

   with:

```tsx
import { designLabel, isNonQuantitative } from "@/lib/charts-data";
import { thaijoHref } from "@/lib/citation";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
```

2. Replace:

```tsx
  if (paper.doi) links.push([`https://doi.org/${paper.doi}`, `DOI ${paper.doi}`]);
  if (fullText && !links.some(([u]) => u === fullText)) links.push([fullText, L(lang, R.fullTextRead)]);
```

   with:

```tsx
  if (paper.doi) links.push([`https://doi.org/${paper.doi}`, `DOI ${paper.doi}`]);
  const thaijo = thaijoHref(paper.thaijo_url); // Plan 24: the ThaiJO article page, never the PDF
  if (thaijo) links.push([thaijo, "ThaiJO"]);
  if (fullText && !links.some(([u]) => u === fullText)) links.push([fullText, L(lang, R.fullTextRead)]);
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-24/frontend && npx vitest run src/lib/thaijo.test.tsx src/lib/citation.test.ts src/lib/prisma-flow.test.ts src/components/review/references.test.tsx src/lib/review-fixes.test.tsx`
Expected: 5 files, 105 tests passed.

- [ ] **Step 5: All frontend checks**

Run: `cd /d/MRA-plan-24/frontend && npm test && npm run typecheck && npm run lint`
Expected: all pass (pre-flight: 143 files, 1515 tests), typecheck and eslint clean.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-24 && git add frontend/src/lib/types.ts frontend/src/lib/citation.ts frontend/src/lib/report-view.ts frontend/src/components/review/references.tsx frontend/src/components/review/source-rail.tsx frontend/src/lib/thaijo.test.tsx
cat > "$MSG" <<'EOF'
feat(report-ui): ThaiJO as a named source, its article-page link and Year;Vol(Issue):Pages references (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

---

### Task 9: Docs, final checks, then merge, the CLAUDE.md line, docker and the smoke check

**Files:**
- Modify: `docs/api.md`, `README.md`, `.env.example`, `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`
- After the merge, on master: root `CLAUDE.md`, by the crafted-blob method

**Steps 1–3 are for the implementer. Steps 4–6 are done by the controller after the final review.**

- [ ] **Step 1: Docs** — apply these replacements (each `old` occurs exactly once):

1. `docs/api.md`: replace

```markdown
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
```

   with:

```markdown
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
- **ThaiJO (Plan 24, off by default):** Thai health journals through TCI's search API, enabled only with
  `THAIJO_ENABLED=true` (see "ThaiJO source (Plan 24)" below).
```

2. `docs/api.md`: replace

```markdown
  RCT search; `unknown` for a hit that names no engine). A hit that several engines returned counts once for each, so
  the counts can sum to more than `stats.found`. null when not recorded.
```

   with:

```markdown
  RCT search; `thaijo` for ThaiJO (Plan 24: the ThaiJO records with an English abstract taken into the pool, at most
  the share cap); `unknown` for a hit that names no engine). A hit that several engines returned counts once for each,
  so the counts can sum to more than `stats.found`. null when not recorded.
```

3. `docs/api.md`: replace

```markdown
**Papers.** Each entry in `papers[]` has `ref, title, authors, year, journal, doi, pmid, pmcid, url, relevance, screen_reason, card, card_en, verification, error`.
- No volume, issue or pages: the search sources do not give them, so references (report and Markdown, Plan 20 Task 6)
  are Vancouver style from these fields only: `Authors (the first 6, then "et al."). Title. Journal. Year. doi: …
  PMID: … PMCID: …`, a missing part left out, titles and journals as written (never translated). Authors are put in
```

   with:

```markdown
**Papers.** Each entry in `papers[]` has `ref, title, authors, year, journal, doi, pmid, pmcid, url, relevance, screen_reason, card, card_en, verification, error`, and since Plan 24 `thaijo_url` and `bib`.
- `thaijo_url` (Plan 24): the ThaiJO article page (`https://<host>.tci-thaijo.org/index.php/<journal>/article/view/<id>`,
  never the PDF) for a paper found in ThaiJO, else null. `bib`: `{volume, issue, pages, issn[], license, article_type}`
  from the journal's OAI-PMH record for a ThaiJO paper that was read (any field can be null; `license` is a Creative
  Commons URL), else null. Both are absent from results stored before Plan 24.
- Volume, issue and pages appear only for ThaiJO papers (`bib`); the other search sources do not give them. References
  (report and Markdown, Plan 20 Task 6) are Vancouver style from these fields only: `Authors (the first 6, then "et
  al."). Title. Journal. Year;Volume(Issue):Pages. doi: … PMID: … PMCID: … ThaiJO: <page>`, a missing part left out
  (`Year.` alone when there is no `bib`), titles and journals as written (never translated). Authors are put in
```

4. `docs/api.md`: replace

```markdown
**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
```

   with:

```markdown
**ThaiJO and the cache (Plan 24).** While `THAIJO_ENABLED` is true, `+thaijo` is added to the pipeline version, so
turning ThaiJO on or off never returns a review that was searched the other way.

**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
```

5. `docs/api.md`: replace

```markdown
- `localize_templated`: Thai reviews only. The consensus and conflict strings rendered from fixed Thai templates in code instead of being translated.
```

   with:

```markdown
- `localize_templated`: Thai reviews only. The consensus and conflict strings rendered from fixed Thai templates in code instead of being translated.

Plan 24 adds (absent while ThaiJO is off):
- `thaijo`: `{hits, detailed, no_abstract, search_failed, detail_failed, cache_hits, cap, kept, seconds}` for the ThaiJO
  search (`hits`: health-category hits across the queries; `detailed`: abstracts looked up; `kept`: candidates taken),
  plus `failed` (an error name) or `timed_out: true` when it failed or was cut, and `metadata: {asked, found, failed,
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.
```

6. `docs/api.md`: replace

```markdown
## Event stream (SSE)
```

   with:

```markdown
## ThaiJO source (Plan 24)

- **Off by default.** `THAIJO_ENABLED=true` (env only, read by the API for the cache key and by the workers for the
  search) adds Thai Journals Online (TCI) to every review's search. TCI's search API is undocumented and has no
  published terms: the owner writes to TCI for permission or rate guidance before turning it on.
- **What it asks.** Per review: one search per planner query (at most 3, `POST /api/v1/articles/search`, health
  categories only), the English abstract of each hit it takes (`GET /api/v1/articles/{id}`, at most the cap plus 5),
  and, for the ThaiJO papers that are read, the journal's OAI-PMH `GetRecord` (oai_dc) for volume, issue, pages, ISSN,
  licence and article type. Never the PDF and never the HTML article page. Requests carry the User-Agent
  `MedicalReviewerAgent/0.1 (research; contact via repository)`, are never retried or redirected, time out after
  `THAIJO_REQUEST_TIMEOUT_SECONDS` (5), and the API host is spaced to at most 5 requests a second per process.
  Abstracts and OAI records are cached in Redis by article for `THAIJO_CACHE_TTL_SECONDS` (7 days).
- **What it adds.** Candidates with an English abstract of at least 150 characters (mostly Latin script), at most
  `THAIJO_MAX_CANDIDATES` (15) and at most 1/8 of `candidate_limit`, as their own list in the search round-robin.
  Buddhist-era years (above 2400) become Gregorian. Screening and reading use the English abstract like any other;
  the Thai abstract is not kept. De-duplication is the usual one (DOI when present, else the fuzzy title match).
- **Soft.** The whole ThaiJO search has `THAIJO_TIMEOUT_SECONDS` (12, below SearXNG's 15); a failure or timeout keeps
  what arrived, is listed in `errors` and in `quality.thaijo`, and never fails the review. The OAI step has the same
  budget and never fails a review either.
- **Safety.** The OAI host comes from the hit's `article_url` and must be `https` on `*.tci-thaijo.org` with the
  article-view path, resolving to public addresses only. OAI XML with a DTD or entity declaration, or over 512 KB,
  is refused. Abstracts are third-party text: markup is stripped as for Europe PMC and they are data in the prompts.
- **Not included:** `/api/v1/papers/search` and the MCP `search_papers` tool (they stay on the SearXNG engines), and
  the Cochrane eval's frozen pools (measuring ThaiJO there needs a new pool version, which is a paid batch).

## Event stream (SSE)
```

7. `docs/api.md`: replace

```markdown
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews. `limit` is clamped to 1–25. Shares the paper-search limit |
```

   with:

```markdown
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews (never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
```

8. `README.md`: replace

```markdown
## Integrations: REST, MCP, API keys, webhooks
```

   with:

```markdown
## ThaiJO (Thai journals, off by default)
Plan 24 adds Thai Journals Online (TCI) as a search source for Thai health studies: English abstracts only, at most
15 candidates (and at most 1/8 of the pool), soft-failing, never PDFs or article pages. It is off until
`THAIJO_ENABLED=true` is set in `.env`, which the owner does only after writing to TCI about the use (its search API
is undocumented). Details: "ThaiJO source (Plan 24)" in `docs/api.md`.

## Integrations: REST, MCP, API keys, webhooks
```

9. `.env.example`: replace

```bash
# SEARXNG_ENGINES=pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire
```

   with:

```bash
# SEARXNG_ENGINES=pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire
# ThaiJO (Thai Journals Online, Plan 24): Thai health journals as an extra source. OFF by default: TCI's search API
# is undocumented, so write to TCI about the use and ask for permission or rate guidance before enabling it.
# At most 15 candidates per review (and at most 1/8 of the pool); abstracts and OAI records cached 7 days in Redis.
# THAIJO_ENABLED=false
```

10. `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`: replace

```markdown
| 24 | **ThaiJO source** (section 7) | Cheap, adds Thai evidence, measured by Plan 22 |
```

   with:

```markdown
| 24 | **ThaiJO source** (section 7). **Built (2026-10-13), off by default:** search, detail and OAI-PMH client, at most 15 candidates (1/8 of the pool), soft-fail, "ThaiJO" in the report and PRISMA; `THAIJO_ENABLED` stays false until TCI answers the letter. Measuring it on the 22a harness needs a new pool version (a paid batch, the owner's call). Spec: `../specs/2026-10-13-plan-24-thaijo-source-design.md` | Cheap, adds Thai evidence, measured by Plan 22 |
```

Then run: `cd /d/MRA-plan-24/backend && uv run pytest tests/unit/test_api_docs_limits.py tests/unit/test_harness_worker.py -q`
Expected: 33 passed (the documented limits and the compose/docs checks still hold).

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-plan-24/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-24/frontend && npm test && npm run typecheck && npm run lint`
Expected: all pass (pre-flight: backend 2184 passed, 41 skipped; frontend 143 files, 1515 tests). Integration tests are
unchanged by this plan; run them only if Postgres is up (`MRA_INTEGRATION=1 uv run pytest -m integration -q`) and
report the result or why they were not run.

- [ ] **Step 3: Commit**

```bash
cd /d/MRA-plan-24 && git add docs/api.md README.md .env.example docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
cat > "$MSG" <<'EOF'
docs(thaijo): API reference, README and .env.example (off by default, TCI letter first); roadmap 24 built (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
```

- [ ] **Step 4 (controller): Merge, then the CLAUDE.md line**

The whole-branch review comes first. The main worktree has the owner's uncommitted edits to `CLAUDE.md`,
`frontend/CLAUDE.md` and `infra/searxng/limiter.toml.new`; none may be staged or changed.

```bash
cd /d/MedicalReviewerAgent && git status --short   # expect only the owner's entries
cat > "$MSG" <<'EOF'
Merge plan-24-thaijo: ThaiJO as a search source (off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git merge --no-ff plan-24-thaijo -F "$MSG"
```

Then add the convention line to the committed `CLAUDE.md` only, by building a blob from `HEAD:CLAUDE.md` (use the
session's scratchpad directory for the temporary files):

```bash
cd /d/MedicalReviewerAgent
git show HEAD:CLAUDE.md > "$SCRATCH/claude-md-head.txt"
cat >> "$SCRATCH/claude-md-head.txt" <<'EOF'
- ThaiJO (Plan 24): `app/services/thaijo.py` (search → detail → OAI-PMH) runs only with `THAIJO_ENABLED` (env only, default false; the owner writes to TCI before turning it on). Health categories only, an English abstract ≥ 150 chars, at most `min(thaijo_max_candidates, candidate_limit // 8)` candidates as their own round-robin list, soft-fail into `errors` and `quality.thaijo`; never `pdf_url` or the HTML page; the OAI host only through `article_link` (`*.tci-thaijo.org`, public addresses, no redirects) and XML with a DTD is refused; `+thaijo` joins the cache key while on; tests use synthetic data only (`tests/unit/thaijo_data.py`), never real responses.
EOF
BLOB=$(git hash-object -w "$SCRATCH/claude-md-head.txt")
git update-index --cacheinfo 100644,$BLOB,CLAUDE.md
cat > "$MSG" <<'EOF'
docs(claude): ThaiJO convention line (Plan 24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$MSG"
git status --short   # still exactly the owner's entries; CLAUDE.md stays modified in the working tree
```

Check that `git show HEAD:CLAUDE.md | tail -1` is the new line and that `git diff CLAUDE.md` still shows the owner's
own edits.

- [ ] **Step 5 (controller): Docker rebuild and the smoke check, spending nothing**

No review is started and no LLM is called. The flag is set for one `docker compose exec` command only, so `.env` and
every running process keep `THAIJO_ENABLED=false`; there is nothing to restore. The direct client check makes about
3–10 requests to TCI (one search, a few detail lookups, one OAI record).

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                                                                     # api healthy, worker up
docker compose exec -T api python -c "from app.config import Settings; print(Settings().thaijo_enabled)"     # False
docker compose exec -T worker python -c "from app.config import Settings; print(Settings().thaijo_enabled)"  # False
curl -s http://localhost:8088/api/v1/status | head -c 120; echo                          # accepting, as before
docker compose exec -T -e THAIJO_ENABLED=true api python - <<'EOF'
import asyncio

from redis.asyncio import Redis

from app.config import Settings
from app.graph.factory import build_thaijo
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient


async def main():
    s = Settings()
    http = HttpClient(timeout=s.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    redis = Redis.from_url(s.redis_url, decode_responses=True)
    try:
        client = build_thaijo(s, http, redis)
        print("enabled", client is not None)
        out, stats = [], {}
        await asyncio.wait_for(client.collect(["metformin type 2 diabetes"], limit=2, out=out, stats=stats),
                               s.thaijo_timeout_seconds)
        print("stats", stats)
        for c in out:
            print("candidate", c.year, c.thaijo_url, len(c.abstract or ""), c.abstract_source, c.pdf_url)
        if out:
            print("bib", await client.record(out[0].thaijo_url))
        keys = await redis.keys("mra:thaijo:*")
        print("cached", len(keys))
        if keys:
            await redis.delete(*keys)
    finally:
        await http.aclose()
        await redis.aclose()


asyncio.run(main())
EOF
docker compose exec -T api python -c "from app.config import Settings; print(Settings().thaijo_enabled)"     # False again
```

Expected:
- `enabled True`; `stats` with `hits` ≥ 1, `detailed` ≤ 7, `search_failed` 0;
- up to 2 `candidate` lines: a Gregorian year, an `https://he0?.tci-thaijo.org/index.php/<journal>/article/view/<id>` page,
  an abstract length of at least 150, `thaijo`, `None` (no PDF);
- `bib` a dict with some of volume, issue, pages, issn, license, article_type (or `None` when that journal's record has
  none of them);
- `cached` ≥ 2 (then deleted).

When a result differs (an API shape change, a timeout), stop and investigate before telling the owner Plan 24 is
ready. Report each result exactly.

- [ ] **Step 6 (controller): Clean up and record**

- Remove the worktree with `git worktree remove ../MRA-plan-24`, and keep the branch.
- Update the memory notes (a `plan-24-state.md`) and the `MEMORY.md` index. Record: Plan 24 merged; ThaiJO is off
  (`THAIJO_ENABLED=false`) until the owner's letter to TCI is answered; measuring it on the 22a harness needs a new pool
  version (paid, the owner's call); next on the roadmap is Plan 25.
