# Production-readiness audit (2026-10-05, master 391d94c)

This is input for the **final plan**, which the user asked to do last: "production เก็บไว้ใน plan ท้ายสุด". Every finding was checked against the code.

**Already solid:**
- atomic admission control
- per-review cost cap
- checkpoint resume
- SSRF-guarded webhooks
- hashed API keys
- a prod overlay that publishes only Caddy
- locked dependencies
- data-tagged prompts

**Missing:** mostly operational.

## Blockers

### B1. A provider outage or exhausted credit is not detected, and degraded reviews are cached
- **What happens:** an OpenRouter 401/402/403 ("Key limit exceeded") becomes a plain `LLMError`.
  - The guard step fails the review.
  - Later nodes swallow the error, so the review still ends `done` with degraded content.
  - That result is then served as the cache for 24 h.
- **Fix:**
  - Classify provider errors as fatal or transient.
  - On a fatal error, set a Redis `mra:provider_down` flag with a TTL. Admission and `/status` then refuse with 503 `llm_unavailable`.
  - Abort runs instead of finishing them as `done`.
  - Never reuse degraded results (provider errors, or `stats.extracted == 0`).
  - Optionally poll OpenRouter `/api/v1/key` for remaining credit.
- **Files:** `services/llm.py:215`, `harness/runner.py:50`, `graph/nodes/*` (the `except LLMError` handlers), `db/repositories.py:47` (`find_reusable`), `services/capacity.py`.

### B2. No startup config validation
- **Problems:**
  - Default secrets are accepted: `IP_HASH_SALT=change-me` and `SEARXNG_SECRET` (default), even though `ip_hash` is reversible with a known salt.
  - `app_env` is never used.
  - A missing `OPENROUTER_API_KEY` only fails at runtime.
  - `PUBLIC_BASE_URL` and `MCP_ALLOWED_HOSTS` default to localhost, and the prod overlay does not set them.
- **Fix:** add a Settings validator that fails fast when `APP_ENV=prod` and any of these hold:
  - a secret is a default value or shorter than 32 characters;
  - the active preset has no key;
  - `PUBLIC_BASE_URL` is localhost;
  - `SITE_ADDRESS` is not in `MCP_ALLOWED_HOSTS`;
  - `TRUST_PROXY` is off behind Caddy.

  Also set `APP_ENV=prod` in the prod overlay.

### B3. No Postgres backup or restore
- **Fix:** a `pg_dump -Fc` sidecar or cron that ships backups off-host with retention, plus a tested restore runbook.

### B4. Privacy and terms
- **Problems:**
  - Every review is listed publicly, including reviews made with an API key: `is_listed` defaults to True, and `GET /reviews` and the home page show the topics.
  - There is no `/privacy` or `/terms` page, although Thai PDPA applies and health topics count as sensitive data.
- **Fix:**
  - Unlist API-key reviews by default.
  - Add an opt-in or opt-out "show in recent reviews" choice.
  - Add `/privacy` covering what is stored (topic, salted IP hash, results, event log), retention and a contact, and `/terms`, both linked in the footer.

### B5. No CI
- **Fix:** GitHub Actions on push and PR running:
  - backend: `uv sync --frozen`, `ruff`, `pytest`
  - frontend: `npm ci`, `lint`, `typecheck`, `test`, `next build`
  - `docker build` for both images
  - `pip-audit` and `npm audit`

## Should

### Security
- **S1. Hardening.** The backend image runs as root. Add a non-root `USER`. In prod, also add `read_only` with a tmpfs, `cap_drop: [ALL]` and `no-new-privileges`.
- **S2. Headers.** Caddy sends no HSTS, CSP, Permissions-Policy or COOP. The CSP needs a nonce for the layout's inline script and must allow challenges.cloudflare.com.
- **S3. Error text.** Raw exception text (model id, provider body) reaches users through `reviews.error`, SSE, MCP and the terminal-state UI. Show stable codes with safe messages and keep the details in logs.
- **S4. Rate limiting.**
  - GET routes (`/status`, `/reviews`, `/reviews/{id}`, `/export`) and the MCP read tools have no limits.
  - slowapi is installed but has no effect.
  - Caddy sets no body limit.
  - Fix: add a per-IP GET limit, a 2 s Redis cache for `/status`, `request_body max_size`, and uvicorn `--limit-concurrency`.
