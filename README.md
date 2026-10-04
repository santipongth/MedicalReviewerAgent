# Medical Reviewer Agent

Public literature-review agent: type a disease / drug / topic → the agent searches PubMed, arXiv, Semantic Scholar, OpenAlex and CrossRef (via a self-hosted searxng-LDR-academic), screens ~100 candidates down to 10, reads abstracts and open-access full text, and produces a comparison table of agreeing / conflicting findings. Backend: Python + LangGraph + Claude. Exposed as a web app, a REST API and an MCP server.

## Quick start (Docker)
1. `cp .env.example .env` and set `ANTHROPIC_API_KEY`, `CONTACT_EMAIL`, `SEARXNG_SECRET`.
2. `docker compose up -d --build` (first build of SearXNG takes a few minutes).
3. `bash scripts/smoke.sh` — creates a review and tails its progress until `done`.
4. API docs: http://localhost:8000/api/docs · SearXNG: http://localhost:8080
5. More workers: `docker compose up -d --scale worker=3`

## Status
Plan 1 (foundation) done: infra, API, queue, SSE, stub graph. Next: real search/extract/synthesize nodes (Plan 2), MCP (Plan 3), web dashboard (Plan 4), hardening (Plan 5). See `docs/superpowers/`.

## Development
See `CLAUDE.md` for commands. Unit tests need no services; integration tests need `docker compose up -d postgres redis searxng` and `MRA_INTEGRATION=1`.
On a Windows host, run the dev API with `--loop app.compat:selector_loop_factory` (psycopg async cannot use the Proactor event loop).
