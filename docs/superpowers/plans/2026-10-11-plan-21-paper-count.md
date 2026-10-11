# Plan 21: user-chosen paper count (5–50) over a pool of about 120 candidates

**Request (2026-10-11):** "ระบบไปค้นหาและทำการวิเคราะห์คัดกรองบทความที่เกี่ยวข้องที่สุดที่จะถูกนำมาวิเคราะห์ตามที่ผู้ใช้กำหนดได้สูงสุด 50 ฉบับ".
An earlier request said "ดึงข้อมูลเก็บราว 120 ฉบับที่มีบทคัดย่อ".

**Builds on:**
- Plan 5 (abstract-only): `max_papers` / `candidate_limit` and the ≥150-character abstract rule.
- Plan 7 (capacity and per-review budget).
- Plan 11 (the agent stage).
- Plan 20 (report Methods and PRISMA).

Base: master at `07164f0`.

## Context: what exists today

The count field already exists end to end. This plan extends it and adds nothing in parallel.

- **Option.** `backend/app/schemas/review.py` `ReviewOptions`:
  - `max_papers: Field(30, ge=5, le=30)`;
  - `candidate_limit: Field(60, ge=20, le=100)`;
  - the validator `candidate_limit >= max_papers`;
  - `ReviewOptions.clamped()`, used by MCP and by graph state stored under older ranges.
- **`/status`.** `ReviewService.status()` (`app/services/review_service.py`) already publishes `limits.max_papers` and
  `limits.candidate_limit` as `{min, max, default}`, read from the `ReviewOptions` field metadata. Changing the field
  therefore changes `/status`. The tests pin the old values: `test_capacity.py:59` and `test_reviews_api.py:28,71-75`.
- **MCP.** `app/mcp/server.py` `start_review(max_papers: int = 30)` clamps through `ReviewOptions.clamped`. Its
  docstring and the server instructions say "screens about 60" and "best 5-30".
- **Pool cut.** `retrieval.make_enrich` keeps `enriched[: options.candidate_limit]`: on-focus first, in search rank
  order, abstract ≥150 characters. The SearXNG search covers up to 4 planner queries (5 for meta-analysis) over 8
  engines, with `searxng_pages` 1 (meta-analysis: 2). Nothing guarantees 120 candidates with usable abstracts.
- **Top N.** `screening.make_select_top` ranks the included papers and takes `ranked[: options.max_papers]`. It
  already records `selection_stats.over_limit`. When fewer than N qualify, it already analyses only what qualifies:
  there is no padding.
- **Prompts.** No prompt mentions 30, 60 or the count. The screen, extract and narrative prompts do not need to change,
  so the SLR sha256 pins in `tests/unit/test_prompts_by_type.py` stay as they are.
- **Budget.**
  - `ReviewBudget(cap_usd=settings.max_cost_per_review_usd)` is a flat $0.25 per review. `app/worker/tasks.py:23`
    passes it to `ReviewRunner(cost_cap_usd=…)`.
  - `Capacity.check()` reserves `(queued + running + 1) × max_cost_per_review_usd` against `max_usd_per_day`.
- **Other limits.**
  - The worker has `job_timeout = 1800` and `stale_running_minutes = 30`. LLM calls share `LLM_CONCURRENCY` 16 per
    process.
  - Localization uses 15-item chunks, then retries up to `RETRY_MAX_ITEMS = 60` items in 5-item chunks
    (`app/harness/localize.py`).
  - Citations: OpenAlex runs batched; Europe PMC references run per paper at `CONCURRENCY = 3`. The whole step has
    `citations_timeout_seconds = 20` (`app/graph/nodes/citations.py`).
- **Stub graph.** `app/graph/nodes/stubs.py` has `MAX_CANDIDATES = 60` and `MAX_KEPT = 30`.
  `app/graph/nodes/stub_result.py:204` hard-codes `limits` as 60/30.
- **Report.**
  - Methods (`frontend/src/components/review/methods-section.tsx`) has a `max` line, "วิเคราะห์สูงสุด {n} ฉบับ".
  - PRISMA (`frontend/src/lib/prisma-flow.ts`) has `over_limit`, "เกินจำนวนที่วิเคราะห์ (สูงสุด N)".
  - Both read `result.methods.limits.max_papers`, falling back to `review.options.max_papers`.
