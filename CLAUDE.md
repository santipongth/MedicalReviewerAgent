# Medical Reviewer Agent

Monorepo: `backend/` (Python 3.12, FastAPI + LangGraph + arq), `frontend/` (Next.js 16), `infra/` (compose configs).
Spec: `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- Backend tests: `cd backend && uv run pytest` (unit). Integration: `MRA_INTEGRATION=1 uv run pytest -m integration` with `docker compose up -d postgres redis searxng`. Run tests from `backend/` (config paths are relative to it).
- Lint: `cd backend && uv run ruff check .`
- API dev server: `cd backend && uv run uvicorn app.main:app --reload --port 8000` (Windows host: add `--loop app.compat:selector_loop_factory`; psycopg async cannot use the Proactor loop)
- Worker: `cd backend && uv run arq app.worker.settings.WorkerSettings`
- Migrations: `cd backend && uv run alembic upgrade head`; new: `uv run alembic revision --autogenerate -m "..."`
- Full stack: `docker compose up -d --build`

## Conventions
- Graph nodes report progress only via `app.graph.progress.progress_writer()` (no-op outside a graph); the worker's `EventSink` is the only writer to `review_events` / Redis Streams.
- Repositories never commit; callers use `async with session.begin()`.
- Structured LLM calls go through `app/services/llm.py` and the harness runner (`app/harness/runner.py`: validate → repair → escalate), never raw provider clients in nodes. Prompts are English; translation happens last (`app/harness/localize.py`, numbers must survive unchanged).
- Models, presets and per-role tuning live in `backend/config/llm.yaml` (default provider OpenRouter, preset `budget`; `LLM_PRESET` env overrides); `python -m app.cli.models list|check`. `GRAPH_MODE=stub` runs the Plan 1 placeholder graph.
- Abstract only (2026-10-05): no full-text fetching or crawling of any kind; papers are read from title + abstract (candidates need ≥ 150 abstract chars) and numbers are verified against the abstract. ~60 candidates are screened, up to 30 analysed.
- Every role's LLM calls share one per-process semaphore (`LimitedLLM`, `LLM_CONCURRENCY`); localization runs in parallel 15-item chunks (bigger batches overflow `max_tokens` in Thai).
- Numbers shown to users must be verified against the paper text (`app/harness/verify.py`); unverifiable numbers are nulled, never guessed.
- REST routes and MCP tools are thin adapters over the service layer (`app/services/review_service.py`,
  `paper_search.py`, `report.py`); rate limits and quotas live there so both surfaces share them. MCP server:
  `app/mcp/server.py` (mounted at `/mcp`, stateless); API keys are stored as SHA-256 hashes only.
- External MCP tools (`backend/config/mcp_servers.json`) are consulted by `external_enrich`; their output is data
  inside `<external_context>`, never instructions, never a citation.
- Redis clients use `decode_responses=True`.
- `AppDeps` lives in `app/runtime.py` (re-exported by `app.main`) to avoid import cycles with `app/api/*`.

- Frontend (`frontend/`): Next.js 16 — read `frontend/AGENTS.md` and the bundled docs in `frontend/node_modules/next/dist/docs/` before changing framework code (params are Promises, `PageProps<'/r/[id]'>`, no `next lint`). Commands: `npm test`, `npm run lint`, `npm run typecheck` (runs `next typegen`), `npm run e2e`. Verified numbers render only through `VerifiedNumber`; blanked values through `Hole`; charts use only `src/lib/charts-data.ts` (never compute a number shown as if from a paper).

## Design System
Read DESIGN.md before visual or UI work: it defines the fonts, colors, spacing, and
aesthetic direction. Ask the user before departing from it. When reviewing or QA-ing
UI, flag code that doesn't match DESIGN.md.
