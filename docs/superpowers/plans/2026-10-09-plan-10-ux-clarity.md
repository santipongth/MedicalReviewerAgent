# Plan 10: UX Clarity Pass (landing slip, live run, answer-first report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three user-facing surfaces easier to understand for lay users and clinicians:
- **Request slip on `/`:** empty topic field; secondary options folded away; Thai study-type labels; an explained disabled state; a mobile jump link to the form.
- **Live run on `/r/[id]`:** a real queue step; plain counters instead of a paragraph explaining the wells; the search queries shown; a time hint; a copy-link button with "you can close this tab"; retry buttons.
- **Report:** answer first, plus a section nav, a glossary, folded filters, a readable matrix, an accessible mobile drawer, and a page title per review.

**Architecture:** Frontend only (`frontend/`). No backend change. A cancel button is out of scope: `DELETE /reviews/{id}` requires the API key that created the review, and browser submissions have none.

New modules:
- `src/lib/glossary.ts` and `src/components/ui/term.tsx`: accessible term explanations.
- `src/lib/copy.ts`: shared copy strings.
- `src/components/ui/copy-link.tsx`: the copy-link button.
- `src/components/review/bottom-line.tsx`
- `src/components/review/report-nav.tsx`
- `src/components/review/rail-drawer.tsx`
- `src/lib/server-api.ts`

**Tech Stack:** Next.js 16 (App Router, React 19), Tailwind 4 tokens in `globals.css`, Vitest + Testing Library, Playwright + axe. Read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before framework code: `params` and `searchParams` are Promises, and the page props type is `PageProps<'/r/[id]'>`.

**Spec:**
- `DESIGN.md` (Theatre Green).
- The user's instruction of 2026-10-09: analyse whether the dashboard (landing + live run) and the results screen are really easy to use, then redesign them to be easier to understand. Chosen direction: "answer first" report restructure, no mockup.
- Approved plan: `C:\Users\santi\.claude\plans\dashboard-twinkling-spindle.md`.

## Global Constraints

- **Rendering verified numbers:**
  - Verified numbers render only through `VerifiedNumber`.
  - Blanked values render only through `Hole`.
  - Chart numbers come only from `src/lib/charts-data.ts`.
  - Never compute or type a number shown as if it came from a paper.
- **Counts:**
  - Counts of papers, pipeline counts and times are review facts, not paper numbers. Render them with `font-display tabular-nums`, NEVER with `VerifiedNumber` or `num-verified`.
  - Any function counting papers lives in `src/lib/charts-data.ts`.
- **No invented summaries:** never synthesise a new "verdict" sentence. Reuse what the API returns: `executive_summary`, evidence strength and rationale, the verified counts.
- **DESIGN.md:**
  - Flat surfaces, 1px rules, 2px corners; no shadows, gradients or pill buttons.
  - No nested cards, no kicker above headings, no centred body text.
  - Status blocks use a tinted background, never a coloured left border.
  - Finding colours (Okabe-Ito) are always paired with a glyph shape.
  - Bai Jamjuree for UI, Anuphan for body, Martian Mono only for verified numbers, Source Serif 4 only for verbatim quotes.
  - Code text uses `font-code`.
- **Approved departures from DESIGN.md** (Task 10 updates DESIGN.md to match):
  - The rail and drawer breakpoint stays at `lg` (1024px).
  - New parts: a report section nav, a glossary popover, and a warning-flag `UncertainFlag` replacing the ◆ used for "uncertain" (◆ is the harm glyph).
  - "Agree/conflict" moves above the matrix.
- **Landing headline:** the h1 "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" stays verbatim.
- **Offline report:** `<Report>` is also built into an offline HTML file (`src/standalone/main.tsx`, Vite; only `next/link` is shimmed). Components rendered inside the report:
  - must not import `next/*` other than `next/link`;
  - must make no server calls;
  - must hide copy-link when `offline`.
- **Copy:**
  - UI copy is Thai and must be plain.
  - Report-body strings stay bilingual through `L(lang, th, en)` from `src/components/review/text.ts`.
  - Glossary entries carry both th and en.
