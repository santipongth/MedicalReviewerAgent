# Medical Reviewer Agent

Public literature-review agent: type a topic or a full question (≤ 600 characters), pick a review type (systematic review, meta-analysis, scoping or narrative) and, optionally, study designs → the agent refines the question (PICO, or PCC for scoping), searches PubMed, Europe PMC (incl. medRxiv/bioRxiv preprints), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ and OpenAIRE through a self-hosted searxng-LDR-academic with our own engine modules in `infra/searxng/engines/` (AGPL-3.0; PLOS is opt-in through `SEARXNG_ENGINES`), screens a pool of candidates that have abstracts (about 120 by default) with PRISMA exclusion reasons, analyses the most relevant abstracts, as many as you choose (limits and default from `GET /api/v1/status`; no full-text fetching), checks every number against its abstract, and reports agreeing / conflicting findings with a GRADE-lite rating, a literature review matrix, a concept map, a citation network (OpenAlex / Europe PMC metadata) and, for meta-analyses, labelled DerSimonian-Laird pooled estimates. Backend: Python + LangGraph; LLMs via OpenRouter (models and presets in `backend/config/llm.yaml`). Exposed as a web app, a REST API and an MCP server. Optional source keys in `.env`: `NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY`, `CORE_API_KEY`.

**Reference for every route, event, limit, webhook and MCP tool: [`docs/api.md`](docs/api.md)** (live limits on any
deployment: `GET /api/v1/status`; interactive OpenAPI at `/api/docs`).

## Quick start (Docker)
1. `cp .env.example .env` and set `OPENROUTER_API_KEY` and `SEARXNG_SECRET`.
2. `docker compose up -d --build` (first build of SearXNG takes a few minutes).
3. `bash scripts/smoke.sh` — creates a review and tails its progress until `done`.
4. One origin for everything (Caddy): http://localhost:8088 (web app, `/api/...`, `/mcp`). Direct ports for
   development: web http://localhost:3000 · API docs http://localhost:8000/api/docs · SearXNG http://localhost:8080
5. Production: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (only Caddy is
   published; set `SITE_ADDRESS`, `TURNSTILE_*`). Scale: `API_WORKERS` (uvicorn processes), `WORKER_REPLICAS` × `MAX_CONCURRENT_REVIEWS_PER_WORKER` (concurrent
   reviews). Capacity guards: `MAX_QUEUED_REVIEWS`, `MAX_REVIEWS_PER_DAY`, `MAX_USD_PER_DAY`, `MAX_COST_PER_REVIEW_USD`
   (see `.env.example` and the capacity section of `docs/api.md`, incl. load-test numbers).

Without an LLM key set `GRAPH_MODE=stub`: the pipeline plumbing (API, queue, SSE, worker) runs with a placeholder graph.

## Running a real review
1. Put `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY` + `LLM_PRESET=claude_direct`) in `.env` and set `GRAPH_MODE=real`.
   Choose or tune models in `backend/config/llm.yaml` (mounted read-only into the containers; restart the worker after
   editing). Validate the file and see the estimated cost per review with
   `docker compose run --rm worker python -m app.cli.models check`.
2. `docker compose up -d --build`
3. `bash scripts/smoke.sh "metformin and colorectal cancer risk"`. Progress events:
   checking_topic → refining → question_refined → planning → searching → enriching → screening → screened →
   reading/extracted ×(one per analysed paper) ∥ citations_fetched → synthesizing → pooled (meta-analysis only) → localizing (Thai only) → finalizing → done (or error / rejected /
   cancelled). Events from the worker carry `elapsed_s`; the full list with payloads is in `docs/api.md`.
4. The result's `quality` block reports number verification, model agreement, escalations and per-stage timings.
5. Live LLM check: `cd backend && OPENROUTER_API_KEY=... uv run pytest -m live`

## Integrations: REST, MCP, API keys, webhooks
- **REST:** OpenAPI at `/api/docs`. Anonymous use works without a key (default 5 reviews/hour per IP; when the
  deployment sets `TURNSTILE_SECRET`, anonymous submissions also need a browser Turnstile token, so scripts should use
  an API key). The same topic/language/options within 24 h returns the existing review (`cached: true`, free).
  `GET /api/v1/status` reports whether reviews are accepted, the queue and the limits; a full queue or used-up
  daily capacity answers 503 with a `reason` and `Retry-After`. `GET /api/v1/reviews/{id}/export?format=md|csv|json`
  downloads a finished review. `GET /api/v1/papers/search?q=` answers quick literature questions.
