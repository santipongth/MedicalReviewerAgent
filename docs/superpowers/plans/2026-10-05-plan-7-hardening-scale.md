# Plan 7: Hardening, concurrency and up-to-date API/MCP docs

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Make the public service safe and predictable when many people use it at once:
- budget and capacity limits with clear 503/429 answers
- a per-review cost cap
- queue position for waiting users
- horizontal scaling of API and workers
- SSE connection limits
- Turnstile for anonymous web submissions
- exports
- a single-origin Caddy front
- API/MCP documentation that matches the running system, proven by a load test

**User request (2026-10-05):** "ทำ plan 7 ต่อได้เลย และอัปเดทตรวจสอบ API and MCP document ใหม่ ให้สอดคล้องกับงานปัจจุบัน ปรับแก้ไขและทดสอบ มากไปกว่านั้นออกแบบให้สามารถรองรับคนเข้าใช้งานพร้อมกันได้ด้วย"

**Architecture for concurrency:** One review is one arq job, so reviews never run inside the request.
- **API:** stateless. It runs `uvicorn --workers N`. Rate limits, capacity counters and event streams all live in Redis, so any number of API processes or replicas behave identically.
- **Workers:** scale with `deploy.replicas`. Each worker runs `max_jobs` reviews concurrently, and its LLM calls share one per-process semaphore (`LLM_CONCURRENCY`). The provider-wide ceiling is `replicas × LLM_CONCURRENCY`.
- **Admission control:** keeps the queue bounded (`MAX_QUEUED_REVIEWS` → 503 + Retry-After) and the spend bounded (`MAX_REVIEWS_PER_DAY`, `MAX_USD_PER_DAY`, `MAX_COST_PER_REVIEW_USD`).
- **Visibility:** users see their queue position. SSE holds no database connection, and each IP is limited to `SSE_MAX_PER_IP` open streams.

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` §5 (public surfaces), §7 (security/cost) and §9 item 8 (hardening).

**Deferred to Plan 8:**
- single-file interactive HTML export
- preferring pooled estimates over overlapping primary studies
- papers/review_papers persistence

## Global Constraints
- Every refusal says why and when to retry:
  - queue full or daily capacity → 503 with Retry-After
  - rate limit or SSE limit → 429 with Retry-After
  - Turnstile failure → 403
- Cache hits are always free. They bypass capacity, Turnstile and rate limits, exactly as before.
- API keys and MCP clients never need Turnstile. Anonymous web submissions do, but only when `TURNSTILE_SECRET` is set.
- No new secrets in the repo. Defaults keep local development working with no extra configuration.
- Documentation states only what the code does. Limits shown to users are read from `GET /api/v1/status`, not hard-coded.

## Review Focus
1. **Two API processes:** the queue cap, daily counters and SSE-per-IP limit hold across both processes, because everything lives in Redis.
2. **Cost cap mid-review:** the remaining LLM steps are skipped (recorded as errors), and the review still finishes `done` with what it has.
3. **SSE slot leaks:** a client that disconnects or crashes frees its slot. The counter has a TTL, so a crashed API process cannot leak slots forever.
4. **Midnight rollover:** the daily counters roll over at UTC midnight, and Retry-After points there.
5. **Turnstile outage:** with `TURNSTILE_SECRET` set, an unreachable Cloudflare gives a clear 503, not a crash or a silent pass.

---

### Task 1: Capacity service, status endpoint, queue position
- **Files:**
  - `app/services/capacity.py` (new)
  - `app/config.py`: `max_queued_reviews=50`, `max_reviews_per_day=500`, `max_usd_per_day=10.0`
  - `app/services/review_service.py`
  - `app/api/status.py` (new, `GET /api/v1/status`)
  - `app/schemas/review.py`: `ReviewOut.queue_position: int | None`
  - `app/db/repositories.py`: `count_queued`, `queue_position`
  - `app/worker/runner.py`: at finish, adds the cost to the daily USD
  - tests
- **Capacity (Redis, UTC day keys with a 48 h TTL):**
  - `reviews_today()`, `usd_today()`
  - `note_review()`, `note_cost(usd)`
  - `check(queued:int) -> Refusal | None`, where the reason is `queue_full | daily_reviews | daily_budget` and `retry_after` is 60 s for a full queue or the seconds until UTC midnight for the daily limits
- **`ReviewService.create`:** after the cache reuse and before the rate limit:
  - `check(count_queued)` raises `Unavailable` (503) when it refuses
  - `note_review()` runs after the review is enqueued
- **`GET /api/v1/status` →** `{accepting, reason, retry_after, queue_depth, running, reviews_today, limits: {review_rate_limit, api_key_rate_limit, paper_search_rate_limit, max_papers: {min, max, default}, candidate_limit: {...}, sse_max_per_ip, max_queued_reviews}}`. Daily budget numbers stay private: only `accepting`/`reason` are shown.
- **Tests:**
  - A full queue gives 503 with Retry-After 60.
  - Daily reviews gives 503 with Retry-After until midnight.
  - The USD budget counts costs noted by workers.
  - A cache hit is still served when capacity is full.
  - Status reflects the limits.
  - `queue_position` is 1 for the oldest queued review and None once running.

### Task 2: Per-review cost cap
- **Files:**
  - `app/services/budget.py` (new: `ReviewBudget` with a contextvar, `BudgetExceeded(LLMError)`)
  - `app/services/llm.py`: `LimitedLLM` charges the active budget and refuses calls once it is spent
  - `app/worker/runner.py`: sets the budget per run from `MAX_COST_PER_REVIEW_USD` (0.25)
  - `app/config.py`
  - tests
- **Tests:**
  - Calls beyond the cap raise `BudgetExceeded` without reaching the model.
  - A graph run with a tiny cap finishes `done` with "cost cap" in its errors.
  - Each run's budget is isolated: two concurrent runs do not share spend.

### Task 3: Scaling knobs and SSE limits
- **Files:**
  - `app/db/session.py`: `pool_size`/`max_overflow` from settings, default 10/20
  - `app/config.py`: `db_pool_size`, `db_max_overflow`, `sse_max_per_ip=5`
  - `app/api/events.py`: Redis slot counter per IP hash, `INCR` + `EXPIRE`, released in `finally`; 429 + Retry-After when over the limit
  - `docker-compose.yml`:
    - api command `uvicorn ... --workers ${API_WORKERS:-2}`
    - worker `deploy.replicas: ${WORKER_REPLICAS:-1}`
    - `MAX_CONCURRENT_REVIEWS_PER_WORKER` default 4
  - `.env.example`
  - tests
- **Tests:**
  - A 6th concurrent stream from one IP gets 429.
  - A closed stream frees its slot.
  - The slot key has a TTL.
  - The engine gets the pool settings.

### Task 4: Turnstile for anonymous web submissions
- **Files:**
  - `app/services/turnstile.py`: `verify(token, ip) -> bool`; an unreachable siteverify raises `Unavailable`
  - `app/config.py`: `turnstile_secret=""`, `turnstile_site_key=""`
  - `app/api/reviews.py`: reads the `cf-turnstile-response` header or body field, only for anonymous callers when the secret is set
  - `app/api/status.py`: exposes the site key
  - tests
- **Tests:**
  - With no secret nothing is checked.
  - With a secret, a missing or invalid token gives 403.
  - A valid token passes.
  - An API key bypasses the check.
  - A Cloudflare outage gives 503.
  - The MCP `start_review` is unaffected.

### Task 5: Exports
- **Files:**
  - `app/services/report.py`: `render_csv(result)` (one row per paper × outcome, with verified numbers only) and `render_json`
  - `app/api/reviews.py`: `GET /api/v1/reviews/{id}/export?format=md|csv|json` with `Content-Disposition`, 409 when not done
  - tests
- **Tests:**
  - Each format returns the right media type and filename.
  - A blanked (unverified) value is empty in the CSV, never guessed.
  - A review that is not done returns 409.

### Task 6: Caddy single origin
- **Files:**
  - `infra/caddy/Caddyfile`: `/api/*`, `/mcp*`, `/healthz` go to `api:8000` with `flush_interval -1`; everything else goes to `web:3000`; security headers
  - `docker-compose.yml`: a `caddy` service on `${PUBLIC_PORT:-8088}`, with `TRUST_PROXY=true` for the api behind it
  - `frontend/src/lib/config.ts`: an empty or `/` apiUrl means same origin
  - `MCP_ALLOWED_HOSTS` includes the Caddy host
- **Tests:**
  - A config unit test for a same-origin apiUrl.
  - Live: `curl :8088/api/v1/status`, `/`, SSE through Caddy, and MCP initialize through Caddy.

### Task 7: Web app: capacity banner, queue position, Turnstile, export menu
- **Files:**
  - `src/lib/api.ts`: `getStatus`, export URLs
  - `src/components/landing/request-slip.tsx`: shows a banner when `!accepting`, with its reason and retry time; renders the Turnstile widget when a site key is present; sends the token
  - `src/components/review/live-run.tsx`: "อยู่ในคิวลำดับที่ N"
  - `src/components/review/report.tsx`: an export menu (Markdown/CSV/JSON)
  - `src/app/about/page.tsx`: limits read from `/status`
  - unit and e2e tests
- **Tests:**
  - The banner shows when the service is not accepting, and the submit button is disabled.
  - The queue position renders.
  - The export links point at the API.
  - With a site key the token is sent.
  - The about page shows the limits returned by status.

### Task 8: API and MCP documentation audit
- **Files:**
  - `app/main.py`: OpenAPI description, tags, contact; every route has a summary and documented 4xx/5xx responses
  - `app/mcp/server.py`: INSTRUCTIONS and tool docstrings: abstract-only, 5–30 papers, 1–3 min, capacity errors, export resource
  - `README.md`
  - `src/app/about/page.tsx`
  - new `docs/api.md`: REST + SSE events + MCP tools/resources/prompts + errors + limits + webhooks + exports + scaling
- **Audit checklist (each item verified against code or a live call):**
  - endpoints and status codes
  - SSE event names and payload fields
  - MCP tool names and arguments
  - option ranges
  - rate limits
  - webhook retry count
  - Turnstile
  - exports
  - error bodies
- **Tests:**
  - An OpenAPI test that every route has a summary and declares its error responses.
  - An MCP test that the instructions mention the current ranges.
  - The about-page e2e.

### Task 9: Load test and capacity numbers
- **Files:**
  - `scripts/loadtest.py`: async httpx virtual users that create a review (unique topics), follow SSE to the end, and fetch the result. It reports p50/p95 for create, first-event time, completion and errors.
  - `docs/api.md`: a capacity section.
- **Run:** `GRAPH_MODE=stub` through Caddy with API_WORKERS=2 and WORKER_REPLICAS=2, ramping 10 → 50 → 100 concurrent users. The rate limit is lifted for the run via an API key.
- **Expected:**
  - No 5xx except deliberate 503s once the queue cap is reached.
  - Every accepted review reaches a terminal state.
  - SSE delivers `done` to every follower.
  - Record the numbers in the ledger and in the docs.
