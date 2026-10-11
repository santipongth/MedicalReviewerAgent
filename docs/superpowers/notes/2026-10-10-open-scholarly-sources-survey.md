# Open scholarly sources survey (2026-10-10, branch plan-16-scholarly-sources)

**สรุปภาษาไทย:** เอกสารนี้สำรวจฐานข้อมูลวิชาการแบบเปิดที่มี API สาธารณะ เพื่อเพิ่มเข้า SearXNG ของเรา
ข้อค้นพบสำคัญคือ PubMed ใน SearXNG เคยได้ผลลัพธ์ 0 เพราะโมดูลของ fork ตั้ง timeout ของ esearch ไว้ 3 วินาทีและส่งคำขอเกินอัตราที่ NCBI ยอม แล้วถูกระงับ (แก้แล้ว ดูหัวข้อ 10)
Plan 16 จึงแก้ PubMed และเพิ่มกลุ่ม A (Europe PMC, DOAJ, PLOS, OpenAIRE) โดยไม่ต้องใช้ API key
ส่วน key ของ NCBI, OpenAlex, Semantic Scholar และ CORE เป็น slot ที่เว้นว่างได้ (ใส่ใน `.env` ถ้ามี)
สิ่งที่เลื่อนไปก่อน: ClinicalTrials.gov, CORE key, ดัชนีท้องถิ่นของ ThaiJO และการขอสิทธิ์ Epistemonikos
ข้อมูลทุกข้อเป็นสถานะ "as of 2026-10" และอาจเปลี่ยนได้

All facts below are "as of 2026-10" unless stated otherwise. Provider terms, quotas and prices change; re-check before relying on them.
The project is abstract-only (spec 2026-10-05): sources must return title + abstract metadata, with no full-text fetching.

## 1. Live probe of our running SearXNG (2026-10-10)

Query "metformin colorectal cancer" against the running SearXNG (pinned fork `porespellar/searxng-LDR-academic` @ f314c22).

| engine | results | note |
|---|---|---|
| pubmed | **0** | `timeout`, then **Suspended**. Verified cause (Task 2): the fork's `pubmed.py` calls esearch inside `request()` with a hard-coded `timeout=3`, and concurrent queries exceed NCBI's 3 req/s; one HTTP 429 suspended the engine for 3600 s. The fork also kept only the first section of structured abstracts. |
| openalex | 10 | mailto only. OpenAlex requires an API key since Feb 2026 (unverified, secondary source); live response headers on 2026-10-10 showed a keyless budget of $0.10/day at $0.001 per search call (`x-ratelimit-limit-usd`, `x-ratelimit-cost-usd`). Free key $1/day (unverified, secondary source). |
| semantic scholar | 10 | Keyless shared pool, 429 under load. |
| crossref | 18 | Abstracts rare. |
| arxiv | 10 | Works. |
| openairepublications | 0 | Timeout (engine exists in the fork, not in our engine list). |
| core | HTTP 500 | Needs a key (not enabled by us). |

Fork engine modules present: arxiv, astrophysics_data_system, base, core, crossref, google_scholar, openalex, pubmed,
semantic_scholar, springer. There is no `europepmc` module, although upstream SearXNG has one.

## 2. Summary of recommendations

| Group | Meaning | Sources | Decision |
|---|---|---|---|
| A | Open, no key, abstracts, medical relevance | Europe PMC, DOAJ, PLOS, OpenAIRE | Add now (PLOS opt-in because of its rate limit) |
| B | Free key, admin signs up | NCBI E-utilities (PubMed), OpenAlex, Semantic Scholar, CORE | Keep or fix now with an optional empty key slot; CORE key deferred |
| C | Usable but not papers, or limited | ClinicalTrials.gov, J-STAGE, Zenodo, DataCite, OpenCitations, Crossref, arXiv | Not added (Crossref and arXiv already used) |
| D | Not suitable or not possible | bioRxiv/medRxiv API, Google Scholar, BASE, Cochrane, Epistemonikos, Lens, Dimensions, Springer Nature, Elsevier, ThaiJO, Trip | Not added |

