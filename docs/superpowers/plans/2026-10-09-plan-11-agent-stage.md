# Plan 11: Live agent stage (real-time 2D visualisation of the review pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the live-run screen ("กำลังทบทวน", `/r/[id]` while running), the step list and the 60-well specimen tray are replaced by an animated 2D "agent stage": each pipeline agent is a node on a flat SVG lane, with edges (ghost/visited states), packets that travel along curved edges when real events arrive, query chips under the planner, search-engine satellites, screener batch chips, a reader pool with P-refs and per-paper outcomes, and an indeterminate "working" state for silent phases. A trace log of real events (Thai text, elapsed) and a full text "live ledger" (steps, counters, queries, refined question, reading list, close-tab info) stay below as the accessible source of truth and the reduced-motion view. Every visual change is driven by a real SSE event — nothing is simulated in the browser.

**Architecture:**
- Frontend (`frontend/`): pure reducer `src/lib/agent-scene.ts` (`reduceScene`), run alongside `reduceRun` on the same event stream in `use-review.ts`; pure geometry `src/lib/agent-layout.ts`; SVG components in `src/components/review/stage/*` using `motion/react` (`LazyMotion` + `domAnimation`, `m.*`, `MotionConfig reducedMotion="user"`), loaded via `next/dynamic` (`ssr:false`) so report readers never download motion. Continuous loops (marching outline for "working", reading pulse) are CSS keyframes so the existing global reduced-motion rule kills them; motion only drives discrete transitions and packet travel.
- Backend (`backend/`): only `GRAPH_MODE=stub` with `STUB_DELAY_SECONDS>0` changes — it emits a realistic, timed event sequence (same names/payload shapes, same Send fan-outs, same concurrency semaphore as the real graph) so the docker stack is usable for manual QA. The real graph, API and event contract do not change.

**Tech Stack:** Next.js 16 (App Router, React 19), Tailwind 4 tokens in `globals.css`, `motion` 14 (already installed, currently unused: `motion/react` for `LazyMotion`, `domAnimation`, `MotionConfig`, `useReducedMotion`, `useMotionValue`, `useTransform`, `animate`; `motion/react-m` for `m`), Vitest + Testing Library, Playwright + axe. Backend: LangGraph stub graph, pytest, ruff. Read `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before framework code.

**Spec:**
- The user's instruction of 2026-10-09: replace the step list + tray with an agents-at-work real-time visualisation adapted from sakshigupta372/AI-Agent-observatory (the user states they have permission to use its code). Binding decisions: 2D SVG + motion; Theatre Green, flat; animation primary with the text ledger kept below; real events only, silent phases show indeterminate "working" only.
- Approved plan: `C:\Users\santi\.claude\plans\dashboard-twinkling-spindle.md`.
- `DESIGN.md` (Theatre Green) — this plan is an approved departure, recorded in Task 9.
- Event contract: `docs/api.md` (events table).

**Observatory concepts adapted** (source is Astro + React 18 + R3F; adapt ideas/formulas, the 3D code itself is not portable): node/edge data model in pipeline order with a hub + satellites; edges and packets sharing one curve with a lifted midpoint (`mid.y += |dx|*0.18 + 0.6`); packets travelling `t = elapsed/duration` with `i*120ms` stagger, colour by edge kind; node "active" = scale up + faster ring; PlannerTasks chips (pending / active pulse / done ✓); keyed triggers so a component fires once per new key; ghost (visited) edges; TracePanel `[time] EVENT`. Avoid its weaknesses: fixed-delay choreography, per-frame allocations, no reduced motion, no mobile, no a11y.

## Global Constraints

- **Never fake progress.** Every packet, status change, count and trace row derives from one received `ReviewEvent`. No timer advances state — timers only play an animation for a state that already happened. Silent phases (search before `searching`, enrich, screening between batches and `screened`, second screening vote, dual extraction/escalation, normalize/explain_conflict/write_synthesis, localize, finalize) may only show the indeterminate `working` look.
- **Packet counts are signals, not data.** A `searching{found:87}` pulse draws `min(n,8)` dots; the shown number is the payload count in `font-display tabular-nums`. Dots never imply per-paper timing except `extracted`, which is per paper.
- **Reader-pool honesty.** `reading` events arrive together at fan-out start; papers then wait on `LLM_CONCURRENCY` (16). The pool shows each slot as "reading or queued" and never claims which are in flight.
- **Numbers:** counts, refs and times use `font-display tabular-nums` (in SVG: `font-display` class + `style={{fontVariantNumeric:"tabular-nums"}}`), never `num-verified`/`VerifiedNumber`/Martian Mono. Paper-count derivations live in `src/lib/agent-scene.ts` or `src/lib/progress.ts`, pure and tested.
- **DESIGN.md:** flat — no shadows, glows, gradients, blur/filter/mask. 1px rules, 2px corners (`rx=2`) for nodes and chips; full radius only for round glyphs (packet dots, reader slots, satellites). No direction colours here; status uses `primary`/`ink`/`muted`/`rule`/`ok`/`err`/`warn`, always paired with a shape (✓ ok, ✕ failed, flag for uncertain via the `UncertainFlag` path, dashed outline for skipped). `font-display` (Bai Jamjuree) for labels, Anuphan for running text, `font-code` for queries and event type names.
- **Motion:** micro 50–100ms, short 150–250ms (status changes, ease-out), medium 250–400ms (zone tint). Packet travel 700ms ease-in-out with 120ms stagger — the new authored moment (recorded in DESIGN.md). Wrap the stage in `<MotionConfig reducedMotion="user">`; imperative `animate(motionValue)` ignores MotionConfig, so `PacketLayer` checks `useReducedMotion()` and renders nothing when true. Reduced motion → every state appears in its final form.
- **Performance:** no per-frame allocations; fixed pool of `MAX_DOTS = 24` packet elements; positions via `useTransform(t, fx)` over a cached segment; no React state updates per frame; `PACKET_CAP = 12` fresh pulses per render; skip packets when `document.hidden`.
- **Bursts/replay:** SSE replays past events on (re)connect. Pulses existing at mount are marked seen; when more than `PACKET_CAP` new pulses arrive in one render only the newest animate. Replay never queues minutes of animation.
- **SSR/client safety:** no `window`/`document`/`matchMedia` at module scope; the stage is client-only via `next/dynamic` with a fixed-aspect placeholder (no layout shift). `LiveRun` is not part of the offline report build (`src/standalone/main.tsx`); never import stage modules from report components.
- **Mobile:** fits 390px with no horizontal scroll. Narrow (<768px) = vertical lane; wide (≥768px) = horizontal lane.
- **Copy:** Thai, plain. SVG labels are fixed short strings from a label table with predefined `<tspan>` lines; long dynamic text (queries, titles) is clipped in SVG with `<title>`, full text in the ledger.
- **Accessibility:** the SVG is `role="img"` with an `aria-label` from `sceneSummary(scene)`; children presentational. The ledger keeps `aria-current="step"`. One throttled milestone announcer (`role="status"`) — the trace log is not live. Scrollable regions get `tabIndex={0}` + an accessible name. axe stays clean.
- **Attribution:** credit sakshigupta372/AI-Agent-observatory in `NOTICE.md` and a short header comment in `agent-stage.tsx` and `agent-layout.ts` (Task 9).
- **Git:** stage only files the task touched (`git add <paths>`, never `-A`/`.`). Commit style `feat(live): …`, `feat(stub): …`, `test(e2e): …`, `docs: …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Keep LF line endings.
- **Commands:** frontend (`frontend/`): `npm test`, `npm run lint`, `npm run typecheck`, `npm run build:standalone`, `npm run e2e`. Backend (`backend/`): `uv run pytest`, `uv run ruff check .`.

