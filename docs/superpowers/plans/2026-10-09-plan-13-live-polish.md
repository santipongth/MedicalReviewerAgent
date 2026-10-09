# Plan 13: A more polished, "smarter" live-run screen (2D + 3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live-run screen ("กำลังทบทวน") clearer and more informative using only real event data: a thought card ("กล่องความคิดของ agent"), a live evidence board ("กระดานหลักฐานสด") of per-paper direction glyphs as the agent read them, a trace log grouped by step with real durations, and 3D polish (evidence piles by direction, floating thought label, fitted framing). Backend adds exactly two fields to the `extracted` event: `direction`, `design`.

**Architecture:**
- Backend: `reading.py` adds `direction` (card `overall_direction`) and `design` (`design_category` after `settle_design_category`) to both `extracted` emits (`None` when `ok` is false). Stub mirrors it; `REAL_KEYS` and `docs/api.md` follow.
- Scene: `src/lib/agent-scene.ts` — `ReaderSlot` gains `title`, `direction`, `design`, `verified`, `doneKey`; `TraceRow` gains `agent`; `Scene` gains `spans` (real start/end `elapsed_s` per step, from agent status diffs).
- New pure libs: `src/lib/live-evidence.ts` (`asDirection`, `asDesign`, `liveTally`, `isPooledDesign`, `DIRECTION_ORDER`), `src/lib/agent-thought.ts` (`thoughtFor`), `src/lib/agent-timeline.ts` (`timelineGroups`, `stepSummary`).
- Eager live-run components (no `motion`, no three): `ThoughtCard` (inside a new stage panel), `EvidenceBoard`, grouped `TraceLog`, shared `StatusMark`.
- 3D (lazy chunk only): `EvidencePiles3D`, `ThoughtLabel3D`, pile labels, finding-colour tokens, piles/headroom in `layout3dFor` bounds, pure `fitCamera`.

**Tech Stack:** FastAPI/LangGraph (uv, pytest), Next.js 16, React 19.2, Tailwind 4, `motion` (2D stage chunk only), three + R3F 9 + drei 10 (3D chunk only), Vitest + Testing Library, Playwright + axe.

**Spec:** User request 2026-10-09 ("ในหน้าที่เป็น 3D และ 2D กำลังทบทวน สามารถทำให้สวยขึ้น มีความดูฉลาดมากขึ้น…") with binding choices: mainly visual polish; one backend addition (`direction`, `design` on `extracted`); all four components; Theatre Green unchanged but refined. Approved plan: `C:\Users\santi\.claude\plans\dashboard-twinkling-spindle.md`. DESIGN.md, Plan 11 and Plan 12 remain binding.

## Global Constraints

