// Pure scene model for the live "agent stage": review events (SSE) -> what the stage draws. No React, no DOM, no timers.
// Every status change, count, packet and trace row derives from exactly one received ReviewEvent (never fake progress);
// events with seq <= lastSeq are ignored so replay after a reconnect never double-applies.
//
// Start vs end of a step (the backend only emits "step began" markers, so a step ends when the next one begins):
//   checking_topic -> guard starts            refining -> guard ends, refine starts
//   question_refined -> refine ends           planning -> plan ends, search starts (silent until `searching`)
//   searching -> search ends, enrich starts   enriching -> enrich ends, screen starts (silent until `screening`)
//   screening -> a screening batch began      screened -> screen ends, read starts (slots created)
//   reading -> a paper entered the read pool  extracted -> a paper finished; the last one ends read, starts synth
//   synthesizing -> synth runs                localizing -> synth ends, localize runs
//   finalizing -> localize ends (or is skipped), finish runs        done -> everything ends
//
// Step spans (`spans`, for durations in the grouped log) come only from received `elapsed_s` values, never a client
// clock. A post-pass (`updateSpans`) diffs agent statuses before/after each event:
//   - entering active/working with no start yet -> start = elapsed_s of that event (paused -> working keeps the start)
//   - leaving active/working/paused for done/failed/skipped -> end = elapsed_s of that event
//   - idle -> done directly (a silent phase, e.g. plan on `planning`) -> start = end of the previous PIPELINE agent
//     ("a step ends when the next begins"), end = elapsed_s
//   - an event without elapsed_s leaves the field null (so no duration is shown for that step)
import { asDesign, asDirection } from "./live-evidence";
import type { DesignCategory, Direction, ReviewEvent } from "./types";
import type { Connection } from "./use-review"; // type only (erased): no runtime cycle

export type AgentId =
  | "guard" | "refine" | "plan" | "search" | "enrich" | "screen" | "read" | "external" | "synth" | "localize" | "finish";
export const PIPELINE: AgentId[] = ["guard", "refine", "plan", "search", "enrich", "screen", "read", "synth", "localize", "finish"]; // external is a side node
/** Every agent, PIPELINE order with the external side node last. */
const ALL_AGENTS: readonly AgentId[] = [...PIPELINE, "external"];
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
  finish: { th: ["เรียบเรียง"], role: "เรียบเรียงรายงาน" },
};

export type EdgeId = `${AgentId}>${AgentId}`;
export type EdgeState = "idle" | "live" | "visited"; // visited = observatory "ghost edge"
export type PulseKind = "query" | "paper" | "kept" | "card" | "failed" | "signal";
export interface Pulse { key: number; edge: EdgeId; kind: PulseKind; n: number } // key = event seq; n in 1..8
export type SlotState = "waiting" | "reading" | "ok" | "failed" | "uncertain";
export interface ReaderSlot {
  ref: string | null; state: SlotState;
  title: string | null; // from reading.title (trimmed, <= 200 chars)
  direction: Direction | null; // extracted.direction via asDirection; null when failed/missing/unknown
  design: DesignCategory | null; // extracted.design via asDesign
  verified: number | null; // count of numbers that passed verification
  doneKey: number | null; // seq of the extracted event that last changed state or direction
}
export interface TraceRow { key: number; type: string; text: string; elapsed: number | null; repeat: number; agent: AgentId | null }
export interface StepSpan { start: number | null; end: number | null } // elapsed_s only
export interface Scene {
  lastSeq: number;
  status: "waiting" | "running" | "paused" | "done" | "error" | "rejected" | "cancelled";
  agents: Record<AgentId, AgentStatus>;
  edges: Partial<Record<EdgeId, EdgeState>>;
  counts: {
    queries: number; found: number; searchFailed: number; candidates: number; batches: number;
    batchesExpected: number; kept: number; screenedTotal: number;
    readOk: number; // finished reads that succeeded (includes `uncertain`)
    readFailed: number; uncertain: number; synthPapers: number | null;
  };
  queries: string[];
  slots: ReaderSlot[]; // <= MAX_SLOTS (30)
  pulses: Pulse[]; // ring, <= MAX_PULSES (24)
  trace: TraceRow[]; // <= MAX_TRACE (80), newest last
  external: boolean;
  expectLocalize: boolean; // from review.language === "th"
  elapsed: number;
  spans: Partial<Record<AgentId, StepSpan>>;
}
export type SceneAction = { kind: "event"; ev: ReviewEvent } | { kind: "lang"; language: string };