- **Frontend counts that are hard-coded today:**
  - `request-slip.tsx:112` (`useState(30)`) and `:267` (`min={5} max={30}`);
  - `landing/timeline.tsx:7-8` ("เก็บราว 60 ฉบับ", "เลือกไว้สูงสุด 30 ฉบับ");
  - `app/about/page.tsx`: lines 20 and 77-78 ("ราว 60 ฉบับ", "สูงสุด 30 ฉบับ"), line 133 ("5–30") and line 144
    ("60 ฉบับ (ปรับได้ 20–100) … สูงสุด 30 ฉบับ (ปรับได้ 5–30)");
  - the stage geometry caps: `lib/agent-layout.ts:41` `MAX_SLOTS = 30`, `lib/agent-scene.ts:86` `MAX_SLOTS = 30`,
    `lib/agent-layout-3d.ts:55` `PILE_CAP = 30`, and `components/review/team/team-stage.tsx:28`
    (`Math.min(n, 30)`) and `:71` (`fixedRows ? 3`);
  - the e2e mock `/status` (`e2e/mock-api.ts:20`) and test fixtures.
  - The live stage's spoken text ("อ่านเสร็จ x จาก y ฉบับ", "ผ่าน a · ตัดออก b") is built from events, so it is
    already dynamic. Only the geometry caps limit it.

## Decisions made in this plan

1. **The count field is `max_papers`, now 5–50 with default 30.** It stays the one user-facing field. The UI label
   changes from "(สูงสุด)" to the requested count.
2. **The pool is `candidate_limit`, default 120, range 20–120.** The maximum equals the default, so the pool is fixed at
   about 120 for the web and MCP callers, who never send `candidate_limit`. REST callers may still lower it, which keeps
   old clients and tests valid. The validator `candidate_limit >= max_papers` stays.
3. **The pool is filled by a bounded top-up inside `enrich`, not by a new graph node.** When fewer than
   `candidate_limit` candidates have usable abstracts after page 1, `enrich` fetches the next SearXNG page of each
   planner query once, up to `searxng_pages_max` (default 2; meta-analysis already reads 2 pages, so its top-up reads
   page 3). It then merges, looks up and filters again. The graph shape and the SSE event set stay unchanged; only
   counts change. PRISMA "identified" includes the top-up hits.
4. **The per-review cost cap scales with N and the pool:**
   `cap(N, C) = review_cost_base_usd + review_cost_per_paper_usd × N + review_cost_per_candidate_usd × C`.
   - The defaults are 0.04, 0.006 and 0.0005, so cap(30, 60) = $0.25, today's cap, and cap(50, 120) = $0.40.
   - Task 2 re-calibrates these from logged `cost_usd`.
   - The admission reservation uses the worst case `cap(max_papers.max, candidate_limit.default)` for reviews already
     admitted (their options are not loaded), and the request's own cap for the new review. This is conservative and is
     named under Risks.
5. **No prompt changes.** The SLR pins hold. `prompt_version` is bumped (`2026-10-11.1`) because the pipeline
   behaviour changes (pool size and top-up), so cached results from the 60-candidate pipeline are not served for a new
   request.
6. **The shortfall is reported, never padded.**
   - `selection_stats` gains `requested` (= `max_papers`) and `eligible` (= `len(ranked)`).
   - The `screened` SSE event gains `requested`. This is an additive field, documented.
   - The report says "ขอ N ฉบับ ผ่านเกณฑ์ E ฉบับ จึงวิเคราะห์ A ฉบับ" whenever A < N.
7. **The UI never hard-codes limits.** `src/lib/server-api.ts` gains `getServerStatus()`: a server-side fetch with
   `revalidate: 60` and a short timeout that returns null on failure.
   - The landing page and the About page pass `limits` down.
   - The slider's min, max and default come from `limits.max_papers`.
   - When the status is unknown, the slider is not rendered, and the request omits `max_papers` so the API default
     applies.
   - The copy then uses number-free wording ("ตามจำนวนที่ระบบกำหนด").
8. **The stage geometry cap rises to 50.** It is a layout capacity, not a policy limit. A unit test asserts that it is
   at least the mock `/status` `max_papers.max`, so a later raise fails loudly. Reserved placeholder rows come from the
   review's requested `max_papers` (`ceil(N/10)`, at least 3), not a constant 3.

## Global constraints

- **Abstract only.** No full-text fetching or crawling, and no new sources. Candidates need ≥ 150 abstract characters
  (`MIN_ABSTRACT_CHARS`). The top-up reads more SearXNG result pages of the same queries, nothing else.
- **Number honesty.**
  - Paper numbers are verified against the abstract (`app/harness/verify.py`); unverifiable numbers are nulled.
  - Counts of studies stay plain figures; nothing here is a `ComputedNumber`.
  - The report states the requested N, the screened count and the analysed count exactly as recorded.
  - A shortfall is stated, never padded and never hidden.
  - A missing count renders as absent, never as a guess.
- **Prompt pins.** The SLR prompt sha256 pins in `tests/unit/test_prompts_by_type.py` must not change. No task edits
  `app/graph/prompts.py`. If an implementer finds that one must change, they stop and get the user's approval first,
  then re-pin with a dated comment that gives the justification, as the Plan 19 and 20 pins do.