- **Never fake progress.** Every new visual traces to a received event: thought text from `currentAgent` + counts/queries/slots/spans; board from slot `direction`; durations from `elapsed_s` differences. Timers only animate/invalidate. No ticking "running for 0:12" counter — a running step shows only its start (`เริ่ม 0:17`). Never claim a paper is "being read now" (all `reading` events arrive together at fan-out): speak only of finished papers or "กำลังอ่านหรือรอคิว".
- **Direction is a model judgement.** Wherever shown: "ตามที่เอเจนต์อ่าน" + `Term k="directionTally"`. The board never ranks: no percentages, no "most studies", no highlighted largest column, fixed order positive, negative, null, mixed, unclear (as in `bottom-line.tsx`). Unknown/missing direction (old events, future enums) → "ไม่มีข้อมูลทิศทาง", never `unclear`. The string `"null"` (no association) ≠ JSON `null` (no card).
- **SR/MA overlap note** whenever a pooled design (`sr_ma_*`) is on the board — same wording as the report (`POOLED_OVERLAP_TH`).
- **Glyph discipline.** Finding colours always with their glyph shape and an accessible name (`Glyph` from `src/components/ui/evidence.tsx`). ◆ = harm only; uncertain = `UncertainFlag`/`FLAG_PATHS`.
- **Numbers.** Counts and times `font-display tabular-nums`, never `num-verified`/`VerifiedNumber`. `verified` is a count of numbers that passed verification ("ตรวจตัวเลขผ่าน 2 ค่า"). No paper numbers added to events.
- **Typography.** Bai Jamjuree (`font-display`, `.label`) headings/labels/counts; Anuphan body/titles; `font-code` queries and P-refs; no Martian Mono on this screen.
- **Flat.** 2px corners, 1px `rule`, surfaces ground < surface < rail; no shadows/glows/gradients/coloured left borders; no nested cards (thought block = `bg-rail` strip without border inside the panel).
- **Accessibility.** Stage SVG and 3D wrapper keep `role="img"` + `sceneSummary`. `MilestoneStatus` stays the only live announcer; ThoughtCard, EvidenceBoard, grouped log are labelled regions without `aria-live`. Toggles are `<button aria-expanded aria-controls>`. Touch targets ≥44px on phones (`min-h-11 md:min-h-0`).
- **Reduced motion.** New CSS animations wrapped with `motion-reduce:animate-none`; final states shown. 3D stays gated off under reduced motion.
- **Burst/replay collapse.** Board chips and 3D pile flights animate only items with `doneKey` > `lastSeq` seen at mount, capped at `PACKET_CAP` (12) newest; older items appear in place.
- **Bundles.** Eager `/r/[id]` code (live-run, thought card, board, log) must not import `motion/react`, three, R3F or drei. three stays in the lazy 3D chunk; the 3D chunk must not import `components/review/stage/*` except `stage/icons`. The offline report (`src/standalone`) imports none of the new libs/components.
- **Mobile 390px.** No horizontal scroll; evidence board collapsed to a summary row below 1024px; finished timeline groups collapsed; thought block ≤3 lines + 2-line clamped title. The page must not get noticeably longer on phones.
- **Git.** Stage only touched files; Edit/Write tools only (LF; never Python text-mode writes); check `git diff --stat`. Commits `feat(events): …`, `feat(live): …`, `feat(live3d): …`, `test(e2e): …`, `docs: …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands.** Backend `cd backend && uv run pytest`. Frontend (`frontend/`): `npm test`, `npm run lint`, `npm run typecheck`, `npm run build:standalone`, `npm run e2e`.

## Review Focus

- `"null"` vs `null` direction handling; unknown → noDirection.
- No text claims "being read now"; nothing reads like a conclusion; SR/MA note present when pooled.
- Step durations only from two real `elapsed_s` values; no client clock.
- No new live region; 3D label parity (every `[data-label3d]` non-empty) still holds.
- Bundle isolation (eager page, 2D chunk, 3D chunk, standalone).

---

### Task 1: Backend — `extracted` gains `direction` and `design`

**Files:** `backend/app/graph/nodes/reading.py` (emits near lines 55 and 126), `backend/app/graph/nodes/stubs.py` (extracted emit), `backend/tests/unit/test_stub_timeline.py` (`REAL_KEYS` + assertions), `backend/tests/unit/test_review_graph.py` (extracted event assertions; failed-extraction test), `docs/api.md` (events table).

- [ ] reading.py (main emit): `entry["card"]` is the dict from `settle_design_category(card, pub_types).model_dump()` — verify. Add `"direction": entry["card"]["overall_direction"] if entry["card"] else None`, `"design": entry["card"]["design_category"] if entry["card"] else None`.
- [ ] reading.py (no-abstract emit): add `"direction": None, "design": None` so every `extracted` has the same key set.
- [ ] stubs.py `read_paper`, deterministic per `i`, `None` when not ok: `DIRS = ("positive","positive","null","negative","mixed","unclear","positive")` → `DIRS[i % 7]`; `DESIGNS = ("rct","cohort","sr_ma_rct","case_control","cohort")` → `DESIGNS[i % 5]` (verify these are valid DesignCategory values in `app/graph/schemas.py`; adjust to valid ones if not).
- [ ] `REAL_KEYS["extracted"] = {"ref","ok","verified","uncertain","direction","design"}`; new test: every ok `extracted` has `direction` in the Direction literal and `design` in the DesignCategory literal (import from `app.graph.schemas`); every not-ok has both `None`.
- [ ] test_review_graph: happy-path extracted events carry the fake extractor card's `overall_direction` and a settled `design`; the bad-JSON/failed paper's event has both `None`.
- [ ] docs/api.md row: `{ref, ok, verified, uncertain, direction, design}` with note: `direction` = the reading model's overall direction (`positive|negative|null|mixed|unclear`; note `"null"` is the string for "no association"), a model judgement, not a pooled result; `design` = design category (same enum as `card.design_category`); both JSON `null` when `ok` is false; events stored before this change lack both keys.
- **Tests:** focused then full `uv run pytest`; `uv run ruff check .`.

### Task 2: Scene model + pure libs (evidence, thought, timeline)

**Files:** modify `frontend/src/lib/agent-scene.ts` (+test), `frontend/src/lib/progress.ts` (+test), `frontend/src/lib/copy.ts`, `frontend/src/components/review/bottom-line.tsx` (shared copy/order only); create `frontend/src/lib/live-evidence.ts`, `agent-thought.ts`, `agent-timeline.ts` (+ tests).

**Shapes (agent-scene.ts):**
```ts
export interface ReaderSlot {
  ref: string | null; state: SlotState;
  title: string | null;            // from reading.title (trimmed, ≤200 chars)
  direction: Direction | null;     // extracted.direction via asDirection; null when failed/missing/unknown
  design: DesignCategory | null;   // via asDesign
  verified: number | null;         // count of verified numbers
  doneKey: number | null;          // seq of the extracted event that last changed state or direction
}
export interface TraceRow { key; type; text; elapsed; repeat; agent: AgentId | null }
export interface StepSpan { start: number | null; end: number | null } // elapsed_s only
// Scene gains: spans: Partial<Record<AgentId, StepSpan>>
```
(Check where `Direction`/`DesignCategory` types live in `src/lib/types.ts` and reuse them.)
- [ ] `emptySlot(ref)` helper used by slot creation and `screened`.
- [ ] `reading` sets `title`; `extracted` sets `direction`, `design`, `verified` (null when not ok) and `doneKey = ev.seq` only when state or direction actually changed (resume re-emits don't re-trigger animation).
- [ ] `traceAgent(type)`: checking_topic→guard; refining/question_refined→refine; planning→plan; searching→search; enriching→enrich; screening/screened→screen; external_lookup→external; reading/extracted→read; synthesizing→synth; localizing→localize; finalizing→finish; else null. Set in `pushTrace`.
- [ ] `updateSpans(prev, next, el)` post-pass in `reduceScene` diffing agent statuses: entering active/working with no start → `start = el`; leaving running for done/failed/skipped → `end = el`; idle→done directly (silent phase, e.g. plan on `planning`) → `start = end` of the previous PIPELINE agent (documented "a step ends when the next begins"); paused→working keeps start; missing `elapsed_s` → field stays null. Document in the header comment.
- [ ] `progress.ts`: remove the dead `source` field (backend never sends it); add `direction?`/`design?` to `ReadingItem` via `asDirection`/`asDesign`.
- [ ] `copy.ts`: `POOLED_OVERLAP_TH = "งานทบทวน/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลักที่นับรวม"` (bottom-line.tsx switches to it), `AS_READ_TH = "ตามที่เอเจนต์อ่าน"`. `DIRECTION_ORDER` exported from live-evidence.ts; bottom-line.tsx reuses it instead of its local order.

**live-evidence.ts (pure):**
```ts
export function asDirection(v: unknown): Direction | null   // only the 5 enum strings (typeof string); JSON null/unknown → null
export function asDesign(v: unknown): DesignCategory | null // only keys of DESIGN_LABEL.th
export interface EvidenceItem { ref: string; direction: Direction; design: DesignCategory | null; uncertain: boolean; key: number; title: string | null }
export interface LiveTally { groups: Record<Direction, EvidenceItem[]>; counted: number; noDirection: number; failed: number; uncertain: number; pooled: number; total: number }
export function liveTally(s: Scene): LiveTally   // groups in doneKey order; total = slots.length
export function isPooledDesign(d: DesignCategory | null): boolean // startsWith("sr_ma")
export const DIRECTION_ORDER: Direction[]
```

**agent-thought.ts (pure):**
```ts
export type ThoughtDetail =
  | { kind: "queries"; items: string[]; more: number }
  | { kind: "paper"; ref: string; title: string | null; ok: boolean; direction: Direction | null; design: DesignCategory | null; uncertain: boolean; verified: number | null };
