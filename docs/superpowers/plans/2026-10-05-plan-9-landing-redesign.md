# Plan 9: Landing Redesign ("แตะที่ตัวเลขดูก่อน") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page with direction C. Instead of reading claims, the visitor taps real verified numbers from a real review and sees the sentence each one came from. Then they send their own question from the existing request slip.

**Architecture:**
- **The sample.** A committed snapshot of one real public review is the sample:
  - topic: colchicine after myocardial infarction
  - review a6213fef, 2026-10-05, Qwen3.5 Flash
  - It is a subset of the real `Paper` objects, so the existing helpers render it: `forestData`, `effectLabel`, `ciLabel`, `isBlankedEffect` and `findReported`.
  - A unit test proves that every number shown is found verbatim in its quote.
- **The sample bench.** A light SVG forest plot plus a source rail. There is no ECharts on `/`.
- **The rest of the page.** Static sections, the live `listRecent` list and a site footer.

**Tech Stack:** Next.js 16 (App Router, React 19), Tailwind 4 tokens in `globals.css`, Vitest + Testing Library, Playwright + axe.

**Spec:**
- `DESIGN.md` (Theatre Green). Landing mode: "Persuade, by showing a real receipt rather than claims".
- Mockup direction C (`landing-directions.html`, private artifact https://claude.ai/artifact/JWBF5BDC9c2Hb1uenjivpG).
- The user's instruction of 2026-10-05: "redesign หน้า landing page ให้สวยงามกว่านี้", done autonomously.

## Global Constraints

- **Rendering verified numbers:**
  - Verified numbers render only through `VerifiedNumber`.
  - Blanked values render only through `Hole`.
  - Numbers on any chart come only from `src/lib/charts-data.ts`.
  - Never compute or type a number shown as if it came from a paper.
- **Typefaces:**
  - Martian Mono is only for verified numbers.
  - Code snippets use a separate code face, `--font-code`: `ui-monospace, "Cascadia Code", Menlo, Consolas, monospace`.
  - Pipeline counts and times use `font-display` with `tabular-nums`.
- **Chart colour:**
  - Brand greens and the highlight yellow stay out of charts.
  - Every direction colour is paired with a glyph and an accessible name.
- **Visual style:**
  - 2px corners and 1px rules.
  - No shadows, gradients or pill buttons.
  - No logo wall, no kicker above headings, no centred body text.
- **Layout:**
  - 16px side gutter at every width.
  - No horizontal page scroll at 390px.
  - Running text is at most 65ch wide.
- **Motion:** `prefers-reduced-motion` removes every transition.
- **Labelling the sample:**
  - Label it as a snapshot of a real review, with its date: "ตัวอย่างจากรีวิวจริง · 5 ต.ค. 2026".
  - Never present it as live data.
  - Link to the paper (DOI/PubMed), never to `/r/a6213fef…`, because that id exists in only one database.
- **Thai line breaks:** the H1 uses no-wrap phrase groups (`.nw`) so Thai never breaks mid-phrase.
- **Dependencies:** no new runtime dependencies.

## Review Focus

1. **Keyboard-only visitor:**
   - Every tappable number and forest row is a real button with `aria-pressed`.
   - The rail announces the selection with `aria-live="polite"`.
   - Focus never jumps.
2. **390px phone:**
   - The bench stacks, with the rail below the plot and collapsible.
   - The SVG scales by its viewBox.
   - Long journal names and quotes wrap.
   - No horizontal scroll.
3. **Dark theme ("Night shift"):**
   - The plot axis, null line, CI lines and labels use text tokens.
   - The tape and the highlight stay readable on the dark ground.
4. **Backend down:**
   - The recent-reviews section shows a calm empty or error line.
   - The rest of the page (sample, slip) still works.
   - The slip's capacity banner behaves as before.
5. **Snapshot drift.** If anyone edits the snapshot, a test fails unless both hold:
   - every shown effect and CI bound is still found verbatim in its quote;
   - the demo still contains at least one blanked value.

---

### Task 1: Sample snapshot and its guard

**Files:**
- Create: `scripts/landing_sample.py`. It rebuilds the snapshot from a review JSON: `python scripts/landing_sample.py <review.json> > frontend/src/data/landing-sample.json`
- Create: `frontend/src/data/landing-sample.json`
- Create: `frontend/src/lib/landing-sample.ts`
- Test: `frontend/src/lib/landing-sample.test.ts`

**Interfaces:**
- Produces: `SAMPLE: LandingSample`, where
  `interface LandingSample { topic: string; capturedOn: string /* ISO date */; question: string /* Thai refined question */; stats: Stats; quality: { numbers_verified: number; numbers_total: number; verification_rate: number }; papers: Paper[] }`
- Produces: `SAMPLE_OUTCOME = "Major Adverse Cardiovascular Events (MACE)"`, the outcome the plot shows.

**Papers kept.** Only the MACE outcome is kept for each paper, with `card` and `card_en` trimmed by the same indexes. The plot has 7 drawn rows and 1 blank:

| Ref | Design | Value kept |
|---|---|---|
| P1 | COLCOT RCT 2019 | MACE HR 0.77; also the blanked recurrent-MI outcome (a `Hole` in the anatomy section) |
| P2 | RCT 2025 | MACE HR 0.99 |
| P4 | SR/MA 2025 | MACE RR 0.90 |
| P5 | SR/MA 2023 | MACE RR 0.56 |
| P8 | SR/MA 2025 | MACE RR 0.75 |
| P10 | SR/MA 2026 | MACE OR 0.87 |
| P15 | SR/MA 2024 | MACE RR 0.73 |
| P11 | SR/MA 2025 | MACE value blanked by the verifier: listed under the plot as a `Hole`, not drawn |

P25 (HR 0.55) is left out on purpose: it is a "no prior ACS" subgroup and would mislead in a post-MI demo.

The script keeps only these fields per paper: `ref, title, journal, year, doi, pmid, url, card, card_en, verification, relevance`. `verification.unverified` is filtered to the kept outcomes.

- [ ] **Step 1: Failing test.** `landing-sample.test.ts` checks:
  - Every outcome whose effect is shown (`effect_value != null && !isBlankedEffect(paper, outcome)`) has `findReported(effect_value, quote) !== null`. The same holds for `ci_lower` and `ci_upper` when present.
  - At least one outcome is blanked (`isBlankedEffect` is true), so the page can show a real `Hole`.
  - `forestData(SAMPLE.papers, "th")` has a ratio group with at least 5 rows.
  - `stats.found > stats.unique >= stats.screened >= stats.extracted > 0`.
  - `capturedOn` is a valid ISO date.
- [ ] **Step 2:** run `npx vitest run src/lib/landing-sample.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** write the script, generate the JSON from `$TEMP/colch2.json`, and write `landing-sample.ts` (a typed import of the JSON).
- [ ] **Step 4:** the test passes; run `npm run typecheck`.
- [ ] **Step 5:** commit `feat(landing): snapshot of a real review as the landing sample, guarded by a verbatim test`.

### Task 2: Hero and sample bench

**Files:**
- Create: `frontend/src/components/landing/sample-bench.tsx`, `frontend/src/components/landing/mini-forest.tsx`
- Create: `frontend/src/components/ui/quote.tsx`. Move `HighlightedQuote` here from `receipt-panel.tsx` and update the import in `source-rail.tsx`.
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/components/landing/sample-bench.test.tsx`, `mini-forest.test.tsx`

**Interfaces:**
- Consumes: `SAMPLE`, `forestData`, `forestAxis`, `effectLabel`, `ciLabel`, `findReported`, `VerifiedNumber`, `Hole`, `Glyph`, `designLabel`, `designKey`.
- Produces `<MiniForest group={ForestGroup} selected={string|null} onSelect={(key) => void} lang="th" />`:
  - one `<button>` per row;
  - the SVG is drawn from `forestAxis(group)` on a log scale;
  - rows the verifier omitted are listed under the plot as a `Hole` plus "ไม่วาด ไม่ประมาณ".
- Produces `<SampleBench />`, a client component containing:
  - a report bar and the refined question;
  - the plot;
  - a one-paragraph summary whose numbers are `VerifiedNumber` buttons;
  - a source rail with the title, journal · year · design, the quote via `HighlightedQuote`, and a DOI/PubMed link via `safeHref`.

**Layout:**
- Hero at `lg`: two columns, with the H1 and sub on the left and `RequestSlip` on the right.
- Bench: below the hero at full width. A 7/5 split at `lg`, stacked below that.
- H1: `<span class="nw">อย่าเพิ่งเชื่อเรา</span> <span class="nw">แตะที่ตัวเลข</span><span class="nw">ดูก่อน</span>`.
- Default selection is P1 MACE, so the rail is never empty.

- [ ] **Step 1: Failing tests:**
  - MiniForest renders one button per row. Each accessible name contains the ref, the measure and the verified value, e.g. "P1 HR 0.77 95% CI 0.61–0.96".
  - MiniForest draws the null line at x(1) and puts a point inside the CI for every row.
  - Clicking a row calls `onSelect` with its key and sets `aria-pressed`.
  - SampleBench shows P1's quote by default, with "0.77" in a `<mark>`.
  - Clicking the P2 row swaps the rail to P2's quote, with "0.99" marked.
  - The blanked recurrent-MI value shows a `Hole`.
  - The summary's numbers are `.num-verified`, and clicking one selects its paper.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement. Add `.nw { white-space: nowrap }` and `--font-code` to `globals.css`. Switch `CodeBlock`'s `<pre>` from `font-num` to `font-code`.
- [ ] **Step 4:** `npx vitest run` is all green; then `npm run lint && npm run typecheck`.
- [ ] **Step 5:** commit `feat(landing): hero and a tappable sample report from a real review`.

### Task 3: Anatomy, timeline and the API/MCP band

**Files:**
- Create: `frontend/src/components/landing/anatomy.tsx`, `timeline.tsx`, `agent-band.tsx`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/components/landing/sections.test.tsx`

**Anatomy** uses P1 from the snapshot, in three steps:
1. The model's claim as plain text: `effectLabel`, body face, no tape.
2. The real quote with the value marked.
3. The same value as a `VerifiedNumber`, beside a `Hole` for the blanked recurrent-MI value.

**Timeline:**
- Five steps with approximate times: 0:00, ~0:15, ~0:40, ~1:00, 1–3 นาที.
- Under the steps, the snapshot's real pipeline counts in `font-display tabular-nums`: "พบ 174 → ไม่ซ้ำ 143 → คัดกรอง 60 → วิเคราะห์ 26".

**Agent band:**
- The MCP tools list: `search_papers`, `start_review`, `get_review_status`, `get_review_result`.
- A `CodeBlock` with an MCP config snippet: the same-origin URL from `apiUrl()` plus `/mcp`.
- Links to `/about` and the API docs.

- [ ] **Step 1: Failing tests:**
  - Anatomy step 1's value has no `.num-verified`.
  - Anatomy step 3 has exactly one `.num-verified` and one `.hole`.
  - The timeline lists five steps in order, and its counts come from `SAMPLE.stats`.
  - The agent band names all four tools, and its code block contains `/mcp`.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** tests green; run lint and typecheck.
- [ ] **Step 5:** commit `feat(landing): how a number earns its tape, the 1–3 minute timeline, and the agent band`.

### Task 4: Recent reviews and site footer

**Files:**
- Create: `frontend/src/components/landing/recent-reviews.tsx`, `frontend/src/components/site-footer.tsx`
- Delete: `frontend/src/components/landing/receipt-panel.tsx` and its test. The sample replaces the live receipt, and the list moves to `RecentReviews`.
- Modify: `frontend/src/app/layout.tsx` (render `<SiteFooter />` after `<main>`), `frontend/src/app/page.tsx`
- Test: `recent-reviews.test.tsx`, `site-footer.test.tsx`

**RecentReviews:**
- Rows come from the done reviews in `listRecent(8)`. Each row shows the topic, language, papers analysed, verified %, and relative time.
- Loading: a loading line.
- Empty: "ยังไม่มีรีวิวสาธารณะที่เสร็จแล้ว".
- Error: "โหลดรายการไม่ได้ตอนนี้ ส่วนอื่นของหน้ายังใช้ได้ตามปกติ".

**Footer:**
- The not-medical-advice disclaimer.
- Data sources: PubMed, Europe PMC, arXiv, Semantic Scholar, OpenAlex, CrossRef.
- Links: หน้าแรก, เกี่ยวกับ, API และ MCP.

- [ ] **Step 1: Failing tests:**
  - Rows link to `/r/{id}` and show the verified percentage.
  - A rejected `listRecent` shows the error line and no rows.
  - The footer contains the disclaimer and every data source.
- [ ] **Step 2:** run. Expected: FAIL.
- [ ] **Step 3:** implement. Remove the old "สิ่งที่เอเจนต์ทำ" section and the disclaimer line from `page.tsx`; the footer now carries the disclaimer.
- [ ] **Step 4:** tests green.
- [ ] **Step 5:** commit `feat(landing): recent public reviews and a site footer`.

### Task 5: End-to-end, design pass, docs

**Files:**
- Modify: `frontend/e2e/app.spec.ts`
- Modify: `DESIGN.md` (Decisions Log rows: landing direction C; `--font-code` for code)
- Modify: `README.md` (the landing description line, if there is one)

- [ ] **Step 1:** update the landing e2e to check:
  - the H1 text;
  - tapping the P2 row shows "0.99" marked in the rail;
  - the `Hole` is visible;
  - submit still opens the live run;
  - axe (wcag2a/aa) reports no serious violations in light or dark;
  - at 390px there is no horizontal scroll and the rail sits below the plot;
  - with the API down, the recent list shows the error line.
- [ ] **Step 2:** `npx playwright test` is green. Take screenshots (light, dark, 390px) and look at them. Fix anything that collides, overflows or departs from DESIGN.md.
- [ ] **Step 3:** update the docs, then run the full suites: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npx playwright test`, and backend `uv run pytest -q`.
- [ ] **Step 4:** commit `test(landing): e2e, accessibility and phone checks for the new landing`.