- **Limits come from `GET /api/v1/status`.** Never hard-code 5, 50, 30, 120 or 60 in UI copy, docs prose or MCP
  docstrings. The exceptions are:
  - the `ReviewOptions` field definitions, which are the single source;
  - the docs' JSON examples, which must match it;
  - test fixtures.

  The MCP docstring may state the range only if it is formatted from `ReviewOptions` at import time.
- **Service layer.** REST and MCP stay thin adapters over `ReviewService`; validation lives in `ReviewOptions`.
- **Conventions (CLAUDE.md).**
  - Progress goes only through `progress_writer()`.
  - Repositories never commit.
  - LLM calls go through `LimitedLLM` and the harness.
  - Redis uses `decode_responses=True`.
  - Translation comes last, and numbers survive it.
- **Design (DESIGN.md).** Theatre Green, 44 px targets, Thai body text at 17px/1.75, no horizontal scroll at 390 px,
  axe clean in light and dark.
- **Git.** Edit/Write only (LF). Stage only the files you touched. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One commit per task at least, on a `plan-21-paper-count`
  branch, merged to master at the end.
- **Gates.**
  - Backend: `cd backend && uv run pytest -q && uv run ruff check .`.
  - Frontend: `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`.
  - Run integration tests (`MRA_INTEGRATION=1`) where a task touches retrieval.

---

## Task 1: Backend options, scaled cost cap and `/status`

**Files**
- `backend/app/schemas/review.py`
- `backend/app/config.py`
- `backend/app/services/budget.py`
- `backend/app/services/capacity.py`
- `backend/app/services/review_service.py`
- `backend/app/worker/runner.py`
- `backend/app/worker/tasks.py`
- `backend/app/graph/nodes/stubs.py`
- `backend/app/graph/nodes/stub_result.py`
- Tests: `tests/unit/test_reviews_api.py`, `test_capacity.py`, `test_budget.py`, `test_runner.py`,
  `test_stub_timeline.py`, `test_nodes_screening.py`, `test_plan20_answer.py`

**Behaviour**
- `ReviewOptions`:
  - `max_papers: Field(30, ge=5, le=50)` and `candidate_limit: Field(120, ge=20, le=120)`;
  - update the class comment;
  - `clamped()` needs no change, because it reads the metadata.
  - A stored option of `candidate_limit: 60` (an old review being resumed) still validates.
- `config.py` adds `review_cost_base_usd = 0.04`, `review_cost_per_paper_usd = 0.006` and
  `review_cost_per_candidate_usd = 0.0005`. It keeps `max_cost_per_review_usd` only as a hard ceiling (raised to 0.60)
  that no computed cap may exceed.
- `budget.py` adds `review_cost_cap(settings, options) -> float`, implementing the formula above, capped by
  `max_cost_per_review_usd`.
- `ReviewRunner` takes `settings` (or a `cap_for(options)` callable) instead of a fixed `cost_cap_usd`, and builds
  `ReviewBudget(cap_usd=review_cost_cap(settings, ReviewOptions.clamped(options)))`. `tasks.py` passes it. The
  "None → uncapped" path stays for tests.
- `Capacity.check(queued, running, this_cap: float | None = None)` computes:
  - `reserved = (queued + running) × worst_cap + (this_cap or worst_cap)`;
  - `worst_cap = review_cost_cap(settings, ReviewOptions(max_papers=<le>, candidate_limit=<default>))`.

  `ReviewService.create` passes the request's cap; `status()` passes none.
- `/status`: `limits.max_papers` becomes `{min: 5, max: 50, default: 30}` and `limits.candidate_limit` becomes
  `{min: 20, max: 120, default: 120}`. No other change.
- Stub:
  - `MAX_CANDIDATES` and `MAX_KEPT` come from the `ReviewOptions` field bounds (`le`), not literals.
  - `stub_result.py` `limits` come from the effective options.
  - The stub timeline at N=50 still finishes within `STUB_DELAY_SECONDS` × (1 ± 0.2).

**Tests first**
- `test_reviews_api.py`:
  - the default request stores `max_papers == 30` and `candidate_limit == 120`;
  - `max_papers` 50 is accepted, while 51 and 4 return 422;
  - `candidate_limit` 121 and 19 return 422;
  - `{max_papers: 50, candidate_limit: 40}` returns 422.
- `test_capacity.py`:
  - the status limits are as above;
  - the reservation uses the worst case for queued and running reviews and the own cap for the new one: with
    `max_usd_per_day` set so that exactly k worst-case reviews fit, the (k+1)th is refused with `daily_budget`.
- `test_budget.py`:
  - `review_cost_cap(…, N=30, C=60) == 0.25`, `(50, 120) == 0.40` and `(5, 120) == 0.13`;
  - the ceiling clamps.
