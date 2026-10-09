# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-05.2`, API/MCP version 0.7.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
- It refines your question, screens about 60 candidate papers that have abstracts, and analyses the abstracts of up to 30. It never fetches full text.
- Every number it shows is checked against the abstract it came from. A number that cannot be checked is left empty, never estimated.
- Results are not medical advice.

## Base URLs

| What | Where |
|---|---|
| REST | `<origin>/api/v1/...` |
| Event stream (SSE) | `<origin>/api/v1/reviews/{id}/events` |
| MCP (streamable HTTP, stateless, JSON responses) | `<origin>/mcp` (also `/mcp/`) |
| Web app | `<origin>/` |

With the bundled Caddy front, all of these share one origin, `http://localhost:8088` locally. Without it, the API is on `:8000` and the web app on `:3000`.

## Authentication, limits and refusals

**Who can call the API.** Anonymous use is allowed. An API key raises limits and unlocks webhooks and cancellation:
- Send the key as `X-API-Key: mra_...` or `Authorization: Bearer mra_...`.
- An invalid or revoked key gets **401** on every route that reads identity. It is never silently treated as anonymous.
- Keys are minted with `python -m app.cli.keys mint --name "lab" [--quota N] [--admin]`. Only SHA-256 hashes are stored.

**Limits.** Defaults are below. The current values are always in `GET /api/v1/status → limits`.

| Limit | Default | Scope | When exceeded |
|---|---|---|---|
| Reviews, anonymous | 5/hour | per IP | 429 + `Retry-After` |
| Reviews, with key | 60/hour | per key | 429 + `Retry-After` |
| Key daily quota | 100/day (set per key) | per key | 429 + `Retry-After: 3600` |
| Paper search (REST and MCP share it) | 30/minute | per IP or key | 429 + `Retry-After` |
| Open event streams | 5 | per client | 429 + `Retry-After: 30` |
| Waiting reviews (queue) | 50 | whole service | 503 `queue_full`, `Retry-After: 60` |
| New reviews per day | 500 | whole service, resets 00:00 UTC | 503 `daily_reviews` |
| LLM spend per day | $10 | whole service, resets 00:00 UTC | 503 `daily_budget` |
| LLM spend per review | $0.25 | per review | further LLM steps are skipped; the review still finishes |

**What a refusal looks like.** Every refusal says why and when to retry:
- **429** returns `{detail}` and a `Retry-After` header.
- **503** from a capacity check returns `{detail, reason}` and a `Retry-After` header. `reason` is one of `queue_full`, `daily_reviews`, `daily_budget` or `verification_unavailable`.
- **503** when the job could not be queued returns `{detail, review_id}`.

**Cache hits are free.** The same topic (case and spaces ignored), language, options and pipeline version within 24 hours of finishing, or while still queued or running, returns that review with `cached: true`. Cache hits skip every limit, Turnstile and capacity check.

**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
- A missing or rejected token gets **403**.
- If Cloudflare cannot be reached, the request gets **503** `verification_unavailable`.
- API keys and MCP are never challenged.
- The site key is published in `/status.turnstile_site_key`.

## Routes

| Method and path | Success | Errors |
|---|---|---|
| `POST /reviews` | 202 `{review_id, status, cached, callback_scheduled}` | 401, 403, 422, 429, 503 |
| `GET /reviews?recent=20` (1–50) | 200 recent finished reviews: `[{id, topic, language, status, created_at, finished_at, verification_rate}]` | 422 |
| `GET /reviews/{id}` | 200 `ReviewOut` | 404, 422 |
| `GET /reviews/{id}/events` | 200 `text/event-stream` | 404, 422 (malformed id), 429 |
| `GET /reviews/{id}/export?format=md\|csv\|json` | 200 file download | 404, 409 (not done), 422 |
| `DELETE /reviews/{id}` (owner key or admin key) | 200 `{review_id, status: "cancelled"}` | 401, 403, 404, 409, 422 (malformed id) |
| `GET /papers/search?q=&limit=10` (q 2–300 chars, limit 1–25) | 200 `[Candidate]` | 401, 422, 429, 502 |
| `GET /status` | 200 status and limits | none |
| `GET /healthz` | 200 `{status: "ok", db, redis}` | 503 `{status: "degraded", …}` |
| `POST /admin/mcp/reload` (admin key) | 200 `{servers, path}` (validates `config/mcp_servers.json`) | 401, 403, 422 |

