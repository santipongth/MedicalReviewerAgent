# Plan 5: Abstract-only reading, 60→30 selection, model retune

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, chosen for Plans 2–4). Steps use `- [ ]`.

**Goal:** Replace full-text reading with abstract-only extraction of up to 30 papers (screened from ~60 candidates). Remove the whole full-text/crawling stack. Retune the budget preset so a review finishes in about 1–3 minutes with working Thai output.

**Why (user decision 2026-10-05):**
- The first real OpenRouter run (full-text design, budget preset) finished `done` with 87.5% verified numbers at $0.068, but took 1,451 s.
- Full-text reading accounted for 454 s of that (the slowest paper).
- Thai localization silently stayed English. 63 items were kept in English because 60-item batches overflow `max_tokens` 8192 and fail as invalid JSON.
- Measured on one real paper, extraction took 9.6 s with gemini-3.1-flash-lite (1 failed number check) against 86 s with deepseek-v4-pro (5 failed).
- Localizing 15 items took 9 s with gemini-3.1-flash-lite against 74 s with qwen3.8-flash.
- The user chose:
  - analyze 30 abstracts
  - retune the models per these measurements
  - delete the full-text code entirely

**Architecture:** the graph shape is unchanged: guard → refine → plan → search → enrich → screen* → select_top → read_paper* → normalize → conflicts* → narrative → localize → finalize.
- `enrich` keeps only candidates with a usable abstract.
- `read_paper` extracts from `title + abstract` only.
- A process-wide LLM concurrency limiter keeps 30 papers × 2 extractors from tripping OpenRouter 429s.
- Localization runs in small chunks in parallel.

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. This plan revises §1, §4, §4.1 and §5; the revision is recorded in Task 5.

## Global Constraints
- Numbers shown to users must be verified against the paper text, which is now the abstract (`app/harness/verify.py`). Unverifiable numbers are nulled, never guessed.
- No full-text fetching of any kind:
  - no Crawl4AI
  - no Europe PMC fullTextXML
  - no Unpaywall
  - no publisher URLs fetched by the worker
- Defaults:
  - `candidate_limit` 60 (range 20–100)
  - `max_papers` 30 (range 5–30)
  - `candidate_limit >= max_papers`, otherwise 422
- Structured LLM calls still go through `app/services/llm.py` and the harness runner. Prompts are English; translation happens last.
- Public users still cannot choose models.
- Old stored results with `fulltext_source`, `fulltext_url` and `stats.with_fulltext` must still render.

## Review Focus
1. **Missing or short abstracts.** A candidate whose abstract is missing or under 150 characters never reaches screening. If fewer than `max_papers` candidates qualify, the review completes with fewer.
2. **Concurrency.** Thirty papers with dual extraction, plus escalations, keep at most `llm_concurrency` requests in flight per worker process. A 429 that survives retries becomes a per-paper error, never a crashed review.
3. **Localization failures stay local.** If one localization chunk fails, only that chunk stays English; the other chunks are still translated.
4. **Legacy results.** Old results carrying `fulltext_source`, `fulltext_url` and `with_fulltext` render without errors.
5. **Wells on phones.** The live-run wells grid at 60 candidates fits a 390 px phone without horizontal scroll.

---

### Task 1: Remove the full-text stack; read abstracts

**Files:**

Delete:
- `app/services/{crawler,crawl_policy,fulltext,fulltext_cache,quality,sections,jats,unpaywall}.py`
- their tests: `tests/unit/{test_crawler,test_crawl_policy,test_fulltext,test_sections_quality,test_europepmc_jats}.py`. Keep any non-JATS Europe PMC cases in `test_europepmc.py`.
- `tests/integration/test_crawl4ai_live.py`
- `tests/fixtures/crawl4ai_*.json`