## 3. Group A: open, no key, abstracts (adding now)

| Source | Coverage | Access and rate limit | Abstracts | Keyword search | Licence / ToS | Status in our fork | Recommendation |
|---|---|---|---|---|---|---|---|
| Europe PMC REST search | PubMed + PMC + preprints (bioRxiv/medRxiv via `SRC:PPR`) | No key | Full abstracts | Yes | Free for use; metadata open | Upstream has `europepmc` (shortcut `!epmc`); our pinned fork lacks it. We already use Europe PMC for metadata enrichment (`backend/app/services/europepmc.py`). | **Add now.** Best single open medical source; also covers preprints that bioRxiv's own API cannot search. |
| DOAJ API v4 | Open-access journals, including many Asian journals | No key, 2 req/s, max 1000 results per query (unverified, secondary source) | Usually present | Yes | Open metadata | No module in fork | **Add now.** Adds regional OA journals; the rate limit is easy to respect. |
| PLOS Solr search (`api.plos.org/search`) | PLOS journals only (small corpus) | No key; 10/min, 300/h, 7200/day | Full abstracts | Yes | Open | No module in fork | **Add now, opt-in.** The limit is tight, so keep it out of the default engine list unless traffic allows (decide in Task 2). |
| OpenAIRE Graph API v1 (`api.openaire.eu/graph/v1/researchProducts`) | Aggregated metadata across repositories | No key (rate-limit header showed 7199/hour) | Often (`descriptions`) | Yes | Open | Fork's `openairepublications` (legacy `/search/publications` json_engine) timed out at 30 s | **Added as `mra_openaire`** (engine name `openaire`, about 1.5 s, DOI/PMID/abstract/date/journal); legacy `openairepublications` ruled out (30 s timeout, no doi/date). |

## 4. Group B: free key (admin signs up; slot left empty by default)

| Source | Coverage | Access and rate limit | Abstracts | Keyword search | Licence / ToS | Status in our fork | Recommendation |
|---|---|---|---|---|---|---|---|
| NCBI E-utilities (PubMed) | PubMed, the core biomedical index | 3 req/s without key, 10 req/s with a free key | Yes (via efetch) | Yes | Public; send `tool` and `email` | `pubmed` module present but **times out** (hard-coded 3 s esearch call) and is then suspended | **Fixed:** `mra_pubmed`, engine timeout 12 s, request spacing, 429 retry without suspension; optional `NCBI_API_KEY`. |
| OpenAlex | Broad multi-field index of works | API key required for production use since Feb 2026 (unverified, secondary source). Usage-based pricing: $0.10/day without a key and $0.001 per search call (both seen in live response headers, 2026-10-10); $1/day with a free key, filter/list about $0.0001, single ID/DOI lookup free, mailto "polite pool" being phased out (unverified, secondary source). | Yes (inverted index) | Yes | Open data | `openalex` module present, working (10 results) | **Keep, add optional `OPENALEX_API_KEY`.** Costs are small at our volume but the free allowance is limited. |
| Semantic Scholar | Large cross-field index | Keyless shared pool (about 1000 req/s shared worldwide (unverified, secondary source); the keyless Graph API answered 429 at once in our probe). A free key gives a dedicated 1 req/s (unverified, secondary source). | Often | Yes | Their API licence applies | `semantic_scholar` module present, working (10 results) | **Keep, add optional `S2_API_KEY`.** |
| CORE API v3 | Large OA aggregator | Free key (about 1000 tokens/day personal, 5000 academic (unverified, secondary source)) | Yes | Yes | Per CORE terms | `core` module present, returns HTTP 500 without a key | **Key later** (deferred). Leave disabled until an admin has a key. |

## 5. Group C: usable but not papers, or limited

