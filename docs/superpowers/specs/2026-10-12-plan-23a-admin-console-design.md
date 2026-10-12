# Plan 23a: admin console (login, dashboard, reviews, keys, audit) — design (2026-10-12)

**สรุปภาษาไทย:** หน้า admin สำหรับดูแลบริการจากที่เดียว เข้าด้วย username + password (สร้างบัญชีแรกด้วย CLI)
รอบนี้ทำ 23a: login, dashboard (จำนวนรีวิวและค่าใช้จ่ายรายวัน, คิว, error rate), จัดการรีวิว (ค้นหา, ยกเลิก, ซ่อน/แสดง, ลบ),
จัดการ API key (สร้าง, แก้ quota, revoke) และ audit log ที่บันทึกทุกการแก้ไข หน้าเว็บอยู่ใน Next.js เดิมที่ `/admin`
และใช้ผ่าน origin เดียว (Caddy) API key แบบ admin ยังใช้กับสคริปต์ได้เหมือนเดิม 23b (จัดการโมเดล) และ 23c (settings,
glossary, harness) ทำเป็น spec แยกภายหลัง

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 6b. The owner approved this design in chat on 2026-10-12.

## 1. Goal and success

The owner runs the service from one place behind a username and password, instead of CLIs and the database.

**Success for 23a:**
- `python -m app.cli.admin create --username owner` creates the first admin; the owner signs in at `/admin` through the
  single origin (Caddy `:8088` locally, the real domain in production).
- The dashboard shows real numbers from `reviews` and the capacity counters.
- The owner can find a review, cancel it, hide or show it in the public list, and delete a finished one.
- The owner can mint a key (shown once), change its name or quota, and revoke it.
- Every change above, every sign-in and every lockout appears in the audit log with who, what, before, after and when.
- Admin API keys keep working for scripts on every admin route, and no admin route appears in `/api/openapi.json`.
- Five wrong passwords lock the username (and the IP) for 15 minutes.

**Out of scope (later plans):**
- 23b: providers, presets and per-role models in the DB with live reload.
- 23c: runtime settings, the glossary editor, harness reports. The dashboard's "latest harness score" moves to 23c with
  the harness page, because the reports are markdown files and the raw `runs/` are not in the image.
- Roles and permissions (every admin is equal), 2FA, password reset by email (`cli.admin passwd` only), per-model
  cost attribution (cost is stored per review, not per call).

## 2. Decisions (owner, 2026-10-12)

| Topic | Decision |
|---|---|
| Split | Plan 23 is three spec/plan cycles: 23a now, then 23b, then 23c |
| Who signs in | A few equal admins; no roles |
| Password hash | argon2id via `argon2-cffi` (new backend dependency) |
| First admin | CLI only (`app.cli.admin create`); there is no sign-up page |
| Session | Opaque random token, stored hashed in Redis, 8 hours, carried in an httpOnly SameSite=Strict cookie |
| Brute force | 5 failures in 15 minutes per username or per IP lock it for 15 minutes |
| CSRF | SameSite=Strict, plus a required `X-MRA-Admin: 1` header on cookie-authenticated writes |
| Scripts | Admin API keys work on every admin route, as today |
| Public API docs | Admin routes are hidden from OpenAPI (`include_in_schema=False`) and described in `docs/api.md` |
| Frontend | Inside the existing Next.js app at `/admin`, same-origin relative calls, no CORS with credentials |
| Harness on the dashboard | Moved to 23c |

## 3. Data model

One Alembic migration adds two tables.

**`admin_users`**
- `id` uuid pk
- `username` varchar(32), unique; stored lower-case, 3–32 chars of `[a-z0-9._-]`
- `password_hash` text (argon2id encoded string)
- `created_at`, `last_login_at` (nullable), `disabled_at` (nullable)

**`admin_audit`**
- `id` bigint pk (integer on sqlite, as `review_events`)
- `created_at` timestamptz, indexed
- `actor_kind`: `user | key | cli`
- `actor_id` uuid, nullable (null for `cli`)
- `actor_label` varchar(64): the username, the key prefix, or `cli`
- `action` varchar(48), for example `review.cancel`, `review.hide`, `review.show`, `review.delete`, `key.mint`,
  `key.update`, `key.revoke`, `admin.login`, `admin.logout`, `admin.lockout`, `admin.create`, `admin.passwd`,
  `admin.disable`
- `target_type` varchar(16), nullable (`review | key | admin`); `target_id` varchar(64), nullable
- `before`, `after`: JSON, nullable. Never a raw key, a password, a hash or a session token.
- `ip_hash` varchar(64), nullable (the same salted hash as `reviews.ip_hash`)

The audit row is written in the same transaction as the change it records. Audit rows are never edited or deleted by
the application.

