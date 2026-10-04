# Plan 6: Harness round 2 (measured on Qwen3.5 Flash)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Use the first three live Qwen3.5 Flash reviews to fix what makes results weak, then measure again on the same topics:
- free-text study designs
- narrative reviews passing screening
- pooled evidence counted like primary studies
- one outlier turning consensus into "conflict"
- a whole outcome clustering discarded for a small mistake
- stale cached results after pipeline changes

**Why (user request 2026-10-05: "ทดสอบดู และปรับแก้ไข harness engineering อีกรอบ"):**

Baseline: 3 live reviews (`budget` = Qwen3.5 Flash everywhere, reasoning off). All 3 finished `done` in 59–98 s for $0.015–0.025, with 91–100 % of numbers verified, and the Thai output works.

| Observation | Effect |
|---|---|
| `study_design` is free text. Metformin produced 14 spellings for 17 papers, e.g. "Retrospective cohort study (Kaiser…)", "Target trial emulation using…" | The design filter in the UI is useless. GRADE's `is_randomized` reads the text, so "Systematic review and meta-analysis" of RCTs counts as non-randomized. |
| Narrative reviews are selected; SGLT2 picked 2 papers typed only as "Review" | These papers add no numbers, and they dilute the matrix. |
| SR/MA and primary cohorts are mixed | The same cohorts are counted twice, once alone and once inside a pooled estimate. Nothing tells the narrative to prefer the pooled estimate. |
| Metformin: `outcome_normalization_fallback: true`, consensus 0 | `validate_clusters` rejects the whole LLM clustering for one missing or duplicated member. The exact-name fallback then groups almost nothing. |
| Any second direction in a row makes it a conflict | Example: statins had 3 conflicts and 1 consensus across 15 papers. One null study among 10 positive ones becomes a "conflict" and lowers GRADE for inconsistency. |
| Cache key = topic + language + options only | After a pipeline or prompt change, users get the old result, including full-text-era results, and re-measuring a topic returns the cache. |

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. Plan 7 = hardening, which was the old Plan 6.

## Global Constraints
- Numbers shown to users are verified against the abstract, and unverifiable numbers are nulled.
- Prompts are English; translation happens last.
- Every new LLM output field is validated in code. A bad value is repaired or deterministically corrected, never silently trusted.
- Old stored results (no `design_category`, no `dissent`) must still render.
- The `budget` preset stays Qwen3.5 Flash on every role with reasoning off.

## Review Focus
1. **Cards without a category.** A card without `design_category` (an old result, or a model that omitted it) still grades and renders, using a text heuristic.
2. **Pub types vs. the model's category.** When Europe PMC's `pub_types` say "Randomized Controlled Trial" or "Meta-Analysis", a contradicting `design_category` is repaired.
3. **Partly wrong clusterings.** A clustering with one missing outcome, one duplicate and one unknown member is kept and fixed, not thrown away.
4. **Consensus rule.** Consensus needs ≥ 3 papers and a ≥ 70 % majority. A real split is still a conflict, and GRADE inconsistency only counts real conflicts.
5. **Cache invalidation.** Bumping `prompt_version` makes a repeated topic run again instead of returning the cache.

---

### Task 1: Cache key includes the pipeline version
- **Files:** `app/schemas/review.py` (`compute_cache_key(topic, language, options, version="")`), `app/services/review_service.py` (pass `settings.prompt_version`), `app/config.py` (`prompt_version = "2026-10-05.1"`), tests in `test_reviews_api.py`.
- **Tests:**
  - `test_cache_key_changes_with_prompt_version`: equal inputs with a different version give a different key.
  - `test_new_prompt_version_does_not_reuse_old_review`: create with v1, mark it done, then create again with v2 gives `cached=False`.
- **Commit:** `fix(cache): a pipeline/prompt version change no longer serves old results`

### Task 2: Study design category
- **Files:** `app/graph/schemas.py`, `app/graph/prompts.py` (EXTRACT_SYSTEM), `app/harness/verify.py` (`card_problems` gets `pub_types`), `app/graph/nodes/reading.py`, `app/harness/grade.py`, tests.
- **Produces:**
  - `DesignCategory = Literal["rct", "non_randomized_trial", "cohort", "case_control", "cross_sectional", "case_series", "mendelian_randomization", "sr_ma_rct", "sr_ma_observational", "sr_ma_mixed", "narrative_review", "other"]`
  - `PaperCard.design_category: DesignCategory | None = None`
  - `grade.is_randomized(card)` works on a card dict: it uses the category when present and falls back to the text heuristic.
  - `verify.design_problems(card, pub_types) -> list[str]` checks:
    - "Randomized Controlled Trial" in pub_types requires `rct`/`sr_ma_rct`/`sr_ma_mixed`.
    - "Meta-Analysis" or "Systematic Review" in pub_types requires `sr_ma_*`.
    - A missing category is a problem.
