# Open scholarly sources survey (2026-10-10, branch plan-16-scholarly-sources)

**สรุปภาษาไทย:** เอกสารนี้สำรวจฐานข้อมูลวิชาการแบบเปิดที่มี API สาธารณะ เพื่อเพิ่มเข้า SearXNG ของเรา
ข้อค้นพบสำคัญคือ PubMed ใน SearXNG ตอนนี้ได้ผลลัพธ์ 0 เพราะ timeout (3 วินาที) แล้วถูกระงับ
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
| pubmed | **0** | `timeout` at the default `request_timeout: 3.0`, then **Suspended**. The most important medical source returns nothing. |
| openalex | 10 | mailto only. OpenAlex requires an API key since Feb 2026 (about $0.10/day without, free key $1/day; search about $0.001/call). |
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
| DOAJ API v4 | Open-access journals, including many Asian journals | No key, 2 req/s, max 1000 results per query | Usually present | Yes | Open metadata | No module in fork | **Add now.** Adds regional OA journals; the rate limit is easy to respect. |
| PLOS Solr search (`api.plos.org/search`) | PLOS journals only (small corpus) | No key; 10/min, 300/h, 7200/day | Full abstracts | Yes | Open | No module in fork | **Add now, opt-in.** The limit is tight, so keep it out of the default engine list unless traffic allows (decide in Task 2). |
| OpenAIRE Graph API `/v3/research-products` | Aggregated metadata across repositories | No key | Often | Yes | Open | Fork has `openairepublications` but it timed out in our probe | **Add now if it works** with a longer timeout; otherwise rule out with evidence. |

## 4. Group B: free key (admin signs up; slot left empty by default)

| Source | Coverage | Access and rate limit | Abstracts | Keyword search | Licence / ToS | Status in our fork | Recommendation |
|---|---|---|---|---|---|---|---|
| NCBI E-utilities (PubMed) | PubMed, the core biomedical index | 3 req/s without key, 10 req/s with a free key | Yes (via efetch) | Yes | Public; send `tool` and `email` | `pubmed` module present but **times out** at 3 s and is then suspended | **Fix now:** per-engine timeout of at least 10 s; optional `NCBI_API_KEY`. |
| OpenAlex | Broad multi-field index of works | API key required for production use since Feb 2026. Usage-based pricing: about $0.10/day without a key, $1/day with a free key. Search about $0.001/call, filter/list about $0.0001, single ID/DOI lookup free. The mailto "polite pool" is being phased out. | Yes (inverted index) | Yes | Open data | `openalex` module present, working (10 results) | **Keep, add optional `OPENALEX_API_KEY`.** Costs are small at our volume but the free allowance is limited. |
| Semantic Scholar | Large cross-field index | Keyless shared pool (about 1000 req/s shared worldwide, frequent 429s). A free key gives a dedicated 1 req/s. | Often | Yes | Their API licence applies | `semantic_scholar` module present, working (10 results) | **Keep, add optional `S2_API_KEY`.** |
| CORE API v3 | Large OA aggregator | Free key (about 1000 tokens/day personal, 5000 academic) | Yes | Yes | Per CORE terms | `core` module present, returns HTTP 500 without a key | **Key later** (deferred). Leave disabled until an admin has a key. |

## 5. Group C: usable but not papers, or limited

| Source | Notes | Recommendation |
|---|---|---|
| ClinicalTrials.gov API v2 | No key, about 50 req/min/IP. Trial registrations, not peer-reviewed publications. | Deferred. If added, show it labelled separately from papers. |
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
  files inside the image. To avoid clashes with the fork's defaults, overriding modules get distinct names (for example `mra_pubmed`).
  Task 2 must verify how same-name entries merge with the fork's defaults.
- **Optional keys via env.** Keys come from the root `.env`, passed through `docker-compose.yml` `environment:` on the searxng service
  (`NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY`, `CORE_API_KEY`) and read by our modules with `os.environ.get`. Empty is valid and
  behaves as today. Keys are never committed or logged.
- **Per-engine timeout.** The default `request_timeout` of 3 s is too short for PubMed and OpenAIRE; set a per-engine `timeout` in
  `settings.yml`. The backend `searxng_timeout_seconds` must then cover the slowest engine.
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

## 10. Sources

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