Modify:
- `app/services/europepmc.py`: drop `fulltext_xml`.
- `app/services/paper_search.py`: drop `fulltext`.
- `app/api/papers.py`: drop `GET /papers/fulltext/{pmcid}`.
- `app/mcp/server.py`: drop the `get_fulltext` tool and its mention in the instructions.
- `app/config.py`: drop `contact_email`, `unpaywall_url`, `max_fulltext_chars`, `fulltext_timeout_seconds`, `crawl_*`, `crawl4ai_*`, `fulltext_cache_days` and `max_crawl_urls_per_paper`.
- `app/services/http.py`: drop the unpaywall interval.
- `app/infra.py`.
- `app/graph/graph.py`: drop `GraphDeps.fulltext`.
- `app/graph/factory.py`: `close_graph_deps` becomes a no-op, kept for callers.
- `app/worker/settings.py`: drop the `crawling` log field.
- `app/graph/nodes/reading.py`.
- `app/graph/prompts.py`: in `EXTRACT_SYSTEM`, the paper text is the title and abstract, and limitations mention abstract-only evidence when relevant.
- `app/graph/nodes/synthesis.py`: drop `FULLTEXT_SOURCES`, the `fulltext_*` fields in result papers and `stats.with_fulltext`. `_brief` gets `text_source: "abstract"`.
- `app/harness/quality.py`: drop `fulltext_timeouts`.
- `app/graph/state.py`: update the comment.
- `tests/integration/test_sources_live.py`: drop the JATS case.
- the affected unit tests.

Migration:
- `migrations/versions/<rev>_drop_paper_fulltext_source.py` drops `papers.fulltext_source`. `oa_url` stays as a link.

**Interfaces:**
- Produces:
  - `reading.paper_text(cand: Candidate) -> str | None` returns `"{title}\n\n{abstract}"`, or None when there is no abstract.
  - Result paper entries carry `{ref, candidate→flattened fields, relevance, screen_reason, card, card_en, verification, error}`, with no `fulltext_*`.
  - The progress event `extracted` carries `{ref, ok, verified, uncertain}`, with no `source`.
- Consumes: `Candidate.abstract`, the longest of the merged abstracts (from `dedupe`).

- [ ] **Step 1: Failing tests**

  Rewrite `tests/unit/test_nodes_reading.py`:
  - `test_reads_title_and_abstract_only`: GraphDeps has no `fulltext`. The fake extractor receives a user prompt containing the abstract and `"text_source": "abstract"`.
  - `test_quote_verified_against_abstract`: an effect whose quote is in the abstract is kept. A number not in the abstract is nulled and listed in `verification.unverified`.
  - `test_no_abstract_is_an_error_not_a_crash`: a candidate without an abstract gives `card=None` and error `"no abstract"`, with no LLM call.

  In other files:
  - `test_api_has_no_fulltext_route` (in `test_papers_and_report.py`): `GET /api/v1/papers/fulltext/PMC1` returns 404.
  - `test_mcp_tools` (in `test_mcp_server.py`): the tool set is exactly `{search_papers, start_review, get_review_status, get_review_result}`.
- [ ] **Step 2:** Run `uv run pytest tests/unit/test_nodes_reading.py -q`. Expected: FAIL, because `fulltext` is still required and `source` is still in the prompt.
- [ ] **Step 3:** Implement the changes and delete the files. In `read_paper`:
  ```python
  text = paper_text(cand)
  if text is None:
      writer({"type": "extracted", "ref": paper["ref"], "ok": False, "verified": 0, "uncertain": False})
      return {"papers": [{**entry, "error": "no abstract"}], "errors": [f"no abstract for {paper['ref']}"], ...}
  user = prompts.extract_user(question=..., outcomes=..., candidate=..., source="abstract", text=text)
  ```
  The rest of the harness path is unchanged: primary, secondary, compare, escalate, then null_unverified_numbers.
- [ ] **Step 4:** Add Alembic revision `drop_paper_fulltext_source`. Its downgrade re-adds the column as nullable `String(32)`. Then run `uv run alembic upgrade head` against the compose Postgres.
- [ ] **Step 5:** Run `uv run pytest -q` and `uv run ruff check .`. Expected: all pass. `grep -rniE "crawl|fulltext|jats|unpaywall" app` matches only migration history.
- [ ] **Step 6:** Commit `refactor(review): read abstracts only; remove the full-text and crawling stack`.

### Task 2: 60 candidates → 30 abstracts

**Files:**
- `app/schemas/review.py`
- `app/graph/nodes/retrieval.py` (enrich)
- `app/graph/nodes/synthesis.py` (stats)
- `app/cli/models.py` (`TYPICAL_CALLS`)
- tests: `test_reviews_api.py`, `test_nodes_retrieval.py`, `test_models_cli.py`

**Interfaces:**
- Produces:
  - `ReviewOptions(max_papers=30 [5..30], candidate_limit=60 [20..100])` with a `model_validator`: `candidate_limit < max_papers` raises ValueError, which becomes a 422.
  - `retrieval.MIN_ABSTRACT_CHARS = 150`.
  - `search_stats` gains `with_abstract`: the count after the abstract filter and before the cut.
  - Result `stats = {found, unique, with_abstract, candidates, screened, selected, extracted}`.