- **Tests:**
  - The validator flags RCT pub type vs `cohort`, and Meta-Analysis vs `cohort`.
  - The repair round feeds the problem back.
  - GRADE starts high for a majority of `rct` + `sr_ma_rct`.
  - A legacy card using text "Systematic review and meta-analysis of randomized trials" is still randomized.
  - When the final card's category is still missing, `reading` maps text to a category deterministically (`infer_design_category(text)`) and never leaves it None when the text matches a known design.
- **Commit:** `feat(harness): a fixed study-design category, cross-checked with Europe PMC publication types`

### Task 3: Screening drops non-research papers
- **Files:** `app/graph/nodes/retrieval.py` or `screening.py` (deterministic filter), `app/graph/prompts.py` (SCREEN_SYSTEM), tests.
- **Produces:**
  - `NON_RESEARCH_TYPES = {"Editorial", "Letter", "Comment", "Published Erratum", "Retraction of Publication", "News", "Retracted Publication"}`
  - A candidate is excluded before screening when every one of its `pub_types` is non-research, or any of them is a retraction. The count goes to `search_stats.non_research`.
  - The screen prompt explicitly excludes narrative/non-systematic reviews, unless they are the only evidence.
  - After extraction, `select`/`matrix`/GRADE use only cards whose category is not `narrative_review`. Narrative reviews stay in the paper list, labelled.
- **Tests:**
  - An editorial and a retracted paper are dropped before the LLM and counted.
  - The prompt names narrative reviews.
  - A `narrative_review` card is excluded from matrix rows and from GRADE but stays in `papers`.
- **Commit:** `feat(screening): drop editorials, letters and retracted papers; keep narrative reviews out of the evidence`

### Task 4: Clustering is repaired, not discarded
- **Files:** `app/harness/matrix.py` (`repair_clusters(clusters, papers) -> (OutcomeClusters, int)`), `app/graph/nodes/synthesis.py` (normalize uses it after the runner), tests.
- **Rules:**
  - Unknown members are dropped.
  - A duplicate assignment keeps the first.
  - A missing outcome joins the cluster whose canonical name matches its normalized title, or else becomes a singleton.
  - An empty canonical name takes its first member's name.
- **Quality:** the number of corrections becomes `normalization_repairs`. Fall back entirely only when the runner returns no value.
- **Tests:**
  - One missing, one duplicate and one unknown member give a valid clustering with 3 repairs.
  - The fallback flag stays False.
  - The validator passes on the repaired output.
- **Commit:** `fix(harness): repair a near-miss outcome clustering instead of discarding it`

### Task 5: Consensus with dissent; conflicts only for real splits
- **Files:** `app/harness/matrix.py` (`build_matrix`), `app/harness/grade.py`, `app/graph/nodes/synthesis.py` (consensus statements carry dissent), tests.
- **Rules per row:**
  - Let n = the number of distinct refs with a known direction (positive, negative, null or mixed).
  - When the top direction has ≥ 70 % of n and n ≥ 3, the row is consensus: `{outcome, direction, refs, dissent: {direction: refs}}`.
  - When the top direction has ≥ 70 % of n and n < 3: a single direction with 2 refs is consensus (unchanged); 2 refs that differ are a conflict.
  - Otherwise, when ≥ 2 directions are present, the row is a conflict (unchanged shape).
  - GRADE inconsistency drops a level only for conflicts. Consensus with dissent adds the factor "minor inconsistency" without lowering the level.
- **Tests:**
  - 9 positive + 1 null gives consensus with dissent `{null: [P10]}`, and no conflict.
  - 3 positive + 2 negative gives a conflict.
  - 1 positive + 1 negative gives a conflict.
  - 2 positive gives consensus.
  - GRADE is not lowered for consensus with dissent.
- **Commit:** `feat(synthesis): consensus tolerates a minority of dissenting studies; conflicts are real splits`

### Task 6: Web app: design categories and dissent
- **Files:** `frontend/src/lib/types.ts`, `src/lib/i18n.ts` (`DESIGN_LABEL` th/en), `src/lib/charts-data.ts` (the filter uses `design_category ?? study_design`), `src/components/review/filter-bar.tsx`, `report-parts.tsx` (consensus shows "ยกเว้น P10 (ไม่พบความสัมพันธ์)"), `source-rail.tsx` (design row: label + detail), tests.
- **Tests:**
  - The design filter offers category labels and filters by category.
  - A legacy card without a category still filters by its text.
  - Consensus dissent renders.
- **Commit:** `feat(web): filter by study-design category and show dissent in consensus`

### Task 7: Live re-measurement
- **Step 1:** Rebuild api, worker and web.
- **Step 2:** With the local API key, run the same 3 topics. The `prompt_version` bump makes them run fresh.
- **Step 3:** Ledger a before/after table:

  | Metric | Before | After |
  |---|---|---|
  | Time | | |
  | Cost | | |
  | Verification rate | | |
  | Distinct design labels | | |
  | Narrative reviews in evidence | | |
  | `normalization_fallback` | | |
  | Consensus / conflicts | | |
  | Evidence strength | | |
  | Kept English | | |

- **Expected:**
  - all `done`
  - narrative reviews in evidence: 0
  - normalization fallback: False on all three
  - metformin consensus ≥ 1
