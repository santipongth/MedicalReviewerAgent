# Plan 24: ThaiJO as a search source — design (2026-10-13)

**สรุปภาษาไทย:** Plan 24 เพิ่ม ThaiJO (Thai Journals Online ของ TCI) เป็นแหล่งค้นอีกแหล่ง เพื่อให้รีวิวเห็นงานวิจัยสุขภาพของไทย
ระบบเรียก API สามขั้น: ค้น (`POST /api/v1/articles/search` เอาเฉพาะหมวด health), ขอรายละเอียดเพื่อเอาบทคัดย่อภาษาอังกฤษ
(`GET /api/v1/articles/{id}`) เฉพาะรายการที่จะรับเข้า pool และ OAI-PMH `GetRecord` ของวารสาร เฉพาะบทความที่ถูกอ่านจริง
เพื่อเอาเล่ม ฉบับ หน้า ISSN สัญญาอนุญาต และประเภทบทความ ไม่ใช้ `pdf_url` และไม่ดึงหน้า HTML เลย รับเฉพาะบทความที่มีบทคัดย่อ
ภาษาอังกฤษอย่างน้อย 150 ตัวอักษร ปี พ.ศ. แปลงเป็น ค.ศ. ThaiJO ใส่ได้ไม่เกิน 15 รายการและไม่เกิน 1/8 ของ pool เพื่อให้
งานไทยเป็นส่วนเสริม ไม่เบียดหลักฐานสากล ถ้า ThaiJO ล่มหรือช้า รีวิวทำต่อได้โดยไม่มี ThaiJO และบันทึกไว้ใน `errors` กับ
`quality.thaijo` คำขอทุกครั้งมี User-Agent ระบุตัว ไม่ retry ไม่ตาม redirect เว้นระยะไม่เกิน 5 ครั้งต่อวินาทีต่อ process
และเก็บบทคัดย่อกับระเบียน OAI ไว้ใน Redis 7 วัน host ของ OAI ต้องเป็น `*.tci-thaijo.org` และ resolve เป็น IP สาธารณะ
XML ที่มี DTD ถูกปฏิเสธ รายงานแสดงแหล่ง "ThaiJO" ใน Methods/PRISMA ลิงก์ไปหน้าบทความ และเอกสารอ้างอิงมีเล่ม(ฉบับ):หน้า
ฟีเจอร์นี้ **ปิดไว้เป็นค่าเริ่มต้น** (`THAIJO_ENABLED=false`) เจ้าของต้องส่งจดหมายถึง TCI ขออนุญาตหรือขอคำแนะนำเรื่อง
อัตราการเรียกก่อนเปิดใช้ ไม่มีการแก้ prompt จึงไม่เปลี่ยน `prompt_version` และการวัดผลบน harness 22a ต้องใช้ pool version
ใหม่ ซึ่งเป็นงานที่เสียเงิน จึงเป็นการตัดสินใจของเจ้าของและไม่อยู่ในแผนนี้

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 7 (the ThaiJO findings, probed
2026-10-11) and section 6 (row 24). Base: master `5658db0` (Plans 22a, 23a, 23b and 23c merged). The owner told Claude
to run the roadmap plans end to end without approval gates, so Claude stood in for the brainstorming dialogue: the
controller's decisions and Claude's own are in section 2.

## 1. Goal, success and scope

**Goal.** Thai health studies reach the screened pool alongside the international evidence, read from their English
abstracts like any other paper, without breaking any project rule (abstract only, no crawling, verified numbers,
soft-failing sources) and without load on TCI that the owner has not cleared with them.

**Success for Plan 24:**
- With `THAIJO_ENABLED=true`, a review's search also asks ThaiJO. Up to `min(15, candidate_limit // 8)` ThaiJO papers
  with an English abstract of at least 150 characters join the candidate list as their own round-robin list.
- Those papers are screened, selected and read like the rest. For the ones read, the journal's OAI-PMH record adds
  volume, issue, pages, ISSN, licence and article type.
- The report names the source "ThaiJO" (Methods, title block, PRISMA identification rows), links the ThaiJO article
  page (source rail and references), and cites ThaiJO papers in Vancouver form with `Year;Vol(Issue):Pages`.