## Review Focus

- Each visual change is traceable to one event in `reduceScene`; no `setInterval`/`setTimeout` changes scene state.
- Replay/reconnect never queues minutes of animation (`takeFreshPulses` tests + e2e burst test).
- Reduced motion: no packets in the DOM, no running CSS animations, final states visible.
- No `num-verified` in `live-run.tsx` or `stage/*`; no paper-count logic in components.
- Bundle: the `/r/[id]` eagerly loaded JS grows by ≤ ~2 kB; motion lives in the lazy stage chunk.
- Existing tests updated deliberately (tray assertions → stage + ledger assertions), not deleted.

---

### Task 1: Backend — realistic timed stub sequence (GRAPH_MODE=stub, STUB_DELAY_SECONDS>0)

**Files:**
- Modify: `backend/app/graph/nodes/stubs.py`, `backend/app/graph/graph.py` (`build_stub_graph`), `CLAUDE.md` (the `GRAPH_MODE=stub` line and the load-test line)
- Tests: extend `backend/tests/unit/test_stub_delay.py`; create `backend/tests/unit/test_stub_timeline.py`
- Unchanged behaviour: with `delay_seconds == 0` the stub stays the two-event placeholder (`planning`, `synthesizing`), so `backend/tests/unit/test_graph_skeleton.py` and quick runs stay as they are.

**Design:**
- When `delay_seconds > 0`, build a stub graph mirroring the real one: `topic_guard → refine_question → plan_queries → search → enrich → screen_batch* (Send per 10 candidates) → select_top → read_paper* (Send per kept paper) [+ external_enrich only when MCP is enabled — off by default] → normalize_outcomes → write_synthesis → localize → finalize`. Every node reports via `app.graph.progress.progress_writer()` (repo convention).
- `StubTimeline` (frozen dataclass from `delay_seconds`) with phase shares summing to 1.0: guard 0.03, refine 0.07, plan 0.05, search 0.08, enrich 0.05, screen (per batch, parallel) 0.10, select 0.02, read (per paper behind the semaphore) 0.35, normalize 0.05, write_synthesis (silent, longest) 0.12, localize 0.05, finalize 0.03. Jitter ±20% from `random.Random(state["review_id"])` so runs are deterministic per review. Per-paper read time = `read_share * delay * concurrency / kept` with ±30% jitter, behind an `asyncio.Semaphore(settings.llm_concurrency)` created in the node factory (shared per process, like `LimitedLLM`) so `extracted` arrives staggered as in production.
- Payloads exactly the real shapes (see `docs/api.md` and the real nodes in `backend/app/graph/nodes/`): `checking_topic{}`, `refining{}`, `question_refined{interpretation, refined_question, sub_questions[2], assumptions[1]}` (English strings built from the topic), `planning{queries}` (4 queries from the topic, e.g. `f"{topic} randomized controlled trial"`), `searching{found: 87, queries: 4, failed: 0}`, `enriching{candidates: min(options.candidate_limit or 60, 60)}`, `screening{batch: len(batch)}` per batch, `screened{kept: min(options.max_papers or 30, 30), total: candidates}`, `reading{ref: f"P{i}", title: f"Simulated study {i}: {topic}"[:140]}` at the start of each `read_paper` (before the semaphore), `extracted{ref, ok: i % 11 != 0, verified: (i % 4) if ok else 0, uncertain: i % 7 == 0}`, `synthesizing{papers: ok_count}` in `normalize_outcomes`, `localizing{}` only when the review language is `th`, `finalizing{}`. Check how the real nodes read options/language from state and mirror that. The final `result` stays the existing stub result (`summary "Stub review for: …"`, `papers: []`) so `frontend/e2e/live.spec.ts` keeps passing.
- Resume safety: each phase is its own node, so a worker restart resumes at the checkpointed node.