- **API keys** raise the hourly rate (default 60/hour per key, with a per-key daily quota, default 100) and unlock
  `callback_url` and `DELETE /api/v1/reviews/{id}`; admin routes need a key minted with `--admin`:
  ```bash
  docker compose exec api python -m app.cli.keys mint --name "partner lab" --quota 100   # prints the key once
  docker compose exec api python -m app.cli.keys list
  docker compose exec api python -m app.cli.keys revoke mra_XXXXXXXX
  ```
  Send it as `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- **Webhooks:** `POST /api/v1/reviews` with `"callback_url": "https://..."` (key required, HTTPS public host).
  When the review ends (done, error, rejected or cancelled) we POST `{"review_id","status","result_url"}` (up to 3
  tries, 10 s / 20 s apart, retried on network errors, 5xx and 429) with
  `X-Signature: sha256=HMAC_SHA256(body, secret)` where `secret = sha256_hex(your_api_key)`.
  A response with `"cached": true` reuses an existing review and has `"callback_scheduled": false`:
  poll `GET /api/v1/reviews/{id}` in that case.
- **MCP server** at `/mcp` (streamable HTTP). Tools: `search_papers`, `start_review`, `get_review_status`,
  `get_review_result`; resources `review://{id}` and `review://{id}/report.md`; prompt
  `literature_review`. API keys work the same way as on REST; MCP is never asked for Turnstile.
  Connect from Claude Code: `claude mcp add --transport http medical-reviewer http://localhost:8088/mcp/`
  or from any MCP client with `{"mcpServers": {"medical-reviewer": {"url": "http://localhost:8088/mcp/"}}}`.
  Behind a domain, add it to `MCP_ALLOWED_HOSTS`.
- **External MCP tools for the agent:** list servers in `backend/config/mcp_servers.json`
  (`{"mcpServers": {"name": {"url": "https://.../mcp"}}}`). Workers pick up edits automatically; the agent calls at
  most 3 relevant tools per review in parallel with paper reading and uses the output as background only.
  `POST /api/v1/admin/mcp/reload` (admin key) validates the file.

## Status
- Plan 1 (foundation) done: infra, API, queue, SSE, stub graph.
- Plan 2 (review graph) done: question refinement, search, screening with second votes, evidence-grounded extraction,
  checked synthesis pipeline, Thai/English output.
- Plan 3 (integrations) done: MCP server, external MCP tools, API keys, webhooks, cancellation, paper search.
- Plan 4 (web) done: landing request slip, live run, interactive evidence report (matrix, verbatim source rail, forest plot,
  PRISMA, study map, filters), /developers (API and MCP); design system in `DESIGN.md` ("Theatre Green").
- Plan 5 (abstract-only) done: full-text/crawling stack removed, a screened pool → a user-chosen number of abstracts (Plan 21 made it adjustable), shared LLM
  concurrency limit, parallel Thai localization, budget preset retuned from live latency measurements.
- Plan 6 (harness round 2) done: fixed study-design categories, non-research filter, clustering repair, consensus
  with dissent, design-aware search, versioned cache.
- Plan 7 (hardening and scale) done: bounded queue and daily caps (atomic across API processes), per-review cost cap,
  `/status`, queue position, per-client SSE limit, Turnstile, exports, Caddy single origin, multi-process API and
  worker replicas, load test, `docs/api.md`.
- Plan 8 (quality and export) done: lenient extraction (quoted outcomes only, at most 6), pooled (SR/MA) evidence
  graded apart from overlapping primary studies, the whole report as one HTML file that opens offline.
- Plan 9 (landing) done: "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" - a tappable sample report from a real review
  (`frontend/src/data/landing-sample.json`, rebuilt by `scripts/landing_sample.py`; a test fails if any shown number is
  not found verbatim in its quote), how a number earns its tape, the run timeline, the agent band, recent reviews.
- Next: production readiness (`docs/superpowers/notes/2026-10-05-production-readiness-audit.md`).
  See `docs/superpowers/`.

## Web app (`frontend/`)
Next.js 16 + React 19 + Tailwind 4 + ECharts 6. The browser calls the API directly; the address is read at request time
from `PUBLIC_API_URL` (compose default `http://localhost:8000`; `/` = same origin behind Caddy), so one image serves
every deployment. The offline HTML report (`/r/{id}/report.html`) is built on the web server, which fetches the review
from `INTERNAL_API_URL` (compose: `http://api:8000`); set it whenever `PUBLIC_API_URL` is not an absolute URL the web
server can reach, or the download answers 502 and the web log says where it looked.
```bash
cd frontend && npm ci
npm run dev            # http://localhost:3000 (API on :8000)
npm test               # unit tests (Vitest)
npm run e2e            # browser tests with a mocked API (Playwright; first: npx playwright install chromium)
MRA_LIVE_WEB=1 npx playwright test e2e/live.spec.ts   # against the running docker stack
```

## Development
See `CLAUDE.md` for commands. Unit tests need no services; integration tests need
`docker compose up -d postgres redis searxng` and `MRA_INTEGRATION=1`.
On a Windows host, run the dev API with `--loop app.compat:selector_loop_factory` (psycopg async cannot use the Proactor event loop).