export const MAX_SLOTS = 30;
export const MAX_PULSES = 24;
export const MAX_TRACE = 80;

const SCREEN_BATCH = 10;
const FINAL_SLOT = new Set<SlotState>(["ok", "failed", "uncertain"]);

export function initialScene(opts?: { language?: string }): Scene {
  const agents = {} as Record<AgentId, AgentStatus>;
  for (const id of ALL_AGENTS) agents[id] = "idle";
  return {
    lastSeq: 0, status: "waiting", agents, edges: {},
    counts: {
      queries: 0, found: 0, searchFailed: 0, candidates: 0, batches: 0, batchesExpected: 0, kept: 0, screenedTotal: 0,
      readOk: 0, readFailed: 0, uncertain: 0, synthPapers: null,
    },
    queries: [], slots: [], pulses: [], trace: [], external: false, expectLocalize: opts?.language === "th", elapsed: 0,
    spans: {},
  };
}

// --- defensive payload parsing: never throws ---------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const num = (v: unknown): number => toNum(v) ?? 0;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const MAX_TITLE = 200;
function titleOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, MAX_TITLE);
}
const pulseN = (n: number): number => Math.max(1, Math.min(8, Math.floor(n)));

function edgeId(a: AgentId, b: AgentId): EdgeId {
  return `${a}>${b}`;
}

function isRunning(st: AgentStatus): boolean {
  return st === "active" || st === "working";
}

// --- scene mutation helpers (operate on a private draft copy) ----------------------------------------------------

/** Marks done->done pipeline edges (and the read>external edge) as visited ghost edges. */
function refreshEdges(s: Scene): void {
  for (let i = 1; i < PIPELINE.length; i++) {
    const a = PIPELINE[i - 1];
    const b = PIPELINE[i];
    if (s.agents[a] === "done" && s.agents[b] === "done") s.edges[edgeId(a, b)] = "visited";
  }
  if (s.agents.read === "done" && s.agents.external === "done") s.edges["read>external"] = "visited";
  // localize skipped: English reviews take the synth>finish shortcut; Thai lanes keep their localize node, so the
  // path through it (synth>localize>finish) becomes the ghost edge instead
  if (s.agents.synth === "done" && s.agents.localize === "skipped" && s.agents.finish === "done") {
    if (s.expectLocalize) s.edges["synth>localize"] = s.edges["localize>finish"] = "visited";
    else s.edges["synth>finish"] = "visited";
  }
}

const TERMINAL_STATUS = new Set<Scene["status"]>(["done", "error", "rejected", "cancelled"]);
const KNOWN = new Set([
  "queued", "started", "checking_topic", "refining", "question_refined", "planning", "searching", "enriching", "screening",
  "screened", "external_lookup", "reading", "extracted", "synthesizing", "localizing", "finalizing", "interrupted", "done",
  "error", "rejected", "cancelled",
]);

/** On a terminal event no edge may stay live: both ends done -> visited, otherwise back to idle (removed). */
function retireLiveEdges(s: Scene): void {
  for (const k of Object.keys(s.edges) as EdgeId[]) {
    if (s.edges[k] !== "live") continue;
    const [a, b] = k.split(">") as [AgentId, AgentId];
    if (s.agents[a] === "done" && s.agents[b] === "done") s.edges[k] = "visited";
    else delete s.edges[k];
  }
}

/**
 * Sets `id` to `status`. Earlier PIPELINE agents that are active/working/paused become done, still-idle ones become
 * skipped. `alsoDone` is forced to done first (so e.g. `planning` ends plan even if it never started). The edge into
 * `id` goes live while `id` runs.
 */