export interface Thought { key: string; agent: AgentId | null; status: AgentStatus | null; heading: string; body: string; short: string; detail: ThoughtDetail | null; since: number | null; indeterminate: boolean }
export function thoughtFor(s: Scene): Thought | null // null for done/error/rejected/cancelled
```
Latest paper = slot with highest `doneKey`. Thai copy (exact):

| State | heading | body | detail / extra |
|---|---|---|---|
| waiting | รอคิว | เอเจนต์จะเริ่มทำงานเมื่อถึงคิว | — |
| paused | หยุดชั่วคราว | เซิร์ฟเวอร์หยุดชั่วคราว จะทำงานต่อเอง | — |
| guard | ตรวจหัวข้อ | ตรวจว่าเป็นคำถามทางการแพทย์ก่อนเริ่มค้น | — |
| refine | ตีความคำถาม | แปลงคำถามให้ชัดแบบ PICO: ใคร ทำอะไร เทียบกับอะไร วัดผลอะไร | — |
| running, no current agent | (last trace row text) | รอขั้นต่อไป | — |
| search | ค้นฐานข้อมูล | ค้นด้วย {n} คำค้นใน PubMed, arXiv, Semantic Scholar, OpenAlex และ Crossref | first 2 queries + "และอีก {m} คำค้น" |
| enrich | ดึงบทคัดย่อ | ค้นเจอ {found} รายการ · เก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน | + "· ค้นไม่สำเร็จ {f}" when f>0 |
| screen | คัดกรอง | ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ · เริ่มชุดที่ {b} จาก {B} | "จาก {B}" only when B>0 |
| read, none finished | อ่านงานวิจัย | อ่านบทคัดย่อและตรวจตัวเลขกับต้นฉบับ · {k} ฉบับกำลังอ่านหรือรอคิว | — |
| read, after a finish | อ่านงานวิจัย | อ่านเสร็จ {d} จาก {n} ฉบับ | detail: "อ่านเสร็จล่าสุด {ref}", title, Glyph + "{DIRECTION_LABEL} ตามที่เอเจนต์อ่าน · {DESIGN_LABEL}" + "ตรวจตัวเลขผ่าน {v} ค่า" (v>0) + flag "สองโมเดลอ่านต่างกัน"; failed: "อ่าน {ref} ไม่สำเร็จ" |
| external | ปรึกษาเครื่องมือภายนอก | ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่แหล่งอ้างอิง | — |
| synth | สังเคราะห์ผล | เทียบผลจาก {p} ฉบับและเขียนสรุป | "(ขั้นนี้ไม่มีความคืบหน้าให้ดู)" |
| localize | แปลภาษา | แปลรายงานเป็นภาษาไทย ตัวเลขต้องคงเดิม | — |
| finish | เรียบเรียงรายงาน | รวมผลเป็นรายงานพร้อมที่มาของตัวเลข | — |

`key` = `${agent ?? status}` (crossfade per step, not per count); `short` = one line for the 3D label (heading + short body).

**agent-timeline.ts (pure):**
```ts
export interface TimelineGroup { id: string; agent: AgentId | null; status: AgentStatus | null; title: string; summary: string | null; durationS: number | null; startS: number | null; current: boolean; rows: TraceRow[] }
export function timelineGroups(s: Scene): TimelineGroup[] // consecutive rows with the same agent merge; id = `${agent ?? "status"}-${firstRow.key}`; durationS only on the LAST group of an agent and only if both span ends known
export function stepSummary(s: Scene, id: AgentId): string | null
```
`stepSummary`: guard done "ผ่านการตรวจ", failed "หัวข้อไม่ผ่าน"; plan "{q} คำค้น"; search "ค้นเจอ {found} รายการ" (+ " · ค้นไม่สำเร็จ {f}"); enrich "มีบทคัดย่อพอให้อ่าน {c} ฉบับ"; screen "ผ่าน {kept} จาก {total} ฉบับ" or "เริ่มชุดที่ {b}" before `screened`; read "อ่านเสร็จ {d}/{n}" (+ " · ไม่สำเร็จ {f}") (+ " · สองโมเดลอ่านต่างกัน {u}"); synth "จาก {p} ฉบับ"; else null.

**Tests (Vitest):** `asDirection("null") === "null"`, `asDirection(null) === null`, `asDirection("benefit") === null`; `asDesign` valid/unknown; liveTally (old events without direction → noDirection; failed only in `failed`; pooled counts sr_ma_*; doneKey order; repeated extracted idempotent); spans for a full walk (plan start = refine end; search from planning to searching; interrupted/resume keeps start; missing elapsed_s → null); thoughtFor per state (read detail picks highest doneKey; failed line; the regex `/กำลังอ่าน P\d/` never matches any output); timelineGroups (grouping; status rows split groups; duration only on the last group of an agent; trace cap 80 still yields summaries from counts). Existing tests stay green (update slot equality for new fields).

### Task 3: Stage panel + thought card (2D polish)

**Files:** create `frontend/src/components/review/thought-card.tsx` (+test), `frontend/src/components/review/stage/status-mark.tsx` (+test; pure SVG, no motion import); modify `stage-view.tsx` (toggle placement), `live-run.tsx`, `app/globals.css` (keyframes), small spacing tweaks in `stage/stage-legend.tsx`, `stage/agent-stage.tsx`.

- **Placement (desktop ≥1024):** header → stage panel (`section aria-labelledby="h-stage"`, `bg-surface border border-rule rounded-sm p-4 lg:p-5 grid gap-4`, visible heading `h2.label` "เวทีเอเจนต์") → EvidenceBoard (Task 4) → ledger. Panel row 1: thought block (`flex-1`) + the existing 3D toggle on the right (same button, `aria-pressed`, text). Row 2: stage. Row 3: footer with a 1px top rule: legend, then caption. **Phone:** same order; thought block full width; no toggle (narrow).
- **ThoughtCard `{ scene }`** → `thoughtFor`: `div aria-labelledby="h-thought"`, `bg-rail rounded-sm px-3 py-2.5`. Line 1: `StatusMark` + `span.label#h-thought` "เอเจนต์กำลังทำ" + `· {heading}` (`font-display font-semibold`); right: `เริ่ม {m:ss}` (`font-display tabular-nums text-muted text-xs`) when `since != null`. Line 2: body (Anuphan). Detail: queries `font-code text-xs text-muted`; paper: ref `font-code`, title `line-clamp-2`, Glyph + direction label + "ตามที่เอเจนต์อ่าน" + design (`text-muted`), `UncertainFlag` when uncertain. Wide-only footnote `text-xs text-muted` "จากเหตุการณ์จริงของรีวิวนี้". Content wrapper keyed by `thought.key` runs CSS `thought-in` (opacity 0→1, 200ms ease-out, `motion-reduce:animate-none`). Returns null for terminal states.
- **StatusMark `{ status }`:** 12px SVG: active solid `primary` square; working dashed `primary`; done `ink` square + check in `ok`; failed `err` + cross; skipped dashed `rule`; paused `warn`. `aria-hidden`.
- **Refinements:** header meta `ผ่านไป {m:ss}` via `formatElapsed` in `font-display tabular-nums` + ` · ปกติใช้ 1–3 นาที`; spacing header→panel `gap-6`, panel→board `gap-4`, board→ledger `gap-8`; legend `gap-x-5 gap-y-1.5` in the panel footer. 2D stage motion unchanged.
- **Tests:** thought-card heading/body per state from fixture scenes; paper detail shows glyph aria-label + "ตามที่เอเจนต์อ่าน"; no `aria-live`/`role=status` inside; terminal → nothing. stage-view toggle still found by role/name in the panel row; gating tests green. status-mark per status.

