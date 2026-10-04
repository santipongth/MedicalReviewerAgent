# Plan 3 — MCP server, MCP client and integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let external systems and agents use the Medical Reviewer Agent through REST and MCP (Model Context
Protocol), and let the agent consult external MCP tools, with API keys, webhooks and cancellation.

**Architecture:** A service layer (`app/services/review_service.py`, `paper_search.py`, `report.py`) holds the
logic; REST routes and the MCP server (`app/mcp/server.py`, mounted at `/mcp`, stateless streamable HTTP) are thin
adapters over it. Rate limits and quotas live in the service layer so both surfaces share them. The worker gains an
optional `external_enrich` graph node that calls tools from operator-configured MCP servers
(`backend/config/mcp_servers.json`) through `langchain.mcp.MCPAdapter`, in parallel with paper reading.

**Tech Stack:** `mcp` 2.3 (`MCPServer`), `langchain[mcp]` 1.4 (`MCPAdapter`, FastMCP 4 client), `limits` 5.8 async
storage, arq (webhook delivery), FastAPI.

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (§3 MCP rows, §4 node 6c, §5, §7).

**Executor note:** the author executes this plan inline, so tasks give interfaces, decisions and the exact tests;
code lives in the commits. Rulings go to the ledger.

## Global Constraints

- MCP server: `MCPServer`, `streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/")`
  mounted at `/mcp`; FastAPI lifespan runs `mcp.session_manager.run()`; CORS exposes `Mcp-Session-Id` and allows
  `Mcp-Protocol-Version, Mcp-Session-Id`.
- MCP tools call the same service layer as REST; they never touch the graph directly.
- MCP client: `langchain.mcp.MCPAdapter` (not the archived `langchain-mcp-adapters`); config format
  `{"mcpServers": {...}}`; empty config → the node is skipped.
- API keys: stored as SHA-256 hashes only; key unlocks higher quota, `callback_url`, DELETE and admin.
- Webhook: POST `{review_id, status, result_url}` with `X-Signature: sha256=HMAC(body, secret)`; 3 attempts;
  HTTPS public hosts only (SSRF guard).
- Untrusted text (tool results, topics) only in user turns inside tags; external tool output is data.
- Public anonymous use keeps working exactly as before (no key needed for POST/GET reviews or MCP tools).

## Review Focus

1. A request with an invalid, revoked or missing API key never gets keyed privileges (quota, callback, DELETE, admin).
2. A webhook URL that resolves to a private/loopback address (at creation or at delivery) is never called.
3. Cancelling a running review stops it, leaves status `cancelled`, and the worker does not requeue or resurrect it.
4. An external MCP server that is down, slow or returns junk never fails the review; its output never enters a
   system prompt.
5. MCP and REST give the same answer for the same review (status, result) and share the same rate limits.

---

### Task 1: Service layer and shared rate limiting

**Files:** create `app/services/review_service.py`, `app/services/ratelimits.py`; modify `app/api/reviews.py`,
`app/runtime.py`, `app/infra.py`, `app/main.py`; tests `tests/unit/test_review_service.py`.

**Interfaces:**
- `RateLimits(storage_uri)` → `async hit(scope: str, identity: str, rate: str) -> RateDecision(allowed, retry_after)`
  (limits.aio moving window; `memory://` → async memory, `redis://` → async redis with `implementation="redispy"`).
- `ReviewService(session_factory, queue, event_sink, settings, limits)`:
  `async create(req: CreateReviewRequest, *, identity: Identity) -> ReviewCreated` (raises `RateLimited(retry_after)`,
  `QueueUnavailable(review_id)`, `Forbidden(detail)`); `async get(review_id) -> Review | None`;
  `async list_recent(limit)`; `async cancel(review_id, identity)`.
- `Identity(ip: str, api_key: ApiKeyInfo | None)`; anonymous rate = `review_rate_limit`, keyed rate =
  `api_key_rate_limit` (default `60/hour`).
