# Plan 14a: Review types, Literature Review Matrix, Concept Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user picks one of three review types at submit time — narrative, systematic (`slr`, default), scoping — and the type changes question framing, planning, screening, selection, synthesis, grading and report sections. Every report gains a Literature Review Matrix (rows = papers) and a concept map. SLR and scoping reports show PRISMA exclusion reasons. (Plan 14b later adds `meta_analysis` and the citation network.)

**Architecture:**
- `ReviewOptions.review_type` (Literal, default `"slr"`) flows API/MCP → cache key (inside the options dump) → graph `state["options"]` → each node reads `ReviewOptions.clamped(...).review_type`.
- Per-type prompt builders in `backend/app/graph/prompts.py`; SLR builders return today's exact strings (pinned by a snapshot test).
- `ReviewQuestion` gains `concept`, `context` (required-nullable). `ScreenDecision` gains `exclusion_reason` (required-nullable).
- `Synthesis.evidence_strength` and `grade_baseline` may be `None`; a new `NarrativeNoGrade` output model for narrative and scoping.
- `select_top` stores `selection_stats`; `finalize` adds `review_type`, `question.framework/concept/context`, `stats.non_research`, `stats.excluded_screening{reason:n}`, `stats.excluded_selection{narrative, over_limit}`.
- Frontend: pure libs `src/lib/review-type.ts`, `src/lib/lit-matrix.ts`, `src/lib/concept-map.ts`, `src/lib/evidence-map.ts`; components `LitMatrix`, `ConceptMapFigure` (TreeChart + outline twin), `EvidenceMapTable`, `ReviewTypePicker`; `report.tsx` shows sections by type; `TreeChart` registered in `echarts-runtime.ts` (lazy chunk only).

**Tech Stack:** FastAPI/LangGraph (uv, pytest, ruff), Next.js 16, React 19.2, Tailwind 4, ECharts 6 (lazy), Vitest + Testing Library, Playwright + axe, Vite standalone IIFE.

**Spec:** User request 2026-10-10 (new report views; review types chosen at submit time). Binding: SLR default; narrative and scoping not graded; concept map built in the frontend from existing data; abstract-only stays. Approved plan: `C:\Users\santi\.claude\plans\dashboard-twinkling-spindle.md`. DESIGN.md, Plans 10–13 and `frontend/CLAUDE.md` stay binding.

## Global Constraints