### Task 4: Live evidence board (2D, HTML)

**Files:** create `frontend/src/components/review/evidence-board.tsx` (+test); modify `live-run.tsx` (placement; reading list gets a glyph column), `globals.css` (`evidence-in` keyframes).

- Visible when `scene.slots.length > 0`; empty state "ยังไม่มีงานที่อ่านเสร็จ".
- `section aria-labelledby="h-evidence"`, `bg-surface border border-rule rounded-sm p-4`. Header: `h2.label#h-evidence` "กระดานหลักฐานสด"; sub-line `text-sm text-muted`: `<Term k="directionTally">ทิศทางผล</Term>ตามที่เอเจนต์อ่าน · ยังไม่ใช่ข้อสรุป`; right: `อ่านเสร็จ {counted+noDirection+failed}/{total}` (`font-display tabular-nums`).
- Summary row (always): `ul` of the five directions in `DIRECTION_ORDER`: `Glyph` + `DIRECTION_LABEL.th` + count (`font-display font-semibold tabular-nums`, `data-evidence-dir`, `data-count`); zero counts muted; no special styling for the largest.
- Detail: five columns at `lg` (`grid-cols-5 gap-4`) of chips: Glyph (12px) + `P3` (`font-code text-xs`) + design (`DESIGN_LABEL.th`, `text-xs text-muted`) + flag icon with `sr-only` "สองโมเดลอ่านต่างกัน"; chip `rounded-sm border border-rule px-1.5 py-0.5`; chips with `doneKey > mountSeq` (useRef of `scene.lastSeq` at mount, newest `PACKET_CAP`) get `evidence-in` (200ms, `motion-reduce:animate-none`).
- Below 1024px: detail behind `button.lg:hidden min-h-11` "ดูรายฉบับ"/"ซ่อนรายฉบับ" (`aria-expanded`, `aria-controls`); detail `className={open ? "grid" : "hidden lg:grid"}`.
- Footer notes (`text-[0.82rem] text-muted`, only when applicable): `POOLED_OVERLAP_TH` (pooled>0); `อีก {n} ฉบับอ่านเสร็จแต่ไม่มีข้อมูลทิศทาง`; `อ่านไม่สำเร็จ {n} ฉบับ (ไม่นับ)`; `มี {n} ฉบับที่<Term k="uncertain">สองโมเดลอ่านต่างกัน</Term>`; during synth `เอเจนต์กำลังเทียบผลเหล่านี้ ผลสรุปจะอยู่ในรายงาน`.
- Ledger reading list: finished ok rows show `Glyph` + design before "เสร็จ".
- **Tests:** counts per direction match `liveTally`; `"null"` lands under "ไม่มีความสัมพันธ์" (check DIRECTION_LABEL); missing direction → noDirection note; SR/MA note only with sr_ma_*; toggle flips aria-expanded/classes; chips present at mount have no `evidence-in`, later chip does; no `aria-live`; largest column has no special class.

