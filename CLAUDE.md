# Medical Reviewer Agent

Monorepo: `backend/` (Python 3.12, FastAPI + LangGraph + arq), `frontend/` (Next.js 16), `infra/` (compose configs).
Spec: `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- Backend tests: `cd backend && uv run pytest` (unit). Integration: `MRA_INTEGRATION=1 uv run pytest -m integration` with `docker compose up -d postgres redis searxng`.
- Lint: `cd backend && uv run ruff check .`
- API dev server: `cd backend && uv run uvicorn app.main:app --reload --port 8000` (Windows host: add `--loop app.compat:selector_loop_factory`; psycopg async cannot use the Proactor loop)
- Worker: `cd backend && uv run arq app.worker.settings.WorkerSettings`
- Migrations: `cd backend && uv run alembic upgrade head`; new: `uv run alembic revision --autogenerate -m "..."`
- Full stack: `docker compose up -d --build`

## Conventions
- Graph nodes report progress only via `langgraph.config.get_stream_writer()`; the worker's `EventSink` is the only writer to `review_events` / Redis Streams.
- Repositories never commit; callers use `async with session.begin()`.
- Structured LLM calls go through `app/services/llm.py` (`method="json_schema"`), never raw `ChatAnthropic` in nodes.
- Redis clients use `decode_responses=True`.
- `AppDeps` lives in `app/runtime.py` (re-exported by `app.main`) to avoid import cycles with `app/api/*`.