function advanceTo(s: Scene, id: AgentId, status: AgentStatus, alsoDone?: AgentId): void {
  if (alsoDone) s.agents[alsoDone] = "done";
  const idx = PIPELINE.indexOf(id);
  for (let i = 0; i < idx; i++) {
    const a = PIPELINE[i];
    const st = s.agents[a];
    if (isRunning(st) || st === "paused") s.agents[a] = "done";
    else if (st === "idle") s.agents[a] = "skipped";
  }
  s.agents[id] = status;
  if (s.external && s.agents.external === "active" && idx > PIPELINE.indexOf("read")) s.agents.external = "done";
  refreshEdges(s);
  if (idx > 0 && isRunning(status)) {
    const from: AgentId = id === "finish" ? finishVia(s) : PIPELINE[idx - 1];
    s.edges[edgeId(from, id)] = "live";
  }
}

/**
 * The edge into finish. English lanes have no localize node, so a skipped localize means the synth>finish shortcut.
 * Thai lanes always draw localize (the layout follows `expectLocalize`), so even when `localizing` never arrives
 * (no papers, localize off) the edge stays localize>finish and is drawable.
 */
function finishVia(s: Scene): AgentId {
  return s.agents.localize === "skipped" && !s.expectLocalize ? "synth" : "localize";
}

function pushPulse(s: Scene, key: number, edge: EdgeId, kind: PulseKind, n: number): void {
  s.pulses = [...s.pulses, { key, edge, kind, n: pulseN(n) }].slice(-MAX_PULSES);
}

function setStatus(s: Scene, next: Scene["status"]): void {
  s.status = next;
}

export function currentAgent(s: Scene): AgentId | null {
  for (let i = PIPELINE.length - 1; i >= 0; i--) {
    const st = s.agents[PIPELINE[i]];
    if (isRunning(st) || st === "paused") return PIPELINE[i];
  }
  const ext = s.agents.external;
  return isRunning(ext) || ext === "paused" ? "external" : null;
}

function recountSlots(s: Scene): void {
  let ok = 0;
  let failed = 0;
  let unc = 0;
  for (const sl of s.slots) {
    if (sl.state === "ok") ok++;
    else if (sl.state === "uncertain") { ok++; unc++; }
    else if (sl.state === "failed") failed++;
  }
  s.counts.readOk = ok;
  s.counts.readFailed = failed;
  s.counts.uncertain = unc;
}

export function emptySlot(ref: string | null): ReaderSlot {
  return { ref, state: "waiting", title: null, direction: null, design: null, verified: null, doneKey: null };
}

/** Slot for `ref`: existing, else first free (no ref yet), else append while under the cap. Returns index or -1. */
function slotFor(s: Scene, ref: string | null): number {
  if (ref !== null) {
    const hit = s.slots.findIndex((sl) => sl.ref === ref);
    if (hit >= 0) return hit;
  }
  const free = s.slots.findIndex((sl) => sl.ref === null);
  if (free >= 0) return free;
  if (s.slots.length < MAX_SLOTS) {
    s.slots.push(emptySlot(ref));
    return s.slots.length - 1;
  }
  return -1;
}

// --- trace -------------------------------------------------------------------------------------------------------

function traceText(type: string, p: Record<string, unknown>, s: Scene): string {
  switch (type) {
    case "queued": return "เข้าคิวแล้ว";
    case "started": return p.resume ? "ทำงานต่อจากจุดที่ค้างไว้" : "เริ่มทำงาน";
    case "checking_topic": return "ตรวจว่าเป็นคำถามทางการแพทย์";
    case "refining": return "กำลังตีความคำถาม";
    case "question_refined": return "ตีความคำถามเสร็จ";
    case "planning": return `วางคำค้น ${Array.isArray(p.queries) ? p.queries.length : 0} คำ`;
    case "searching": {
      const q = Array.isArray(p.queries) ? p.queries.length : (toNum(p.queries) ?? s.counts.queries);
      const failed = num(p.failed);
      return `ค้นเจอ ${num(p.found)} รายการจาก ${q} คำค้น${failed > 0 ? ` · ค้นไม่สำเร็จ ${failed}` : ""}`;
    }
    case "enriching": return `มีบทคัดย่อพอให้อ่าน ${num(p.candidates)} ฉบับ`;
    case "screening": return `คัดกรองชุดละ ${num(p.batch)} ฉบับ`;
    case "screened": return `ผ่านคัดกรอง ${num(p.kept)} จาก ${num(p.total)} ฉบับ`;
    case "external_lookup": return "ปรึกษาเครื่องมือภายนอก";
    case "reading": return `เริ่มอ่าน ${str(p.ref) ?? "งานวิจัย"}`;
    case "extracted": {
      const ref = str(p.ref) ?? "งานวิจัย";
      if (p.ok !== true) return `อ่าน ${ref} ไม่สำเร็จ`;
      return p.uncertain === true ? `อ่าน ${ref} เสร็จ · สองโมเดลอ่านต่างกัน` : `อ่าน ${ref} เสร็จ`;
    }
    case "synthesizing": return `เริ่มสังเคราะห์จาก ${num(p.papers)} ฉบับ`;
    case "localizing": return "แปลรายงานเป็นภาษาไทย";
    case "finalizing": return "เรียบเรียงรายงาน";
    case "interrupted": return "เซิร์ฟเวอร์หยุดชั่วคราว จะทำงานต่อเอง";
    case "done": return "เสร็จแล้ว";
    case "error": return "ไม่สำเร็จ";
    case "rejected": return "หัวข้อไม่ผ่านการตรวจ";
    case "cancelled": return "ถูกยกเลิก";
    default: return type;
  }
}