- ThaiJO down, slow or answering garbage never fails a review: what arrived is kept, the rest is listed in `errors` and
  `quality.thaijo`, and a structured log line is written.
- With the flag off (the default) nothing else changes: no request to TCI, no new key in `quality`, the same cache
  key, and every existing test passes. Papers carry the two new fields as null.

**In scope:** the ThaiJO client (search, detail, OAI-PMH), the search-node integration and share cap, the OAI-PMH
graph step, the result fields, Markdown and web references, the source label, config, docs and tests.

**Out of scope:**
- Turning ThaiJO on in production. That waits for TCI's answer to the owner's letter.
- A runtime console toggle. The 23c console has exactly 13 settings and no boolean kind; `THAIJO_ENABLED` stays
  env-only. A console toggle is a possible later change.
- `/api/v1/papers/search` and the MCP `search_papers` tool. They stay on the SearXNG engines.
- The landing page's source list and `/status`. ThaiJO is off by default, so the public list stays the eight engines;
  listing ThaiJO there is a follow-up once it is on.
- Measuring ThaiJO on the Cochrane harness. The 22a eval replays frozen pools from screening onward, so ThaiJO cannot
  change eval results without a new pool version, which means a paid freeze and run. That is the owner's call.
- Storing or showing Thai abstracts, author institutions, references lists, or anything from the HTML page.

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

**From the controller:**