| Source | Notes | Recommendation |
|---|---|---|
| ClinicalTrials.gov API v2 | No key, about 50 req/min/IP (unverified, secondary source). Trial registrations, not peer-reviewed publications. | Deferred. If added, show it labelled separately from papers. |
| J-STAGE WebAPI (Japan) | No key. Metadata search, mostly without abstracts. | Not suitable (abstract rule). |
| Zenodo REST | No key. Mostly datasets and software. | Not suitable. |
| DataCite | Datasets. | Not suitable. |
| OpenCitations | Citation graph, not search. | Relevant to Plan 14b, not to search. |
| Crossref | Already used. Metadata, abstracts rare (18 results in the probe). | Keep as is. |
| arXiv | Already used. Preprints, few medical. | Keep as is. |

## 6. Group D: not suitable or not possible

| Source | Why | Recommendation |
|---|---|---|
| bioRxiv / medRxiv API | No keyword search (date range or DOI only). | Use through Europe PMC instead. |
| Google Scholar | Scraping, CAPTCHA and ToS risk. The fork has an engine; we do not enable it. | Not suitable. |
| BASE | API needs IP registration. The fork engine returned 0. | Not suitable for now. |
| Cochrane Library | No public API (Wiley subscription). | Not possible. |
| Epistemonikos | API token for registered partners only. Largest systematic-review database (about 300k SRs). | Request access later (deferred). |
| Lens.org, Dimensions, Springer Nature, Elsevier / ScienceDirect | Keys need approval or commercial terms. | Not suitable. |
| Trip database | No public API found. | Not possible. |
| ThaiJO (Thai Journals Online) | About 260k articles in 1,300+ journals, OJS-based. There is no central search API. OAI-PMH is available per journal. | Needs our own harvested index (future plan, see section 9). |

## 7. How engines are added to our SearXNG

- **Config-only `json_engine`.** SearXNG's `json_engine` can query any JSON API from `settings.yml` alone (URL template, JSON paths for
  title, content, url). Its limit: it cannot return `doi`, `publishedDate`, `journal` or `authors` in paper style. Our backend parser
  (`parse_searxng_result` in `backend/app/services/searxng.py`) wants those fields, so `json_engine` is only good enough for
  link-only sources.
- **Python engine modules.** Academic engines are Python modules with `request()` and `response()` functions that return paper-style
  results. They live in `infra/searxng/engines/*.py`, are bind-mounted read-only into `/usr/local/searxng/searx/engines/` and are
  declared in `infra/searxng/settings.yml` (`use_default_settings: true` stays, so the fork's bundled engines remain). We do not edit
  files inside the image. Overriding modules get distinct module names (for example `mra_pubmed`). Resolved in Task 2: a
  `settings.yml` entry whose `name` exists in the fork's defaults is merged into that entry (`update_dict` in the fork's
  `settings_loader`), so `name: pubmed` keeps its name and only swaps `engine:` and `timeout:`; one bind-mount line per file,
  because mounting the directory would hide the fork's own engines.
- **Optional keys via env.** Keys come from the root `.env`, passed through `docker-compose.yml` `environment:` on the searxng service
  (`NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY`, `CORE_API_KEY`) and read by our modules with `os.environ.get`. Empty is valid and
  behaves as today. Keys are never committed. They are not logged at SearXNG's default log level (its error recorder keeps only
  the host), but they do travel on the wire as request data: NCBI and OpenAlex take the key as a query parameter, Semantic Scholar
  as the `x-api-key` header.
- **Per-engine timeout.** Every engine has an explicit `timeout` in `settings.yml`, and the backend `searxng_timeout_seconds`
  (15 s) must exceed the slowest requested engine, because SearXNG waits for it.
- **Engine names.** The backend selects engines by the SearXNG engine `name` (spaces URL-encoded), so names in `settings.yml` and
  `searxng_engines` must match exactly.

## 8. Decision for Plan 16