const MERGE = new Set(["screening", "reading"]);

const TRACE_AGENT: Record<string, AgentId> = {
  checking_topic: "guard", refining: "refine", question_refined: "refine", planning: "plan", searching: "search",
  enriching: "enrich", screening: "screen", screened: "screen", external_lookup: "external", reading: "read",
  extracted: "read", synthesizing: "synth", localizing: "localize", finalizing: "finish",
};

/** The agent a trace row belongs to (status rows such as queued/started/done -> null). */
export function traceAgent(type: string): AgentId | null {
  return Object.prototype.hasOwnProperty.call(TRACE_AGENT, type) ? TRACE_AGENT[type] : null;
}

function pushTrace(s: Scene, ev: ReviewEvent, p: Record<string, unknown>): void {
  const elapsed = toNum(p.elapsed_s);
  const last = s.trace[s.trace.length - 1];
  if (last && last.type === ev.type && MERGE.has(ev.type)) {
    const repeat = last.repeat + 1;
    const text = ev.type === "reading" ? `เริ่มอ่าน ${repeat} ฉบับ` : last.text;
    s.trace = [...s.trace.slice(0, -1), { ...last, repeat, text, elapsed: elapsed ?? last.elapsed }];
    return;
  }
  s.trace = [...s.trace, { key: ev.seq, type: ev.type, text: traceText(ev.type, p, s), elapsed, repeat: 1, agent: traceAgent(ev.type) }].slice(-MAX_TRACE);
}

// --- step spans (see header) ------------------------------------------------------------------------------------

const ENDED = new Set<AgentStatus>(["done", "failed", "skipped"]);

/** Diffs agent statuses before/after one event and records span starts/ends (copy-on-write on `next.spans`). */
function updateSpans(prev: Scene, next: Scene, el: number | null): void {
  const spans: Scene["spans"] = { ...next.spans };
  let changed = false;
  const get = (id: AgentId): StepSpan | undefined => spans[id];
  const put = (id: AgentId, sp: StepSpan): void => {
    spans[id] = sp;
    changed = true;
  };
  // PIPELINE order, so a silent phase sees the previous agent's end even when both change in the same event.
  for (const id of ALL_AGENTS) {
    const a = prev.agents[id];
    const b = next.agents[id];
    if (a === b) continue;
    const cur = get(id) ?? { start: null, end: null };
    if (isRunning(b) && a !== "paused") {
      if (cur.start === null && el !== null) put(id, { ...cur, start: el });
    } else if ((isRunning(a) || a === "paused") && ENDED.has(b)) {
      if (el !== null) put(id, { ...cur, end: el });
    } else if (a === "idle" && b === "done") {
      const i = PIPELINE.indexOf(id);
      const before = i > 0 ? (get(PIPELINE[i - 1])?.end ?? null) : null;
      put(id, { start: cur.start ?? before, end: el ?? cur.end });
    }
  }
  if (changed) next.spans = spans;
}

// --- reducer -----------------------------------------------------------------------------------------------------

