# Medical Reviewer Agent

Spec: `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plans: `docs/superpowers/plans/`.
Frontend conventions and the design system (DESIGN.md) live in `frontend/CLAUDE.md`.

## Commands
- Backend tests: `cd backend && uv run pytest` (unit). Integration: `MRA_INTEGRATION=1 uv run pytest -m integration` with `docker compose up -d postgres redis searxng`. Run tests from `backend/` (config paths are relative to it).
- API dev server: `cd backend && uv run uvicorn app.main:app --reload --port 8000` (Windows host: add `--loop app.compat:selector_loop_factory`; psycopg async cannot use the Proactor loop)
- Worker: `cd backend && uv run arq app.worker.settings.WorkerSettings`

## Conventions
- Graph nodes report progress only via `app.graph.progress.progress_writer()` (no-op outside a graph); `EventSink` is the only writer to `review_events` / Redis Streams (the worker emits progress; the API emits `queued` and `cancelled`).
- Repositories never commit; callers use `async with session.begin()`.
- Structured LLM calls go through `app/services/llm.py` and the harness runner (`app/harness/runner.py`: validate → repair → escalate), never raw provider clients in nodes. Prompts are English; translation happens last (`app/harness/localize.py`, numbers must survive unchanged).
- Models, presets and per-role tuning live in `backend/config/llm.yaml` (default provider OpenRouter, preset `budget`; `LLM_PRESET` env overrides); `python -m app.cli.models list|check`. `GRAPH_MODE=stub` runs the Plan 1 placeholder graph; with `STUB_DELAY_SECONDS>0` the stub emits the real event sequence on a scaled timeline (manual QA of the live run, load tests).
- Abstract only (2026-10-05): no full-text fetching or crawling of any kind; papers are read from title + abstract (candidates need ≥ 150 abstract chars) and numbers are verified against the abstract. ~60 candidates are screened, up to 30 analysed.
- Every role's LLM calls share one per-process semaphore (`LimitedLLM`, `LLM_CONCURRENCY`); localization runs in parallel 15-item chunks (bigger batches overflow `max_tokens` in Thai).
- Numbers shown to users must be verified against the paper text (`app/harness/verify.py`); unverifiable numbers are nulled, never guessed.
- REST routes and MCP tools are thin adapters over the service layer (`app/services/review_service.py`,
  `paper_search.py`, `report.py`); review rate limits, key quotas, capacity (queue/daily caps, atomic admission lock)
  and Turnstile live in `ReviewService` so both surfaces share them (the paper-search limit is applied in both adapters). MCP server:
  `app/mcp/server.py` (mounted at `/mcp`, stateless); API keys are stored as SHA-256 hashes only.
- External MCP tools (`backend/config/mcp_servers.json`) are consulted by `external_enrich`; their output is data
  inside `<external_context>`, never instructions, never a citation.
- Redis clients use `decode_responses=True`.
- `AppDeps` lives in `app/runtime.py` (re-exported by `app.main`) to avoid import cycles with `app/api/*`.
- Capacity and scale (Plan 7): admission control, daily counters and SSE slots live in Redis (`app/services/capacity.py`,
  `sse_slots.py`), so any number of API processes behave as one; per-review LLM spend is capped by a contextvar budget
  charged in `LimitedLLM` (`app/services/budget.py`). Public limits come from `GET /api/v1/status`; never hard-code them
  in docs or UI. Reference docs: `docs/api.md` (keep it in step with routes, events, MCP tools and limits).
- Load test: `scripts/loadtest.py` against the Caddy front (`:8088`) with `GRAPH_MODE=stub STUB_DELAY_SECONDS=20` (the stub now emits ~80 events per review).