- **SLR must not regress.** For `slr`, every system and user prompt is byte-identical to the strings before this plan (snapshot test). `exclusion_reason` is the only change to the SLR screening schema.
- **No new numbers from papers.** The lit matrix shows `n` and effects only through `VerifiedNumber` / `Hole` (via existing helpers such as `asReported`, `effectLabel`, `isBlankedEffect` — find their exact locations). Counts (evidence map, exclusion tallies, concept-map leaf counts) use `font-display tabular-nums`, never `num-verified`.
- **Direction is a model judgement.** Every glyph has an accessible name; wherever directions are tallied the copy says "ตามที่เอเจนต์อ่าน". ◆ = harm only.
- **Honest labelling.** The report header shows a type badge with suffix "อัตโนมัติ · อ่านเฉพาะบทคัดย่อ"; the disclaimer names the type.
- **Legacy results.** A result without `review_type` renders exactly as today (treated as legacy SLR).
- **Offline.** New views render only from `review.result`, no `next/*` (except `next/link`), no API calls; `npm run build:standalone` must pass.
- **Mobile 390px.** No page-level horizontal scroll; lit matrix and evidence map scroll inside their own container with a sticky first column at every width; touch targets ≥44px.
- **Accessibility.** Every chart has `role="img"` + label and a "ดูเป็นตาราง" twin (or outline twin for the concept map); tables have `aria-label` and `scope` headers; no new live regions.
- **Flat Theatre Green.** No shadows/gradients/coloured left borders; brand greens out of charts; finding colours always with glyph shapes.
- **Git.** Stage only touched files; Edit/Write only (LF; never Python text-mode writes); check `git diff --stat`. Commits `feat(review-types): …`, `feat(report): …`, `test(e2e): …`, `docs: …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Leave the untracked `infra/searxng/limiter.toml.new` alone.
- **Commands.** Backend `cd backend && uv run pytest && uv run ruff check .`. Frontend (`frontend/`): `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`.

## Review Focus

- SLR prompt snapshot passes (SLR behaviour unchanged).
- `evidence_strength: null` never renders as "very low"; legacy results render as before.
- Scoping hides direction, claims and forest everywhere (report, lit matrix, concept map, Markdown export).
- Concept-map links come only from `comparison` cells; tree deterministic.
- Study-type filter vs review type labelled distinctly ("รูปแบบการทบทวน" vs "ชนิดงานวิจัยที่จะรวม").

### Per-type behaviour (reference for all tasks)

| | Narrative (`narrative`) | SLR (`slr`, default) | Scoping (`scoping`) |
|---|---|---|---|
| Thai label · description | การทบทวนแบบบรรยาย (Narrative review) · สรุปภาพรวมความรู้จากงานวิจัยหลายชนิด รวมบทความทบทวน เหมาะกับการทำความเข้าใจหัวข้ออย่างรวดเร็ว ไม่ประเมินความแข็งแรงของหลักฐาน | การทบทวนวรรณกรรมอย่างเป็นระบบ (Systematic review) · ค้นและคัดกรองตามเกณฑ์ที่ชัดเจน รายงานขั้นตอนแบบ PRISMA และประเมินความแข็งแรงของหลักฐาน (ค่าเริ่มต้น) | การทบทวนขอบเขต (Scoping review) · สำรวจว่ามีงานวิจัยอะไร ชนิดใด ปีใด ด้วยกรอบ PCC ไม่ประเมินคุณภาพหรือสรุปว่าได้ผลหรือไม่ |
| Question | PICO | PICO (prompts byte-identical) | PCC: `concept`, `context` required; `comparator` may be empty; `outcomes` = aspects to chart |
| Planning | skip `ensure_design_query` | as today | broad queries; skip `ensure_design_query` |
| Screening | narrative reviews, SR/MA and key primary studies allowed | today's rule + `exclusion_reason` | any design or review addressing the concept in the context; exclude only off-topic, editorials, protocols without results |
| `select_top` | keep narrative reviews | as today | keep narrative reviews |
| Extraction | base | base | base + "outcomes = aspects of the concept the abstract reports; effect fields usually none" |
| Matrix/conflicts | narrative reviews excluded from direction matrix (as today) | as today | narrative reviews included in counts; conflict explanation skipped |
| Synthesis | thematic narrative, no grade | as today | evidence-map narrative, no grade |
| Report sections | summary (not graded), claims, findings, lit matrix, concept map, forest; PRISMA hidden | all of today + lit matrix, concept map, PRISMA with reasons | summary (not graded), evidence map, lit matrix (no direction/RoB), concept map grouped by design, PRISMA-ScR; claims and forest hidden |

---

### Task 1: Backend — `review_type` option, cache key, API/MCP/status, result field, stub result

**Files:** `backend/app/schemas/review.py`, `backend/app/mcp/server.py`, `backend/app/services/review_service.py` (status limits), `backend/app/config.py` (`prompt_version` → `"2026-10-10.1"`), `backend/app/graph/nodes/synthesis.py` (finalize), `backend/app/graph/nodes/stubs.py`, new `backend/app/graph/nodes/stub_result.py`; tests (find the relevant existing files: schemas, MCP server, reviews API, review service, stub timeline); `docs/api.md`.

- [ ] `ReviewType = Literal["narrative", "slr", "scoping"]`; `review_type: ReviewType = "slr"` on `ReviewOptions`. `clamped()` maps missing/unknown to `"slr"` (resumed state never crashes); the strict API model returns 422 for unknown values.
- [ ] Cache key already hashes `options.model_dump()`: test that different `review_type` → different keys, and default == explicit `"slr"`.
- [ ] MCP `start_review(..., review_type: Literal[...] = "slr")`, docstring one line per type.
- [ ] `/status` `limits.review_types = ["narrative", "slr", "scoping"]` (14b appends).
- [ ] `finalize` adds `"review_type": options.review_type` to the result; both stub finalize paths carry it.
- [ ] `stub_result.py`: deterministic representative result (6 papers with English cards incl. population/intervention/comparator/key_findings/limitations/RoB, two `comparison` rows with cells/directions, key terms, stats with `excluded_screening`), used by the timed stub's finalize (`STUB_DELAY_SECONDS>0`) so manual QA shows new views; plain stub stays minimal.
- [ ] `docs/api.md`: `options.review_type`, `result.review_type`, `/status` limits, MCP row.
- **Tests:** schema validation and clamping; cache key; MCP passthrough; stub result has `review_type` and expected keys; `REAL_KEYS` unchanged.

### Task 2: Backend — per-type prompts and question framing (PICO/PCC)

**Files:** `backend/app/graph/prompts.py`, `backend/app/graph/schemas.py` (`ReviewQuestion.concept`, `.context`), `backend/app/harness/question.py`, `backend/app/graph/nodes/intake.py`; tests (question, intake), new `backend/tests/unit/test_prompts_by_type.py`.

- [ ] Builders `refine_system(rt)`, `critique_system(rt)` (if a critic prompt exists), `plan_system(rt)`, `screen_system(rt)`, `extract_system(rt)`, `narrative_system(rt)`. `slr` returns today's constants unchanged; other types append a small type block, except scoping refine which uses a separate `REFINE_SYSTEM_PCC`.
- [ ] `ReviewQuestion.concept: str | None`, `.context: str | None`, required-nullable for strict schemas (same `json_schema_extra` pattern as existing required-nullable fields, e.g. `design_guess`). PICO types return null.
- [ ] `question_problems(q, options)` takes the review type: scoping requires `concept` and `context`, not a comparator; requires `intervention_or_exposure` (= concept).
- [ ] `ensure_design_query` skipped for narrative and scoping.
- [ ] Finalize `_question_block`: add `framework` ("PICO"|"PCC"), `concept`, `context`.
- [ ] Every node that calls these prompts passes the review type from `ReviewOptions.clamped(state["options"]).review_type`.
- **Tests:** SLR snapshot (each builder for `slr` equals the old constant — capture the old strings in the test before refactoring); scoping refine passes with empty comparator and fails without concept/context; existing intake tests green.

### Task 3: Backend — per-type screening, selection, PRISMA reasons

**Files:** `backend/app/graph/schemas.py` (`ScreenDecision.exclusion_reason`), `backend/app/graph/nodes/screening.py`, `backend/app/graph/state.py` (`selection_stats`), `backend/app/graph/nodes/synthesis.py` (finalize stats); tests (screening), `backend/tests/fakes.py` responders.

- [ ] `ExclusionReason = Literal["off_topic","population","intervention_exposure","outcome","study_design","publication_type","other"]`; `exclusion_reason: ExclusionReason | None` required-nullable. `_decisions` coerces: include → `None`; exclude with `None` → `"other"`.
- [ ] `screen_system(rt)` used by screening.
- [ ] `select_top` by type: `slr` as today; `narrative` and `scoping` keep narrative reviews (`narrative_excluded = 0`). Returns `selection_stats = {excluded_screening: Counter(reason), narrative_excluded, over_limit}` (`over_limit` = included beyond `max_papers`).
- [ ] Finalize stats: `non_research` (already in `search_stats`), `excluded_screening`, `excluded_selection`.
- **Tests:** tallies from mixed decisions; narrative reviews kept for scoping; SLR selection unchanged (existing tests); fakes updated with the new field.

### Task 4: Backend — per-type synthesis, grading, exports

**Files:** `backend/app/graph/nodes/synthesis.py`, `backend/app/graph/schemas.py` (`Synthesis.evidence_strength: ... | None`, `grade_baseline: str | None`, new `NarrativeNoGrade`), `backend/app/services/report.py`; tests (synthesis nodes, exports, review graph).

- [ ] `_evidence(state)`: scoping includes narrative reviews.
- [ ] `route_conflicts`: scoping → straight to `write_synthesis`.
- [ ] `write_synthesis`: narrative and scoping use `NarrativeNoGrade` (executive_summary, research_gaps) with `narrative_system(rt)`; `evidence_strength=None`, `grade_baseline=None`; `evidence_rationale` fixed English sentence ("Certainty of evidence is not graded in a scoping/narrative review.") localized as usual; citation check stays.
- [ ] Markdown export: a type line; "Evidence strength: not assessed (…)"; scoping omits direction words in the comparison table.
- [ ] CSV: append `population, intervention_or_exposure, comparator, risk_of_bias, overall_direction, key_findings, limitations` at the END of `CSV_FIELDS` (lists joined with " | "); existing column order unchanged.
- **Tests:** scoping graph run has no `explain_conflict` and `evidence_strength None`; SLR graph run unchanged; CSV header; Markdown per type.

### Task 5: Frontend — types, review-type picker, request slip

**Files:** `frontend/src/lib/types.ts`, new `frontend/src/lib/review-type.ts` (+test), `frontend/src/components/landing/request-slip.tsx` (+test), new `frontend/src/components/landing/review-type-picker.tsx` (+test, or inside request-slip if simpler), `frontend/src/lib/agent-thought.ts` (+test), `frontend/src/components/review/live-run.tsx`.

- [ ] Types: `ReviewType`; `ReviewResult.review_type?`; `QuestionBlock.key_terms?: {term; synonyms; mesh}[]`, `framework?`, `concept?`, `context?`; `Synthesis.evidence_strength?: EvidenceStrength | null`; `ComparisonCell.design_category?`, `pooled?`; `Stats.non_research?`, `excluded_screening?`, `excluded_selection?`; `ReviewOptions.review_type?`; `ServiceStatus.limits.review_types?`.
- [ ] `review-type.ts`: `REVIEW_TYPE_LABEL` (Thai/English name + description from the table), `reviewTypeOf(result)` (missing → `"legacy"` behaving as SLR), `SECTIONS_BY_TYPE`, `isGraded(type)`.
- [ ] `ReviewTypePicker`: visible (not folded) `fieldset` "รูปแบบการทบทวน" of radio rows (label Bai Jamjuree, description `text-muted text-sm`, `min-h-11`, 1px `rule` border, selected = `primary` border). Default `slr`. Options from `status.limits.review_types`, fallback static three. Rename study-type legend to "ชนิดงานวิจัยที่จะรวม (ไม่เลือก = ทุกชนิด)". Send `options.review_type`.
- [ ] Live thought: scoping refine text says "แบบ PCC" via a small `thoughtFor(s, {framework})` parameter wired from `review.options.review_type` (check how options reach LiveRun).
- **Tests:** picker defaults to SLR and sends value; descriptions render; status list limits options; `reviewTypeOf` legacy.

### Task 6: Frontend — per-type report sections, strength line, PCC, PRISMA reasons, scoping evidence map

**Files:** `frontend/src/components/review/report.tsx`, `report-parts.tsx` (`StrengthLine`, `QuestionDetails`), `bottom-line.tsx`, `components/review/charts.tsx`, `components/charts/figures.tsx` (`PrismaFigure` reasons table), `frontend/src/lib/charts-data.ts` (`exclusionReasons`), new `frontend/src/lib/evidence-map.ts` (+test), new `frontend/src/components/review/evidence-map.tsx` (+test), `frontend/src/lib/glossary.ts` (`pcc`, `scopingReview`, `narrativeReview` if needed, `slr`); tests report, charts.

- [ ] Header type badge (`label` on `rail`, 2px corners) e.g. "การทบทวนอย่างเป็นระบบ · อัตโนมัติ · อ่านเฉพาะบทคัดย่อ" with a `Term`; none for legacy results.
- [ ] `StrengthLine`: when `!isGraded(type)` or `evidence_strength === null` on a typed result → "ไม่ได้ประเมินความแข็งแรงของหลักฐาน ({type label})" instead of the bar; legacy keeps the existing fallback.
- [ ] `QuestionDetails`: PCC block (P ประชากร, C แนวคิด, C บริบท) with `Term k="pcc"`; key terms as chips.
- [ ] Sections + nav via the visibility map: scoping hides `h-claims`, forest and the BottomLine direction tally; narrative hides PRISMA.
- [ ] PRISMA: "เหตุผลที่คัดออก" table under the bars (reason label, count `font-display tabular-nums`) + "ไม่ใช่งานวิจัย {non_research}", "เกินจำนวนที่วิเคราะห์ {over_limit}", "บทความทบทวนแบบไม่เป็นระบบ {narrative}"; scoping title says PRISMA-ScR.
- [ ] Evidence map (scoping, `h-evidence-map`, nav "แผนที่หลักฐาน"): counts table rows = comparison rows (concepts) × columns = design categories present + "รวม"; second table 5-year bins × design; zero "–"; scroll container + sticky first column; caption "จำนวนงานที่พบ ไม่ใช่การประเมินว่าได้ผล".
- **Tests:** sections per type; null strength text; legacy fixture unchanged; reason labels; evidence-map counts from fixture.

### Task 7: Frontend — Literature Review Matrix

**Files:** new `frontend/src/lib/lit-matrix.ts` (+test), new `frontend/src/components/review/lit-matrix.tsx` (+test), `report.tsx` (section `h-litmatrix`, nav "ตารางงานวิจัย"), `frontend/src/lib/i18n.ts` (column labels).

- [ ] `litRows(papers, lang, type)`: one row per paper in `visible` (filtered) order; narrative reviews and failed extractions included (failed → one spanning cell "สกัดข้อมูลไม่สำเร็จ"); text from `card` (or `card_en` in English), numbers from `card_en`.
- [ ] Columns: sticky ผู้แต่ง/ปี + `P#` (button → rail); รูปแบบการศึกษา (`DESIGN_LABEL`, SR/MA `Term`); ประชากร; สิ่งที่ศึกษา/สิ่งสัมผัส; ตัวเปรียบเทียบ (hidden when empty for every row); ผลลัพธ์ (list: outcome + `VerifiedNumber` effectLabel + CI, or `Hole`, or "ไม่รายงานตัวเลข"); ข้อค้นพบหลัก; ทิศทาง (`Glyph` + label + `UncertainFlag`); ความเสี่ยงอคติ (`ROB_LABEL`); n (`VerifiedNumber` via the existing as-reported helper with sample_size + sample_size_quote, or `Hole`); ข้อจำกัด. Scoping drops ทิศทาง and ความเสี่ยงอคติ.
- [ ] Layout: `overflow-x-auto` container, `min-w-[1100px]` table, rows ≥36px, long text `line-clamp-4` (full text in rail), `th scope="col"`, `aria-label="ตารางสรุปงานวิจัย"`, first column `sticky left-0 bg-surface`.
- [ ] CSV download link next to the heading (hidden offline).
- **Tests:** columns by type; blanked `n` → `Hole`; verified effect → `VerifiedNumber` (`num-verified`); failed row; ref click → `onSelect`; no `num-verified` on counts.