export function reduceScene(state: Scene, a: SceneAction): Scene {
  if (a.kind === "lang") {
    const expect = a.language === "th";
    return expect === state.expectLocalize ? state : { ...state, expectLocalize: expect };
  }
  const ev = a.ev;
  if (!ev || typeof ev.seq !== "number" || !Number.isFinite(ev.seq) || ev.seq <= state.lastSeq) return state;
  // A terminal event arriving after the scene is already terminal (SSE then polling) is a duplicate: no second row.
  if (TERMINAL_STATUS.has(state.status) && TERMINAL_STATUS.has(ev.type as Scene["status"])) {
    return { ...state, lastSeq: ev.seq };
  }
  const p: Record<string, unknown> = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  const s: Scene = {
    ...state, lastSeq: ev.seq, agents: { ...state.agents }, edges: { ...state.edges },
    counts: { ...state.counts }, slots: state.slots.map((x) => ({ ...x })), queries: state.queries,
  };
  const el = toNum(p.elapsed_s);
  if (el !== null) s.elapsed = el;
  if (s.status === "waiting" && ev.type !== "queued" && KNOWN.has(ev.type)) setStatus(s, "running");

  switch (ev.type) {
    case "queued":
      setStatus(s, "waiting");
      break;
    case "started":
      setStatus(s, "running");
      for (const id of Object.keys(s.agents) as AgentId[]) if (s.agents[id] === "paused") s.agents[id] = "working";
      break;
    case "checking_topic":
      advanceTo(s, "guard", "active");
      break;
    case "refining":
      advanceTo(s, "refine", "active");
      pushPulse(s, ev.seq, "guard>refine", "signal", 1);
      break;
    case "question_refined":
      advanceTo(s, "refine", "done");
      pushPulse(s, ev.seq, "refine>plan", "signal", 1);
      break;
    case "planning": {
      const qs = Array.isArray(p.queries) ? p.queries.filter((q): q is string => typeof q === "string") : [];
      s.queries = qs;
      s.counts.queries = qs.length;
      advanceTo(s, "search", "working", "plan");
      pushPulse(s, ev.seq, "plan>search", "query", Math.min(qs.length, 8));
      break;
    }
    case "searching": {
      const found = num(p.found);
      s.counts.found = found;
      s.counts.queries = Array.isArray(p.queries) ? p.queries.length : (toNum(p.queries) ?? s.counts.queries);
      s.counts.searchFailed = num(p.failed);
      advanceTo(s, "enrich", "working", "search");
      pushPulse(s, ev.seq, "search>enrich", "paper", Math.min(found, 8));
      break;
    }
    case "enriching": {
      const c = num(p.candidates);
      s.counts.candidates = c;
      s.counts.batchesExpected = Math.ceil(c / SCREEN_BATCH);
      advanceTo(s, "screen", "working", "enrich");
      pushPulse(s, ev.seq, "enrich>screen", "paper", Math.min(c, 8));
      break;
    }
    case "screening": {
      const exp = s.counts.batchesExpected;
      s.counts.batches = exp > 0 ? Math.min(s.counts.batches + 1, exp) : s.counts.batches + 1;
      advanceTo(s, "screen", "active");
      break;
    }
    case "screened": {
      const kept = num(p.kept);
      s.counts.kept = kept;
      s.counts.screenedTotal = num(p.total);
      // Idempotent (a restarted worker may re-emit `screened`): keep slots that have a ref, resize only the waiting tail.
      const want = Math.min(Math.max(kept, 0), MAX_SLOTS);
      while (s.slots.length > want && s.slots[s.slots.length - 1].ref === null) s.slots.pop();
      while (s.slots.length < want) s.slots.push(emptySlot(null));
      recountSlots(s);
      advanceTo(s, "read", "working", "screen");
      pushPulse(s, ev.seq, "screen>read", "kept", Math.min(kept, 8));
      break;
    }
    case "external_lookup":
      s.external = true;
      s.agents.external = "active";
      s.edges["read>external"] = "live";
      pushPulse(s, ev.seq, "read>external", "signal", 1);
      break;
    case "reading": {
      advanceTo(s, "read", "active");
      const i = slotFor(s, str(p.ref));
      if (i >= 0 && !FINAL_SLOT.has(s.slots[i].state)) {
        s.slots[i].ref = str(p.ref) ?? s.slots[i].ref;
        s.slots[i].state = "reading";
      }
      if (i >= 0) s.slots[i].title = titleOf(p.title) ?? s.slots[i].title;
      break;
    }
    case "extracted": {
      if (!isRunning(s.agents.read) && s.agents.read !== "done") advanceTo(s, "read", "active");
      const next: SlotState = p.ok === true ? (p.uncertain === true ? "uncertain" : "ok") : "failed";
      const i = slotFor(s, str(p.ref));
      if (i >= 0) {
        const sl = s.slots[i];
        const changed = sl.state !== next;
        const ok = next !== "failed";
        const direction = ok ? asDirection(p.direction) : null;
        // Resume re-emits the same result: doneKey (which drives board/pile animation) moves only on a real change.
        if (changed || direction !== sl.direction) sl.doneKey = ev.seq;
        sl.ref = str(p.ref) ?? sl.ref;
        sl.state = next;
        sl.direction = direction;
        sl.design = ok ? asDesign(p.design) : null;
        sl.verified = ok ? toNum(p.verified) : null;
        if (changed) pushPulse(s, ev.seq, "read>synth", next === "failed" ? "failed" : "card", 1);
      }
      recountSlots(s);
      if (s.slots.length > 0 && s.slots.every((sl) => FINAL_SLOT.has(sl.state)) && s.agents.read !== "done") {
        advanceTo(s, "synth", "working", "read");
      }
      break;
    }
    case "synthesizing": {
      s.counts.synthPapers = toNum(p.papers);
      advanceTo(s, "synth", "working");
      pushPulse(s, ev.seq, "read>synth", "signal", 1);
      break;
    }
    case "localizing":
      advanceTo(s, "localize", "working");
      pushPulse(s, ev.seq, "synth>localize", "signal", 1);
      break;
    case "finalizing": {
      advanceTo(s, "finish", "working");
      const via = finishVia(s);
      pushPulse(s, ev.seq, edgeId(via, "finish"), "signal", 1);
      break;
    }
    case "interrupted":
      setStatus(s, "paused");
      for (const id of Object.keys(s.agents) as AgentId[]) if (isRunning(s.agents[id])) s.agents[id] = "paused";
      break;
    case "done":
      setStatus(s, "done");
      for (const id of Object.keys(s.agents) as AgentId[]) {
        const st = s.agents[id];
        if (st === "skipped") continue;
        if (st === "idle" && id === "external" && !s.external) continue; // never used
        if (st === "idle" && id === "localize" && !s.expectLocalize) {
          s.agents[id] = "skipped";
          continue;
        }
        s.agents[id] = "done";
      }
      refreshEdges(s);
      break;
    case "error": {
      setStatus(s, "error");
      const cur = currentAgent(s);
      if (cur) s.agents[cur] = "failed";
      break;
    }
    case "rejected":
      setStatus(s, "rejected");
      for (const id of Object.keys(s.agents) as AgentId[]) s.agents[id] = id === "guard" ? "failed" : "skipped";
      break;
    case "cancelled": {
      setStatus(s, "cancelled");
      const cur = currentAgent(s);
      if (cur) s.agents[cur] = "skipped";
      break;
    }
    default:
      break; // unknown event: trace row only (forward compatible)
  }
  if (TERMINAL_STATUS.has(s.status)) retireLiveEdges(s);
  updateSpans(state, s, el);
  pushTrace(s, ev, p);
  return s;
}