**Steps:**
- [ ] Write failing tests first, then implement `StubTimeline`, the stub node factories and `build_stub_graph(checkpointer, delay_seconds, settings)` (pass `settings` from `build_graph`, which already has `deps.settings` — verify).
- [ ] Update `CLAUDE.md`: on the `GRAPH_MODE=stub` line add "with `STUB_DELAY_SECONDS>0` the stub emits the real event sequence on a scaled timeline (manual QA of the live run, load tests)"; on the load-test line note the stub now emits ~110 events per review.

**Tests** (`test_stub_timeline.py`, delay ~0.6s, `InMemorySaver`): custom event types arrive in pipeline order (screening ×6, reading ×30, extracted ×30; order-insensitive inside a fan-out, ordered between phases); payload keys match a `REAL_KEYS` dict mirroring `docs/api.md`; `localizing` present for `th`, absent for `en`; with `llm_concurrency=4` the spread between first and last `extracted` exceeds 30% of the read share; total duration ≥ 0.9 × delay (keep a Windows timer tolerance comment); same `review_id` → same sequence; `test_graph_skeleton` unchanged and passing.

### Task 2: Pure scene model `src/lib/agent-scene.ts` + wiring in `use-review`

**Files:**
- Create: `frontend/src/lib/agent-scene.ts`, `frontend/src/lib/agent-scene.test.ts`
- Modify: `frontend/src/lib/use-review.ts` (second reducer, return `scene`), `frontend/src/lib/use-review.test.tsx`

**Exported shapes:**
```ts
export type AgentId = "guard" | "refine" | "plan" | "search" | "enrich" | "screen" | "read" | "external" | "synth" | "localize" | "finish";
export const PIPELINE: AgentId[] = ["guard","refine","plan","search","enrich","screen","read","synth","localize","finish"]; // external is a side node
export type AgentStatus = "idle" | "active" | "working" | "done" | "failed" | "skipped" | "paused";
export const AGENT_LABEL: Record<AgentId, { th: string[]; role: string }> = {
  guard: { th: ["ตรวจหัวข้อ"], role: "ตรวจว่าเป็นคำถามทางการแพทย์" },
  refine: { th: ["ตีความ", "คำถาม"], role: "แปลงคำถามให้ชัดแบบ PICO" },
  plan: { th: ["วางคำค้น"], role: "เลือกคำค้นภาษาอังกฤษ" },
  search: { th: ["ค้นฐาน", "ข้อมูล"], role: "ค้น PubMed, arXiv และฐานข้อมูลอื่น" },
  enrich: { th: ["ดึง", "บทคัดย่อ"], role: "เก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน" },
  screen: { th: ["คัดกรอง"], role: "ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ" },
  read: { th: ["ผู้อ่าน"], role: "อ่านบทคัดย่อและตรวจตัวเลขกับต้นฉบับ" },
  external: { th: ["เครื่องมือ", "ภายนอก"], role: "ปรึกษาเครื่องมือที่ผู้ดูแลตั้งไว้" },
  synth: { th: ["สังเคราะห์"], role: "เทียบผลและเขียนสรุป" },
  localize: { th: ["แปลภาษา"], role: "แปลรายงานเป็นภาษาไทย" },
  finish: { th: ["เสร็จ"], role: "เรียบเรียงรายงาน" },
};
export type EdgeId = `${AgentId}>${AgentId}`;
export type EdgeState = "idle" | "live" | "visited";        // visited = observatory "ghost edge"
export type PulseKind = "query" | "paper" | "kept" | "card" | "failed" | "signal";
export interface Pulse { key: number; edge: EdgeId; kind: PulseKind; n: number }   // key = event seq; n in 1..8
export type SlotState = "waiting" | "reading" | "ok" | "failed" | "uncertain";
export interface ReaderSlot { ref: string | null; state: SlotState }
export interface TraceRow { key: number; type: string; text: string; elapsed: number | null; repeat: number }
export interface Scene {
  lastSeq: number;
  status: "waiting" | "running" | "paused" | "done" | "error" | "rejected" | "cancelled";
  agents: Record<AgentId, AgentStatus>;
  edges: Partial<Record<EdgeId, EdgeState>>;
  counts: { queries: number; found: number; searchFailed: number; candidates: number; batches: number;
            batchesExpected: number; kept: number; screenedTotal: number; readOk: number; readFailed: number;
            uncertain: number; synthPapers: number | null };
  queries: string[];
  slots: ReaderSlot[];          // ≤ MAX_SLOTS (30)
  pulses: Pulse[];              // ring, ≤ MAX_PULSES (24)
  trace: TraceRow[];            // ≤ MAX_TRACE (80), newest last
  external: boolean;
  expectLocalize: boolean;      // from review.language === "th"
  elapsed: number;
}
export type SceneAction = { kind: "event"; ev: ReviewEvent } | { kind: "lang"; language: string };
export function initialScene(opts?: { language?: string }): Scene;
export function reduceScene(s: Scene, a: SceneAction): Scene;
export function takeFreshPulses(pulses: Pulse[], seenKey: number, cap: number): Pulse[];
export function planDots(fresh: Pulse[], maxDots: number): { edge: EdgeId; kind: PulseKind; delayMs: number }[];
export function sceneSummary(s: Scene): string;   // Thai aria-label
export function currentAgent(s: Scene): AgentId | null;
export function formatElapsed(s: number | null): string; // "0:42", "—" when null
```