### Task 5: Grouped timeline log

**Files:** modify `frontend/src/components/review/stage/trace-log.tsx` (+test), `live-run.tsx` (prop change), `frontend/e2e/live-stage.spec.ts` (row selector only).

- [ ] `TraceLog({ scene })` (was `{ rows }`) using `timelineGroups(scene)`. Keep `section aria-labelledby="h-trace"` heading "บันทึกการทำงาน" (e2e region name), scroll box `max-h-72 tabIndex=0`, `nearBottom` stick-to-bottom (deps: last group id, last row key/repeat).
- [ ] Group header `li[data-trace-group={agent}]`: `StatusMark` + agent icon (`ICON[agent]` from `stage/icons`, 14px, `currentColor`) + title (`font-display font-semibold`) + summary (`text-muted text-sm`) + right (`font-display tabular-nums text-xs text-muted`): done → `ใช้เวลา {m:ss}`; running → `กำลังทำ · เริ่ม {m:ss}`; skipped → `ข้าม`; toggle `ดู {n} รายการ`/`ซ่อนรายการ` (`aria-expanded`, `aria-controls`). Status groups (agent null) = one muted line with time, no toggle.
- [ ] Rows `[data-trace-row]` with `data-type`: time (4rem, tabular-nums) + text + `×{repeat}`; drop the visible `[type]` tag.
- [ ] Collapse: current group expanded, finished collapsed (rows stay in DOM with `hidden`); user-opened groups stay open (state keyed by group id); an expanded read group shows its last 6 rows + "ดูทั้งหมด {n} รายการ".
- [ ] e2e `traceRows` → `region.locator("[data-trace-row]")`; per-frame count assertions unchanged.
- **Tests:** header durations from spans; running shows start without duration; collapse/expand; user-expanded survives new events; `×6` renders; stick-to-bottom tests pass.