### `POST /api/v1/reviews`

```json
{"topic": "metformin and colorectal cancer", "language": "th",
 "options": {"max_papers": 30, "candidate_limit": 60, "year_from": 2015, "study_types": ["RCT"]},
 "callback_url": "https://your-app.example.org/hooks/review"}
```

Field rules:
- `topic`: 3–300 characters, with at least one letter or digit.
- `language`: `th` (default) or `en`.
- `max_papers`: 5–30, default 30.
- `candidate_limit`: 20–100, default 60. Must be at least `max_papers`.
- `year_from`: 1950–2100.
- `study_types`: up to 10 entries.
- `callback_url`: needs an API key, and must use https on a public host. Otherwise the request gets 403 (no key) or 422 (bad URL).

Checks run in this order:
1. Validate the body.
2. Reject a `callback_url` sent without a key.
3. Return the cached review if one matches.
4. Check Turnstile.
5. Check that `callback_url` is safe.
6. Check the key's daily quota.
7. Check capacity: queue and daily caps. This step is atomic across all API processes.
8. Check the hourly rate limit.
9. Insert and enqueue the review.

### `GET /api/v1/reviews/{id}`

The response holds the summary fields plus `options`, `result`, `error`, `cost_usd`, `started_at` and `queue_position`:
- `queue_position` counts from 1 (next to start). It is `null` once the review has left the queue.
- `progress` is reserved and always `null`. Live progress comes from the event stream.
- `status` is one of `queued`, `running`, `done`, `error`, `rejected` or `cancelled`.

`result` has these keys: `topic, english_topic, language, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context`.

**Papers.** Each entry in `papers[]` has `ref, title, authors, year, journal, doi, pmid, pmcid, url, relevance, screen_reason, card, card_en, verification, error`.
- `card.design_category` is one of `rct, non_randomized_trial, cohort, case_control, cross_sectional, case_series, mendelian_randomization, sr_ma_rct, sr_ma_observational, sr_ma_mixed, narrative_review, other`.
- Narrative reviews are listed, but they never count as evidence.

**Stats.** `stats` has `found, unique, with_abstract, candidates, screened, selected, extracted`.

**Synthesis.** `synthesis.consensus` explanations name any dissenting minority. Consensus needs at least 70 % of at least 3 studies to agree. `synthesis.conflicts` lists real splits, each with its likely reasons.

### Exports

The web app also serves the whole interactive report as one HTML file that works offline: `GET <origin>/r/{id}/report.html` (attachment `review-<id8>.html`, about 1 MB; 409 until done).

`GET /reviews/{id}/export?format=…` returns an attachment named `review-<first 8 chars of id>.<format>`. It is only available once the review is `done`; before that it returns 409.

| Format | Contents |
|---|---|
| `md` | The Markdown report. This is the same file as the MCP resource `review://{id}/report.md`. |
| `csv` | One row per paper × outcome: `ref, title, year, journal, doi, pmid, design_category, study_design, sample_size, outcome, direction, effect_measure, effect_value, ci_lower, ci_upper, p_value, evidence_quote, error`. Only verified numbers appear; blanked values are empty. The file starts with a UTF-8 BOM for spreadsheets. |
| `json` | `{review_id, topic, language, created_at, finished_at, result}` |

### `GET /api/v1/status`

```json
{"accepting": true, "reason": null, "retry_after": null, "queue_depth": 0, "running": 3, "reviews_today": 41,
 "turnstile_site_key": null,
 "limits": {"review_rate_limit": "5/hour", "api_key_rate_limit": "60/hour", "paper_search_rate_limit": "30/minute",
            "max_papers": {"min": 5, "max": 30, "default": 30}, "candidate_limit": {"min": 20, "max": 100, "default": 60},
            "max_queued_reviews": 50, "sse_max_per_ip": 5}}
```

