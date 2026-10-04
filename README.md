# Medical Reviewer Agent

Public literature-review agent: type a disease / drug / topic → the agent interprets and refines your question, searches PubMed, arXiv, Semantic Scholar, OpenAlex and CrossRef (via a self-hosted searxng-LDR-academic), screens ~20 candidates down to the best 8, reads abstracts and open-access full text (Europe PMC, then a polite Crawl4AI service), and produces a comparison table of agreeing / conflicting findings with a GRADE-lite evidence rating. Backend: Python + LangGraph; LLMs via OpenRouter (models and presets in `backend/config/llm.yaml`). Exposed as a web app, a REST API and an MCP server.

## Quick start (Docker)
1. `cp .env.example .env` and set `CONTACT_EMAIL`, `SEARXNG_SECRET` and a random `CRAWL4AI_API_TOKEN` (`openssl rand -hex 32`).
2. `docker compose up -d --build` (first build of SearXNG takes a few minutes; the Crawl4AI image is ~6 GB).
3. `bash scripts/smoke.sh` — creates a review and tails its progress until `done`.
4. API docs: http://localhost:8000/api/docs · SearXNG: http://localhost:8080
5. More workers: `docker compose up -d --scale worker=3`

Without an LLM key set `GRAPH_MODE=stub`: the pipeline plumbing (API, queue, SSE, worker) runs with a placeholder graph.

## Running a real review
1. Put `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY` + `LLM_PRESET=claude_direct`) in `.env` and set `GRAPH_MODE=real`.
   Choose or tune models in `backend/config/llm.yaml` (mounted read-only into the containers; restart the worker after
   editing). Validate the file and see the estimated cost per review with
   `docker compose run --rm worker python -m app.cli.models check`.
2. `docker compose up -d --build`
3. `bash scripts/smoke.sh "metformin and colorectal cancer risk"`. Progress events:
   checking_topic → refining → question_refined → planning → searching → enriching → screening → screened →
   reading/extracted ×8 → synthesizing → localizing → finalizing → done. Every event carries `elapsed_s`.
4. The result's `quality` block reports number verification, model agreement, escalations and per-stage timings.
5. Live LLM check: `cd backend && OPENROUTER_API_KEY=... uv run pytest -m live`

## Integrations: REST, MCP, API keys, webhooks
- **REST:** OpenAPI at `/api/docs`. Anonymous use works without a key (5 reviews/hour per IP).
  `GET /api/v1/papers/search?q=` and `GET /api/v1/papers/fulltext/{pmcid}` answer quick literature questions.
- **API keys** unlock a higher rate, a daily quota, `callback_url`, `DELETE /api/v1/reviews/{id}` and admin routes:
  ```bash
  docker compose exec api python -m app.cli.keys mint --name "partner lab" --quota 100   # prints the key once
  docker compose exec api python -m app.cli.keys list
  docker compose exec api python -m app.cli.keys revoke mra_XXXXXXXX
  ```
  Send it as `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- **Webhooks:** `POST /api/v1/reviews` with `"callback_url": "https://..."` (key required, HTTPS public host).
  On completion we POST `{"review_id","status","result_url"}` with
  `X-Signature: sha256=HMAC_SHA256(body, secret)` where `secret = sha256_hex(your_api_key)`.
  A response with `"cached": true` reuses an existing review and has `"callback_scheduled": false`:
  poll `GET /api/v1/reviews/{id}` in that case.
- **MCP server** at `/mcp` (streamable HTTP). Tools: `search_papers`, `start_review`, `get_review_status`,
  `get_review_result`, `get_fulltext`; resources `review://{id}` and `review://{id}/report.md`; prompt
  `literature_review`. Connect from Claude Code: `claude mcp add --transport http medical-reviewer http://localhost:8000/mcp/`
  or from any MCP client with `{"mcpServers": {"medical-reviewer": {"url": "http://localhost:8000/mcp/"}}}`.
  Behind a domain, add it to `MCP_ALLOWED_HOSTS`.
- **External MCP tools for the agent:** list servers in `backend/config/mcp_servers.json`
  (`{"mcpServers": {"name": {"url": "https://.../mcp"}}}`). Workers pick up edits automatically; the agent calls at
  most 3 relevant tools per review in parallel with paper reading and uses the output as background only.
  `POST /api/v1/admin/mcp/reload` (admin key) validates the file.

## Status
- Plan 1 (foundation) done: infra, API, queue, SSE, stub graph.
- Plan 2 (review graph) done: question refinement, search, screening with second votes, evidence-grounded extraction,
  checked synthesis pipeline, Thai/English output, Crawl4AI full text.
- Plan 3 (integrations) done: MCP server, external MCP tools, API keys, webhooks, cancellation, paper search.
- Next: web dashboard and interactive report (Plan 4), hardening (Plan 5).
  See `docs/superpowers/`.

## Development
See `CLAUDE.md` for commands. Unit tests need no services; integration tests need
`docker compose up -d postgres redis searxng crawl4ai`, `MRA_INTEGRATION=1` and `CRAWL4AI_API_TOKEN` exported.
On a Windows host, run the dev API with `--loop app.compat:selector_loop_factory` (psycopg async cannot use the Proactor event loop).