### Task 6: 3D polish — evidence piles, thought label, framing, lighting

**Files:** `frontend/src/components/review/stage3d/{tokens-3d.ts, model-3d.ts, labels-3d.tsx, stage-3d.tsx, camera-rig.tsx}` (+ `model-3d.test.ts`, `tokens-3d.test.ts`); create `stage3d/evidence-piles-3d.tsx`, `stage3d/thought-label-3d.tsx`; `frontend/src/lib/agent-layout-3d.ts` (+test).

- [ ] Tokens: add `sup`, `harm`, `none`, `mixed`, `unclear`, `rail` from CSS vars (check exact var names in globals.css), with light fallbacks; extend parser tests.
- [ ] Layout: reader pool centred under `read`; `Layout3D.piles: Record<Direction, Vec3> | null` (null when no slots): five bases on the `POOL_Y` plane starting near `synth.x - 0.6`, pitch 0.4; `pileSpot(layout, dir, i, out)` allocation-free, stacks rise 0.13 per token, 10 per stack, tokens 10–29 start a second stack at z−0.3; bounds include full piles and thought headroom (+0.9 y above highest node). Tests: pool bbox vs piles bbox gap ≥0.2 (Thai and English lanes); bounds contain every pile spot.
- [ ] model-3d (pure): `PILE_SHAPE` positive→sphere, negative→octahedron, null→flat bar (box 0.22×0.06×0.1), mixed→dome (hemisphere), unclear→thin torus (match 2D glyph silhouettes; verify against `Glyph`); `PILE_COLOR`; `planArrivals(items, seenKey, cap)` → `{animate, snap}` (newest `cap` with key>seenKey animate with 60ms stagger); `thoughtAnchor(layout, agent)` 0.85 above the node (above `external` when agent=read and external shown); `fitCamera(bounds, aspect=960/330, fovDeg=45, out)` with 8% margin at fixed elevation; `cameraGoal` uses it (keep PAN; look-at Y = bounds centre). Tests: shape map covers 5 directions; burst collapse; anchor height; projected bounds corners within NDC ±0.95 (pinhole math).
- [ ] EvidencePiles3D: five `InstancedMesh`es (cap 30 each), `meshStandardMaterial flatShading roughness={1} metalness={0}`, colour per direction; instance i of d at `pileSpot(d,i)`; arrivals fly from the paper's pool slot along `arc3(slot, spot, 0.12)` over the existing flight duration with easeInOut, preallocated per-instance start times and segments built at schedule time; `invalidate()` only while a flight is active; `seen` at mount; dispose.
- [ ] ThoughtLabel3D: drei `Html` at `thoughtAnchor` showing `thought.short`, `data-label3d="thought"`, `aria-hidden`, `pointer-events-none`, `max-w-[240px] whitespace-normal`, `bg-surface border border-rule rounded-sm px-2 py-1 font-display text-xs`; thin drei `Line` in `rule` to the node; hidden (not rendered) when no thought/current agent so it's never empty; mounts with other labels (one-commit deferral).
- [ ] Labels3D: one label per non-empty pile under its base (`data-label3d="pile-{dir}"`): Glyph + count + flag count if uncertain; caption above piles (`data-label3d="piles"`) "ทิศทางผลตามที่เอเจนต์อ่าน" when counted>0.
- [ ] Lighting/framing: one ambient (0.65) + one directional (1.0 at [-3,9,7]); `flatShading` on cores and tokens; flat tray plane in `rail` under pool and piles (y = POOL_Y − 0.2, Lambert, no shadows/transparency); no emissive/fog/post; edges idle radius 0.012, live 0.02.
- **Tests:** Vitest pure helpers; stage-3d test: piles + thought label mount with the mocked Canvas as existing tests do; token reader includes finding colours.