- **Accessibility:** keyboard and touch operable; Esc closes popovers and drawers; focus is visible (2px primary outline); `prefers-reduced-motion` is respected; axe stays clean.
- **Git:**
  - Stage only the files the task touched (`git add <paths>`, never `git add -A` or `git add .`). The working tree has unrelated uncommitted edits to the root `CLAUDE.md` and `frontend/CLAUDE.md` that must not be committed.
  - Commit messages follow the repo style (`feat(report): …`, `test(…)`, `fix: …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands** (run from `frontend/`): `npm test` (vitest), `npm run lint`, `npm run typecheck`, `npm run build:standalone`, `npm run e2e`. Each task runs the unit tests and lint/typecheck for what it touched. Task 10 runs e2e.

## Review Focus

- No count or time rendered with `num-verified`, and no new paper-derived number outside `charts-data.ts`.
- The offline build still works: no `next/*` imports in report components besides `next/link`.
- Existing tests updated rather than deleted. Assertions still test behaviour, not markup trivia.
- Thai copy is plain and consistent across the slip, the live run and the terminal states.

---

### Task 1: Shared groundwork — glossary, Term, UncertainFlag, Hole explain, copy constants, CopyLinkButton

**Files:**
- Create: `src/lib/glossary.ts`, `src/components/ui/term.tsx`, `src/lib/copy.ts`, `src/components/ui/copy-link.tsx`
- Modify: `src/components/ui/evidence.tsx`, `src/app/globals.css` (only if needed)
- Tests: `src/components/ui/term.test.tsx`, `src/lib/glossary.test.ts`, `src/components/ui/copy-link.test.tsx`, plus additions to the existing evidence test file

**`glossary.ts`:**
- Shape: `export type TermKey = …` and `export const GLOSSARY: Record<TermKey, { label: { th: string; en: string }; body: { th: string; en: string } }>`.
- Keys:
  - `pico`, `evidenceStrength`, `riskOfBias`
  - `rct`, `nonRandomized`, `cohort`, `caseControl`, `crossSectional`, `caseSeries`, `mendelian`, `srma`, `narrativeReview`
  - `hr`, `or`, `rr`, `md`, `smd`, `rd`, `ci95`
  - `logScale`, `prisma`, `relevance`, `notVerified`, `uncertain`, `directionTally`
- Bodies are 1–2 plain sentences each, accurate and with no numbers presented as findings. Required texts:
  - `notVerified` (th): "ตัวเลขนี้ถูกซ่อนเพราะตรวจกับต้นฉบับไม่ผ่าน ระบบไม่เดาค่าแทน"
  - `relevance` (th): "คะแนน 0–100 ที่เอเจนต์ให้ตอนคัดกรอง ว่างานวิจัยตอบคำถามนี้ตรงแค่ไหน"
  - `uncertain` (th): "โมเดลสองตัวอ่านทิศทางผลของงานนี้ไม่ตรงกัน ควรอ่านประโยคต้นฉบับเอง"
  - `directionTally` (th): "นับจำนวนงานวิจัยตามทิศทางผลโดยรวมที่เอเจนต์อ่าน ไม่ใช่ผลรวมทางสถิติ"

**`term.tsx`, `<Term k lang? children?>`:**
- Implemented with React state, not the native popover API.
- The trigger is a `<button type="button" aria-expanded aria-controls>` showing `children ?? label`, with a dotted underline in `primary`.
- The panel is a `<span role="note" id>`, absolutely positioned under the trigger. Below `sm` it is fixed to the bottom of the viewport. Style: flat `bg-surface`, `border border-rule`, `rounded-sm`, no shadow.
- Esc closes it and returns focus to the trigger; clicking outside closes it.
- Uses `L()` for the language.
- Must not cause horizontal scroll at 375px.
- Document in a comment that a Term must never be placed inside another button.

**`evidence.tsx`:**
- Add `UncertainFlag({ lang?, label? })`: a small inline SVG flag in the `warn` colour plus a text label, defaulting to "สองโมเดลอ่านต่างกัน" / "models disagree".
- `Hole` gains an optional `explain?: boolean`. When true, it renders `<Term k="notVerified">` AFTER the hatched slot, outside it. The default render stays byte-identical, because the landing tests count `.hole`.

**`copy.ts`:** `export const TYPICAL_DURATION_TH = "ปกติใช้ 1–3 นาที"`.

**`copy-link.tsx`, `CopyLinkButton`:**
- Uses `navigator.clipboard.writeText(location.href)` and shows "คัดลอกแล้ว" in a `role="status"` region.
- If the clipboard fails, it falls back to showing a read-only input with the URL selected.
- Label: "คัดลอกลิงก์". Styled as a ghost button: `rounded-sm border border-rule`.

**Tests:**
- Term:
  - opens and closes on click;
  - Esc closes it and focus returns to the trigger;
  - `aria-expanded` toggles;
  - th and en text both render.
- Every glossary key has non-empty th and en for both `label` and `body`.
- `Hole` without `explain` keeps the same markup; with `explain`, it shows the Term.
- `UncertainFlag` renders its accessible text.
- CopyLinkButton writes to the clipboard (mocked) and shows the status. Its fallback path shows the input.

### Task 2: Landing — request slip, hero, recent reviews

**Files:**
- Modify: `src/components/landing/request-slip.tsx`, `src/app/page.tsx`, `src/components/landing/sample-bench.tsx`, `src/components/landing/recent-reviews.tsx`
- Tests: `request-slip.test.tsx`, `recent-reviews.test.tsx`, `sample-bench.test.tsx`; page tests if any exist

**RequestSlip:**
- **Topic field:**
  - New prop `initialTopic?: string`. The initial value is `initialTopic ?? ""` (the current example pre-fill is removed).
  - Placeholder: `เช่น เมตฟอร์มินกับมะเร็งลำไส้ใหญ่`.
  - The "ลองหัวข้อ" example buttons still fill the field.
- **Header:** `ใบส่งคำถาม` only; drop "· REVIEW REQUEST".
- **Language radios** stay visible.
- **Folded options:** study types, paper count and start year move into `<details>`.
  - The `<summary>` reads "ตัวเลือกเพิ่มเติม" followed by the current choices, e.g. "ทุกชนิดงานวิจัย · สูงสุด 30 ฉบับ · ทุกปี". It updates as the user changes them.
  - The slider default stays as it is now, or comes from the status limits if they are already used.
- **Study-type labels:** `[value, label]` pairs. The value sent stays English, exactly as before.
  - `RCT` → "การทดลองแบบสุ่ม (RCT)"
  - `Cohort` → "การศึกษาติดตามกลุ่ม (Cohort)"
  - `Case-control` → "การศึกษาย้อนหลังแบบมีกลุ่มเปรียบเทียบ (Case-control)"
  - `Meta-analysis` → "การวิเคราะห์อภิมาน (Meta-analysis)"
  - `Systematic review` → "การทบทวนวรรณกรรมอย่างเป็นระบบ (Systematic review)"
- **Turnstile wait:** while the token is pending (site key set, no token yet, widget not failed), show `<p id=…>` "กำลังยืนยันว่าเป็นผู้ใช้จริง ปุ่มส่งจะใช้ได้ในไม่กี่วินาที" and reference it from the disabled button's `aria-describedby`.
- **Anchor:** the form gets `id="request"`.

**`page.tsx`:**
- `Home(props: PageProps<"/">)` reads `const { q } = await props.searchParams`. It takes the first value if `q` is an array, trims it, caps it at 300 characters, and passes it as `initialTopic`.
- Replace the hero paragraph under the unchanged h1 with: "ส่งคำถามเรื่องโรค ยา หรือสาร เอเจนต์จะอ่านงานวิจัยที่เกี่ยวข้อง เทียบผลที่ตรงกันและขัดกัน และให้คุณตรวจทุกตัวเลขกับประโยคต้นฉบับได้ ฟรี ไม่ต้องสมัคร".
- Below `lg`, add a ghost-button link `<a href="#request">ส่งคำถามของคุณ ↓</a>`.
- Move the tape/hatching explanation sentence(s) from the hero into the intro of `SampleBench`, next to the receipt they explain.

**RecentReviews:**
- Add an `aria-hidden` header row on the same grid: "หัวข้อ · ภาษา · เมื่อ · ตัวเลขตรวจผ่าน". On mobile, show only the right-hand label "ตรวจผ่าน".
- Add an `sr-only` " ตัวเลขตรวจผ่าน" after the percentage, and `data-testid="share"` on the percentage span.

**Tests:**
- **Update:** tests that submit without typing (queue_full, busy, 429, Turnstile, etc.) must now type a topic first, because the field is empty and required. Study-type queries become `getByLabelText(/RCT/)`. The recent-reviews cell-order assertion uses `data-testid="share"`.
- **Add:**
  - the field is empty by default and shows the placeholder;
  - `initialTopic` pre-fills it;
  - the Turnstile reason text shows while the token is pending and is linked via `aria-describedby`;
  - the summary text reflects the choices made;
  - the submitted payload still sends English study-type values.

### Task 3: Live run — progress model and LiveRun

**Files:**
- Modify: `src/lib/progress.ts`, `src/components/review/live-run.tsx`, `src/components/review/review-screen.tsx` (pass `startedAt`)
- Tests: `progress.test.ts`, `live-run.test.tsx`

**`progress.ts`:**
- Add a real `queue` step at the front of `STEPS`. On the `queued` status it is the current step.
- Keep `run.queries`.
- Add a pure `readCounts(run)` returning `{ found, candidates, kept, read }`, where `read` is the number of papers whose read state is finished (ok or failed). Reuse the fields the reducer already tracks.

**LiveRun:**
- **Step list:** "รอคิว" is a real step.
- **Status line while connecting:** "กำลังเชื่อมต่อ…" (never "ผ่านไป 0 วินาที").
- **Elapsed time:** a 1-second local clock from the `startedAt` prop (`review.started_at`), falling back to `run.elapsed`. Append ` · ${TYPICAL_DURATION_TH}`.
- **Counters:** a `<dl>` above the tray, replacing the paragraph that explains the wells:
  - items: ค้นเจอ N → มีบทคัดย่อ N → ผ่านคัดกรอง N → อ่านแล้ว N/kept;
  - each label has a tiny well swatch in the matching tray state, so the tray explains itself;
  - `font-display tabular-nums`, never `num-verified`.
  - The tray stays, with its `role="img"` label.
- **Search queries:** under the "ค้น PubMed…" step once it is active or done, list `run.queries` in small `font-code` text. Show the first 3; the rest go in a `<details>` labelled "และอีก N คำค้น".
- **Reading rows:** "เสร็จ · ไม่แน่นอน" becomes `<UncertainFlag/>` "เสร็จ · สองโมเดลอ่านต่างกัน" with `<Term k="uncertain">`. The row is not a button.
- **Info block** (`bg-info-bg` or the existing info tint, no coloured left border): "ปิดแท็บนี้ได้ รีวิวยังทำงานต่อบนเซิร์ฟเวอร์ เก็บลิงก์ไว้เพื่อกลับมาดูผล" plus `<CopyLinkButton/>`.

**Tests:**
- **Update:** `/ไม่แน่นอน/` becomes `/สองโมเดลอ่านต่างกัน/`. Keep the `aria-current` test.
- **Add:**
  - on `queued`, "รอคิว" is `aria-current`;
  - connecting never shows "0 วินาที";
  - queries render;
  - counters have no `.num-verified`;
  - `readCounts` is correct.

### Task 4: Recovery — retry on unavailable, terminal states with retry link

**Files:**
- Modify: `src/lib/use-review.ts`, `src/components/review/review-screen.tsx`, `src/components/review/terminal-state.tsx`
- Tests: `use-review.test.tsx`, the terminal-state and live-run tests

**`useReview`:**
- Exposes `retry()`. It bumps an `attempt` counter that is in the effect's dependency list and resets `phase` to `"loading"`.
- The unavailable view in `ReviewScreen` gets a primary button "ลองอีกครั้ง".
- `ReviewScreen` sets `document.title` to the topic in an effect once the review is known. This is the client half of Task 9; do it here.

**TerminalState:**
- **error:** the raw `message` moves into `<details><summary>รายละเอียดทางเทคนิค</summary>`.
- **rejected:** the guard's reason stays visible. It is user-facing, and e2e asserts on it.
- **Primary action:**
  - error/cancelled: "ลองอีกครั้ง";
  - rejected: "แก้หัวข้อแล้วส่งใหม่";
  - both link to `/?q=${encodeURIComponent(topic)}#request`;
  - the secondary ghost link "ถามคำถามใหม่" goes to `/`.
- **Cancelled copy:** title "รีวิวนี้หยุดก่อนเสร็จ"; body "อาจถูกหยุดโดยผู้ส่งผ่าน API หรือผู้ดูแลระบบ ส่งคำถามเดิมอีกครั้งได้เลย".

**Tests:**
- retry after a rejected first load leads to the report;
- the retry link href contains `?q=` with the encoded topic;
- `/ยกเลิก/` becomes `/หยุดก่อนเสร็จ/`;
- rejected keeps a "ถามคำถามใหม่" link to `/`;
- the raw message sits inside a `details` element.

### Task 5: Report bottom line (answer first)

**Files:**
- Create: `src/components/review/bottom-line.tsx`
- Modify: `src/components/review/report-parts.tsx`, `src/components/review/report.tsx`, `src/lib/charts-data.ts`
- Tests: `report.test.tsx`, `review-fixes.test.tsx` and the charts-data tests (or new ones next to them)

**Split `QuestionHeader`:**
- `QuestionTitle`: label plus h1. The h1 is still the refined question, which tests rely on, at a smaller size: `clamp(1.2rem,2vw,1.5rem)`.
- `QuestionDetails`: one `<details>` "เอเจนต์ตีความคำถามอย่างไร" holding the interpretation, the PICO grid with `<Term k="pico">`, sub-questions, and assumptions/ambiguities. No nested `<details>`.

**`directionTally(papers)`** in `charts-data.ts`:
- Returns `Record<Direction, number>`, counting papers that have a card by `overall_direction`.
- Also expose whether any pooled (SR/MA) papers are included, or reuse the existing pooled detection.

**`BottomLine`:** a `<section aria-labelledby="h-summary">` containing, in order:
1. `QuestionTitle`.
2. `StrengthLine`, with `<Term k="evidenceStrength">` on its label and the verified count worded "ตัวเลขตรวจผ่าน n/m" (th) / "numbers verified n/m" (en).
3. H2 `id="h-summary"` "สรุป", with the `executive_summary` through `CitedText`.
4. The tally row: `Glyph` + direction label + count for each direction with a non-zero count, in `font-display tabular-nums`.
   - Label it with `<Term k="directionTally">`, worded "จำนวนงานวิจัยตามทิศทางผลที่เอเจนต์อ่าน".
   - When pooled papers are present, show the note "งานทบทวน/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลักที่นับรวม".
5. The action row:
   - "ดาวน์โหลด": a `<details>` holding the existing HTML/MD/CSV/JSON links;
   - `<CopyLinkButton/>`, hidden when `offline`;
   - "พิมพ์", which calls `window.print()`.

**Other changes:**
- `QuestionDetails` renders right after `BottomLine`.
- Fix the summary note that claims taped numbers appear "ในตาราง". Th: "ตัวเลขที่ตรวจกับต้นฉบับแล้วมีเส้นใต้ลายเทป ดูได้ในแถบต้นฉบับ (แตะช่องในตารางผลแต่ละการศึกษา) และในมุมมองตารางของแผนภาพ". Fix the en equivalent the same way.
- `QualityNote` and the disclaimer stay at the bottom; Task 6 moves them into the method section.

**Tests:**
- the tally matches the fixture's directions and contains no `.num-verified`;
- copy link is hidden when `offline`;
- the summary note no longer claims tape "in the table";
- the h1 is still the refined question;
- the downloads are still reachable.

### Task 6: Report section nav, order, and folded filters

**Files:**
- Create: `src/components/review/report-nav.tsx`
- Modify: `src/components/review/report.tsx`, `src/components/review/filter-bar.tsx`, `src/components/review/report-parts.tsx` (ClaimsPanel heading wrapper if needed)
- Tests: `report.test.tsx` and the filter tests

**`ReportNav({ items: {id,label}[] })`:**
- A `<nav aria-label="ในรายงานนี้">` of text links in a horizontally scrollable row. Do not let it cause page-level horizontal scroll.
- Sticky inside the reading column only, just under the site header: `bg-surface border-b border-rule`.
- Built only from sections that exist.
- Every H2 gets `scroll-mt-28`, or an equivalent so the sticky stack does not cover it.
- Optional: `aria-current` on the visible section via IntersectionObserver. It must be guarded for jsdom and the offline build.

**Section order and ids:**
1. `h-summary`: BottomLine, then `QuestionDetails`.
2. `h-claims`: a new H2 "จุดที่ตรงกันและขัดกัน" wrapping `ClaimsPanel`, whose h3 headings stay.
3. `h-matrix`: the filter toggle, the matrix and the single legend.
4. `h-charts`
5. `h-gaps`
6. `h-papers`
7. `h-method`, "วิธีทำและดาวน์โหลด": `QualityNote`, the external context, the download links repeated as plain links, and the disclaimer.

Nav labels, in the same order: สรุป · จุดตรงกัน/ขัดกัน · ผลแต่ละการศึกษา · แผนภาพ · สิ่งที่ยังไม่รู้ · งานวิจัยที่อ่าน · ดาวน์โหลด. Provide en labels via `L()`.

**FilterBar:**
- An outer toggle button with `aria-expanded`, labelled "กรอง (แสดง n จาก m ฉบับ)", closed by default and placed directly above the matrix.
- Next to the relevance slider, help text plus `<Term k="relevance">`.
- `<Term k="riskOfBias">` on the risk-of-bias legend and a Term on the design legend.
- When any filter is active, show the one-line status "กำลังกรอง: แสดง n จาก m ฉบับ · ล้างตัวกรอง" (info tint) above the charts and above the paper list, because they are filtered too.

**Tests:**
- Filter tests click the toggle first.
- New:
  - nav links match the H2 ids present;
  - the empty-review fixture shows no nav, or only สรุป;
  - the active-filter status appears and "ล้างตัวกรอง" resets it.

### Task 7: Matrix readability, uncertain flag, chart glossary

**Files:**
- Modify: `src/components/review/report-parts.tsx` (`ComparisonMatrix`, `MatrixLegend`, `PaperList`), `src/components/review/charts.tsx`, `src/components/charts/figures.tsx`
- Tests: `report.test.tsx`, `review-fixes.test.tsx`, the charts tests

**ComparisonMatrix:**
- **Column headers:** first line `P1`; second line the first author's surname and year when available (`paper.authors?.[0]`, `year`), otherwise nothing. Wrap in `<abbr title={paper.title}>`.
- **SR/MA marker:** a `<Term k="srma">` instead of a `title` tooltip. It sits in a `th`, not a button.
- **Selected cell:** below the table, a `<p aria-live="polite">` shows "P3 · <outcome>: <finding text>". This is the visible label for touch users.

**Legend:**
- Remove the duplicate `MatrixLegend` in `charts.tsx`; keep one legend under the matrix.
- Add `UncertainFlag` with its meaning to that legend.

**PaperList:** "◆ ไม่แน่นอน" becomes `<UncertainFlag/>` "สองโมเดลอ่านต่างกัน".

**`figures.tsx`:**
- `<Term k="logScale">` in the ratio caption.
- `<Term k="prisma">` in the PRISMA figure title area.
- A compact `<dl>` "คำย่อในแผนภาพ" under the forest plot using Terms for HR/OR/RR/MD/SMD/RD. Show only the measures present, if easy.
- Captions are not buttons, so Terms are safe there.

**Tests:**
- Column-header queries `{name: "P1"}` and `/^P1$/` become `/^P1\b/`.
- The SR/MA assertions stay valid.
- New:
  - the selected-cell line shows after a cell is clicked;
  - only one legend is rendered;
  - no "◆ ไม่แน่นอน" remains.

### Task 8: Source rail fixes and accessible mobile drawer

**Files:**
- Create: `src/components/review/rail-drawer.tsx`
- Modify: `src/components/review/source-rail.tsx`, `src/components/review/report.tsx`
- Tests: `report.test.tsx` or `source-rail.test.tsx`

**SourceRail:**
- In `OutcomeEvidence`, `selected = outcome != null && <match>`, so a citation (no outcome) highlights nothing.
- `<Term k="ci95">` next to "95% CI".
- `<Term k="riskOfBias">` on that fact's `dt`.
- A blanked effect renders `<Hole explain/>`.
- Uncertain banner: `UncertainFlag` + Term; keep the dashed `border-harm` top edge.
- The selected outcome `li` scrolls into view (`block: "nearest"`) when the selection changes, with `behavior: "auto"` under reduced motion.

**RailDrawer** (below `lg` only, while the drawer is open):
- A flat backdrop (`fixed inset-0`, ink at about 40% opacity; click closes).
- The panel is `role="dialog" aria-modal="true"`, labelled by the rail heading.
- On open, focus moves to the panel heading. Esc closes. On close, focus returns to the element that triggered `select()` (save it at select time).
- Body scroll is locked while open.
- Desktop rendering is unchanged. Keep the `complementary` landmark named "ต้นฉบับ" that the tests and e2e use.

**Tests:**
- selecting a citation gives no `li[aria-current]` / highlighted outcome;
- the drawer closes on Esc and on backdrop click;
- focus moves into the drawer.

### Task 9: Per-review page title

**Files:**
- Create: `src/lib/server-api.ts`
- Modify: `src/app/r/[id]/page.tsx`, `src/app/r/[id]/report.html/route.ts`
- Tests: `src/app/r/[id]/page.test.ts` (or the repo's equivalent location)

**Steps:**
- Move `serverApiUrl()` from `report.html/route.ts` into `src/lib/server-api.ts`, and have the route import it.
- Read `node_modules/next/dist/docs/` on `generateMetadata` first (search for generate-metadata) and follow it for Next 16.
- `generateMetadata({ params }: PageProps<"/r/[id]">)`:
  - awaits `params`;
  - fetches `${serverApiUrl()}/api/v1/reviews/${encodeURIComponent(id)}` with `AbortSignal.timeout(1500)` and `cache: "no-store"`;
  - returns `{ title: topic, openGraph: { title: topic } }`;
  - falls back to "รายงานทบทวนงานวิจัย" on any error or non-OK response.
- `document.title` on the client was already done in Task 4; verify it is there.

**Tests:** mock `fetch` and cover a title from the topic plus the fallback on error, timeout and 404.

### Task 10: E2E, accessibility, docs

**Files:**
- Modify: `e2e/app.spec.ts`, `e2e/live.spec.ts`, `e2e/offline-report.spec.ts` (and any other spec that breaks), `DESIGN.md`, `docs/api.md` (only if anything user-visible about the API changed; probably nothing)

**Update existing e2e:**
- Landing submit and rate-limit tests fill the topic first.
- The report filter step clicks the "กรอง" toggle.
- Column-header regexes.
- The phone-drawer test adds Esc and backdrop checks.

**Add e2e:**
- `/?q=statins` pre-fills the slip;
- the live run shows "รอคิว" after `queued`, and the query text;
- the report nav link jumps to `#h-papers`;
- a glossary Term opens on tap at 375px and closes on Esc;
- axe on `/` at 375px in light and dark themes, and on `/r/<id>` with the drawer open;
- the offline report has no copy-link button.

**Docs:** update DESIGN.md:
- the rail/drawer breakpoint is 1024px;
- the new components: report section nav, glossary Term popover, UncertainFlag (a warning flag, not ◆);
- the report order (answer first: bottom line → agree/conflict → matrix → charts → gaps → papers → method & downloads).

**Verify:** run the full `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e` from `frontend/`, then `rg "num-verified|VerifiedNumber" src/components/review/bottom-line.tsx src/components/review/live-run.tsx`, which must find nothing.