- `AppDeps` gains `limits`, `service`, `papers` (Task 5).

**Tests:** existing `test_reviews_api.py` stays green unchanged (incl. 429 + `Retry-After`); new: service create
reuses cache, rate limit shared between two callers with the same identity, keyed identity uses the keyed rate.

### Task 2: API keys (model, CLI, auth dependency, quota)

**Files:** migration adding `api_keys.key_prefix`, `api_keys.is_admin`; `app/services/api_keys.py`;
`app/cli/keys.py`; `app/api/auth.py`; tests `test_api_keys.py`.

**Interfaces:** `mint_key(session, name, daily_quota=100, is_admin=False) -> (raw_key, ApiKey)` (raw key
`mra_<43 url-safe chars>`, shown once); `resolve_key(session, raw) -> ApiKeyInfo | None` (revoked → None);
`revoke_key`; `list_keys`. `python -m app.cli.keys mint|list|revoke`. FastAPI dependency `identity(request)` reads
`X-API-Key` or `Authorization: Bearer`; a key header that is present but invalid → 401 (never silently anonymous).
Daily quota: reviews created by the key in the last 24 h ≥ `daily_quota` → 429.

**Tests:** hash-only storage; revoked/unknown key → 401; keyed POST stores `api_key_id`; quota exhaustion → 429;
`callback_url` without a key → 403; admin flag enforced.

### Task 3: Cancellation

**Files:** `app/services/queue.py` (`abort_review`), `app/api/reviews.py` (DELETE), `app/worker/runner.py`,
`app/worker/sweep.py`; tests in `test_reviews_api.py`, `test_runner.py`.

**Behaviour:** `DELETE /api/v1/reviews/{id}` needs the key that created the review (or an admin key); terminal
reviews → 409; sets status `cancelled` + `finished_at`, emits `cancelled`, then aborts the arq job. The runner, on
`CancelledError`, re-reads the status: `cancelled` → emit nothing more and do not requeue. The sweep never touches
cancelled reviews (already terminal).

**Tests:** owner can cancel (status cancelled, event, abort called); other key → 403; anonymous → 401; done → 409;
runner cancelled mid-run does not set `queued`.

### Task 4: Webhooks

**Files:** `app/services/webhook.py`, `app/worker/tasks.py` (`deliver_webhook`), `app/worker/runner.py` (enqueue on
terminal status), `app/worker/settings.py`; tests `test_webhook.py`.

**Behaviour:** `callback_url` must be `https` and resolve only to public addresses (checked at creation with
`is_public_http_url` + scheme, and again at delivery). Body `{"review_id","status","result_url"}` (result URL =
`public_base_url + /api/v1/reviews/{id}`), header `X-Signature: sha256=<hex HMAC-SHA256(body, secret)>`,
`secret = SHA-256 hex of the API key` (the client can derive it; the server stores only that hash).
`deliver_webhook` retries on network errors / 5xx up to 3 attempts (arq `Retry(defer=attempt*10)`), never follows
redirects, 10 s timeout. `webhook_allow_http` setting (default false) for local testing only.

**Tests:** signature verifiable with the raw key; private/loopback/http URL rejected at creation (422) and skipped
at delivery; 5xx → Retry, 3rd failure → gives up and logs; runner enqueues delivery only for reviews with a callback.

### Task 5: Paper search, full text and Markdown report services + REST

**Files:** `app/services/paper_search.py`, `app/services/report.py`, `app/api/papers.py`; infra builds an
`HttpClient`, `SearxngClient`, `EuropePmcClient` for the API process; tests `test_paper_search.py`, `test_report.py`.