| Topic | Decision |
|---|---|
| Default | Off. Env flag `THAIJO_ENABLED`, default `false`, documented in README and `.env.example`. The owner writes to TCI for permission or rate guidance before enabling it. Not a 23c console setting (that set is exactly 13 and has no bool kind); a console toggle is a possible later change |
| Three steps | Search (`POST https://www.tci-thaijo.org/api/v1/articles/search`, health categories only); detail (`GET /api/v1/articles/{id}`, for every candidate kept); OAI-PMH `GetRecord` oai_dc, only for papers actually read (at most `max_papers`), for volume, issue, pages, ISSN, licence and type |
| Never | `pdf_url` is never read or stored; the HTML article page is never fetched |
| Candidates | Only an English abstract of at least 150 characters. A year above 2400 has 543 subtracted |
| Pool share | Capped (section 2, Claude's value: 15, and at most 1/8 of `candidate_limit`) |
| Soft-fail | A review runs without ThaiJO when it errors or times out; the failure is logged and counted |
| Politeness | Small concurrency, an identifying User-Agent, timeouts below the existing sources' timeouts, a Redis cache by article id with a TTL |
| Report and PRISMA | A "ThaiJO" source label, a link to `article_url` (never the PDF), per-source counts in PRISMA as other sources |
| De-duplication | DOI when present, else the existing fuzzy title match (`merge_candidates`) |
| Host safety | The OAI host comes from `article_url` and is checked against `*.tci-thaijo.org` with the project's URL-safety helpers (no SSRF through a crafted `article_url`) |
| Third-party text | ThaiJO abstracts enter the same prompts as other abstracts, sanitised the same way (`app/services/text.py` `strip_markup`), as data |
| Thai abstracts | The pipeline reasons in English: the English abstract is used. The Thai abstract is not stored (Claude: nothing in the result shows abstracts, so storing it would add cache size and untrusted text for no reader) |
| Tests | Synthetic fixtures modelled on the real shapes; no real third-party abstract is committed. At most 10 live requests to confirm shapes (9 made, section 3) |
| Evaluation | Measuring ThaiJO on the harness needs a new pool version (a paid batch): the owner's call, not this plan |
| Dependencies | None new. `defusedxml` is not a dependency (checked `backend/pyproject.toml`), so the OAI XML is parsed with stdlib `xml.etree` after refusing any document with a DTD or entity declaration, or over 512 KB |
| Prompts | No prompt or LLM schema changes, so `prompt_version` stays `2026-10-12.1` and the pins in `tests/unit/test_prompts_by_type.py` are untouched |

**Claude's own:**

| Topic | Decision | Why |
|---|---|---|
| Health filter | The search body carries no `category`; hits are kept when their `category` matches `^health\d{2}$` and their `id` is `<category>-<digits>` | One category per request is all the API takes: a list answered 400 `INVALID_JSON` (live request 9). A single `health01` would miss health02–05 (for "metformin type 2 diabetes glycemic control": health01 57, health02 39, health03 3, health04 5, health05 4 of 143). One request per query, filtered here, covers all five |
| Share cap | `min(THAIJO_MAX_CANDIDATES = 15, candidate_limit // 8)`: 120 → 15, 60 → 7, 40 → 5, 20 → 2 | 15 of 120 is 12.5%: enough for the Thai studies of a topic to be screened, too few to crowd out international trials. Scaling with `candidate_limit` keeps the same share in small pools |
| Placement | ThaiJO candidates are their own list in the search round-robin, after the trial searches | The existing pattern for extra sources (`trials:<q>`): ThaiJO's best hit sits beside each query's best hit, not at the end where the pool cut would drop it |
| Queries | The first 3 distinct planner queries (words only, at most 200 characters), `per_page` 20, page 1; hits merged round-robin by rank, a hit found twice kept once | Meilisearch-style matching returns hits for multi-word queries (57 for a five-word query, live request 7); three pages of 20 give enough health hits for a 15 cap |
| Detail budget | At most cap + 5 detail requests, in rank order, 3 at a time | 22 of 24 recent hits had an English abstract (roadmap section 7): 5 spare lookups cover the misses without walking the whole list |
| English check | After `strip_markup`, at least 150 characters and at least 90% of letters ASCII (Latin); capped at 6,000 characters at a word boundary | Thai text filed under `en_US` and `"-"` placeholders are seen; the cap bounds what an untrusted source can put in a prompt (seen: 800–2,600) |
| Title | The English title, else the Thai title (the abstract is English either way) | A Thai-only title still names the paper correctly; `on_focus` already never demotes a non-Latin title |
| Year | Gregorian after the 543 rule, and null outside 1800–2100 | A malformed year must not pass the `year_from` filter by accident |
| Candidate fields | `abstract_source` gains `"thaijo"` (ranked like `engine` in `merge_candidates`); new `thaijo_url` (the checked article page), a merge scalar | The OAI step needs the page even when a SearXNG duplicate's `url` wins the merge; `Candidate` is not an LLM schema |
| Result fields | Each paper gains `thaijo_url` and `bib` (`{volume, issue, pages, issn[], license, article_type}` or null) | The UI needs to know a paper is from ThaiJO and where its page is; `bib` is what OAI-PMH is called for |
| OAI step | A graph node `thaijo_metadata`, sent from `select_top` in the same superstep as `read_paper` (like `fetch_citations`), only when ThaiJO is on and a selected paper has `thaijo_url`; 2 requests at a time; the step's budget is `THAIJO_TIMEOUT_SECONDS` | Adds no latency (reading takes far longer) and touches only the papers read |
| References | Vancouver `Year;Vol(Issue):Pages.` when `bib` has them (`2024:e265234.` with pages only), and an identifier link `ThaiJO: <page>` | NLM journal-article form; the page link is the only identifier most ThaiJO papers have (DOI is usually missing) |
| Bibliographic numbers | Volume, issue and pages are citation metadata like year and DOI, not paper results, so they are not number-verified | The verification rule covers numbers a paper reports, not where it was published |
| Cache | Redis keys `mra:thaijo:abs:{id}` (`{"en": text or null}`) and `mra:thaijo:oai:{host}:{submission}` (`{"bib": … or null}`), TTL `THAIJO_CACHE_TTL_SECONDS` = 7 days; "no abstract" and "no record" are cached, errors never; a Redis failure only costs a request; processes without Redis in their graph deps (the eval CLI, the harness worker) do not cache | Repeated topics cost TCI nothing for a week; negative caching keeps the misses cheap too |
| HTTP | `HttpClient` gains `post()` and a per-call `follow_redirects`; ThaiJO calls use `retries=0` and `follow_redirects=False`; `www.tci-thaijo.org` gets 0.2 s per-host spacing (5 requests a second per process, as Europe PMC) | No retry storms on an undocumented API; a redirect can never take the server to another host |
| Timeouts | 5 s per request (`THAIJO_REQUEST_TIMEOUT_SECONDS`, below OpenAlex's 6 s and Europe PMC's 8 s) and 12 s for the whole ThaiJO search (`THAIJO_TIMEOUT_SECONDS`, below SearXNG's 15 s, so it never lengthens the search node); the OAI step has the same 12 s | |
| OAI host check | `article_link`: https, host `tci-thaijo.org` or a subdomain, default port, no user info, path `/index.php/<journal>/article/view/<digits>`, no query or fragment, and its submission id must equal the hit id's number; then `is_public_http_url` on the OAI URL (public addresses only) | Defence in depth: the response decides the URL, so the URL is checked like a webhook callback |
| Cache key | `+thaijo` is appended to the pipeline version while `THAIJO_ENABLED` is true | Turning ThaiJO on must not return reviews searched without it, and the reverse |
| Eval | `freeze_engines()` records `thaijo` in a frozen pool's `engines` when the flag was on | A pool frozen with ThaiJO says so; replay is unchanged |
| Telemetry | `quality.thaijo` (counts, cap, kept, seconds, `failed`/`timed_out`, and `metadata` for the OAI step); `errors` lines; structlog `thaijo_search_degraded`, `thaijo_oai_failed`, `thaijo_oai_timed_out` | "Logged and counted", in the places reviews already report source failures |

## 3. Observed API shapes (live, 2026-10-13)

Nine requests, all with `User-Agent: MedicalReviewerAgent/0.1 (research; contact via repository)`; nothing was saved
in the repository.

| # | Request | Answer |
|---|---|---|
| 1 | search `metformin`, `category: health01`, `per_page` 5 | 200 in 0.46 s, 5 hits of 57 |
| 2 | detail `health01-265234` | 200 in 0.06 s |
| 3 | detail `health01-0` | 404 `{"error": "Article 'health01-0' not found", "code": "NOT_FOUND"}` |
| 4 | OAI GetRecord `oai:he01.tci-thaijo.org:article/265234` on `he01.tci-thaijo.org/index.php/scnet/oai` | 200 `text/xml`, 5 KB, no DTD |
| 5 | OAI GetRecord `oai:he01.tci-thaijo.org:article/276255` on `.../TJPP/oai` | 200 |
| 6 | OAI GetRecord for a missing identifier | 200 with `<error code="idDoesNotExist">` |
| 7 | search, five-word query, `health01`, `per_page` 20, `facets: true` | 200, 20 of 57 hits, 36 ms server time |
| 8 | same query, no category, `per_page` 1, `facets: true` | 143 hits; categories health01–05, life, physical, social |
| 9 | same query with `category` as a list | 400 `{"error": "Invalid request body", "code": "INVALID_JSON"}` |

**Search answer:** `{hits[], total, page, per_page, processing_time_ms, facets}` (`facets` null unless asked; then
`{category, journal_id, journal_path, languages, year}`, each `{value: count}`). Each hit:
- `id` (`"health01-276255"`), `category` (`"health01"`), `submission_id` (int), `publication_id` (int), `issue_id` (int),
  `journal_id` (int)
- `titles`, `journal_name`: `{en_US, th_TH}` strings (either may be missing)
- `authors`, `keywords`: `{en_US: [..], th_TH: [..]}` (names may hold double spaces)
- `year` (int; sometimes Buddhist era), `date_published` (ISO 8601 with +07:00), `doi` (string or null; usually null)
- `languages` (`["en_US", "th_TH"]`), `article_url` (`https://he01.tci-thaijo.org/index.php/<journal_path>/article/view/<submission_id>`),
  `issue_url`, `journal_url`, `journal_path`, `thumbnail_url` (string or null)
- no abstract

**Detail answer:** every search-hit field, plus `abstracts` and `abstracts_raw` (`{en_US, th_TH}`; `abstracts_raw` is
HTML with `<p>`), `pages` (string, e.g. `"e265234"`), `pdf_url` (never used) and `seq` (float). Unknown id: 404 as above.

**OAI-PMH GetRecord (oai_dc):** `OAI-PMH/GetRecord/record` with `header` (`identifier`, `datestamp`, `setSpec`) and
`metadata/oai_dc:dc`:
- `dc:title` (xml:lang en-US, th-TH), `dc:creator` (Thai names, "Surname, Given"), `dc:subject` (keywords, both
  languages), `dc:description` (abstracts, both languages), `dc:publisher`, `dc:date`
- `dc:type`: `info:eu-repo/semantics/article`, `info:eu-repo/semantics/publishedVersion`, and on some journals an
  en-US "Peer-reviewed article" and a th-TH equivalent
- `dc:format` (`application/pdf`), `dc:identifier` (the article page), `dc:relation` (the PDF link, never used)
- `dc:source`: en-US `"<journal>; Vol. 17 No. 4 (2025): Oct-Dec; 1048-1066"` (pages only on some journals: another
  answered `"<journal>; Vol. 11 No. 2 (2024): Vol.11 No.2"`), a th-TH equivalent (`ปีที่ 17 ฉบับที่ 4`), and bare ISSNs
  (`"3027-6136"`)
- `dc:language` (`tha`), `dc:rights` (a copyright line and a Creative Commons URL, e.g.
  `https://creativecommons.org/licenses/by-nc-nd/4.0`)
- A missing record is `<error code="idDoesNotExist">` with no `GetRecord`.

## 4. Architecture and data flow

```
plan_queries ──► search ─┬─ SearXNG (pages × queries) ───────────────┐
                         ├─ Europe PMC trial searches (meta only) ────┤ round-robin by rank
                         └─ ThaiJO (if enabled, ≤ 12 s) ──────────────┘   (ThaiJO: its own list)
                              search ×≤3 (POST, health filter here)
                              detail ×≤cap+5 (GET, cached, English ≥150)
                 ──► enrich (merge, Europe PMC lookup by DOI/PMID, filters, cut) ──► screening ──► select_top
select_top ──► read_paper ×N ∥ fetch_citations ∥ external_enrich ∥ thaijo_metadata (ThaiJO papers read: OAI-PMH)
           ──► normalize_outcomes … ──► finalize (papers[].thaijo_url, papers[].bib)
```

- **`app/services/thaijo.py`** (new): `ThaiJoClient(http, base_url, *, cache, timeout, cache_ttl, resolver)` with
  `search(query)`, `abstract(article_id, stats)`, `collect(queries, *, limit, out, stats)` and `record(article_url)`;
  pure helpers `gregorian_year`, `article_link`, `english_abstract`, `parse_hit`, `to_candidate`, `query_words`,
  `parse_oai_record`. `collect` fills `out` and `stats` in place, so a caller that times out keeps what arrived (rank
  order kept; at most the batch in flight is lost).
- **`app/graph/factory.py`**: `build_thaijo(settings, http, redis)` returns the client only when the flag is on;
  `build_graph_deps` sets `GraphDeps.thaijo` (None in stub mode).
- **`app/graph/nodes/retrieval.py`**: `thaijo_cap`, `thaijo_search` (wraps `collect` in `asyncio.wait_for`, never
  raises), `thaijo_errors`; `make_search` starts ThaiJO alongside SearXNG and adds the `thaijo:` list after the trial
  lists. `per_source` counts ThaiJO candidates under `thaijo` through their `engines`.
- **`enrich`** is unchanged: ThaiJO candidates have a usable abstract (`abstract_source="thaijo"`), usually no DOI or
  PMID (so no Europe PMC lookup), and go through the same year, non-research, abstract and focus filters and the same
  `candidate_limit` cut.
- **`app/graph/nodes/thaijo.py`** (new): `thaijo_papers(selected)` and `make_thaijo_metadata(deps)`; the node returns
  `{"thaijo_bib": {ref: bib}, "quality": [...]}`. `route_to_reading` sends it when `deps.thaijo` exists and a selected
  candidate has `thaijo_url`; it runs in the same superstep as `read_paper` and joins at `normalize_outcomes`. The
  eval graph shares `_add_review_nodes`, so it has the node too (it never fires on frozen pools without ThaiJO).
- **`finalize`** adds `thaijo_url` and `bib` to each paper.

## 5. Config (`app/config.py`, env only)

| Setting | Default | Meaning |
|---|---|---|
| `thaijo_enabled` | `false` | Search ThaiJO at all |
| `thaijo_url` | `https://www.tci-thaijo.org/api/v1` | API base |
| `thaijo_max_candidates` | `15` | Upper bound of the share cap (also at most `candidate_limit // 8`) |
| `thaijo_timeout_seconds` | `12.0` | The whole ThaiJO search, and the OAI step |
| `thaijo_request_timeout_seconds` | `5.0` | Per request, no retries |
| `thaijo_cache_ttl_seconds` | `604800` | Redis TTL of cached abstracts and OAI records |

Module constants (`app/services/thaijo.py`): `PER_PAGE = 20`, `QUERIES = 3`, `EXTRA_DETAILS = 5`, `CONCURRENCY = 3`,
`MAX_ABSTRACT_CHARS = 6000`, `MIN_LATIN_SHARE = 0.9`, `MAX_XML_BYTES = 512_000`, `USER_AGENT`; OAI concurrency 2 in the
node. `DEFAULT_MIN_INTERVAL["www.tci-thaijo.org"] = 0.2` in `app/services/http.py`.

The API process reads `thaijo_enabled` for the cache key, the workers for the search: both read the same `.env`.

## 6. Failure modes

| Failure | Behaviour |
|---|---|
| Every ThaiJO search fails (network, 4xx/5xx, bad JSON) | No ThaiJO candidates; `errors`: "ThaiJO search failed: <Error>"; `quality.thaijo.failed`; log `thaijo_search_degraded`; the review goes on |
| Some searches or detail lookups fail | The rest is used; `errors`: "ThaiJO: n search(es) and m abstract lookup(s) failed"; counts in `quality.thaijo` |
| ThaiJO slower than 12 s | Cut; the candidates collected so far stay; `errors`: "ThaiJO search timed out after 12 s; kept k candidate(s)"; `timed_out: true` |
| A hit outside health, with a bad id, an off-site or mismatched `article_url`, or no title | Dropped at parse; never fetched |
| No English abstract, `"-"`, Thai text under `en_US`, under 150 characters | Not a candidate (`no_abstract` count); cached as "none" for the TTL |
| Detail 404 | As "no abstract"; cached |
| Redirect from TCI | Treated as an error (not followed) |
| Redis down | No caching; every request goes to TCI (still spaced and capped) |
| OAI: record missing, deleted or a different identifier | `bib` null (cached); the paper keeps its search metadata |
| OAI: error, timeout, private-address host, DTD, oversized or broken XML | `bib` null; counted in `quality.thaijo.metadata.failed` / `timed_out`; log `thaijo_oai_failed` / `thaijo_oai_timed_out`; never fails the review |
| ThaiJO changes its response shape | Fields missing are null, hits that fail the checks are dropped; at worst ThaiJO adds nothing |

## 7. Security

- **SSRF.** The only URLs built from ThaiJO data are the detail URL (`id` must match `^health\d{2}-\d{1,10}$`, so no
  path tricks) and the OAI URL (host, journal and submission from `article_link`, section 2; then
  `is_public_http_url`). `follow_redirects=False` on every ThaiJO call. `is_allowed_host(url, domain)` is added to
  `app/services/urlsafety.py`.
- **XML.** Stdlib `xml.etree.ElementTree`, which never resolves external entities; a document containing `<!DOCTYPE`
  or `<!ENTITY` (any case) or over 512 KB is refused before parsing (`UnsafeXml`), which also rules out internal
  entity expansion. Text fields go through `strip_markup` and are length-capped.
- **Untrusted text.** Titles, authors, journal names and abstracts go through `strip_markup` and are length-capped
  (title 500, author 120, journal 300, abstract 6,000) before they become a `Candidate`. They reach the prompts in the
  same slots, inside the same `<candidates>`/`<paper>` blocks with `DATA_NOTICE`, as Europe PMC abstracts; they are
  data, never instructions. Numbers from them are verified against the same abstract like any other paper's.
- **Links.** The UI and the Markdown link `thaijo_url` only when it passes the same page check again (frontend
  `thaijoHref`, backend `article_link`); the PDF link is never stored.
- **Load.** No retries, 0.2 s per-host spacing, 3 detail requests at a time, at most 3 searches and cap + 5 details per
  review, and a 7-day cache.

## 8. Report, PRISMA and UI

- **Sources.** `result.methods.sources` gains `thaijo: <kept>`; `SOURCE_NAME.thaijo = "ThaiJO"` names it in the Methods
  list, the title block's sources and the PRISMA identification rows. `stats.found` includes the ThaiJO candidates
  (only the ones with an English abstract enter the list, so PRISMA arithmetic stays consistent: they are records
  identified, then screened like the rest).
- **Paper.** `Paper.thaijo_url` and `Paper.bib` (`PaperBib`) in `src/lib/types.ts`. The source rail adds a "ThaiJO ↗"
  link to the article page. References (`citationParts`) add `Year;Vol(Issue):Pages` and a `ThaiJO: <page>` link (the
  reference list's accessible name is "ThaiJO <url> …").
- **Markdown export.** The same reference rules (`app/services/report.py` `_citation_parts`).
- **Not changed:** the landing page's eight sources, the live stage, `/status`, DESIGN.md tokens.

## 9. Docs

- `docs/api.md`: the data-sources list, `methods.sources`, the `papers[]` fields and the reference format, the cache
  note (`+thaijo`), `quality.thaijo`, the MCP `search_papers` note (never ThaiJO), and a "ThaiJO source (Plan 24)"
  section.
- `README.md`: a short "ThaiJO (Thai journals, off by default)" section.
- `.env.example`: a commented `THAIJO_ENABLED=false` with the TCI letter note.
- Roadmap row 24: built, off by default.
- After the merge (controller): a `CLAUDE.md` convention line.

## 10. Testing

All unit tests, offline, with synthetic data (`backend/tests/unit/thaijo_data.py`: invented titles, names and
abstracts in the observed shapes):
- HTTP: `post()` with JSON and retries, `follow_redirects=False`, the spacing entry, `is_allowed_host`.
- Candidate: defaults, timeouts below the other sources, `thaijo_url` survives a merge, the ThaiJO abstract beats a
  snippet.
- Client: year rule, `article_link` (hosts, paths, id match), hit parsing (health only, Thai-only title, Buddhist era,
  DOI), English check (length, script, cap), query words, the POST body and User-Agent, no retry, no redirect, cache
  (hits, misses, TTL, dead Redis), `collect` (rank order, dedupe, limit, partial failures, all failed, timeout keeps
  what arrived).
- OAI: full and partial records, missing/deleted/foreign/empty, DTD bomb, oversized, broken XML, markup in fields,
  cache, host checks (other hosts, http, the PDF link, a private address), no redirect.
- Search node: cap values, round-robin placement and `per_source`, cap follows the pool, failure, timeout, lost
  requests, disabled, enrich keeps ThaiJO, `build_thaijo`, `quality.thaijo`, `freeze_engines`, the cache key.
- Metadata node and graph: route sends only when needed, node collects and soft-fails, timeout keeps what arrived, a
  full fake review carries `thaijo_url`, `bib`, `methods.sources.thaijo` and `quality.thaijo.metadata`; without ThaiJO
  the fields are null and the block absent.
- References: backend and frontend produce the same string for the same paper; partial `bib`; no link for a page
  outside ThaiJO.
- Frontend: source names, source rail link, reference list link.
- Not automated: live calls. The controller's smoke check makes a handful of real requests inside the api container
  with the flag set for that one command only (no LLM, no spend).

## 11. Risks and open items

- **Terms.** The API is internal and undocumented. Mitigation: off by default; the owner's letter to TCI comes first;
  light, cached, identifiable traffic.
- **Shape drift.** TCI can change the API at any time. Mitigation: strict parsing that drops what it does not
  recognise, soft-fail, and the smoke check before enabling.
- **Quality of Thai studies.** Many hits are nursing, quality-improvement or local descriptive studies. Screening,
  design labelling and the study-type rules handle them as any other paper; the cap limits their share.
- **Measurement.** Without a new pool version the 22a harness cannot show ThaiJO's effect; that run is the owner's
  call (cost).