// --- burst helpers (replay never queues minutes of animation) ----------------------------------------------------

/** Pulses newer than `seenKey`; when more than `cap` arrive at once only the newest `cap` are kept. */
export function takeFreshPulses(pulses: Pulse[], seenKey: number, cap: number): Pulse[] {
  const fresh = pulses.filter((p) => p.key > seenKey);
  return fresh.length > cap ? fresh.slice(fresh.length - cap) : fresh;
}

/** Expands pulses into dots: `i*120ms` inside a pulse, pulses offset by 60ms, at most `maxDots` (oldest dropped). */
export function planDots(fresh: Pulse[], maxDots: number): { edge: EdgeId; kind: PulseKind; delayMs: number }[] {
  const flat: { edge: EdgeId; kind: PulseKind; pulse: number; i: number }[] = [];
  fresh.forEach((p, pulse) => {
    for (let i = 0; i < p.n; i++) flat.push({ edge: p.edge, kind: p.kind, pulse, i });
  });
  const kept = flat.length > maxDots ? flat.slice(flat.length - Math.max(maxDots, 0)) : flat;
  const firstPulse = kept.length ? kept[0].pulse : 0;
  const firstI = kept.length ? kept[0].i : 0;
  return kept
    .map((d) => ({
      edge: d.edge, kind: d.kind,
      delayMs: (d.pulse - firstPulse) * 60 + (d.pulse === firstPulse ? d.i - firstI : d.i) * 120,
    }))
    .sort((x, y) => x.delayMs - y.delayMs);
}