- `test_runner.py`: a review with `max_papers` 50 runs under the cap(50, 120) budget; a legacy options dict
  `{max_papers: 10}` runs under cap(10, 120).
- `test_stub_timeline.py`: at `{max_papers: 50}` the stub emits 50 `extracted` events and `screened {kept: 50, total: 120}`.
- `ReviewOptions.clamped({"max_papers": 99})` gives 50, and `clamped({"max_papers": 3, "candidate_limit": 10})` gives
  `(5, 20)`, which matches today's behaviour.
- Update the expectations in `test_nodes_screening.py:136` ("default max_papers 30") and in `test_plan20_answer.py:203`
  to the new defaults.

**Acceptance**
- The backend gates are green.
- `GET /api/v1/status` shows 5/50/30 and 20/120/120.
- The flat `cost_cap_usd` is no longer read anywhere (`rg cost_cap_usd backend/app` finds only the runner's
  test-compat path).

---

## Task 2: Engine (pool of about 120, top-N selection, shortfall stats, scaling)

**Files**
- `backend/app/graph/nodes/retrieval.py`
- `backend/app/graph/nodes/screening.py`
- `backend/app/graph/nodes/synthesis.py` (stats pass-through only)
- `backend/app/graph/nodes/citations.py`
- `backend/app/harness/localize.py`
- `backend/app/config.py`
- `backend/app/services/llm.py` (docstring only)
- Tests: `tests/unit/test_nodes_retrieval.py`, `test_nodes_screening.py`, `test_review_graph.py`, `test_localize*.py`
  (whichever holds the retry tests), `test_citations*.py`
- Integration: `tests/integration/test_pool_size.py` (new, `-m integration`)

**Behaviour**
1. **Top-up in `enrich`.**
   - Read `settings.searxng_pages_max` (new, default 2; meta-analysis uses `max(searxng_pages_meta + 1, …)`).
   - If `len(enriched) < options.candidate_limit` after filtering, and pages remain, search the next page for each plan
     query, under the same `SEARXNG_CONCURRENCY` gate.
   - Merge with `merge_candidates` (rank order: page-1 hits first), look up only the new non-enriched hits in Europe
     PMC, and re-apply the year, non-research, abstract and focus filters.
   - Do this at most once per review.
   - Update `search_stats.found` and `per_source` with the top-up hits so PRISMA "identified" stays honest.
   - Record `{"stage": "enrich", "topup_pages": n, "topup_found": k, …}` in `quality`.
   - Failures are soft and go to `errors`, as for page-1 searches.
   - Emit no new event type. `enriching {candidates}` still reports the final pool size.
2. **Selection.**
   - `select_top` keeps `ranked[: options.max_papers]`.
   - It adds `requested: options.max_papers` and `eligible: len(ranked)` to `selection_stats`, plus `requested` in the
     `screened` progress payload.
   - It never pads: a test asserts `len(selected) == min(N, eligible)`.
   - The synthesis/finalize stats builder passes `requested` and `eligible` through to
     `result.stats.excluded_selection`, next to `over_limit`.
3. **Scaling at N=50 and C=120.**
   - Screening: 12 batches of 10, as today; the batch size is unchanged.
   - Localization: `RETRY_MAX_ITEMS` becomes `max(60, 2 × len(selected))`, a function of the paper count, so the retry
     pass still covers a 50-paper Thai report. Keep 15-item first-pass chunks and 5-item retry chunks.
   - Citations:
     - Europe PMC references `CONCURRENCY` rises from 3 to 5.
     - The step timeout scales: `citations_timeout_seconds + 0.3 s × papers`, capped at 40 s.
     - It stays soft-fail with partial coverage.
     - OpenAlex is already batched (one call per 50 ids); keep `OPENALEX_SHARE`.
   - Synthesizer: measure the prompt size of 50 cards (`narrative_user`) in a unit test with realistic cards. It must
     stay under 60k characters. If it does not, cap the per-card text fed to the narrative, not the prompt template.
   - Job and stale timeouts: keep `job_timeout = 1800` and `stale_running_minutes = 30` unless the measurement in
     Task 6 shows a p95 above 900 s. Record the measured numbers in the task's commit message.
4. **Calibration.**
   - From the `cost_usd` and `quality` logged by one real run each at N=30 and N=50, update the three cost settings so
     that cap ≥ 1.5 × the observed spend.
   - Ask the user before spending: a real run costs about $0.2–0.4 on the `budget` preset.
   - Bump `prompt_version` to `2026-10-11.1`.