**Event → scene mapping** (comment in the module which events mark the start vs the end of a step). Helper `advanceTo(id, status)`: sets `id`; earlier PIPELINE agents that are `active`/`working` become `done`, earlier ones still `idle` become `skipped`; edges between done agents become `visited`; the edge into `id` becomes `live`.

| Event | Scene change | Pulse |
|---|---|---|
| `queued` | status `waiting` | – |
| `started{resume}` | status `running`; paused agents back to `working` | – |
| `checking_topic` | guard `active` | – |
| `refining` | refine `active` | guard>refine signal |
| `question_refined` | refine `done` | refine>plan signal |
| `planning{queries}` | plan `done`, search `working`, `queries` | plan>search query n=min(len,8) |
| `searching{found,queries,failed}` | search `done`, enrich `working`, counts | search>enrich paper n=min(found,8) |
| `enriching{candidates}` | enrich `done`, screen `working`, `batchesExpected=ceil(c/10)` | enrich>screen paper |
| `screening{batch}` | screen `active`, `batches++` (capped at expected) | – |
| `screened{kept,total}` | screen `done`, read `working`, `slots` = kept waiting (≤30) | screen>read kept n=min(kept,8) |
| `external_lookup` | `external=true`, external `active` | read>external signal |
| `reading{ref,title}` | read `active`; slot by ref, else first free, else append (≤30) → `reading` | – |
| `extracted{ref,ok,uncertain}` | slot `ok`/`failed`/`uncertain`; counts; when all slots final: read `done`, synth `working` | read>synth card or failed n=1 |
| `synthesizing{papers}` | synth `working`, `synthPapers` | read>synth signal |
| `localizing` | localize `working` | synth>localize signal |
| `finalizing` | finish `working` (localize `skipped` if never seen) | → finish signal |
| `interrupted` | status `paused`; active/working → `paused` | – |
| `done` | status `done`; every non-skipped agent `done` | – |
| `error` | status `error`; `currentAgent` → `failed` | – |
| `rejected` | status `rejected`; guard `failed`; rest `skipped` | – |
| `cancelled` | status `cancelled`; current → `skipped` | – |
| unknown | trace row only (forward compatible) | – |

**Trace text (Thai):** `queued` "เข้าคิวแล้ว"; `started` "เริ่มทำงาน" / "ทำงานต่อจากจุดที่ค้างไว้" (resume); `checking_topic` "ตรวจว่าเป็นคำถามทางการแพทย์"; `refining` "กำลังตีความคำถาม"; `question_refined` "ตีความคำถามเสร็จ"; `planning` "วางคำค้น {n} คำ"; `searching` "ค้นเจอ {found} รายการจาก {queries} คำค้น" (+ " · ค้นไม่สำเร็จ {failed}" when >0); `enriching` "มีบทคัดย่อพอให้อ่าน {c} ฉบับ"; `screening` "คัดกรองชุดละ {batch} ฉบับ" (consecutive rows merge into `repeat`, shown "×6"); `screened` "ผ่านคัดกรอง {kept} จาก {total} ฉบับ"; `external_lookup` "ปรึกษาเครื่องมือภายนอก"; `reading` "เริ่มอ่าน {ref}" (consecutive rows merge → "เริ่มอ่าน {repeat} ฉบับ"); `extracted` "อ่าน {ref} เสร็จ" / "อ่าน {ref} ไม่สำเร็จ" / "อ่าน {ref} เสร็จ · สองโมเดลอ่านต่างกัน"; `synthesizing` "เริ่มสังเคราะห์จาก {papers} ฉบับ"; `localizing` "แปลรายงานเป็นภาษาไทย"; `finalizing` "เรียบเรียงรายงาน"; `interrupted` "เซิร์ฟเวอร์หยุดชั่วคราว จะทำงานต่อเอง"; `done` "เสร็จแล้ว"; `error` "ไม่สำเร็จ"; `rejected` "หัวข้อไม่ผ่านการตรวจ"; `cancelled` "ถูกยกเลิก". `elapsed` from `payload.elapsed_s`, else null.

**Burst helpers:** `takeFreshPulses` returns pulses with `key > seenKey`; if more than `cap`, keep the newest `cap`. `planDots` expands each pulse into `n` dots with delay `i*120ms` inside a pulse, pulses in the same render offset by 60ms, total capped at `maxDots` dropping the oldest.

**Wiring (`use-review.ts`):** `const [scene, dispatchScene] = useReducer(reduceScene, undefined, () => initialScene())`; when `getReview` returns, dispatch `{kind:"lang", language: review.language}` (check the actual field name in `src/lib/types.ts`); `onEvent` and `settle()` dispatch `{kind:"event", ev}` to the scene reducer as well as to `reduceRun`. Return `{ review, run, scene, phase, connection, retry }`. Retry must reset the scene the same way it resets `run` (check how `run` is reset today).