### Task 8: Frontend — concept map (TreeChart + outline)

**Files:** new `frontend/src/lib/concept-map.ts` (+test), `frontend/src/components/charts/echarts-runtime.ts` (add `TreeChart`), `frontend/src/components/charts/figures.tsx` (`ConceptMapFigure`), `report.tsx` (section `h-map`, nav "แผนที่ความรู้"), echart tests if they assert registration.

- [ ] `conceptTree(result, lang, type)` → `{root, nodes}`: root = refined question (truncated); level 1 = P, I/E (or Concept), C, Context (only present ones), key terms attached by case-insensitive substring match on the element's text else under "คำสำคัญ"; level 2 under I/E = each comparison row (outcome/variable, localized via row index); leaves = groups per direction in `DIRECTION_ORDER` labelled "{DIRECTION_LABEL} · P1, P3 +2" with a count (scoping groups by `DESIGN_LABEL`). Narrative reviews never leaves in direction groups. Stable ordering.
- [ ] Figure: ECharts tree `layout:"orthogonal"`, `orient:"LR"`, `initialTreeDepth: 3`, `expandAndCollapse: true`, leaf symbol = direction glyph symbol in direction colour, other nodes `rect` in rule colour, labels display font 12px width 160 truncate, height = max(240, leaves × 28); animation respects reduced motion. Use chart tokens like existing figures.
- [ ] Twin = nested `ul` outline (full text), each paper ref a button → rail.
- [ ] Caption: "เส้นเชื่อมมาจากตารางผลแต่ละการศึกษาเท่านั้น ไม่ได้แสดงตัวแปรคั่นกลาง (mediator)".
- **Tests:** tree from fixture (P/I/C nodes, outcome nodes, leaf groups with refs); scoping groups by design; outline buttons; same input deep-equal tree.