- **S5. Real client IP behind Cloudflare.** If Cloudflare proxies the site, configure Caddy `trusted_proxies` for the Cloudflare ranges and `client_ip_headers CF-Connecting-IP`, and document it.
- **S6. Credentials.** Postgres uses `mra/mra` hard-coded, and Redis has no password. Move both to `.env` or Docker secrets.
- **S7. Supply chain.** Pin images by digest, scan them with Trivy or Grype in CI, and push the SearXNG build to your own registry.

### Reliability
- **S8. Worker health.** The worker has no healthcheck. Use `arq --check`, and alert when no worker is running while the queue is non-empty.
- **S9. Limits.** No service has resource limits or log rotation. Add per-service memory and CPU limits, json-file log rotation, and Redis `maxmemory` with `noeviction`, since arq uses that Redis.
- **S10. Spend on interrupted runs.**
  - Cancelled or interrupted runs never book their spend.
  - A resume starts a fresh budget.
  - Fix: book `budget.spent` on cancel, and persist the spend so a resume can seed its budget.
- **S11. Zero-cost risk.** If the catalog fetch fails and the response lacks `usage.cost`, cost is recorded as 0 and the daily budget never trips. Fix: send `usage: {include: true}`, retry loading the catalog, and alert on zero-cost reviews in real mode.
- **S12. Graceful deploy.**
  - Add `stop_grace_period`, a worker drain mode, and uvicorn `--timeout-graceful-shutdown`.
  - Have CI build versioned images to a registry instead of `up --build` on the host.
  - Document rolling updates.
- **S13. Readiness and circuit breakers.** Add `/readyz` covering SearXNG, Europe PMC and OpenRouter, a circuit breaker per host, and per-engine failure rates.

### Observability
- **S14. Metrics, errors and alerts.**
  - Add Prometheus `/metrics` for the API and the worker: reviews by status, duration, cost, LLM errors by code, queue depth, and SSE connections.
  - Add Sentry with PII scrubbing.
  - Alert on provider errors, daily budget above 80 %, `queue_full`, and a missing worker.
- **S15. Logging.**
  - Add `dict_tracebacks`; tracebacks are currently dropped.
  - Add a request-ID middleware.
  - Bind `review_id` in the runner and pass the request ID into the job.
  - Switch uvicorn to JSON access logs and add Caddy `log { format json }`.

### Data
- **S16. Retention.** Add a daily cron that:
  - deletes checkpoints of terminal reviews after N days;
  - deletes `review_events` older than 30 days;
  - nulls `ip_hash` after 30 days.

  The `papers` and `review_papers` tables are dead schema.

### Ops and legal
- **S17. Runbook and versioning.**
  - Write `docs/runbook.md` covering backup and restore, rotating keys, provider outages, credit top-ups and SearXNG bans.
  - Use one version number across components (0.7.0 vs 0.1.0 today), git tags and a CHANGELOG.
- **S18. Source licensing.**
  - Add a "data sources and licences" section to /about.
  - Trim abstracts in REST paper search.
  - Check the Semantic Scholar terms.
- **S19. Disclaimer.** Show a prominent disclaimer above the summary on `/r/[id]` and at the top of md, csv and json exports.

## Nice
- **N1. Frontend pages and metadata.**
  - Add `not-found.tsx`, `error.tsx` and `global-error.tsx`.
  - Add OG/Twitter metadata, `metadataBase`, `themeColor`, a sitemap, and per-review `generateMetadata`.
  - Revisit `robots.txt`.
  - Set `html lang` per report language.
  - Note that `connection()` makes every page dynamic.
- **N2. Budgets and analytics.** Set a bundle budget and add cookieless analytics (Plausible or Umami).
- **N3. Accessibility.** Run axe in CI and cover `/r/[id]` in its done and error states.
- **N4. Reset time zone.** Make the daily reset time zone configurable, or document it (07:00 in Thailand).
- **N5. Webhook DNS pinning.** Pin the resolved IP for webhook delivery to close the TOCTOU window.
- **N6. Turnstile response checks.** Check `hostname` and `action` in the Turnstile response.
- **N7. CORS.** Keep `*` or restrict it in prod.
- **N8. Public API docs.** Leaving the API docs public is a deliberate choice.
- **N9. Prompt delimiters.**
  - Escape the `</paper>` and `</topic>` delimiters, or use nonce delimiters.
  - Allow only `url` MCP servers in prod; no stdio `command`.
- **N10. Leftovers.**
  - Remove the full-text `SOURCE_LABEL` entries.
  - `llm.yaml` still has `app_url: http://localhost`.
  - The smoke script still defaults to `:8000`.

## Suggested order
B2 → B1 → B3 → B5 → B4 → S3 → S1 → S2 → S9 → S14/S15 → S16 → S12 → the rest.
