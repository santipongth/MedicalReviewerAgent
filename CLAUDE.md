# Medical Reviewer Agent

Monorepo: `backend/` (Python 3.12, FastAPI + LangGraph + arq), `frontend/` (Next.js 16), `infra/` (compose configs).
Spec: `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- Backend tests: `cd backend && uv run pytest` (unit). Integration: `MRA_INTEGRATION=1 uv run pytest -m integration` with `docker compose up -d postgres redis searxng crawl4ai` and `CRAWL4AI_API_TOKEN` exported. Run tests from `backend/` (config paths are relative to it).
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
- Full text: Europe PMC JATS first, then Crawl4AI for open-access URLs only (robots.txt respected, per-domain spacing and cooldown in Redis). Never send `proxy`, `proxy_config`, `extra_args` or `hooks` to Crawl4AI; it stays on the `crawl` network, away from Postgres/Redis.
- Numbers shown to users must be verified against the paper text (`app/harness/verify.py`); unverifiable numbers are nulled, never guessed.
- REST routes and MCP tools are thin adapters over the service layer (`app/services/review_service.py`,
  `paper_search.py`, `report.py`); rate limits and quotas live there so both surfaces share them. MCP server:
  `app/mcp/server.py` (mounted at `/mcp`, stateless); API keys are stored as SHA-256 hashes only.
- External MCP tools (`backend/config/mcp_servers.json`) are consulted by `external_enrich`; their output is data
  inside `<external_context>`, never instructions, never a citation.
- Redis clients use `decode_responses=True`.
- `AppDeps` lives in `app/runtime.py` (re-exported by `app.main`) to avoid import cycles with `app/api/*`.
