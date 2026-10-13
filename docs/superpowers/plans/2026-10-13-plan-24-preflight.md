# Plan 24 pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-24-thaijo-source.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-24-thaijo-source-design.md`. Base: master `5658db0` (Plans 22a, 23a, 23b and
23c merged).

**How it was checked.**
- Every interface the plan quotes from master was read in the code: `HttpClient`, `urlsafety`, `text`, `Candidate`,
  `dedupe`, `retrieval` (`make_search`, `make_enrich`, the `per_query` round-robin), `route_to_reading`,
  `_add_review_nodes`, `GraphDeps`, `build_graph_deps`, `make_finalize`, `summarize_quality`,
  `ReviewService._version`, `freeze`, `report._citation_parts`, and the frontend `citation.ts`, `report-view.ts`,
  `prisma-flow.ts`, `source-rail.tsx`, `references.tsx`.
- The response shapes were confirmed with 9 live requests to ThaiJO (spec section 3); nothing from them is in the
  repository. The test data is synthetic.
- The code was written and made green in a scratch copy outside the repository (`backend/`, `frontend/`, `docs/`). The
  plan's code sections were then generated from that copy, and two further checks were run:
  - **Replay:** a fresh copy of the worktree received the tasks one by one, test files first. Each task's tests were run
    before its code (to see them fail as the plan says), then after it, then `ruff` and the full backend suite.
  - **Parse-back:** the rendered plan was parsed, and every block it gives was applied to another fresh copy: new files,
    whole-file replacements, replacement pairs and the docs replacements. All 35 touched files came out byte-identical
    to the verified copy.

| Task | Before its code | Its tests after | ruff | Full backend suite |
|---|---|---|---|---|
| 1 | `ImportError: is_allowed_host` | 39 passed | clean | 2135 passed, 41 skipped |
| 2 | 3 failed (`thaijo_enabled`, `abstract_source`, `thaijo_url`) | 11 passed | clean | 2138 passed, 41 skipped |
| 3 | `ModuleNotFoundError: app.services.thaijo` | 14 passed | clean | 2152 passed, 41 skipped |
| 4 | `ImportError: UnsafeXml` | 23 passed | clean | 2161 passed, 41 skipped |
| 5 | `ImportError: freeze_engines` | 28 passed | clean | 2173 passed, 41 skipped |
| 6 | `ModuleNotFoundError: app.graph.nodes.thaijo` | 41 passed | clean | 2179 passed, 41 skipped |
| 7 | 3 failed (reference strings, Markdown link) | 49 passed | clean | 2184 passed, 41 skipped |
| 8 | 6 failed (`thaijoHref is not a function`, strings, names, links) | 5 files, 105 passed | — | frontend: 143 files, 1515 tests passed; `npm run typecheck` and `npx eslint` clean |
| 9 | — | `test_api_docs_limits.py` + `test_harness_worker.py`: 33 passed | — | 2184 passed, 41 skipped (with the docs edits) |

Baseline before Task 1: 2131 passed, 41 skipped. The 41 skipped are the integration tests (they need
`MRA_INTEGRATION=1` and Postgres); Plan 24 adds none and changes no migration.