The daily budget figures are private. When the budget runs out, the status shows only `accepting: false` with `reason: "daily_budget"`.

## Event stream (SSE)

`GET /api/v1/reviews/{id}/events` first replays the review's past events, then streams new ones.
- Each frame has the form `id: <seq>`, `event: <type>`, `data: <JSON>`.
- To resume after a disconnect, send `Last-Event-ID` or `?since=<seq>`.
- The server sends a ping every 15 s.
- The stream closes after a terminal event. It also closes right after the replay if the review had already finished.

Every event sent by the worker carries `elapsed_s` (seconds since the review first started). The `queued` and `cancelled` events come from the API, so they do not carry it.

| Event | Payload | Notes |
|---|---|---|
| `queued` | `{topic}` | sent by the API |
| `started` | `{resume}` | repeated when a review resumes after a worker restart |
| `checking_topic` | `{}` | |
| `refining` | `{}` | |
| `question_refined` | `{interpretation, refined_question, sub_questions[], assumptions[]}` | in the review language; skipped if refinement fails |
| `planning` | `{queries[]}` | marks the end of the planning step |
| `searching` | `{found, queries, failed}` | marks the end of the search step |
| `enriching` | `{candidates}` | marks the end of the enrich step |
| `screening` | `{batch}` | once per batch of 10 |
| `screened` | `{kept, total}` | marks the end of screening |
| `external_lookup` | `{}` | only when external MCP servers are configured |
| `reading` | `{ref, title}` | once per paper; sent when the paper's read starts, and all arrive together at fan-out start (papers then wait for the LLM concurrency limit) |
| `extracted` | `{ref, ok, verified, uncertain, direction, design}` | once per paper. `direction` is the reading model's overall direction (`positive\|negative\|null\|mixed\|unclear`; the string `"null"` means "no association"), a model judgement, not a pooled result. `design` is the design category (same enum as `card.design_category`). Both are JSON `null` when `ok` is false; events stored before this change lack both keys |
| `synthesizing` | `{papers}` | skipped when no paper was extracted |
| `localizing` | `{}` | Thai reviews only |
| `finalizing` | `{}` | |
| `interrupted` | `{will_resume: true}` | the worker stopped and the review went back to the queue; not terminal |
| `done` | `{cost_usd}` | terminal |
| `error` | `{message}` | terminal |
| `rejected` | `{reason}` | terminal: the topic is not a biomedical question |
| `cancelled` | `{by: "owner" \| "admin"}` | terminal; sent by the API |

With `GRAPH_MODE=stub` and `STUB_DELAY_SECONDS>0` the stub emits the same sequence on a scaled timeline.

## Webhooks

If a request with an API key includes `callback_url`, the service POSTs to it when the review ends as `done`, `error`, `rejected` or `cancelled`. A cached answer returns `callback_scheduled: false` and no webhook is sent; poll the review instead.

```
POST <callback_url>
Content-Type: application/json
User-Agent: MedicalReviewerAgent-Webhook/1
X-Signature: sha256=<hex HMAC-SHA256(raw body, key=sha256_hex(your API key))>

{"review_id": "...", "status": "done", "result_url": "<PUBLIC_BASE_URL>/api/v1/reviews/<id>"}
```

Delivery rules:
- Up to 3 tries in total. The 2nd and 3rd tries wait 10 s and 20 s.
- A network error, 5xx or 429 is retried. A 3xx or other 4xx is final.
- Redirects are never followed.
- The address is checked again at delivery time.
- Nothing is sent if the key has been revoked in the meantime.

## MCP server

The server name is `medical-reviewer-agent`, version 0.7.0. The `Host` header must be in `MCP_ALLOWED_HOSTS`. API keys work through the same headers and limits as REST. MCP calls are never challenged by Turnstile and cannot set `callback_url`.