**Tests (`agent-scene.test.ts`):** full LIVE_EVENTS walk (statuses and edges per step; `skipped` when `question_refined` absent); dedupe (seq ≤ lastSeq ignored; replaying the full sequence twice gives the same scene); slot assignment by ref, first free, append when `screened` unseen, cap 30, repeated `extracted` idempotent; read `done` only when all slots final; `interrupted` → `paused`, `started{resume:true}` → back to `working`; error fails current agent; rejected fails guard; localize skipped when `finalizing` arrives without `localizing`; pulses ring capped at 24 and trace at 80; consecutive `reading`/`screening` rows merge with the right `repeat`; `takeFreshPulses` on a burst of 40 returns the newest 12; `planDots` caps at 24 with monotonic delays; `sceneSummary` Thai strings for waiting, running (e.g. "เอเจนต์กำลังอ่านงานวิจัย อ่านแล้ว 12 จาก 30 ฉบับ") and done; junk payloads (strings for numbers, missing keys) never throw. `use-review.test.tsx`: `scene` advances with events and dedupes.

### Task 3: Pure layout geometry `src/lib/agent-layout.ts`

**Files:** Create `frontend/src/lib/agent-layout.ts`, `frontend/src/lib/agent-layout.test.ts`.

**API:**
```ts
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type LayoutKind = "wide" | "narrow";
export interface Seg { a: Pt; c: Pt; b: Pt }               // quadratic control through the lifted midpoint
export interface StageLayout {
  kind: LayoutKind; width: number; height: number;          // viewBox
  nodes: Partial<Record<AgentId, Pt>>;                     // visible agents only
  label: Partial<Record<AgentId, "below" | "right">>;
  edges: { id: EdgeId; d: string; seg: Seg }[];
  satellites: { label: string; at: Pt }[];                 // PubMed, arXiv, Semantic Scholar, OpenAlex, Crossref
  queryChips: Rect[]; batchChips: Rect[]; slots: Pt[]; zone: Partial<Record<AgentId, Rect>>;
}
export function arc(a: Pt, b: Pt, bend?: number): Seg;      // bend default 0.18
export function segPath(s: Seg): string;                    // "M ax ay Q cx cy bx by", 1 decimal
export function segX(s: Seg, t: number): number;            // allocation-free
export function segY(s: Seg, t: number): number;
export function clip(text: string, max: number): string;    // "…" when longer
export function layoutFor(kind: LayoutKind, o: { showLocalize: boolean; showExternal: boolean; slots: number; batches: number; queries: number }): StageLayout;
```
Check the satellite list against the configured search engines (`backend/config` / searxng settings) and use the real engine names.

**Arc (observatory formula in 2D):** `mid = lerp(a,b,0.5)` offset along the unit normal of `(b−a)` by `|b−a|·bend + 6`; normal points up (−y) for horizontal edges and right (+x) for vertical ones; quadratic control `c = 2·mid − (a+b)/2` so the curve passes through the lifted midpoint.

**Wide layout** (viewBox 960 × ~420): one lane at y=96, nodes spaced evenly across visible PIPELINE agents (10, or 9 without localize); nodes are 44×44 tiles, labels below. Zones under the lane (y 170–410): query chips under `plan` (max 4 + "+n"); satellites on an arc above `search` (r=58, 5 points); batch chips under `screen` (max 10, 2 rows); reader pool under `read`/`synth` (6 cols × 5 rows, 26px pitch); `external` (when shown) below `read`'s zone with an edge to synth.

**Narrow layout** (viewBox width 360, height computed): vertical lane at x=36, 76px apart; labels right of each node (x=70); zones right of their node (x 70–350) pushing the next node down by their height; pool 7 cols at 30px pitch. Width ≤ 360 so the svg (`width:100%`) never causes horizontal scroll at 390px.

**Tests:** arc midpoint lift equals `|dx|·0.18+6` for a horizontal pair; `segX/segY(seg, .5)` hit the lifted midpoint; `segPath` stable (exact string); vertical edges bulge right; every node, chip and slot lies inside the viewBox in both layouts for slots 0..30, batches 0..10, queries 0..12; narrow width ≤ 360; nodes never overlap (pairwise distance ≥ 44); `showLocalize:false` → no `localize` node and a synth>finish edge exists; `slots.length === min(n,30)`; `clip` behaviour.

### Task 4: Stage primitives with motion (node, edge, packets) + CSS loops

**Files:**
- Create in `frontend/src/components/review/stage/`: `motion.tsx` (`StageMotion` = `LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"`), `agent-node.tsx`, `stage-edge.tsx`, `packet-layer.tsx`, `icons.tsx` (small line icons as path strings), `use-wide.ts` (`useSyncExternalStore` on `matchMedia("(min-width: 768px)")`, server snapshot `false`)
- Modify: `frontend/src/app/globals.css` (stage keyframes)
- Tests: `stage/agent-node.test.tsx`, `stage/packet-layer.test.tsx`, `stage/use-wide.test.ts`

**AgentNode `{id, at, status, label, count?}`** → `<g data-agent={id} data-status={status}>`: tile `rect rx=2` 44×44 fill `surface`; stroke by status — idle `rule` 1px; active `primary` 2px; working `primary` 1.5px `stroke-dasharray 4 3` + class `stage-march`; done `ink` 1px + ✓ corner mark; failed `err` 2px + ✕; skipped dashed `rule`, label `muted`; paused fill `warn-bg`, no animation. `m.g` scales 1 → 1.06 when active (200ms ease-out). No bob, no idle rotation. Dimming uses `muted` colours, not opacity. Label `<text className="font-display">` with predefined `<tspan>` lines; count badge `fill-muted` tabular-nums (e.g. "87", "30/60", "12/30"). Check the Tailwind token names for SVG fills/strokes available in `globals.css` and use them (e.g. `fill-surface`, `stroke-primary`) or CSS variables.