`ApiKeyInfo` gains `key_prefix`, so key-authenticated admin actions can be labelled.

## 4. Authentication

### 4.1 Passwords and the CLI
`app/services/admin_auth.py` holds hashing and the user repository calls.
- `PasswordHasher()` from `argon2-cffi` with its defaults (argon2id). Passwords are 12–256 characters.
- Hashing and verifying run in `asyncio.to_thread`, so a sign-in never blocks the event loop.
- On a successful sign-in, `check_needs_rehash` upgrades an old hash in place.

`python -m app.cli.admin`:
- `create --username NAME` — the password comes from `getpass` twice, or from one line of stdin with `--password-stdin`
- `passwd NAME` — sets a new password and ends every session of that user
- `disable NAME` / `enable NAME` — disabling ends every session
- `list` — username, created, last sign-in, disabled

Each CLI change writes an audit row with `actor_kind = cli`.

### 4.2 Sessions
`app/services/admin_sessions.py`, Redis only (so any number of API processes agree, like capacity):
- A token is `secrets.token_urlsafe(32)`. Redis stores `mra:admin:session:<sha256(token)>` → `{user_id, username,
  created_at}` with TTL `admin_session_ttl_seconds` (default 28,800). The TTL is absolute; it is not extended on use.
- `mra:admin:user:<user_id>:sessions` is a set of that user's session hashes, so `passwd` and `disable` can end them all.
- Each cookie-authenticated request loads the session, then the user row; a missing or disabled user ends the
  session and answers 401.
- Sign-out deletes the session and clears the cookie.

The cookie is `mra_admin`: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/admin`, `Max-Age` equal to the TTL, and
`Secure` when `admin_cookie_secure` is true. That setting defaults to `None`, which means "true when
`public_base_url` starts with `https://`".

