# Plan 14b — Citation network + Meta-analysis review type

**Request (2026-10-10):** report views "Citation Networking" and review type "Meta-Analysis" (follows Plan 14a: narrative /
slr / scoping, literature matrix, concept map — merged 086e6f1; Plan 15 stage; Plan 16 sources).
**User decisions:** meta-analysis = **compute a pooled estimate with a clear label** (approved departure from "never compute a
number shown as if from a paper"); citations from **OpenAlex + Europe PMC** (metadata only, not full text).
**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (abstract-only; numbers verified against abstracts).

## Global constraints
- **SLR unchanged.** SLR prompts stay byte-identical (sha pins in `backend/tests/unit/test_prompts_by_type.py` must pass untouched);
  `meta_analysis` reuses the SLR prompts plus appended override blocks (`OVERRIDE_LEAD`) only where needed.
- **Pooling rules (meta.py):** DerSimonian–Laird random effects; pool only primary studies (never SR/MA — `pooled`/`design_category`
  `sr_ma_*` rows are shown as reference rows); same `effect_measure` and same design group (RCT vs observational pooled separately);
  k ≥ 3; inputs only effect + both CI bounds that passed verification (`verification` / non-null after `null_unverified_numbers`);
  ratio measures (HR, OR, RR) pooled on the log scale; MD/RD on the raw scale; SMD only if all SMD; `r` and `other`/`none` never.
  Duplicate cohort guard: skip a study whose (first author surname, year, n) matches another in the same pool, with a warning.
- **Honest display:** pooled numbers render only through new `ComputedNumber` (no verified tape; small "คำนวณ" tag) with the
  banner "คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด"; pooled diamond is an **outlined lozenge**
  (never the solid ◆, which means harm); I²/τ²/k/Q shown; "วิธีคำนวณ" disclosure lists every input (ref, value, CI, SE, weight);
  warnings: abstracts only, small k (<5), I² ≥ 50%, mixed adjusted/unadjusted not detectable from abstracts.
  The synthesis text never restates pooled numbers (prompt rule + a check that strips them).
- **Citations:** edges only between papers in the same review; `cited_by` counts from the source; no data ≠ "does not cite"
  (coverage shown); OpenAlex key optional (`OPENALEX_API_KEY`, `OPENALEX_MAILTO`, empty default); timeouts + soft failure — a
  citation failure never fails a review; runs in parallel with reading (no added wall time beyond reading).
- Legacy and existing types render exactly as before except the new citation view (shown for slr/narrative/scoping/meta when data
  exists; legacy none).
- Abstract-only; no full text. Frontend: numbers only through VerifiedNumber/Hole/ComputedNumber; charts data only from `src/lib/*`;
  DESIGN.md (flat Theatre Green, glyph+colour, ◆ = harm only, 44px targets); offline report renders everything from `review.result`.
- Git: Edit/Write only (LF), stage only touched files, leave `infra/searxng/limiter.toml.new` alone; commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commands as in CLAUDE.md.

## Task 1: Backend — OpenAlex client + Europe PMC references
**Files:** new `backend/app/services/openalex.py`, `backend/app/services/europepmc.py` (`references`), `backend/app/config.py`
(`openalex_url`, `openalex_api_key`, `openalex_mailto`, timeouts), `.env.example`, `docker-compose.yml` (pass the env to api/worker),
fixtures + unit tests.
- `OpenAlexClient.works_by_ids(dois, pmids)` → batched `filter=doi:a|b` / `ids.pmid:` (≤50 per call), `select=id,doi,ids,
  publication_year,referenced_works,cited_by_count`; `api_key` param when set; polite throttle; returns per input id
  `{openalex_id, referenced_works, cited_by_count, year}`.
- `EuropePmcClient.references(source, id)` (`/{source}/{id}/references`, pageSize 1000) for papers OpenAlex lacks.

## Task 2: Backend — citation graph node
**Files:** new `backend/app/harness/citations.py` (pure: build edges between review papers from id maps; coverage), new node
`fetch_citations` (Send branch from `select_top` like `external_enrich`, joins at `normalize_outcomes`), state field, finalize
`result.citations = {edges: [{from, to}], cited_by: {ref: n}, coverage: {ref: "openalex"|"europepmc"|null}, source_note}`,
progress event `citations_fetched` (count), stub result citations, docs/api.md. Tests: pure graph builder, node soft-fail on
timeout/error, graph wiring with fakes.

## Task 3: Backend — meta.py (pure)
**File:** new `backend/app/harness/meta.py` + `backend/tests/unit/test_meta.py`.
- `se_from_ci(lo, hi, scale)`; `dersimonian_laird(y, v)` → est, se, ci, tau2, i2, q, df, p_het.
- **Reference tests:** hand fixture y=[0, 0.5, 1], v=[0.04]*3 → Q=12.5, τ²=0.21, μ=0.5, SE=0.288675, I²=84%;
  metafor dat.bcg (13 BCG trials, log RR) → est −0.7141, SE 0.1787, τ² 0.3088, I² 92.12%, Q 152.23;
  `se_from_ci(0.71, 0.90, "log")` = 0.060493. Tolerance 1e-4 (I² 0.01%).
- `pool_outcomes(matrix, papers)` applies the Global pooling rules and returns
  `[{outcome, measure, scale, design_group, k, studies:[{ref, effect, ci_lower, ci_upper, se, weight}], pooled:{est, ci_lower, ci_upper,
  se}, tau2, i2, q, df, p_het, method:"DerSimonian-Laird random effects", version:"meta-1", warnings:[...]}]` + excluded list with reasons.

## Task 4: Backend — `meta_analysis` review type
**Files:** `schemas/review.py` (Literal adds `meta_analysis`; clamp; status `review_types`), prompts (meta = SLR + an extract override
asking for adjusted/unadjusted wording in the quote only if stated — no new fields unless needed), node `pool_effects` after
`normalize_outcomes` (meta only), `result.meta_analysis`, GRADE-lite: downgrade inconsistency when I² ≥ 50%, imprecision when the pooled
CI crosses the null; synthesis prompt gets the pooled results as data with "do not restate pooled numbers" + a post-check that removes
any pooled number string from the summary; Markdown/CSV export (pooled rows labelled "computed"), MCP/API docs, stub meta result.
`ensure_design_query` stays on for meta (Plan 14a opt-out set).

## Task 5: Frontend — types, picker, sections
`types.ts` (`MetaAnalysis`, `Citations`, `ReviewType` adds meta), `review-type.ts` (label "การวิเคราะห์อภิมาน (Meta-analysis)" ·
"รวมผลเชิงตัวเลขจากงานวิจัยหลักที่วัดผลแบบเดียวกัน (ตั้งแต่ 3 ฉบับ) ด้วยวิธี random effects ตัวเลขรวมคำนวณโดยระบบ ไม่ใช่ผลจากงานใดงานหนึ่ง";
sections = SLR + `meta` + `citations`), picker 4th option, stage/thought copy for the pooling step if a new event exists.

## Task 6: Frontend — ComputedNumber + Meta-analysis section
`components/ui/evidence.tsx` `ComputedNumber`; `lib/meta-view.ts` (pure view model); `components/review/meta-analysis.tsx`: banner,
per-pool forest (studies + outlined lozenge, null line), I²/τ²/k/Q line (`font-display tabular-nums`), "วิธีคำนวณ" disclosure table,
warnings, reference rows for SR/MA, excluded studies with reasons; table twin; DESIGN.md departure entry.

## Task 7: Frontend — Citation network
`echarts-runtime.ts` adds GraphChart; `lib/citation-network.ts` (pure: nodes x = year, y = deterministic lanes, size by cited_by
(capped), colour by design, edges arrows); `CitationNetworkFigure` (fixed layout, click → rail), table twin (paper, cites, cited by
in review, cited_by total, coverage); lit matrix gains "ถูกอ้างอิง" column; caption about coverage ("ไม่มีข้อมูล" ≠ ไม่อ้างอิง).

## Task 8: Docs and exports
docs/api.md (result.citations, result.meta_analysis, review_type), spec revision note (OpenAlex as citation metadata source,
computed pooled estimate departure), /about sources line if present, DESIGN.md components + Decisions Log, CLAUDE.md conventions line.

## Task 9: E2E, verification, screenshots
E2E per type incl. meta (banner, lozenge, ComputedNumber has no tape, disclosure inputs) and citations (graph + twin); offline
report; axe light/dark 1440/390; bundle delta; screenshots reviewed; live smoke (stub + one real meta review if a key is present).