**Not executed:** the integration tests, the controller's merge, the `CLAUDE.md` blob, the docker rebuild and the live
smoke check (Task 9 Steps 4–6).

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 3, 4 | `HttpClient.post`, `follow_redirects`, `retries=0` → `search`, `abstract`, `record` | `HttpClient` had no POST and always followed redirects, so an OAI host could redirect anywhere | `_send` with a per-call `follow_redirects`; tests in Tasks 1, 3 and 4 refuse the redirect |
| 1 | 3, 4 | `is_allowed_host` → `article_link` | `is_public_http_url` alone checks DNS, not the domain | Both are used: domain first, then public addresses (Task 4) |
| 2 | 3 | `Candidate.thaijo_url`, `abstract_source="thaijo"` → `to_candidate` | Consistent | — |
| 2 | 5, 6 | `dedupe.SCALARS` gains `thaijo_url` → enrich keeps it; the OAI step reads it | Without it a SearXNG duplicate's `url` would hide the ThaiJO page after the merge | `thaijo_url` is its own scalar (Task 2 test) |
| 3 | 4 | both build `app/services/thaijo.py` and `tests/unit/thaijo_data.py` | Task 3 alone must pass ruff (no unused `xml.etree`/`is_public_http_url` imports) | Task 3's file is the final one without the OAI part; Task 4 adds imports, section and `record()` as 4 replacements; replay confirmed both states |
| 3 | 5 | `collect(queries, *, limit, out, stats)` → `thaijo_search` | A timeout first lost the whole batch in flight (detail calls were gathered `limit` at a time) | Batches of `CONCURRENCY` in rank order; `test_a_timeout_keeps_the_candidates_already_collected` |
| 4 | 6 | `record(article_url)` → `thaijo_metadata` | Consistent | — |
| 4 | 7, 8 | `article_link` → Markdown link; frontend `thaijoHref` mirrors it | Both refuse the PDF link and other hosts | Tests on both sides |
| 5 | 6 | both edit `app/graph/graph.py` | Task 5 needs only `GraphDeps.thaijo` | Task 5 adds the field; Task 6 adds the import, node, route argument and edge |
| 5 | 6 | `summarize_quality` reads a `thaijo_metadata` stage entry that Task 6 writes | Consistent (Task 5 tests it with a literal entry; Task 6's full review checks the real one) | — |
| 5 | existing tests | `make_search` | `zip(..., strict=True)` over the gather results would break if ThaiJO joined that gather | ThaiJO runs as its own task (`ensure_future`) awaited after the gather; the existing retrieval tests pass unchanged |
| 5 | existing tests | `ReviewService._version()` | Consistent with 23b/23c (`+llm`, `+g`); `+thaijo` only while on | `test_turning_thaijo_on_starts_a_new_cache_generation` |
| 6 | eval graph (22a) | `_add_review_nodes` → `build_eval_graph` | The route list names `thaijo_metadata`, so the node must exist in every graph that uses the route | The node is added in `_add_review_nodes`; eval tests pass unchanged |
| 6 | 7, 8 | `papers[].thaijo_url`, `papers[].bib` → references | Consistent | — |
| 7 | 8 | the reference string | Must match byte for byte | The same paper and expected string in both test files; the `Year;:Pages` edge was found and both sides now write `Year:Pages` |
| 8 | existing frontend | `CitationId.label` union | `ID_NAME` is a `Record<label, string>`, so the new label must be named there | Added in Task 8; typecheck clean |
| 9 | `test_api_docs_limits.py` | `docs/api.md` | Docs edits must keep it green | Run step in Task 9 |
| all | `prompt_version`, `test_prompts_by_type.py` | prompts | No prompt or LLM schema changes (`Candidate` is not an LLM schema; ThaiJO text enters existing slots) | No bump; pins untouched |

## Each task against itself

| Task | Tests vs code; files created vs files touched | Finding | Fix |
|---|---|---|---|
| 1 | 4 tests; 2 files modified, 1 test file | Consistent | `http.py` is given as a whole file (the diff was hard to read as pairs) |
| 2 | 3 tests; 3 files modified | Consistent | — |
| 3 | 14 tests; 1 module, 1 data file, 1 test file | The timeout test first used `limit=1`, which finished before the slow lookup | `limit=5` with `CONCURRENCY` set to 1 for that test |
| 4 | 9 tests; module and data file extended | A fixture regex lost its `\b` when written through a Bash heredoc (the host collapses `\\`) | Files written with the editor tools; Global Constraints warn about it |
| 5 | 12 tests; 7 files modified | `ReviewOptions(candidate_limit=20)` is invalid with the default `max_papers` 30 | The cap test passes `max_papers=5` |
| 6 | 6 tests (one is a full fake review); 1 node, 4 files modified | `route_to_reading` needs a `topic` in the state | The route tests pass one |
| 7 | 5 tests; 1 file modified | `Year;:Pages` for pages without a volume | `Year:Pages` (NLM e-locator form) |
| 8 | 6 tests; 5 files modified, 1 test file | Consistent; no DESIGN.md change (existing link styles) | — |
| 9 | docs tests | Docs replacements first matched mid-line text | Every docs replacement is whole lines; the parse-back applies them exactly |