**Tests first**
- `test_nodes_retrieval.py`:
  - **Top-up runs when short:** fake SearXNG page 1 gives 40 usable and page 2 gives 90, so the pool is 120, `found`
    includes both pages and `quality` records `topup_pages == 1`.
  - **No top-up when full:** page 1 gives 130 usable; no page-2 call is made and the pool is 120.
  - **Top-up at most once:** pages 1 and 2 together give 70 usable; the pool is 70, no page 3 is requested, and the
    review continues.
  - **Top-up failure is soft:** an error is recorded and the pool keeps the page-1 hits.
  - Meta-analysis reads page 3 only when short after its 2 pages.
- `test_nodes_screening.py`:
  - **Analyses N of many:** 80 eligible, N=50, so 50 are selected, `over_limit == 30`, `eligible == 80` and
    `requested == 50`.
  - **Shortfall:** 22 eligible, N=50, so 22 are selected, `over_limit == 0` and `eligible == 22`.
  - The `screened` progress payload carries `requested`.
- `test_review_graph.py`: an end-to-end fake run at `{max_papers: 50, candidate_limit: 120}` analyses 50 papers within
  the cap(50, 120) budget. The existing cost-cap test still finishes "with what it has".
- `test_localize*.py`: with 50 papers' items left in English, the retry pass covers 100 items.
- `test_citations*.py`:
  - 50 papers with a slow fake Europe PMC finish inside the scaled timeout;
  - a hanging one gives `partial: true`, never an exception.
- The prompt pins test passes unchanged; do not touch it.
- Integration (`MRA_INTEGRATION=1`, docker SearXNG): 3 fixed topics (a drug, a screening test, a qualitative topic) log
  the pool size, `topup_pages` and the share reaching 120. The test only asserts the pool is greater than 0 and at most
  120. The numbers go in the commit message and drive whether `searxng_pages_max` should be 3.

**Acceptance**
- The gates are green and the pins are unchanged.
- A fake N=50 run selects exactly `min(50, eligible)`.
- The stats carry `requested` and `eligible`.
- Integration numbers are recorded.

---

## Task 3: REST, MCP and documentation

