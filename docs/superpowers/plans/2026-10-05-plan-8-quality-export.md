# Plan 8: Extraction robustness, evidence tiers, single-file HTML export, Plan 7 minors

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Fix the measured extraction failures on multi-outcome RCT abstracts, stop counting pooled and primary evidence as independent, let users download the interactive report as one HTML file, and close the deferred Plan 7 minors.

**User request (2026-10-05):** "ทำ plan 8 ต่อได้เลย" (in the same message: production readiness → Plan 9; landing redesign → separate, after the user picks a mockup).

**Why (measured on the live colchicine review, Qwen3.5 Flash, 19 selected papers):**
- 74.5 % of numbers were verified, there were 12 escalations, and 2 cards (P1, P12) failed outright.
- Re-running P1 and P12 shows a deterministic cause. The model lists every "outcome of interest" and sets `evidence_quote: null` for outcomes the abstract does not report. `OutcomeResult.evidence_quote: str` then rejects the whole card, and the same error survives every repair and the same-model escalation.
- Most cards carry quote-less, number-less filler outcomes (e.g. 4 of 5).
- The secondary extractor and the escalation run the same model as the primary. They roughly double the extraction cost for little independent checking.
- In this review, 12 of 17 cards were SR/MA of RCTs alongside the RCTs those reviews pool. GRADE and the narrative count them as independent.

**Spec:** `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md`. The single-file interactive HTML export comes from §5, the web section ("ดาวน์โหลดเป็นไฟล์ interactive HTML เดี่ยว").

## Global Constraints
- Numbers shown to users are verified against the abstract. Unverifiable numbers are nulled, never guessed.
- Every LLM output is validated in code. A near miss is corrected deterministically or repaired. It never fails the whole card or review when part of it is usable.
- Old stored results (no `pooled` cell flag, no evidence tiers) still render and export.
- Bump `prompt_version` when extraction or synthesis behaviour changes, so the re-measurement is not served from the cache.

## Review Focus
1. **Partly unusable outcomes:** a card where some outcomes have a quote and some do not keeps the quoted ones and drops the rest. A card where none have a quote still keeps its design, sample size and limitations.
2. **Same model, two roles:** when the secondary extractor or the escalation model equals the primary, it is skipped. No duplicate cost, no pointless escalation. Different models still cross-check.
3. **Pooled studies:** with SR/MA present, GRADE starts from the pooled evidence and says that primary studies may overlap. Without SR/MA, behaviour is unchanged.
4. **HTML export:** the downloaded file opens offline. It has no network calls except optional fonts. The review JSON is embedded safely: a `</script>` inside a title cannot break out.
5. **CSV formulas:** a cell starting with `=`, `+`, `-` or `@` is neutralised. Negative numbers in numeric columns stay numbers.

---

### Task 1: Extraction robustness (measured)
- **Files:** `app/graph/schemas.py` (OutcomeResult/PaperCard lenient before-validator), `app/graph/prompts.py` (EXTRACT_SYSTEM: report only outcomes the abstract states, at most 6, most relevant first), `app/graph/nodes/reading.py` (same-model secondary skipped), `app/harness/runner.py`/`app/services/llm.py` (same-model escalation skipped), `app/config.py` (`prompt_version` 2026-10-05.3), tests.
- **Rules:**
  - `PaperCard.outcomes` drops entries whose `evidence_quote` is null or blank before validation, and keeps at most 6.
  - A model's `null` for a required string list (limitations, key_findings) becomes `[]`.
  - The secondary extractor runs only when its model differs from the primary.
  - The escalation factory returns None when the escalation model equals the model that just failed.
- **Tests:**
  - A card JSON with one null-quote outcome validates and keeps the others.
  - A card with all quotes null validates with `outcomes == []`.
  - With the same model configured, the secondary is not called.
  - With the same model configured, escalation is skipped and the card is marked uncertain on disagreement.
  - With a different secondary model, both still run.
- **Live:** rerun the colchicine topic.
  - Expected: 0 failed cards, fewer escalations, a verification rate of at least the previous 74.5 %, and lower cost.
  - Record the result in the ledger.

### Task 2: Evidence tiers (pooled vs primary)
- **Files:** `app/harness/matrix.py` (cells carry `design_category` and `pooled`), `app/harness/grade.py` (with SR/MA present, the baseline is computed from pooled cards and the factor "primary studies may overlap with pooled analyses" is added), `app/graph/prompts.py` (NARRATIVE_SYSTEM: prefer pooled estimates; never present overlapping primary studies as independent confirmation), `frontend` matrix header marks SR/MA columns (badge "SR/MA"), tests.
- **Tests:**
  - GRADE with 2 `sr_ma_rct` + 3 cohorts starts from the pooled tier (high) and carries the overlap factor.
  - GRADE without SR/MA is unchanged.
  - The narrative prompt mentions pooled estimates.
  - Matrix cells carry `pooled`.
  - The frontend matrix renders the SR/MA badge, and legacy cells without the flag render as before.

### Task 3: Single-file interactive HTML export
- **Approach:** a standalone bundle of the existing report UI.
  - `frontend/src/standalone/main.tsx` renders `<Report>` from `window.__MRA_REVIEW__`.
  - esbuild bundles React, the report components and ECharts into one IIFE. `next/link` and `next/navigation` are aliased to tiny shims.
  - The Tailwind CLI compiles the CSS from the same sources.
  - A build script writes `frontend/standalone/report.js` and `report.css`, which ship in the web image.
  - The Next route handler `GET /r/[id]/report.html` fetches the review from the API server-side and returns one HTML document. It inlines the CSS, the JS and the review JSON. The JSON is escaped with `<` → `<`.
  - It sets `Content-Disposition: attachment; filename="review-<id8>.html"`.
  - The report's download menu gains "HTML (เปิดได้ออฟไลน์)".
- **Tests:**
  - The standalone render works from a fixture: vitest renders `mountStandalone`.
  - The HTML builder escapes `</script>` in data.
  - The route returns `text/html` with an attachment filename, and 404/409 pass through.
  - Playwright: the downloaded file opened via `page.setContent` shows the matrix and opens the source rail with no request to the API.
- **Size budget:** the file is at most 2 MB. Record the actual size.

### Task 4: Plan 7 minors
- **CSV:** neutralise formula-leading strings (prefix `'`).
- **Banner time:** the daily-cap banner uses `retry_after` to show the reopening time in the viewer's time zone.
- **Admission lock:** release is atomic compare-and-delete via WATCH/MULTI. Waiters back off with jitter.
- **Same origin:** an empty `PUBLIC_API_URL` also means same origin.
- **docs/api.md:** quote the real MCP error text; add 422 for malformed UUIDs on `/events` and `DELETE`.
- **Tests:**
  - Rename and split the weak tests (Turnstile key vs MCP; the OpenAPI version assert).
  - `test_catalog_loads_from_openrouter` never touches the network.
- **Style:** move the status import to module level and rename `format` → `fmt` with alias `format`.

### Task 5: Live acceptance
1. Rebuild the stack and run 3 topics: colchicine, metformin and SGLT2.
2. Compare against the Plan 6/7 measurements.
3. Download an HTML export and open it offline.
4. Run the full suites.