// --- presentation helpers ----------------------------------------------------------------------------------------

const DOING: Partial<Record<AgentId, string>> = {
  guard: "ตรวจหัวข้อ", refine: "ตีความคำถาม", plan: "วางคำค้น", search: "ค้นฐานข้อมูล", enrich: "ดึงบทคัดย่อ",
  screen: "คัดกรองงานวิจัย", synth: "สังเคราะห์ผล", localize: "แปลรายงานเป็นภาษาไทย", finish: "เรียบเรียงรายงาน",
  external: "ปรึกษาเครื่องมือภายนอก",
};

/** Papers whose read has finished (ok, uncertain or failed). */
export function readDone(s: Scene): number {
  return s.counts.readOk + s.counts.readFailed;
}

/** Packet pool size and per-update pulse cap, shared by the 2D and 3D stages (kept here so the 3D chunk never imports the 2D stage). */
export const MAX_DOTS = 24;
export const PACKET_CAP = 12;

/** The count shown under an agent's label (2D and 3D). */
export function countFor(s: Scene, id: AgentId): string | undefined {
  const c = s.counts;
  switch (id) {
    case "search": return c.found > 0 ? String(c.found) : undefined;
    case "enrich": return c.candidates > 0 ? String(c.candidates) : undefined;
    case "screen": return c.screenedTotal > 0 ? `${c.kept}/${c.screenedTotal}` : undefined;
    case "read": return s.slots.length > 0 ? `${readDone(s)}/${s.slots.length}` : undefined;
    default: return undefined;
  }
}

/** The indeterminate synth caption (two lines; wide views join them with a space). Shown only while synth is working. */
export const SYNTH_CAPTION = ["กำลังเทียบผลและเขียนสรุป", "(ขั้นนี้ไม่มีความคืบหน้าให้ดู)"] as const;

export function showSynthCaption(s: Scene): boolean {
  return s.agents.synth === "working";
}

/** At most one stage caption (2D and 3D). Polling wins: it explains why the stage updates in steps. */
export function stageCaption(s: Scene, connection?: Connection): string | null {
  if (connection === "polling") return "อัปเดตทุกไม่กี่วินาที";
  return s.status === "waiting" ? "รอคิว · เอเจนต์จะเริ่มทำงานเมื่อถึงคิว" : null;
}

/** Thai aria-label for the stage SVG. */
export function sceneSummary(s: Scene): string {
  switch (s.status) {
    case "waiting": return "เอเจนต์กำลังรอคิว";
    case "paused": return "เซิร์ฟเวอร์หยุดชั่วคราว เอเจนต์จะทำงานต่อเอง";
    case "done": return "เอเจนต์ทำงานเสร็จแล้ว";
    case "error": return "เอเจนต์ทำงานไม่สำเร็จ";
    case "rejected": return "หัวข้อไม่ผ่านการตรวจ เอเจนต์หยุดทำงาน";
    case "cancelled": return "การทำงานถูกยกเลิก";
    default: break;
  }
  const cur = currentAgent(s);
  if (cur === "read") {
    return `เอเจนต์กำลังอ่านงานวิจัย อ่านแล้ว ${readDone(s)} จาก ${s.slots.length} ฉบับ`;
  }
  return cur ? `เอเจนต์กำลัง${DOING[cur] ?? "ทำงาน"}` : "เอเจนต์กำลังทำงาน";
}

export function formatElapsed(sec: number | null): string {
  if (sec === null || typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "—";
  const t = Math.floor(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