### Task 7: E2E, docs, verification and screenshot review

**Files:** `frontend/e2e/mock-api.ts` (`LIVE_EVENTS` extracted gains `direction: "positive", design: "cohort"`), `frontend/e2e/live-stage.spec.ts`, `frontend/e2e/live-stage-3d.spec.ts`, `frontend/e2e/app.spec.ts`, `DESIGN.md`; temporary uncommitted `frontend/e2e/plan13-screens.spec.ts`.

- [ ] E2E: thought card heading follows streamed frames (ค้นฐานข้อมูล → ดึงบทคัดย่อ → คัดกรอง → อ่านงานวิจัย) and after an extracted frame shows "อ่านเสร็จล่าสุด P3" + "ตามที่เอเจนต์อ่าน"; evidence board `data-count` per direction matches streamed directions (include one `"null"`, one `sr_ma_rct`, one uncertain, one failed with direction null), SR/MA note visible, at 390px detail collapsed (`aria-expanded="false"`) and tap opens, burst replay → no running chip animation; timeline group headers, a finished group shows `ใช้เวลา` with the expected m:ss from fixture elapsed_s, finished groups collapsed, expand works, row count still increments per frame; 3D `[data-label3d="thought"]` non-empty, `pile-positive` count equals board count, parity test passes; axe at 1440 and 390, light and dark, board expanded and collapsed, and 3D on at 1440; no horizontal scroll at 390 and 1024; reduced motion → computed `animation-name: none` on `.evidence-in` and the thought content; app.spec live-run test sees board and thought card.
- [ ] DESIGN.md: under "Agent stage (live run)": thought block (rail strip, real events only, no live region); live evidence board (fixed order, "ตามที่เอเจนต์อ่าน", SR/MA note, collapsed below 1024px); grouped log (durations from elapsed_s only, no ticking); 3D piles (shape-coded tokens matching glyphs), thought label, tray plane. Decisions Log row (2026-10-09, Plan 13).
- [ ] Bundle check after `npm run build`: eager `/r/[id]` chunks contain no motion and no `WebGLRenderer`; only the 3D chunk contains three; `standalone-dist` contains no `thoughtFor`/`liveTally`/`EvidenceBoard`. Report size deltas.
- [ ] Full verification: backend `uv run pytest`; frontend `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`.
- [ ] Screenshot review (temporary, not committed): `frontend/e2e/plan13-screens.spec.ts` with `streamSse` + `mockApi`, scenes: mid-run (30 slots, 12 extracted with mixed directions/designs incl. sr_ma, uncertain, failed; queries present) and synthesizing (30 extracted + `synthesizing`); captures 2D at 1440×900 and 390×844 light/dark, 3D at 1440 light/dark (wait 1.5s after last frame); full-page plus element shots of panel, board, log; save to `D:/MedicalReviewerAgent/.superpowers/plan13/`. Open every PNG and check against DESIGN.md (hierarchy, spacing, no glow/shadow, glyph+colour pairing, Thai legibility ≥12px, thought label not overlapping external node, nothing reading like a conclusion). Fix anything found, then delete the spec (`git status` must not list it).

## Risks
1. `"null"` vs `null` direction — `asDirection` must check `typeof v === "string"`; tests cover both.
2. design_category mapping — backend DesignCategory vs frontend DESIGN_LABEL keys; `asDesign` drops unknown values.
3. Unknown/missing direction (pre-deploy events, future enums) → noDirection, never unclear.
4. SR/MA overlap note required when pooled > 0.
5. Payload size: ~40 B × ≤30 papers; JSON payload, no migration; stub test pins the key set.
6. "Reading now" honesty — only finished papers or "กำลังอ่านหรือรอคิว".
7. Trace cap 80 — group headers come from spans and counts.
8. Eager bundle growth — keep new eager components free of motion/three; measure.
9. 3D label density (~19 Html labels) — check overlap in screenshots.
10. Uncertain papers — always pair direction with the flag.