**StageEdge `{d, state}`:** `path fill="none"`: idle `rule`; visited `ink` 1px (ghost edge); live `primary` 1.5px. No CSS animation on edges.

**PacketLayer `{scene, layout}`:** render `null` when `useReducedMotion()` is true (and skip work when `document.hidden`). `seen = useRef(scene.lastSeq at mount)`. In an effect on `scene.lastSeq`: `fresh = takeFreshPulses(scene.pulses, seen.current, PACKET_CAP)`, `dots = planDots(fresh, MAX_DOTS)`, assign round-robin to 24 always-mounted `PacketDot`s, then `seen.current = scene.lastSeq`. `PacketDot` keeps `t = useMotionValue(0)`, `cx = useTransform(t, v => segX(segRef.current, v))`, same for `cy`; on assignment: stop the previous control, set `segRef.current`, `animate(t, [0,1], {duration: .7, delay, ease: "easeInOut"})`; opacity keyframes 0 → 1 → 0 at `[0,.1,.9,1]`; `r=3.5`. Colour by kind: query/paper `ink`, kept/card `primary`, failed `err`, signal `muted`. A dot carries `data-packet` only while in flight.

**CSS (`globals.css`):** `@keyframes stage-march { to { stroke-dashoffset: -14 } }`, `@keyframes stage-pulse { 50% { opacity: .45 } }`; classes `.stage-march` (1.2s linear infinite) and `.stage-pulse`. Confirm the existing reduced-motion block disables them.

**Tests:** AgentNode renders `data-status` for every status, ✕ on failed, ✓ on done, nothing with `num-verified`; PacketLayer: after a rerender with 1 new pulse `[data-packet]` count > 0, mounted with an existing scene (replay) → 0, after a burst of 40 pulses ≤ 24, with `useReducedMotion` mocked true renders nothing (`vi.mock("motion/react", …)` partial); `useWide` returns false on the server snapshot.

### Task 5: Detail clusters + `AgentStage` composer

**Files:**
- Create in `frontend/src/components/review/stage/`: `query-chips.tsx`, `search-satellites.tsx`, `screen-batches.tsx`, `reader-pool.tsx`, `agent-stage.tsx`, `stage-legend.tsx`
- Modify: `frontend/src/components/ui/evidence.tsx` (export `FLAG_PATHS` used by `UncertainFlag`, markup unchanged)
- Tests: `stage/agent-stage.test.tsx`