- [ ] **Step 1: Failing tests**
  - `test_defaults_60_and_30`
  - `test_candidate_limit_below_max_papers_is_422`
  - `test_out_of_range_422` (max_papers 31; candidate_limit 101)
  - `test_enrich_drops_missing_and_short_abstracts`: of 3 candidates with abstracts of None, 80 chars and 400 chars, only the 400-char one is kept, and `with_abstract == 1`.
  - `test_enrich_keeps_rank_order_among_abstract_holders`
  - `test_models_check_typical_calls_60_30`: the extractor row assumes 30 calls of 1,200 input tokens.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `enrich` filters with `c.abstract and len(c.abstract.strip()) >= MIN_ABSTRACT_CHARS` after the year filter, then applies the `candidate_limit` cut. Remove the no-abstract sort line.
  - New `TYPICAL_CALLS` (calls × input / output tokens):

    | Role | Calls | Input | Output |
    |---|---|---|---|
    | screener | 6 | 6000 | 900 |
    | extractor | 30 | 1200 | 700 |
    | extractor_secondary | 30 | 1200 | 700 |
    | screener_secondary | 8 | 3000 | 500 |
    | conflict_explainer | 4 | 6000 | 600 |
    | localizer | 8 | 1500 | 2000 |
    | synthesizer | 1 | 20000 | 3000 |
    | normalizer | 1 | 6000 | 2000 |
    | escalation | 4 | 3000 | 1000 |
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: pass.
- [ ] **Step 5:** Commit `feat(review): screen 60 candidates with abstracts and analyse up to 30`.

### Task 3: Throughput: LLM concurrency limit, parallel localization, budget retune

**Files:**
- `app/services/llm.py`: `LimitedLLM` and `build_llms`
- `app/config.py`: `llm_concurrency: int = 8`
- `app/harness/localize.py`: chunks of 15, run with `asyncio.gather`
- `config/llm.yaml`
- tests: `test_llm_limit.py` (new), `test_localize.py`, `test_llm_config.py`

**Interfaces:**
- Produces:
  - `LimitedLLM(inner: StructuredLLM, sem: asyncio.Semaphore)`: `ainvoke(system, user)` runs under the semaphore, and the `model`/`role` attributes are forwarded.
  - `build_llms` wraps every role, including escalation and secondaries, with ONE shared semaphore per `build_llms` call.
  - `localize_strings(..., chunk_size=15)` runs its chunks concurrently. The return contract is unchanged.

Budget preset after the change:

| Role | Model | Settings |
|---|---|---|
| guard, screener | `google/gemini-2.5-flash-lite` | unchanged |
| refiner, planner | `google/gemini-3.5-flash` | reasoning_effort `low`, timeout 90 |
| extractor | `google/gemini-3.1-flash-lite` | temperature 0, timeout 90 |
| extractor_secondary | `deepseek/deepseek-v4-flash` | temperature 0, timeout 90. A different family keeps the cross-check meaningful. |
| screener_secondary | `deepseek/deepseek-v4-flash` | timeout 90 |
| normalizer, localizer | `google/gemini-3.1-flash-lite` | timeout 90 |
| conflict_explainer | `google/gemini-3.5-flash` | reasoning_effort `low`, timeout 90 |
| synthesizer | `google/gemini-3.5-flash` | reasoning_effort `medium`, max_tokens 16000, timeout 180 |
| escalation | `qwen/qwen3.8-max-0902` | timeout 120. An open large model, per the user's escalation rule. |

Change the preset comment to "~$0.10–0.20 per review (60→30 abstracts)".

- [ ] **Step 1: Failing tests**
  - `test_limited_llm_caps_in_flight`: 20 concurrent calls into a fake that records peak concurrency, with semaphore 3, give a peak of 3.
  - `test_build_llms_shares_one_semaphore`: two different roles share the same `sem` object.
  - `test_localize_chunks_of_15_in_parallel`: 40 strings make 3 calls, and the fake sees overlapping calls.
  - `test_localize_one_failed_chunk_keeps_only_that_chunk_english`: the fake raises `LLMOutputError` for the chunk containing id `s20`. Ids `s0..s14` and `s30..s39` are translated, and `kept == 15`.
  - `test_budget_preset_roles` (llm_config): the extractor is gemini-3.1-flash-lite and extractor_secondary is from a different vendor.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. In `localize_strings`, a chunk whose runner call raises `LLMError` counts as kept-English for that chunk only (`return_exceptions=True`). Non-LLM exceptions are re-raised.