| Tool | Returns | Notes |
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | `limit` is clamped to 1–25; shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30)` | `{review_id, status, cached, status_url}` | `max_papers` is clamped to 5–30; capacity errors include the reason and the wait time |
| `get_review_status(review_id)` | `{review_id, status, error, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled` |
| `get_review_result(review_id)` | `{review_id, status, result}` | if the review is not done: `{…, result: null, message, error}` |

The server also exposes these resources and one prompt:

| Kind | Name | Returns |
|---|---|---|
| Resource | `review://{id}` | JSON `{review_id, topic, status, result, error}` |
| Resource | `review://{id}/report.md` | the Markdown report |
| Prompt | `literature_review(topic)` | |

Tool errors come back as MCP tool errors, for example "review … not found" or "the review queue is full; please try again in a minute (queue_full); retry after 60 seconds".

Connect from Claude Code:

```bash
claude mcp add --transport http medical-reviewer http://localhost:8088/mcp/
```

## Capacity and scaling

One review is one queue job, so requests never wait for a review to finish. These components scale as follows:

| Component | How it scales | Shared state |
|---|---|---|
| API (`uvicorn --workers API_WORKERS`, or replicas behind Caddy) | stateless | rate limits, capacity counters, the admission lock, SSE slots and event streams all live in Redis |
| Workers (`WORKER_REPLICAS` containers × `MAX_CONCURRENT_REVIEWS_PER_WORKER` each) | concurrent reviews = replicas × per-worker | the arq queue in Redis |
| LLM calls | at most `LLM_CONCURRENCY` in flight per worker process; the provider-wide ceiling is replicas × `LLM_CONCURRENCY` | |
| Postgres | `DB_POOL_SIZE` + `DB_MAX_OVERFLOW` per process; `max_connections` is 300 in compose | |
| Event streams | hold no database connection; one Redis connection each; capped per client | |

A real review on the budget preset (Qwen3.5 Flash) takes about 1.5 minutes. Each worker slot therefore completes about 40 reviews per hour. With 2 replicas × 4 slots, the service handles about 320 reviews per hour, and the queue absorbs bursts of up to `MAX_QUEUED_REVIEWS`.

**Measured load test, 2026-10-05.** Setup:
- `scripts/loadtest.py` through Caddy
- stub reviews of 20 s each (`STUB_DELAY_SECONDS`)
- 2 workers × 10 slots, `API_WORKERS=2`

Each virtual user submits a review, follows its event stream to the end and fetches the result.

| Concurrent users | Accepted | Refused | Submit p95 | First event p95 | Finished p95 | Errors / 5xx |
|---|---|---|---|---|---|---|
| 10 | 10 | 0 | 0.17 s | 0.20 s | 21 s | 0 |
| 50 | 50 | 0 | 0.60 s | 0.65 s | 62 s | 0 |
| 100 | 70 (20 running + 50 queued) | 30 × 503 `queue_full` | 1.6 s | 1.5 s | 83 s | 0 |
| 200 | 70 | 130 × 503 `queue_full` | 4.2 s | 3.4 s | 83 s | 0 |

Every accepted review finished and delivered `done` to its stream. Postgres stayed under 50 connections.

To reproduce: run the stack with `GRAPH_MODE=stub STUB_DELAY_SECONDS=20`, mint a high-quota key, then run:

```bash
uv run --project backend python scripts/loadtest.py --base http://localhost:8088 --users 100 --api-key mra_...
```

**Production checklist:**
- Run `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. The overlay publishes only Caddy (80/443; set `SITE_ADDRESS=your.domain` for automatic HTTPS) and sets `PUBLIC_API_URL=/` and `TRUST_PROXY=true`.
- Never enable `TRUST_PROXY` while the API port is reachable directly: a client could forge `X-Forwarded-For` and get a fresh rate-limit bucket per request. Without it behind Caddy, every visitor shares the proxy's bucket.
- Set the `TURNSTILE_*` keys.
- Size `WORKER_REPLICAS` and `MAX_CONCURRENT_REVIEWS_PER_WORKER` for the traffic you expect, and set `MAX_USD_PER_DAY` to your budget.