### 4.3 Sign-in and lockout
`POST /api/v1/admin/session` with `{username, password}`:
1. Normalise the username (strip, lower-case).
2. If `mra:admin:fail:u:<username>` or `mra:admin:fail:ip:<ip_hash>` has reached `admin_login_max_failures`
   (default 5), answer 429 with `Retry-After` (the key's remaining TTL). The password is not checked.
3. Verify the password. An unknown or disabled user is verified against a fixed dummy hash, so the answer takes the
   same time either way.
4. On failure, `INCR` both counters (TTL `admin_lockout_seconds`, default 900, set when a counter is created) and
   answer 401 `invalid username or password`. When a counter reaches the limit, write one `admin.lockout` audit row.
5. On success, clear the username counter (the IP counter stays), set `last_login_at`, create the session, set the
   cookie, write `admin.login`, and answer 204.

Failed attempts are not audited one by one (a flood would bury the log); the lockout row and the counters record them.

### 4.4 Who is calling
`require_admin` (in `app/api/auth.py`) returns an `Identity` whose new field `admin: AdminPrincipal | None` is set:
- If an API key is presented (`X-API-Key` or `Authorization: Bearer`), the key path decides, exactly as today: an
  invalid key is 401, a non-admin key is 403. The principal is `AdminPrincipal(kind="key", id, label=key_prefix)`.
- Otherwise the `mra_admin` cookie decides. No cookie or an unknown session is 401. The principal is
  `AdminPrincipal(kind="user", id, label=username)`.
- For a cookie-authenticated `POST`, `PATCH` or `DELETE`, the request must carry `X-MRA-Admin: 1`, or it is 403.
  The sign-in route needs the header too (login CSRF). Key-authenticated requests carry no ambient credential and are
  exempt.

`Identity.is_admin` is true for either kind. `ReviewService.cancel` accepts `identity.is_admin` in place of an admin
API key, so a signed-in admin cancels through the same code path (event, webhook, job abort) and the event says
`by: admin`.

## 5. Admin API

All routes are under `/api/v1/admin`, hidden from OpenAPI, and need `require_admin` except sign-in. Errors use the
service's usual `{detail}` shape. Lists use keyset paging: `before` is the last item's cursor, `limit` is 1–100
(default 50), and the answer carries `next` (null on the last page).

| Method and path | What it does |
|---|---|
| `POST /session` | Sign in (section 4.3) |
| `DELETE /session` | Sign out; 204 |
| `GET /me` | `{kind, label}` of the caller |
| `GET /dashboard?days=30` | Section 7; `days` is 1–90 |
| `GET /reviews?q=&status=&listed=&before=&limit=` | `q` matches the topic (case-insensitive substring); newest first. Items: `id`, `topic` (first 200 chars), `status`, `review_type` (from `options`, `slr` when missing), `created_at`, `finished_at`, `cost_usd`, `is_listed`, `api_key_prefix`, `prompt_version`, `error` |
| `POST /reviews/{id}/cancel` | `ReviewService.cancel`; 409 when already finished; audit `review.cancel` |
| `PATCH /reviews/{id}` | `{is_listed}`; audit `review.hide` or `review.show` with before and after |
| `DELETE /reviews/{id}` | Section 8; 409 unless the review is finished; audit `review.delete` |
| `GET /keys` | Every key, revoked ones too: `id`, `key_prefix`, `name`, `daily_quota`, `is_admin`, `created_at`, `revoked_at`, `reviews_24h` |
| `POST /keys` | `{name, daily_quota, is_admin}`; answers the raw key once; audit `key.mint` (prefix only) |
| `PATCH /keys/{id}` | `{name?, daily_quota?}`; a revoked key is 409; audit `key.update`. The admin flag is set only at mint |
| `POST /keys/{id}/revoke` | Idempotent; audit `key.revoke` on the first revoke only |
| `GET /audit?before=&limit=` | Newest first |
| `POST /mcp/reload` | Unchanged behaviour; now also open to signed-in admins and hidden from OpenAPI |

Business logic lives in `app/services/admin_service.py` (reviews, keys, audit, dashboard); the routes in
`app/api/admin.py` stay thin adapters, as the rest of the API. Repositories never commit; the service opens
`session.begin()` and writes the audit row in the same transaction.

## 6. Settings

New fields in `app/config.py` (env-overridable like the rest):
- `admin_session_ttl_seconds: int = 28800`
- `admin_login_max_failures: int = 5`
- `admin_lockout_seconds: int = 900`
- `admin_cookie_secure: bool | None = None`

## 7. Dashboard

`GET /dashboard?days=N` reads one window of review rows (`created_at`, `status`, `cost_usd`, `model_versions`) and
the capacity counters, and aggregates in Python. That keeps one code path for Postgres and sqlite, and the window is
at most 90 days of a small service. Days are UTC, the same days as the daily caps; the UI says so.

```json
{
  "days": 30, "since": "2026-09-13",
  "per_day": [{"date": "2026-10-12", "by_status": {"done": 4, "error": 1}, "cost_usd": 0.31}],
  "totals": {"reviews": 120, "by_status": {"done": 100, "error": 6, "rejected": 10, "cancelled": 4},
             "cost_usd": 7.9, "avg_cost_done_usd": 0.072},
  "error_rate_7d": 0.05,
  "by_model": [{"synthesizer": "openrouter:qwen/qwen3.5-flash-02-23", "reviews": 118, "cost_usd": 7.8}],
  "capacity": {"accepting": true, "reason": null, "queued": 0, "running": 1, "max_queued_reviews": 20,
               "reviews_today": 5, "max_reviews_per_day": 500, "usd_today": 0.4, "max_usd_per_day": 10.0}
}
```

- `per_day` lists every day in the window, zero-filled.
- `error_rate_7d` is `error / (done + error)` over the last 7 days, or null when both are zero. Guard rejections and
  cancellations are not errors.
- `by_model` groups by `model_versions["synthesizer"]` (`"unknown"` when missing). Cost is stored per review, so this
  is "cost of reviews whose synthesizer was X", not a per-model bill; the UI labels it that way.
- `capacity` gives the queue counts from `reviews`, today's counters from `Capacity`, the admission verdict from
  `Capacity.check` (as `/status` computes it), and the caps from `Settings` (`max_queued_reviews`,
  `max_reviews_per_day`, `max_usd_per_day`). The daily caps are not in the public `/status`, so the admin endpoint
  carries them; the UI never hard-codes them.

## 8. Deleting a review

Only a finished review (`done`, `error`, `rejected`, `cancelled`) can be deleted; a queued or running one is cancelled
first. The delete:
1. In one transaction: deletes the review's `review_events` and `review_papers` rows explicitly (sqlite in tests does
   not enforce cascades), then the `reviews` row, and writes the audit row. Its `before` is `{topic, status,
   created_at, cost_usd, prompt_version}`, so the log still says what was removed. Shared `papers` rows stay; they are
   a cache used by other reviews.
2. After the commit, deletes the review's Redis event stream (`stream_key`), and enqueues a new worker job
   `delete_checkpoint` that calls the worker's `AsyncPostgresSaver.adelete_thread(str(review_id))`. Both are
   best-effort: a failure is logged and the delete still answers 204.

A deleted review is gone from the result cache too, because `find_reusable` reads `reviews`.

## 9. Frontend

Routes under `frontend/src/app/admin/`:
- `page.tsx`: the sign-in form.
- `layout.tsx`: `robots: {index: false, follow: false}` metadata, the admin nav (Dashboard, รีวิว, API keys,
  Audit log, ออกจากระบบ), and a client guard that calls `GET /me`. A 401 shows the sign-in page.
  A 404 means the page is not behind the single origin, so it shows
  "หน้า admin ใช้ผ่านที่อยู่หลักของเว็บเท่านั้น" with the reason.