**Clusters:**
- **QueryChips** (observatory PlannerTasks): one `rect rx=2` chip per query, `font-code` 11px, `clip(q, 26)` with `<title>` full text; "+n" chip for the rest; pending (`rule`) until `planning`, then done (`ink` + ✓).
- **SearchSatellites:** 5 round 10px glyphs labelled with the search engines (from Task 3), joined to the hub by short `rule` spokes; lit (`primary` stroke) only while search is `working`/`active`. No per-source counts (events don't carry them) — say so in a comment.
- **ScreenBatches:** `batchesExpected` chips; the first `batches` are active (`stage-pulse`) until `screened`, then all done; caption "ผ่าน {kept} · ตัดออก {total−kept}" in tabular-nums.
- **ReaderPool:** one round slot per `scene.slots[i]` with `data-testid="reader-{state}"`: waiting dashed `rule` ring; reading `primary` ring + `stage-pulse` with ref ("P7", 9px `font-display`); ok `ok` ring + ✓; failed `err` + ✕; uncertain `warn` + the flag path (`FLAG_PATHS`).
- **Synth indeterminate:** synth node `working` + zone tint; caption under it "กำลังเทียบผลและเขียนสรุป (ขั้นนี้ไม่มีความคืบหน้าให้ดู)".

**AgentStage `{scene, connection?}`:** picks the layout with `useWide()` and memoises `layoutFor(...)` on `[kind, showLocalize, showExternal, slots, batches, queries]`. Inside `<StageMotion>` renders `<figure className="grid gap-2">` with `<svg viewBox role="img" aria-label={sceneSummary(scene)} className="w-full h-auto max-w-[960px]">`, drawing in order: zone rect (`rail` fill for the current agent, 300ms ease-out opacity — adapts ZONES), edges, clusters, nodes, PacketLayer. Caption under the svg when waiting: "รอคิว · เอเจนต์จะเริ่มทำงานเมื่อถึงคิว"; when `connection === "polling"`: "อัปเดตทุกไม่กี่วินาที". `<StageLegend>` (HTML) below: small inline-svg samples with "กำลังทำ", "กำลังทำ (ไม่มีความคืบหน้าให้ดู)", "เสร็จ", "ข้ามขั้นนี้", "อ่านไม่สำเร็จ" and the uncertain flag "สองโมเดลอ่านต่างกัน".

**Tests:** for the full LIVE_EVENTS state: `[data-agent="read"]` has `data-status="active"`, `reader-ok` count 1, `reader-waiting` 29, svg aria-label mentions "อ่าน"; narrow layout when `matchMedia` false, wide when mocked true; >4 queries shows "+n"; no localize node when `expectLocalize:false`; rejected scene shows guard failed; synth working caption once every slot is final.

### Task 6: Trace log + milestone announcer

**Files:**
- Create: `frontend/src/components/review/stage/trace-log.tsx`, `frontend/src/components/review/stage/milestone-status.tsx`
- Tests: `stage/trace-log.test.tsx`, `stage/milestone-status.test.tsx`

**TraceLog `{rows}`** (observatory TracePanel): `<section aria-labelledby="h-trace">` with `<h2 className="label" id="h-trace">บันทึกการทำงาน</h2>`; a scroll container `max-h-72 overflow-y-auto tabIndex={0} aria-labelledby="h-trace"` with an `<ol>`; each row a grid `[4rem_minmax(0,1fr)]`: `formatElapsed` in `font-display tabular-nums text-muted`, the Thai text (Anuphan) followed by the event type in `font-code text-xs text-muted` (`[extracted]`), and "×n" when `repeat > 1`. Newest at the bottom; auto-scroll to the bottom only when the user is already near it (pure `nearBottom(el)`); no smooth scroll under reduced motion. Not `aria-live`.

**MilestoneStatus `{scene}`:** visually hidden `<p role="status">` announcing `AGENT_LABEL[currentAgent].role` only when `currentAgent` changes, throttled to one announcement per 5s with a trailing update (the timer only affects the announced text, never scene state). Separate from the header's existing `aria-live` clock line.

**Tests:** rows render with elapsed and merged ×6; no `aria-live` on the log; the announcer changes on an agent change, ignores a burst of `extracted`, throttles with fake timers.

### Task 7: Integrate into `LiveRun`; slim `progress.ts`

**Files:**
- Modify: `frontend/src/components/review/live-run.tsx`, `frontend/src/components/review/review-screen.tsx` (pass `scene`), `frontend/src/lib/progress.ts` (remove `wells`, `WELL_COUNT`, `Well`, `screenedWells` and tray-only logic; keep counts and steps), `frontend/src/lib/progress.test.ts`, `frontend/src/components/review/live-run.test.tsx`

**LiveRun `{ run, scene, topic, connection, queuePosition, startedAt }`:**
- Header unchanged (label, h1, aria-live status with clock and `TYPICAL_DURATION_TH`, reconnect/polling banner).
- Stage: `const AgentStage = dynamic(() => import("./stage/agent-stage").then(m => m.AgentStage), { ssr: false, loading: () => <div aria-hidden className="aspect-[960/420] w-full rounded-sm border border-rule bg-surface" /> })` — read the Next 16 docs on `next/dynamic`/lazy loading in `node_modules/next/dist/docs/` first. `<MilestoneStatus>` next to the stage.
- Ledger below the stage, always visible (not in `<details>`: it is the accessible equivalent of the `role="img"` stage, the reduced-motion view, and what tests target), `lg:grid-cols-2`:
  - Left, under `<h2 className="label">ความคืบหน้าแบบข้อความ</h2>`: the existing STEPS `<ol>` with `aria-current="step"` and queries (first 3 + `<details>` "และอีก n คำค้น"), and the counters `<dl>` without the well `Swatch`.
  - Right: refined-question block, `<TraceLog>`, the "กำลังอ่าน" reading list (text equivalent of the pool), close-tab info + `CopyLinkButton`, external-lookup line.

**Tests:** rewrite "shows the refined question, the tray…" as "…the agent stage and paper-by-paper progress": build `run` and `scene` from the same events with a helper `statesOf(events)`; assert `await screen.findByRole("img", { name: /อ่าน/ })` (if the dynamic import doesn't resolve in vitest, `vi.mock("next/dynamic", …)` to return the component directly), `reader-ok` count 1, ledger `listitem[aria-current=step]` contains "สังเคราะห์" (or the correct current step). Keep the reconnect, queue, connecting, clock, queries and counters tests; "counters not num-verified" checks `container.querySelector(".num-verified") === null` over the whole section. `progress.test.ts`: drop well assertions, keep step/count assertions (`screened` still sets `kept`).

### Task 8: E2E — timed streaming, tray → stage assertions, reduced motion, phone, axe

**Files:**
- Modify: `frontend/e2e/mock-api.ts`, `frontend/e2e/app.spec.ts`
- Create: `frontend/e2e/live-stage.spec.ts`

**Timed streaming without a backend:** add `streamSse(page, frames: {delayMs: number; events: [string, Record<string, unknown>][]}[])` to `mock-api.ts`, using `page.addInitScript` to wrap `window.fetch`: requests whose URL ends with `/reviews/${RID}/events` get `new Response(new ReadableStream({ start(c) { …enqueue each frame after its delay… } }), { headers: { "content-type": "text/event-stream" } })` (frames serialised in the same SSE format and seq numbering as the existing `sse()`); other requests pass through to the real fetch (still intercepted by `page.route`). Use `page.clock.install()` + `page.clock.runFor(ms)` for deterministic timing; if motion's frame loop doesn't advance under `page.clock`, assert on `data-status` and trace rows only and assert packets with `expect.poll` and real timers (frames ~300ms apart). Keep `sse()` for burst-style tests.

**Update `app.spec.ts`:** the "live run shows the refined question and the specimen tray" test becomes "…and the agent stage": expect the stage img (`getByRole("img", { name: /เอเจนต์/ })`), `[data-agent="read"][data-status="active"]`, `reader-ok` 1, `reader-waiting` 29, trace text "ผ่านคัดกรอง 30 จาก 60 ฉบับ"; keep the screenshot and the axe check. "live wells fit phone" becomes "live stage fits phone" (390px, reader slots visible, no horizontal scroll, screenshot). The รอคิว `aria-current` and queries-in-`ol li` tests must still pass unchanged.

**New `live-stage.spec.ts`:**
- Real-time progression: frames started → (1s) refining → (2s) planning → (3s) searching → … → screened → reading ×30 → extracted P1..P5 at 1s each; after each step assert the current agent's `data-status`; `[data-packet]` > 0 right after an `extracted` frame and 0 after ~1s more; the trace grows by one row per frame.
- Burst then live: the first frame carries all past events at once → `[data-packet]` ≤ 24 (in practice 0) and final statuses correct immediately; then one live `extracted` frame → packets appear.
- Reduced motion: `emulateMedia({ reducedMotion: "reduce" })` → `[data-packet]` 0 throughout, final states visible, no running animations on `.stage-march` elements (`el.getAnimations().length === 0`).
- axe on the stage at 1440 and 390, light and dark, with reduced motion on (no mid-fade sampling).
- Narrow geometry at 390: svg bounding box width ≤ viewport width; labels "ผู้อ่าน" and "สังเคราะห์" visible.

Run the full verification at the end of this task (see Verification) and report results honestly.

### Task 9: Docs, DESIGN.md, attribution

**Files:** `DESIGN.md`, `docs/api.md`, `NOTICE.md` (new, repo root), header comments in `frontend/src/components/review/stage/agent-stage.tsx` and `frontend/src/lib/agent-layout.ts`; `CLAUDE.md` only if Task 1 didn't already update the stub/load-test lines.

**DESIGN.md:**
- Overview/modes: live run is "Experience: a working instrument panel".
- Components: replace "Specimen tray (live run)" with "Agent stage (live run)": 44px node tiles with 2px corners; status vocabulary (active solid `primary`; working marching dashed `primary` — the indeterminate state, used only for phases without progress events; done `ink` + ✓; failed `err` + ✕; skipped dashed `rule`; paused `warn-bg`); edges in `rule`, ghost (visited) edges `ink`, live edge `primary`; packets = 7px round dots, signals of real events only, ≤8 per event and ≤24 on screen; reader pool round slots (full radius allowed) with the flag for uncertain; wide = horizontal lane, narrow (<768px) = vertical lane; the text ledger always stays below the stage.
- Shapes: `full` also for packet dots, reader slots and satellites.
- Motion: add "The second authored moment: packets travel 700ms ease-in-out along curved edges (120ms stagger) when an event arrives; working = 1.2s marching outline; bursts and replays collapse to the final state"; reduced motion: no packets, no loops, final states; JS motion goes through `MotionConfig reducedMotion="user"` + `useReducedMotion`.
- Decisions Log row (keep the log chronological): `2026-10-09 | Plan 11: the live run's step list + specimen tray are replaced by a real-time 2D agent stage (SVG + motion), text ledger kept | The user approved; adapted from sakshigupta372/AI-Agent-observatory (graph of agents, curved edges with travelling packets, planner task chips, ghost edges, trace panel) to Theatre Green: flat, 2D, no bob or glow, driven only by real events, reduced-motion and mobile first`.

**docs/api.md:** no contract change; add notes to the events table: `reading` is sent when a paper's read starts and all arrive together at fan-out start (papers then wait for the LLM concurrency limit); `planning`, `searching`, `enriching` and `screened` mark the end of their step; with `GRAPH_MODE=stub` and `STUB_DELAY_SECONDS>0` the stub emits the same sequence on a scaled timeline.

**Attribution:** `NOTICE.md`: "The live-run agent stage adapts ideas and the edge-arc formula from AI-Agent-observatory by sakshigupta372 (https://github.com/sakshigupta372/AI-Agent-observatory), used with the author's permission as stated by the project owner on 2026-10-09." Plus a 2-line comment in `agent-stage.tsx` and `agent-layout.ts` pointing to `NOTICE.md`.

**Verify:** run `rg "num-verified|VerifiedNumber" frontend/src/components/review/live-run.tsx frontend/src/components/review/stage` (or grep) — must find nothing.

---

## Verification

- Backend (`backend/`): `uv run pytest` (incl. `test_graph_skeleton`, `test_stub_delay`, `test_stub_timeline`) and `uv run ruff check .`.
- Frontend (`frontend/`): `npm test && npm run lint && npm run typecheck && npm run build:standalone && npm run e2e`. `build:standalone` proves the offline report doesn't pull in stage/motion code (grep the standalone output for "motion" → none).
- Bundle: compare `npm run build` output before/after; the `/r/[id]` eager chunks grow ≤ ~2 kB; the lazy stage chunk ≤ ~45 kB gzip.
- Manual QA: `docker compose up` with `GRAPH_MODE=stub`, `STUB_DELAY_SECONDS=90`, `LLM_CONCURRENCY=4`; submit; watch the timed sequence, staggered reader pool, silent synth, Thai localize phase; reload mid-run (no animation storm); stop the worker mid-read (paused → resume); light/dark, 390px/1440px, OS reduced motion; then `MRA_LIVE_WEB=1 npx playwright test e2e/live.spec.ts`.

## Risks

- Replay bursts → `seen` at mount + per-render cap; React batches one SSE chunk into one render.
- Polling fallback (4s) → the stage freezes at the last known state, which is honest; caption explains.
- Performance (30 readers, 24 dots, 11 nodes ≈ 150 SVG elements) → CSS-only loops, motion only during flights, no filters.
- Motion bundle size → `LazyMotion` + `domAnimation` + `m` + `next/dynamic`; measure.
- Thai text in SVG → fixed label table with `<tspan>` lines, ≥12px effective in narrow layout, dynamic strings clipped with `<title>`.
- axe on SVG → `role="img"` + `aria-label`; scrollable trace focusable and named; token colours, not opacity; axe with reduced motion.
- Clock-dependent e2e → `page.clock` + init-script stream; fallback to `expect.poll` on status/trace.
- Event semantics drift → unknown types only add a trace row (pinned by a test).