**Interfaces:** `PaperSearch(searxng, europepmc)`: `async search(query, limit) -> list[Candidate]` (dedupe, Europe
PMC metadata, no LLM); `async fulltext(pmcid) -> {pmcid, source, text}` (Europe PMC JATS only — no crawling from
the API process). `render_markdown(review) -> str` (question, summary, comparison table, consensus, conflicts,
papers with DOI links, quality line; uses the user-language result). REST: `GET /api/v1/papers/search?q=&limit=`
(separate rate `paper_search_rate_limit`, default `30/minute`), `GET /api/v1/papers/fulltext/{pmcid}`.

**Tests:** search merges and caps; SearXNG failure → 502 with detail; invalid PMCID → 422; Markdown contains the
table rows and escapes `|` in cells.

### Task 6: MCP server

**Files:** `app/mcp/server.py`, `app/main.py` (mount + lifespan); tests `test_mcp_server.py` (in-process FastMCP
client against the `MCPServer` instance, plus one HTTP round-trip through the mounted ASGI app).

**Tools:** `search_papers(query, limit=10)`, `start_review(topic, language="th", max_papers=8)`,
`get_review_status(review_id)`, `get_review_result(review_id)`, `get_fulltext(pmcid)`.
**Resources:** `review://{review_id}` (JSON), `review://{review_id}/report.md`.
**Prompt:** `literature_review(topic)`.
Identity for `start_review`: client IP and optional `X-API-Key` from the HTTP request behind the tool context;
same `ReviewService.create` (same limits, cache, guard). Errors are returned as MCP tool errors with a clear message
(rate limited → retry-after seconds).

**Tests:** tool list/schemas; start → status → result equal to REST `GET`; unknown id → tool error; rate limit
shared with REST; resource report.md renders; HTTP POST `/mcp` `initialize` works with the CORS/MCP headers.

### Task 7: MCP client and `external_enrich`

**Files:** `app/services/mcp_client.py`, `app/graph/nodes/external.py`, `app/graph/prompts.py`,
`app/graph/nodes/screening.py` (route), `app/graph/graph.py`, `app/graph/nodes/synthesis.py` (narrative +
finalize), `app/api/admin.py` (`POST /api/v1/admin/mcp/reload`), `backend/config/mcp_servers.json` (empty);
tests `test_mcp_client.py`, `test_nodes_external.py`.

**Design:** `McpRegistry(path)` loads/validates the config (re-read when the file's mtime changes — every worker
picks up edits; the admin endpoint validates the file and returns the server list). `external_enrich` runs as one
extra `Send` next to the `read_paper` fan-out (no added latency): the `enricher` role (fallback planner) returns a
structured `ToolPlan{calls: [{tool, arguments}] ≤ 3}` from the tool catalogue (names, descriptions, JSON schemas);
calls are validated against the catalogue, executed with a per-call timeout, results truncated (4 000 chars) and
stored in `external_context`. The narrative prompt receives them inside `<external_context>` as data; citations
stay `[Pn]` only; `result.external_context` lists tool, arguments and a preview. Ruling: plan-then-call instead of a
free ReAct loop — works with the structured-output harness and any OpenRouter model; cost: no reasoning over
intermediate tool results.

**Tests:** empty config → no Send, node absent from events; in-process `MCPServer` tool called with planned
arguments; unknown tool / bad arguments rejected; server error or timeout → review continues with an error entry;
narrative prompt contains `<external_context>` in the user turn and not in the system prompt; reload endpoint
requires an admin key and reports invalid JSON as 422.

### Task 8: Compose, docs and live checks

**Files:** `docker-compose.yml` (mount `config/` already covers `mcp_servers.json`; `PUBLIC_BASE_URL`),
`.env.example`, `README.md` (REST/MCP/webhook how-to, client config snippet for Claude Desktop / Claude Code),
`CLAUDE.md`, `tests/integration/test_mcp_live.py` (FastMCP client over HTTP to `http://localhost:8000/mcp`:
list tools, start a stub review, poll result).

**Verify:** unit suite, ruff, integration suite, smoke, MCP live test against the running stack.