### Task 9: E2E, docs, DESIGN.md, verification, screenshot review

**Files:** `frontend/src/test/fixtures.ts` (add `review_type`, `key_terms`, stats reasons; scoping and narrative variants), `frontend/e2e/mock-api.ts`, `frontend/e2e/app.spec.ts`, `frontend/e2e/offline-report.spec.ts`, `DESIGN.md`, `CLAUDE.md`, `docs/api.md`, `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (revision note); temporary uncommitted screenshot spec.

- [ ] E2E: slip sends `review_type`; report per type shows/hides correct sections and nav; lit matrix scrolls inside its container at 390 (no page horizontal scroll); concept map toggles to outline; PRISMA reasons appear; offline report renders lit matrix and concept-map outline; axe at 1440 and 390, light and dark.
- [ ] DESIGN.md: components Review-type picker, Literature review matrix, Concept map, Evidence map, Not-graded strength line; Decisions Log row (2026-10-10, Plan 14a).
- [ ] CLAUDE.md conventions: review types (SLR prompts frozen; scoping/narrative not graded).
- [ ] Bundle: lazy echarts chunk delta (TreeChart) and `standalone-dist/report.js` size before/after.
- [ ] Full verification; screenshots at 1440 and 390, light and dark, per type, saved to `D:/MedicalReviewerAgent/.superpowers/plan14a/`, looked at against DESIGN.md; delete the temp spec.

## Risks
1. Prompt regression leaking into SLR — snapshot test; live smoke per type before merge if possible.
2. Required-nullable fields add tokens/repairs on small models — measure `quality.repaired`.
3. Two "meta-analysis" labels (study type vs review type) — renamed legends.
4. Null evidence strength in old clients — documented nullable in api.md.
5. Cache invalidation once (prompt_version bump) — expected.
6. Concept map density on phones — grouped leaves, depth 3, outline twin.
7. Lit matrix length (30 × 11) — clamped cells, rail, filters.