- [ ] **Step 4:** Run:
  - `uv run pytest -q`
  - `uv run ruff check .`
  - with `.env` loaded, `uv run python -m app.cli.models check`

  Expected: every role validates against the live catalog.
- [ ] **Step 5:** Commit `perf(llm): shared concurrency limit, parallel small-chunk localization, faster budget preset`.

### Task 4: Web app for abstract-only 30-paper reviews

**Files (frontend):**
- `src/lib/types.ts`: mark `fulltext_*` and `with_fulltext` as legacy, and add `with_abstract`.
- `src/lib/progress.ts`: `WELL_COUNT = 60`.
- `src/components/review/live-run.tsx`: wells grid `grid-cols-10`, wells `size-5`, and the copy "ปิดฝาเมื่อเป็นฉบับที่เลือกวิเคราะห์".
- `src/components/landing/request-slip.tsx`: slider 5–30, default 30, label "จำนวนงานวิจัยที่วิเคราะห์".
- `src/components/review/source-rail.tsx`: no source row and no "full text read" link. The dl row reads "วิเคราะห์จากบทคัดย่อ".
- `src/components/review/report-parts.tsx` (QualityNote): show `with_abstract`. Old `with_fulltext` is still shown when present.
- `src/lib/charts-data.ts` (`prismaStages`): found → unique → with_abstract (when present) → screened → selected → extracted. The legacy `with_fulltext` stage appears only when present.
- `src/app/page.tsx` and `src/app/about/page.tsx`:
  - change the copy to "คัด 60 ฉบับ วิเคราะห์บทคัดย่อสูงสุด 30 ฉบับ"
  - remove the fulltext curl example, `get_fulltext` and the robots.txt line
  - state "ใช้เฉพาะบทคัดย่อ ไม่ดาวน์โหลดฉบับเต็ม"
- `src/test/fixtures.ts`: new results have no `fulltext_*`. Keep one legacy fixture.
- `e2e/mock-api.ts` and `scripts/mock-api.mjs`.
- `../DESIGN.md`: the specimen tray has 60 wells, 30 capped.

- [ ] **Step 1: Failing tests**
  - `progress.test.ts`: `screened` with total 60 and kept 30 gives 60 wells with 30 capped.
  - `charts-data.test.ts`: prisma stages for the new stats include `with_abstract` and not `with_fulltext`. Legacy stats still produce the full-text stage.
  - `source-rail.test.tsx`: no "Full text read" link, and the abstract-only note is present.
  - `request-slip.test.tsx`: slider max 30, default 30.
- [ ] **Step 2:** Run `npx vitest run`. Expected: those FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run:
  - `npx vitest run`
  - `npm run lint`
  - `npx next typegen && npx tsc --noEmit`
  - `npx playwright test`, which includes axe and a new 390 px check on the live run with 60 wells (`live wells fit phone` in `app.spec.ts`)
- [ ] **Step 5:** Commit `feat(web): abstract-only 60→30 reviews in the live run, report and copy`.

### Task 5: Infra, docs, live acceptance run

**Files:**
- `docker-compose.yml`: remove the `crawl4ai` service and the `crawl` network. The worker is on `data` only.
- `.env.example`: remove `CRAWL4AI_API_TOKEN` and `CONTACT_EMAIL`.
- `CLAUDE.md`:
  - the Full text convention becomes "Abstract only: no full-text fetching or crawling of any kind; numbers are verified against the abstract"
  - the integration command no longer needs crawl4ai
- `README.md`
- the spec: add a "Revision 2026-10-05: abstract-only" section, update §1 and §4 to 60→30, and mark §4.1 as removed.

- [ ] **Step 1:** Edit the files. Then run `docker compose up -d --build api worker web` and `docker compose rm -sf crawl4ai`.
- [ ] **Step 2: Live acceptance** with the real OpenRouter key from `.env`. POST `{"topic":"metformin and colorectal cancer risk","language":"th"}` and poll until it reaches a terminal state.

  Expected:
  - status `done`
  - `quality.timings.total` < 240 s
  - `quality.localization_kept_english` ≤ 5
  - `stats.selected` ≤ 30
  - `cost_usd` < $0.30

  Record the timings and cost in the ledger.
- [ ] **Step 3:** Run `MRA_LIVE_WEB=1 npx playwright test e2e/live.spec.ts` against the rebuilt stack.
- [ ] **Step 4:** Commit `chore: drop Crawl4AI service; document the abstract-only design`.