**Files**
- `backend/app/api/reviews.py` (OpenAPI description only, if it states ranges)
- `backend/app/mcp/server.py`
- `docs/api.md`
- `CLAUDE.md`
- `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (append a dated Revision line; do not rewrite
  history)
- Tests: `tests/unit/test_mcp_server.py`, `tests/unit/test_api_docs*.py` (if any doc-parity test exists)

**Behaviour**
- REST needs no new code: validation comes from `ReviewOptions`, so 4 and 51 return 422 with the pydantic message.
- MCP `start_review`:
  - The `max_papers` default is `ReviewOptions.model_fields["max_papers"].default`, not the literal 30.
  - It is still clamped through `ReviewOptions.clamped`.
  - The docstring and server instructions are formatted from the `ReviewOptions` bounds at import, for example "screens
    about {candidate default} candidates that have abstracts and analyses the {min}–{max} most relevant (default
    {default})".
  - The decision is to keep clamping, not rejecting, for MCP, which matches the existing documented behaviour. The task
    brief says "validation 5–50": clamping into 5–50 is that validation for MCP. State this in api.md.
- `docs/api.md`:
  - lines 83-92: the example and the ranges, `max_papers` 5–50 default 30 and `candidate_limit` 20–120 default 120;
  - line 213: the `limits` note;
  - the `stats.excluded_selection` paragraph: `requested` and `eligible`;
  - line 609: the `/status` example;
  - line 636: `screened {kept, total, requested}`;
  - line 680: the MCP table row ("clamped to 5–50");
  - a short "Paper count and pool" paragraph covering the top-up, the shortfall rule and the cost cap formula, with no
    private daily figures.
- CLAUDE.md: replace "~60 candidates are screened, up to 30 analysed" with "a pool of up to 120 candidates (one
  SearXNG top-up page when short) is screened; the user picks how many are analysed (`max_papers`, limits from
  `/status`)". Add a one-line note on the scaled cost cap under Capacity and scale.

**Tests first**
- `test_mcp_server.py`:
  - `max_papers` 50 is stored as 50;
  - 99 gives 50 and 1 gives 5;
  - the default is 30;
  - the tool description contains the bounds from `ReviewOptions` (assert that it contains `str(le)`, not a literal).
- If a docs-parity test exists, extend it. Otherwise add `test_api_docs_limits.py`, which parses the `/status` JSON
  example in `docs/api.md` and compares it with `ReviewService.status()` limits for `max_papers` and `candidate_limit`.

**Acceptance**
- `rg -n "~60|about 60|5-30|5–30" backend/app docs/api.md CLAUDE.md` returns nothing that is current. Historical plan
  files are exempt.
- MCP and REST behave as documented.

---

## Task 4: Frontend form (5–50 from `/status`) and copy fixes

**Files**
- `frontend/src/lib/server-api.ts` (add `getServerStatus`)
- `src/app/page.tsx`
- `src/app/about/page.tsx`
- `src/components/landing/request-slip.tsx`
- `src/components/landing/timeline.tsx`
- `src/components/about/live-limits.tsx`
- `src/lib/types.ts` (`selection_stats` / `excluded_selection` `requested` and `eligible`; the `screened` event
  `requested`)
- Stage geometry:
  - `src/lib/agent-layout.ts`, `src/lib/agent-scene.ts`, `src/lib/agent-layout-3d.ts`;
  - `src/components/review/team/team-stage.tsx`;
  - `src/components/review/stage/stage-placeholder.tsx`.
- Tests: `request-slip.test.tsx`, `live-limits.test.tsx`, `sections.test.tsx`, `agent-layout.test.ts`,
  `agent-scene.test.ts`, `agent-layout-3d.test.ts`, `stage-placeholder.test.tsx`, `team-stage.test.tsx`

**Behaviour**
- **Status helper.** `getServerStatus()` fetches `${serverApiUrl()}/api/v1/status` with `next: { revalidate: 60 }` and a
  3 s abort, and returns `ServiceStatus | null`. Read the Next 16 docs in `node_modules/next/dist/docs/` for fetch
  caching first.
- **Landing.** `page.tsx` awaits it once and passes `limits` to `RequestSlip` and `Timeline`. `RequestSlip` keeps its
  client `getStatus()` for `accepting` and refreshes `limits` from it too.
- **Slider.**
  - min, max and the initial value come from `limits.max_papers`.
  - The label is "จำนวนงานวิจัยที่ต้องการวิเคราะห์".
  - The helper line is "ระบบคัดกรองราว {candidate_limit.default} ฉบับที่มีบทคัดย่อ แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนนี้ ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน".
  - Keep the 44 px target and the `aria-valuetext`. Add `aria-describedby` pointing to the helper line.
  - With no limits (status unknown), do not render the slider, and omit `max_papers` from the request.
  - Never `useState(30)`.
- **Timeline.** It takes `limits?: ServiceLimits`.
  - Search step: "… ตัดเรื่องซ้ำ เก็บราว {candidate_limit.default} ฉบับที่มีบทคัดย่อ".
  - Screen step: "… เลือกฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่คุณกำหนด ({min}–{max} ฉบับ ค่าเริ่มต้น {default}) …".
  - Without limits, use number-free wording.
  - The step times ("~0:40") stay. The duration line uses `TYPICAL_DURATION_TH`, which Task 6 may update from
    measurement.
- **About page.** It becomes async and server-fetches the same helper.
  - Line 20's curl example drops `max_papers` (it shows the default) or uses `{default}`.
  - Lines 77-78 and 144 are written from `limits`, with number-free fallbacks.
  - Line 133: "max_papers (ปรับให้อยู่ในช่วง {min}–{max})".
  - `LiveLimits` already reads `/status` live and stays.
- **Stage geometry.**
  - `MAX_SLOTS` in `agent-layout.ts` and `agent-scene.ts`, and `PILE_CAP` in `agent-layout-3d.ts`, become 50, exported
    as `STAGE_MAX_PAPERS` from one module, `agent-scene.ts`, and imported by the others.
  - `team-stage.tsx` uses it instead of `30`. Its `Pool` reserves `max(3, ceil(requested/10))` rows when `fixedRows`.
    The requested count comes from `review.options.max_papers` via the scene, falling back to 3 rows.
  - `stage-placeholder` computes its reserved height from the same rows, so the placeholder and the live stage still
    match. This is the existing CLS guarantee; keep its test.
  - Check that the reader-slot ref font still fits "P50": the "P30" comment in `agent-layout.ts:59` should say "P50".
  - In the wide 2D layout, 5 rows × 28 px must not overlap the next tile: extend the `agent-layout.test.ts` overlap
    test to 50 slots.

**Tests first**
- `request-slip.test.tsx`:
  - with mocked status `max_papers {min: 5, max: 50, default: 30}`, the slider has min 5, max 50 and value 30;
  - moving it to 50 submits `max_papers: 50`;
  - with status `{max: 40}` the max is 40, which shows the value is not hard-coded;
  - with the status fetch failing, no slider renders and the payload has no `max_papers`.
- `sections.test.tsx` / timeline: with limits, the text contains `120` and `5–50`; without limits, it contains no digit
  sequence for these counts.
- `agent-layout.test.ts` / `agent-scene.test.ts`:
  - 50 slots are laid out without overlap in the wide and narrow layouts;
  - a 51st is clamped;
  - `STAGE_MAX_PAPERS >= mockStatus.limits.max_papers.max` (import the e2e mock constant, or a shared fixture).
- `stage-placeholder.test.tsx`: the placeholder height for requested 50 equals the live stage height with 50 slots.
- Grep guard (a test in `copy-limits.test.ts`, or an `rg` step in the gate list):
  `rg -n "(ราว|สูงสุด|ปรับได้) ?(60|30|20–100|5–30)" src` finds nothing outside tests and fixtures.

**Acceptance**
- The landing slider runs 5–50 with default 30, all from `/status`.
- No hard-coded 60 or 30 counts remain in copy.
- The stage renders 50 readers without overlap at 1440 and 390 in 2D and 3D.
- The frontend gates are green.

---

## Task 5: Report Methods and PRISMA (requested N, screened, analysed)

**Files**
- `frontend/src/components/review/methods-section.tsx`
- `src/lib/i18n-report.ts`
- `src/lib/prisma-flow.ts`
- `src/components/review/limitations.tsx`
- Tests: `prisma-flow.test.ts`, `methods-section` tests (`report-view*.test.ts` / `i18n-report.test.ts`), fixtures in
  `src/test/fixtures.ts`

**Behaviour**
- The numbers come from:
  - `requested`: `excluded_selection.requested`, then `methods.limits.max_papers`, then `options.max_papers`;
  - `screened`: `stats.screened`;
  - `eligible`: `excluded_selection.eligible`;
  - `analysed`: `stats.selected`, or `stats.extracted` where Plan 20 already uses it.
- **Methods selection block.** Replace the `max` line with:
  - TH: "ผู้ใช้กำหนดให้วิเคราะห์ {N} ฉบับ คัดกรอง {S} ฉบับที่มีบทคัดย่อ วิเคราะห์ {A} ฉบับตามอันดับความเกี่ยวข้อง";
  - EN: "The user asked for {N} records; {S} records with abstracts were screened and {A} were analysed, in order of
    relevance".
  - When A < N, add: TH "ผ่านเกณฑ์เพียง {E} ฉบับ จึงวิเคราะห์น้อยกว่าที่กำหนด (ไม่เติมงานที่ไม่ผ่านเกณฑ์)", EN "Only
    {E} met the criteria, so fewer than requested were analysed (none were added to make up the number)".
  - Use the Plan 20 `pl()` plurals, and plain figures for counts (`<N>`).
- **PRISMA.**
  - The `over_limit` label becomes "ผ่านเกณฑ์แต่เกินจำนวนที่กำหนด ({N} ฉบับ)" / "Eligible but beyond the requested
    {N}".
  - The "included" box gets a note "ขอ {N} ฉบับ" / "{N} requested" when `requested` is known.
  - On a shortfall, the note says "ผ่านเกณฑ์ {E} จากที่ขอ {N}" / "{E} eligible of {N} requested".
  - The candidates box's `capNote` uses `candidate_limit` as now.
- **Limitations.** The "at most N" line follows the same `requested` source. On a shortfall, add the same honest sentence
  once; it is not repeated in Methods and Limitations at different numbers.
- **Legacy results** (no `requested` or `eligible`) render exactly as today: snapshot or assert unchanged text.
- The offline HTML (`build:standalone`) and print use the same components, so no separate work is needed. Confirm in
  the e2e of Task 6.

**Tests first**
- `prisma-flow.test.ts`:
  - N=50, S=120, E=80, A=50: `over_limit` 30, and the label carries 50;
  - shortfall N=50, E=22, A=22: the note carries 22 and 50, and `over_limit` 0;
  - legacy without the keys: unchanged output.
- Methods tests: the TH and EN strings for the normal and shortfall cases; no shortfall sentence when A == N.
- Fixtures: add `resultN50` and `resultShortfall` to `src/test/fixtures.ts` (stats, methods.limits `{120, 50, 150}` and
  `excluded_selection` with `requested` and `eligible`).

**Acceptance**
- The report states the requested N, the screened count and the analysed count in Methods and PRISMA, in TH and EN.
- A shortfall is stated once, consistently.
- Legacy reports are unchanged.
- axe is clean.

---

## Task 6: End-to-end, stub load sanity, screenshots and final review

**Files**
- `frontend/e2e/mock-api.ts`
- `e2e/app.spec.ts`, `e2e/team-stage.spec.ts`, `e2e/live-stage.spec.ts`, `e2e/live-stage-3d.spec.ts`
- a new `e2e/paper-count.spec.ts`
- `scripts/loadtest.py` (only if it hard-codes options)
- `frontend/src/lib/copy.ts` (`TYPICAL_DURATION_TH`, only if the measurement says so)
- CLAUDE.md (the stub event count in the Load test line)

**Behaviour and steps**
1. Update the mock `/status` to `max_papers {5, 50, 30}` and `candidate_limit {20, 120, 120}`. Update the mock event
   sequences to `enriching {candidates: 120}` and `screened {kept: 30, total: 120, requested: 30}`.
2. `paper-count.spec.ts`:
   - The slider goes from 5 to 50; submit with 50 and assert the POST body.
   - A stub run with `screened {kept: 50, total: 120}` and 50 `extracted` events renders 50 reader slots in 2D and 3D
     without overlap: take a bounding-box check of the slots.
   - The report for the `resultShortfall` fixture shows the shortfall sentence in Methods and PRISMA.
   - A status failure hides the slider and still submits.
3. Update the existing specs for the new counts, for example "ผ่านคัดกรอง 30 จาก 120 ฉบับ".
4. **Stub load sanity.** Run `docker compose up` with `GRAPH_MODE=stub STUB_DELAY_SECONDS=20`, then run
   `scripts/loadtest.py` against `:8088` with `max_papers` 50. Check that:
   - no 5xx occurs;
   - the SSE event count per review is recorded (the stub emits more than about 80 events now: update CLAUDE.md with the
     measured figure);
   - the p95 time to `done` is within 20 s × 1.2 plus queueing;
   - the Redis stream length is within `event_stream_ttl` expectations.
5. **Real-run measurement (ask the user first; it costs about $0.4).**
   - Run one real review at N=50 on the `budget` preset: record wall time, `cost_usd`, the top-up use, the localization
     retry count and citations coverage.
   - Update `TYPICAL_DURATION_TH` and the timeline step times only if they are measured to be wrong. This feeds the
     calibration in Task 2.
6. **Screenshots.**
   - Landing at 1440 and 390, light and dark: the slider at 30 and 50.
   - The live stage with 50 readers in 2D and 3D.
   - The report Methods and PRISMA in the normal and shortfall cases, TH and EN.
   - Save them under `.superpowers/plan21/shots/`.
7. **Final review.** Request a code review of the whole branch (the superpowers requesting-code-review skill), fix the
   findings, re-run all the gates, then merge `plan-21-paper-count` to master. Per memory, finish this plan, including
   its review, before starting another.

**Acceptance**
- All the gates are green, including e2e and `build:standalone`.
- The load test has no errors.
- The screenshots are reviewed against DESIGN.md.
- The measured real-run numbers are recorded in the merge commit.

---

## Risks

- **Cost.**
  - The spend per review rises about 60% at N=50 with C=120 (cap from $0.25 to $0.40). Even a review at N=5 now screens
    120 candidates (cap $0.13).
  - The daily admission reservation uses the worst-case cap, so at `max_usd_per_day = 10` it admits about 25 concurrent
    in-flight reviews instead of 40.
  - Mitigations: the calibration in Task 2, and possibly raising `max_usd_per_day`, which is the operator's call and
    out of scope.
- **Upstream rate limits at 120 candidates.**
  - The top-up doubles SearXNG requests for short pools. Each SearXNG request fans out to 8 engines.
  - PubMed E-utilities allow about 3 req/s without a key. Semantic Scholar's unauthenticated pool is small, and Crossref
    asks for polite use.
  - With `max_concurrent_reviews_per_worker = 4`, a burst of 4 reviews × 4 queries × 2 pages can trip engine
    suspensions in SearXNG, which then return empty results silently.
  - Mitigations: keep `SEARXNG_CONCURRENCY = 4` per review; the top-up runs only when short; the integration numbers
    decide `searxng_pages_max`; watch SearXNG's engine-suspended log during the load test. (The SearXNG `limiter` is off
    in `infra/searxng/settings.yml`; the untracked `limiter.toml.new` is not part of this plan.)
- **Europe PMC.** Enrichment lookups for up to about 240 raw hits are batched 40 per request, with retry and backoff.
  The references lookups grow to 50 per review, at concurrency 5 and soft-fail.
- **OpenAlex.** One batched call per 50 ids. Its share of the citation timeout is unchanged. Without
  `OPENALEX_API_KEY`, the polite pool can still throttle; coverage then degrades to null, which is honest.
- **Worker timeouts.**
  - A real run at N=50 is expected at about 3–5 min against `job_timeout` 1800 s and `stale_running_minutes` 30.
  - The synthesizer (180 s timeout on `budget`) gets a larger prompt with 50 cards: the size test in Task 2 guards it.
  - Localization of 50 papers' items into Thai is the long pole after reading; the retry cap scales.
- **LLM concurrency.** `LLM_CONCURRENCY` 16 per process is shared by 4 concurrent reviews. At N=50, 100 extractor calls
  queue behind it, so the wall time rises but the providers' rate limits are respected. No change is planned; record the
  measured time.
- **Pool may not reach 120.** Narrow topics yield fewer usable abstracts even after the top-up. This is reported
  honestly through PRISMA ("with abstract" and the candidate counts); there is no padding, and no search outside the 8
  engines.
- **Stage layout.** Five rows of reader slots enlarge the reserved stage height for N > 30. The CLS guarantee depends
  on the placeholder reading the requested N; the tests in Task 4 pin it.