**Added now:**
- Fix PubMed (timeout, optional NCBI key).
- Add Europe PMC, DOAJ and PLOS (PLOS opt-in), and enable OpenAIRE if it proves usable.
- Optional key slots for NCBI, OpenAlex and Semantic Scholar.

**Deferred:**
- ClinicalTrials.gov: trial registrations are not publications; add later as a separately labelled source.
- CORE key: wait until an admin registers a key.
- ThaiJO local index (see below).
- Epistemonikos access request.

## 9. ThaiJO situation

ThaiJO (https://www.tci-thaijo.org) hosts about 260k articles across 1,300+ journals on Open Journal Systems (OJS). OJS exposes OAI-PMH per
journal, but there is no central search API. Thai-language coverage therefore needs a future plan: harvest OAI-PMH from the
journals, keep our own local index (abstracts only) and expose it as an engine. This is out of scope for Plan 16.

**Update 2026-10-11:** ThaiJO has an internal central search API (`POST /api/v1/articles/search`, with a detail call
`GET /api/v1/articles/{id}` that returns English and Thai abstracts). A local OAI-PMH index is therefore no longer needed.
ThaiJO is now planned as a backend source (Plan 24). The findings and design are in `2026-10-11-roadmap-thai-evidence.md`,
section 7.

## 10. Outcome (as built, 2026-10-10)

- **Default engines (backend `searxng_engines`):** `pubmed`, `europe pmc`, `openalex`, `semantic scholar`, `crossref`, `arxiv`,
  `doaj`, `openaire`. The UI source list (stage, footer) shows these defaults.
- **Opt-in:** `plos` (enabled in SearXNG; add it through `SEARXNG_ENGINES`; its 10/min, 300/h budget is enforced in the module).
- **Ruled out:** `openairepublications` (legacy OpenAIRE API, 30 s timeout).
- **Engine timeouts:** pubmed 12 s, crossref 10 s, all others 8 s; backend `searxng_timeout_seconds` 15 s. A 429 suspends an engine
  for 120 s instead of the fork's 3600 s.
- **Live numbers:** PubMed went from 0 to 10 results per query (stable across repeated and 6-way concurrent runs). On the
  Task 3 live run over 5 queries, unique candidates with a usable abstract went from 150 to 294.
- **Europe PMC enrichment:** batches run 3 at a time and hits that already carry the Europe PMC engine's abstract and PMCID
  skip the lookup; on 5 live queries (403 unique hits) the lookup took 2.7 s instead of 5.9 to 8.4 s.
- Engine modules are AGPL-3.0-or-later (`infra/searxng/engines/LICENSE`, `README.md`).

## 11. Sources

- https://docs.searxng.org/user/configured_engines.html
- https://docs.searxng.org/dev/engines/index.html
- https://docs.searxng.org/dev/engines/online/core.html
- https://docs.searxng.org/dev/engines/json_engine.html
- https://docs.searxng.org/dev/engines/online/openalex.html
- https://github.com/porespellar/searxng-LDR-academic
- https://developers.openalex.org/api-reference/authentication.md
- https://casrai.org/news/openalex-api-keys-mandatory-usage-based-pricing-2026
- https://intuitionlabs.ai/articles/research-paper-apis-scientific-literature
- https://casrai.org/guides/semantic-scholar-api
- https://testdoaj.cottagelabs.com/api/docs (DOAJ API docs mirror; production https://doaj.org/api/docs)
- https://api.plos.org/solr/faq/
- https://graph.openaire.eu/docs/11.2.0/apis/graph-api/
- https://docs.ropensci.org/medrxivr/articles/medrxiv-api.html (bioRxiv/medRxiv API has no keyword search)
- https://dev.to/ronin13/clinical-trials-data-has-a-free-json-api-every-study-on-clinicaltrialsgov-no-key-required-1pek
- https://api.epistemonikos.org/
- https://www.tci-thaijo.org/en/pages/about
- https://developers.zenodo.org/
- https://rdrr.io/cran/jstager/
- https://github.com/internetarchive/fatcat-scholar