- `dashboard/page.tsx`: totals, an echarts stacked bar of reviews per day by status with the daily cost as a line,
  the `by_model` table, and the capacity block (accepting or not, the queue, and today's reviews and spend against
  their caps, all from the dashboard payload).
- `reviews/page.tsx`: search box, status and listed filters, a table with "โหลดเพิ่ม" paging, and row actions
  (ยกเลิก, ซ่อน or แสดง, ลบ). Each topic links to `/r/{id}`.
- `keys/page.tsx`: the key table, a mint form whose result shows the raw key once with `CopyText` and a warning
  that it will not be shown again, inline quota and name edits, and revoke.
- `audit/page.tsx`: the log, newest first, with before and after shown as a compact diff.

Destructive actions (ลบ, revoke) ask again inside the page with a second confirm button. They never use the browser's
`confirm()`.

Client code:
- `src/lib/admin-api.ts`: `fetch` with relative URLs, `credentials: "same-origin"`, and `X-MRA-Admin: 1` on writes.
  It maps 401, 403, 404, 409 and 429 to typed errors; a 429 shows the wait from `Retry-After`.
- `src/lib/admin-types.ts`: the payload types.

The pages follow `DESIGN.md`. Labels are Thai with English technical terms, as the rest of the site. Nothing here
renders a number from a paper, so the `VerifiedNumber` and `ComputedNumber` rules do not apply. Costs and counts
are plain figures.

**Same origin.**
- Production and docker: Caddy already sends `/api/*` to the API, so `/admin` on the site address works unchanged.
- `next dev` only: `next.config.ts` adds a rewrite of `/api/v1/admin/:path*` to `ADMIN_DEV_API_URL`
  (default `http://localhost:8000`) when `NODE_ENV === "development"`. A standalone build carries no such rewrite.
- Opening the web container directly (`:3000` in docker) gets the 404 message above.

## 10. Testing

Backend (unit, sqlite plus the fake Redis already in `tests/conftest.py`):
- Hashing round trip, rehash on sign-in, length limits, username rules.
- CLI: `create`, `passwd` (ends sessions), `disable`/`enable`, `list`, each with an audit row.
- Sessions: create, load, TTL set, sign-out, `passwd` and `disable` end all sessions, a disabled user's cookie gets 401.
- Sign-in: wrong password 401; the 5th failure locks the username and the IP, then 429 with `Retry-After` even for
  the right password; an unknown user takes the dummy-hash path; success clears the username counter only; missing
  `X-MRA-Admin` 403.
- `require_admin`: cookie, admin key, non-admin key (403), invalid key (401), no credentials (401), CSRF header
  rule for cookie writes only.
- Every write route writes exactly one audit row with the right actor, action, before and after, and never a secret.
- Reviews: search and filters, paging, cancel through the service (event emitted with `by: admin`), hide/show, delete
  of a finished review (rows gone, stream deleted, checkpoint job enqueued), delete of a running review 409.
- Keys: mint returns the raw key once and stores only its hash, update, revoke idempotent, update of a revoked key 409.
- Dashboard: zero-filled days, status tallies, `error_rate_7d` (null on no data), `by_model` grouping with "unknown".
- OpenAPI: no path under `/api/v1/admin` in `/api/openapi.json`.
- Migration upgrade and downgrade (integration, Postgres).

Frontend:
- Vitest for `admin-api.ts` (header on writes, error mapping) and for each page (renders data, actions call the API,
  the second confirm, the key shown once, the 404 message).
- One Playwright flow against the docker stack through Caddy: sign in, see the dashboard, mint a key, revoke it, see
  both in the audit log, sign out.

## 11. Docs

- `docs/api.md`: an "Admin API" section (sign-in, cookie, CSRF header, routes, that they are not in OpenAPI).
- Root `CLAUDE.md`: one convention line on admin auth (the cookie or an admin key through `require_admin`,
  the audit row in the same transaction, routes hidden from OpenAPI).
- The operator note in the README or deploy doc: create the first admin with
  `docker compose exec api python -m app.cli.admin create --username <name>`.
- Roadmap row 23: 23a done, when it is.

## 12. Risks

- **A stolen cookie** is good for up to 8 hours. HttpOnly limits script theft, and `passwd` or `disable` ends it.
- **Lockout as a nuisance:** anyone can lock a known username for 15 minutes. That is acceptable for a few admins;
  admin keys still work during a lockout.
- **Dev versus production paths:** the dev rewrite exists only in `next dev`, so production depends on Caddy routing
  `/api/*`, which it already does. The Playwright flow runs through Caddy to cover that path.
