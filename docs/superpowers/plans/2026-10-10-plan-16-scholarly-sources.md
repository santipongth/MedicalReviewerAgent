# Plan 16 — Open scholarly sources: survey, fix broken engines, add Europe PMC / DOAJ / PLOS / OpenAIRE

**Request (2026-10-10):** survey open academic databases with public APIs that can be added to our SearXNG.
**User decisions:** scope = fix what is broken + add group A (Europe PMC, DOAJ, PLOS, enable OpenAIRE) + survey report;
API keys = optional slots (empty works), read from `.env`; ClinicalTrials.gov not included.
**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (abstract-only; numbers verified against abstracts;
candidates need ≥150 abstract chars). No full text, no crawling.

## Findings that drive this plan (live probe 2026-10-10, query "metformin colorectal cancer", running SearXNG)
| engine | results | note |
|---|---|---|
| pubmed | **0** | `timeout` at the default `request_timeout: 3.0`, then **Suspended** — the most important medical source returns nothing |
| openalex | 10 | mailto only; OpenAlex requires an API key since Feb 2026 (≈$0.10/day without, free key $1/day; search ≈ $0.001/call) |
| semantic scholar | 10 | keyless shared pool, 429 under load |
| crossref | 18 | abstracts rare |
| arxiv | 10 | ok |
| openairepublications | 0 | timeout (in the fork, not in our engine list) |
| core | HTTP 500 | needs key (not enabled by us) |
Fork engine modules: arxiv, astrophysics_data_system, base, core, crossref, google_scholar, openalex, pubmed, semantic_scholar, springer
(no `europepmc`, although upstream SearXNG has one). `json_engine` (config-only) cannot return doi/publishedDate/journal, so new
academic engines must be Python modules returning paper-style results.

## Global constraints
- Backend parser contract (`backend/app/services/searxng.py` `parse_searxng_result`): each result needs `title`, `content`
  (abstract), `url`, ideally `doi`, `publishedDate` (YYYY-MM-DD…), `authors`, `journal`; PMID is read from a pubmed URL. New
  engines must fill these. Engine names used by the backend are the SearXNG engine `name` values (spaces URL-encoded).
- Keys are optional everywhere: with no key every engine behaves as today. Keys come from the root `.env` via compose
  `environment:` on the searxng service (`NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY`, `CORE_API_KEY`), read by our engine
  modules with `os.environ.get` — never committed, never logged.
- Do not modify the fork's files in the image: our engines live in `infra/searxng/engines/*.py`, bind-mounted read-only into
  `/usr/local/searxng/searx/engines/` and declared in `infra/searxng/settings.yml` (`use_default_settings: true` stays; verify how
  same-name engine entries override/merge with the fork's defaults and choose distinct module names, e.g. `mra_pubmed`).
- Respect each API's limits: DOAJ ≤2 req/s; PLOS ≤10/min, 300/h (so PLOS is opt-in, not in the default engine list unless
  traffic allows — rule it in the ledger); NCBI 3 req/s without key, 10 with.
- Abstract-only: engines return metadata + abstract only.
- Git: Edit/Write only (LF), stage only touched files, leave `infra/searxng/limiter.toml.new` alone; commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: backend `cd backend && uv run pytest && uv run ruff check .`; integration `MRA_INTEGRATION=1 uv run pytest -m integration`
  (needs `docker compose up -d postgres redis searxng`); frontend `npm test && npm run lint && npm run typecheck && npm run e2e`.

## Task 1: Survey document
**File:** `docs/superpowers/notes/2026-10-10-open-scholarly-sources-survey.md`.
- Table per source: coverage (fields, size), access (key? free tier), rate limit, abstracts available?, search by keyword?,
  licence/ToS notes, status in our SearXNG fork (module present? working?), recommendation (add now / key later / not suitable) +
  why. Group A/B/C/D as in the controller's findings (given in the dispatch). Include the live probe table above.
- Sources list with links (from the dispatch). Note dated facts ("as of 2026-10") and the ThaiJO situation (OJS, OAI-PMH per
  journal, no central search API → future local index).

## Task 2: SearXNG engines and settings (infra)
**Files:** `infra/searxng/settings.yml`, new `infra/searxng/engines/{mra_pubmed,mra_openalex,europepmc,doaj,plos}.py` (names may
differ; record them), `docker-compose.yml` (read-only mount of the engines dir + optional key env vars), `.env.example`.
- PubMed: per-engine `timeout` ≥ 10 s; NCBI `api_key` + `tool`/`email` params when set; results keep pubmed URLs (PMID).
- OpenAlex: send `api_key` when `OPENALEX_API_KEY` is set (keep mailto); per-engine timeout.
- Semantic Scholar: `x-api-key` header when `S2_API_KEY` is set (override module only if the fork's cannot take a header).
- OpenAIRE publications: enable with a working timeout; verify it returns abstracts/doi; if its results are unusable, rule it out
  in the ledger with evidence.
- New `europepmc` (port upstream SearXNG's engine; return abstract in `content`, doi, pmid → pubmed-style URL or explicit field,
  pmcid, publishedDate, journal, authors; include preprints SRC:PPR), `doaj` (API v4 articles search), `plos` (Solr `api.plos.org/search`,
  fields id/title/abstract/publication_date/journal/author_display; DOI = id).
- Each engine module has pure `request()`/`response()` functions unit-testable without SearXNG: add tests under
  `backend/tests/unit/test_searxng_engines.py` that import the modules by path with a tiny stub of the `searx` imports they need
  (or keep the parsing in a dependency-free helper inside each module) and parse recorded fixture JSON (`backend/tests/fixtures/`).
- **Live verification (required):** `docker compose up -d --build searxng`, then for each engine run the probe used above
  (`docker compose exec -T api python -c ...` GET `http://searxng:8080/search?q=...&format=json&engines=<name>`): report count,
  unresponsive_engines, and one sample result's doi/abstract length. PubMed must be > 0 and not suspended.

## Task 3: Backend wiring
**Files:** `backend/app/config.py` (`searxng_engines` default; `searxng_timeout_seconds` raised to cover 10 s engines),
`backend/app/services/searxng.py` (full abstracts from europepmc/doaj/plos → `abstract_source` not "snippet"; PMID/PMCID/DOI
from the new engines' fields/URLs), `backend/app/graph/nodes/retrieval.py` only if needed; tests
(`test_http_and_searxng.py`, integration `test_searxng_json.py`, `test_sources_live.py`).
- Default engines: `pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj` (+ `openairepublications` if Task 2 found it
  usable; PLOS per Task 2 ruling). Engine names must match Task 2's `name:` values exactly.
- Dedup still by DOI/PMID; Europe PMC enrichment unchanged.

## Task 4: Frontend and docs
**Files:** `frontend/src/components/site-footer.tsx` (SOURCES), `frontend/src/lib/agent-layout.ts` (`SATELLITES` mirrors
`searxng_engines`; the stage detail band lists sources — check it still fits at 1440 and 390 with the new count), copy that says
"five databases"/"ห้าฐานข้อมูล" (`components/landing/timeline.tsx`, `lib/agent-thought.ts`, `lib/agent-scene.ts`,
`components/review/live-run.tsx`), tests (`site-footer.test.tsx`, `agent-layout.test.ts`, e2e stage text checks), `README.md`,
`backend/app/mcp/server.py` / `backend/app/api/papers.py` docstrings, spec revision note (2026-10-10), `DESIGN.md` (stage source list),
`docs/api.md` if it names sources. Screenshot the stage at 1440/390 to confirm the longer source list still sits cleanly.
