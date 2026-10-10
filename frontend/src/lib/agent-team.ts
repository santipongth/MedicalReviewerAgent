// Pure: the live review Scene seen as a team of 5 AI agents, each with a "thinking" phase. No React, no DOM, no timers.
// Phases (คิด / วิเคราะห์ / วางแผน / ลงมือ) are labels for real pipeline steps derived from received events, not the
// model's inner thoughts. Every speech line comes from scene data (counts, queries, finished slots) and follows the
// honesty rules of agent-thought.ts: never claim a specific paper is being read right now (speak only of finished
// papers or "กำลังอ่านหรือรอคิว"), a direction is always "ตามที่เอเจนต์อ่าน", and a scoping scene (`directionless`)
// never mentions a direction at all.
import {
  PIPELINE, type AgentId, type AgentStatus, type EdgeId, type PulseKind, type Scene,
  AGENT_LABEL, PACKET_CAP, currentAgent, readDone,
} from "./agent-scene";
import { type ThoughtDetail, STEP_TITLE, latestFinished, paperLines } from "./agent-thought";
import { READING_OR_QUEUED } from "./copy";

export type MemberId = "planner" | "researcher" | "screener" | "reader" | "synthesizer";
export type Phase = "think" | "analyse" | "plan" | "act";
/** idle, working, paused (server restart), done, failed (error/rejected), stopped (run cancelled while it worked). */
export type MemberStatus = "idle" | "working" | "paused" | "done" | "failed" | "stopped";

export interface TeamMember { id: MemberId; name: string; role: string; steps: AgentId[] }
export interface MemberState {
  id: MemberId;
  status: MemberStatus;
  /** Where the member is now (null when idle or done). */
  phase: Phase | null;
  /** Phases already behind it, in PHASES order (all four once done). */
  passed: Phase[];
  /** What it says: a real result, the current step, or its role while idle. */
  line: string;
  /** Short real tally ("อ่านเสร็จ 12 จาก 30"), or null when nothing is known yet. */
  tally: string | null;
}
export interface Team { members: MemberState[]; speaking: MemberId | null }
export interface Handoff { key: number; from: MemberId; to: MemberId; kind: PulseKind; n: number }

export const PHASES: readonly Phase[] = ["think", "analyse", "plan", "act"];
export const PHASE_LABEL: Record<Phase, string> = { think: "คิด", analyse: "วิเคราะห์", plan: "วางแผน", act: "ลงมือ" };
/** The visible note that the phases are labels for real steps. */
export const PHASE_NOTE = "ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล";

export const TEAM: readonly TeamMember[] = [
  { id: "planner", name: "ผู้วางแผน", role: "ตรวจหัวข้อ ตีความคำถาม และวางคำค้น", steps: ["guard", "refine", "plan"] },
  { id: "researcher", name: "นักค้นคว้า", role: "ค้นฐานข้อมูลงานวิจัยหลายแหล่ง แล้วเก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน", steps: ["search", "enrich"] },
  { id: "screener", name: "ผู้คัดกรอง", role: "ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ", steps: ["screen"] },
  { id: "reader", name: "ผู้อ่าน", role: "อ่านบทคัดย่อและตรวจตัวเลขกับต้นฉบับ", steps: ["read", "external"] },
  { id: "synthesizer", name: "ผู้สังเคราะห์", role: "เทียบผล เขียนสรุป และแปลรายงาน", steps: ["synth", "localize", "finish"] },
];

const MEMBER_OF: Record<AgentId, MemberId> = {
  guard: "planner", refine: "planner", plan: "planner", search: "researcher", enrich: "researcher", screen: "screener",
  read: "reader", external: "reader", synth: "synthesizer", localize: "synthesizer", finish: "synthesizer",
};
/** The member that owns a pipeline step (`external` belongs to the reader). */
export function memberOf(id: AgentId): MemberId {
  return MEMBER_OF[id];
}

const RUNNING = new Set<AgentStatus>(["active", "working"]);

interface Ctx { s: Scene; steps: AgentId[]; framework?: "PICO" | "PCC" }

/** Steps the lane actually shows: localize only for Thai (or if it ran), external only when it was used. */
function visibleSteps(s: Scene, steps: AgentId[]): AgentId[] {
  return steps.filter((id) => {
    if (id === "external") return s.external;
    if (id === "localize") return s.expectLocalize || s.agents.localize !== "idle";
    return true;
  });
}

/**
 * The step a cancel cut short: the last step that left idle, when it ended "skipped" (the reducer skips the current
 * step on `cancelled`). Steps skipped earlier (English localize, a jump over idle steps) always have a later step that
 * started, so they are never mistaken for it.
 */
function cancelledStep(s: Scene): AgentId | null {
  if (s.status !== "cancelled") return null;
  for (let i = PIPELINE.length - 1; i >= 0; i--) {
    const st = s.agents[PIPELINE[i]];
    if (st === "idle") continue;
    if (st === "skipped") return PIPELINE[i];
    break;
  }
  return s.agents.external === "skipped" ? "external" : null;
}

/** A step the member is on (or was on when the run stopped there). */
function touched(s: Scene, id: AgentId): boolean {
  const st = s.agents[id];
  return RUNNING.has(st) || st === "paused" || st === "failed" || cancelledStep(s) === id;
}

function statusOf(s: Scene, steps: AgentId[]): MemberStatus {
  const sts = steps.map((id) => s.agents[id]);
  if (sts.some((x) => x === "failed")) return "failed";
  if (sts.some((x) => x === "paused")) return "paused";
  if (sts.some((x) => RUNNING.has(x))) return "working";
  const someDone = sts.some((x) => x === "done");
  const allEnded = sts.length > 0 && sts.every((x) => x === "done" || x === "skipped");
  const cut = cancelledStep(s);
  if (cut && steps.includes(cut)) return "stopped";
  if (allEnded && someDone) return "done";
  // Between two of its steps (e.g. the planner after the question is refined, before the queries arrive).
  if (someDone && s.status === "running") return "working";
  if (someDone && s.status === "paused") return "paused";
  return "idle";
}

/** Phase of a live member. `passed` is what lies behind it. */
function phaseOf(id: MemberId, s: Scene): { phase: Phase | null; passed: Phase[] } {
  const on = (x: AgentId) => touched(s, x);
  const done = (x: AgentId) => s.agents[x] === "done";
  switch (id) {
    case "planner":
      if (on("plan")) return { phase: "plan", passed: ["think", "analyse"] };
      if (on("refine")) return { phase: "analyse", passed: ["think"] };
      if (on("guard")) return { phase: "think", passed: [] };
      if (done("refine")) return { phase: "plan", passed: ["think", "analyse"] };
      if (done("guard")) return { phase: "analyse", passed: ["think"] };
      return { phase: null, passed: [] };
    case "researcher":
      return on("search") || on("enrich") || done("search") ? { phase: "act", passed: ["think", "plan"] } : { phase: null, passed: [] };
    case "screener":
      if (!on("screen")) return { phase: null, passed: [] };
      return s.counts.batches > 0 ? { phase: "analyse", passed: ["think"] } : { phase: "think", passed: [] };
    case "reader":
      if (!on("read") && !on("external") && !done("read")) return { phase: null, passed: [] };
      // readDone counts failed reads too: a reader whose papers all failed has still acted (it tried to verify them).
      return readDone(s) > 0 ? { phase: "act", passed: ["think", "analyse"] } : { phase: "analyse", passed: ["think"] };
    case "synthesizer":
      if (on("localize") || on("finish") || done("synth")) return { phase: "act", passed: ["think", "analyse"] };
      if (on("synth")) return s.counts.pools !== null ? { phase: "analyse", passed: ["think"] } : { phase: "think", passed: [] };
      return { phase: null, passed: [] };
  }
}

// --- speech (real scene data only) ------------------------------------------------------------------------------

function stepWords(c: Ctx): AgentId | null {
  for (const id of c.steps) if (touched(c.s, id)) return id;
  return null;
}

function readerFinished(s: Scene): string {
  const n = s.slots.length;
  const base = `อ่านเสร็จ ${readDone(s)} จาก ${n} ฉบับ`;
  const latest = latestFinished(s);
  if (!latest || latest.ref === null) return base;
  const ok = latest.state !== "failed";
  const detail: Extract<ThoughtDetail, { kind: "paper" }> = {
    kind: "paper", ref: latest.ref, title: latest.title, ok, direction: ok ? latest.direction : null,
    design: ok ? latest.design : null, uncertain: latest.state === "uncertain", verified: ok ? latest.verified : null,
    ...(s.directionless ? { directionless: true } : {}),
  };
  const pl = paperLines(detail);
  if (!ok) return `${base} · ${pl.lead}`;
  const parts = [base, pl.finding ? `${latest.ref} ${pl.finding}` : null, pl.flag].filter((x): x is string => !!x);
  return parts.join(" · ");
}

function lineFor(id: MemberId, status: MemberStatus, c: Ctx): string {
  const s = c.s;
  const k = s.counts;
  const member = TEAM.find((m) => m.id === id) as TeamMember;
  const at = stepWords(c);
  if (status === "failed") {
    if (s.status === "rejected" && id === "planner") return "หัวข้อไม่ผ่านการตรวจ";
    return `${at ? STEP_TITLE[at] : member.name} ไม่สำเร็จ`;
  }
  if (status === "paused") return "หยุดชั่วคราว จะทำงานต่อเอง";
  if (status === "stopped") return `ถูกยกเลิก${at ? `ระหว่าง${STEP_TITLE[at]}` : ""}`;
  switch (id) {
    case "planner":
      if (status === "idle") return member.role;
      if (k.queries > 0 && (status === "done" || s.agents.plan === "done")) return `วางคำค้น ${k.queries} คำ`;
      if (status === "done") return "ตรวจและตีความคำถามเสร็จ";
      if (at === "guard") return "ตรวจว่าเป็นคำถามทางการแพทย์ก่อนเริ่มค้น";
      if (at === "refine") return c.framework === "PCC" ? "แปลงคำถามให้ชัดแบบ PCC" : "แปลงคำถามให้ชัดแบบ PICO";
      return AGENT_LABEL.plan.role;
    case "researcher": {
      if (status === "idle") return member.role;
      const fail = k.searchFailed > 0 ? ` · ค้นไม่สำเร็จ ${k.searchFailed}` : "";
      if (status === "done" || at === "enrich" || s.agents.search === "done") {
        const keep = k.candidates > 0 ? ` · มีบทคัดย่อพอให้อ่าน ${k.candidates}` : "";
        return k.found > 0 ? `พบ ${k.found} รายการ${keep}${fail}` : "ค้นเสร็จแล้ว";
      }
      return k.queries > 0 ? `ค้นด้วย ${k.queries} คำค้น` : "ค้นฐานข้อมูลงานวิจัย";
    }
    case "screener":
      if (status === "idle") return member.role;
      if (status === "done") return k.screenedTotal > 0 ? `เลือก ${k.kept} จาก ${k.screenedTotal}` : "คัดกรองเสร็จแล้ว";
      if (k.batches <= 0) return member.role;
      return `ให้คะแนนชุดที่ ${k.batches}${k.batchesExpected > 0 ? ` จาก ${k.batchesExpected}` : ""}`;
    case "reader": {
      if (status === "idle") return member.role;
      const n = s.slots.length;
      if (status === "done") {
        if (n === 0) return "ไม่มีงานวิจัยให้อ่าน";
        const failed = k.readFailed > 0 ? ` · อ่านไม่สำเร็จ ${k.readFailed}` : "";
        return `อ่านเสร็จ ${readDone(s)} จาก ${n} ฉบับ${failed}`;
      }
      if (at === "external" && !touched(s, "read")) return "ปรึกษาเครื่องมือภายนอก · ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่แหล่งอ้างอิง";
      if (n === 0) return AGENT_LABEL.read.role;
      if (readDone(s) === 0) return `${n} ฉบับ${READING_OR_QUEUED}`;
      return readerFinished(s);
    }
    case "synthesizer": {
      if (status === "idle") return member.role;
      const p = k.synthPapers;
      const pooled = k.pools !== null ? ` · คำนวณค่ารวมแล้ว ${k.pools} ชุด` : "";
      if (status === "done") return `${p !== null ? `สรุปจาก ${p} ฉบับ` : "เขียนรายงานเสร็จ"}${pooled}`;
      if (at === "localize") return "แปลรายงานเป็นภาษาไทย ตัวเลขต้องคงเดิม";
      if (at === "finish") return "รวมผลเป็นรายงานพร้อมที่มาของตัวเลข";
      return `${p !== null ? `เทียบผลจาก ${p} ฉบับและเขียนสรุป` : "เทียบผลและเขียนสรุป"}${pooled}`;
    }
  }
}

function tallyFor(id: MemberId, s: Scene): string | null {
  const k = s.counts;
  switch (id) {
    case "planner": return k.queries > 0 ? `${k.queries} คำค้น` : null;
    case "researcher": return k.found > 0 ? `พบ ${k.found} รายการ` : null;
    case "screener":
      if (k.screenedTotal > 0) return `เลือก ${k.kept} จาก ${k.screenedTotal}`;
      return k.batches > 0 ? `ชุดที่ ${k.batches}${k.batchesExpected > 0 ? ` จาก ${k.batchesExpected}` : ""}` : null;
    case "reader": return s.slots.length > 0 ? `อ่านเสร็จ ${readDone(s)} จาก ${s.slots.length}` : null;
    case "synthesizer":
      if (k.pools !== null) return `ค่ารวม ${k.pools} ชุด`;
      return k.synthPapers !== null ? `จาก ${k.synthPapers} ฉบับ` : null;
  }
}

// --- public API --------------------------------------------------------------------------------------------------

/** The team for a scene: one state per member plus who is speaking (only while the run is live). */
export function teamOf(s: Scene, opts: { framework?: "PICO" | "PCC" } = {}): Team {
  const members: MemberState[] = TEAM.map((m) => {
    const steps = visibleSteps(s, m.steps);
    const status = statusOf(s, steps);
    const ctx: Ctx = { s, steps, framework: opts.framework };
    let phase: Phase | null = null;
    let passed: Phase[] = [];
    if (status === "done") passed = [...PHASES];
    else if (status !== "idle") ({ phase, passed } = phaseOf(m.id, s));
    return { id: m.id, status, phase, passed, line: lineFor(m.id, status, ctx), tally: tallyFor(m.id, s) };
  });
  let speaking: MemberId | null = null;
  if (s.status === "running") {
    const cur = currentAgent(s);
    const byStep = cur ? members.find((m) => m.id === memberOf(cur)) : undefined;
    const pick = byStep && byStep.status === "working" ? byStep : members.find((m) => m.status === "working");
    speaking = pick ? pick.id : null;
  }
  return { members, speaking };
}

/**
 * Pulses on an edge between steps of two different members, as member -> member packets. Only pulses newer than
 * `seenKey` are returned; callers MUST pass the last key they drew (the default 0 returns the whole pulse history).
 * Same-member edges are dropped first, then the newest PACKET_CAP remain.
 */
export function handoffs(s: Scene, seenKey = 0): Handoff[] {
  const out: Handoff[] = [];
  for (const p of s.pulses.filter((x) => x.key > seenKey)) {
    const [a, b] = (p.edge as EdgeId).split(">") as [AgentId, AgentId];
    const from = MEMBER_OF[a];
    const to = MEMBER_OF[b];
    if (from && to && from !== to) out.push({ key: p.key, from, to, kind: p.kind, n: p.n });
  }
  return out.slice(-PACKET_CAP);
}

/** Accessible name of one member, e.g. "ผู้อ่าน: กำลังลงมือ · อ่านเสร็จ 12 จาก 30". */
export function memberLabel(m: MemberState): string {
  const name = (TEAM.find((x) => x.id === m.id) as TeamMember).name;
  let state: string;
  switch (m.status) {
    case "working": state = m.phase ? `กำลัง${PHASE_LABEL[m.phase]}` : "กำลังทำงาน"; break;
    case "done": state = "เสร็จแล้ว"; break;
    case "failed": state = "ไม่สำเร็จ"; break;
    case "paused": state = "หยุดชั่วคราว"; break;
    case "stopped": state = "ถูกยกเลิก"; break;
    default: state = "รอถึงคิว";
  }
  return `${name}: ${state}${m.tally ? ` · ${m.tally}` : ""}`;
}

/** One-sentence accessible description of the whole team. */
export function teamSummary(s: Scene, opts: { framework?: "PICO" | "PCC" } = {}): string {
  const t = teamOf(s, opts);
  switch (s.status) {
    case "waiting": return "ทีมเอเจนต์ 5 คนกำลังรอคิว";
    case "paused": return "เซิร์ฟเวอร์หยุดชั่วคราว ทีมเอเจนต์จะทำงานต่อเอง";
    case "done": return "ทีมเอเจนต์ทำงานเสร็จแล้ว";
    case "rejected": return "หัวข้อไม่ผ่านการตรวจ ทีมเอเจนต์หยุดทำงาน";
    case "cancelled": return "การทำงานของทีมเอเจนต์ถูกยกเลิก";
    case "error": {
      const f = t.members.find((m) => m.status === "failed");
      return f ? `ทีมเอเจนต์ทำงานไม่สำเร็จ ${memberLabel(f)}` : "ทีมเอเจนต์ทำงานไม่สำเร็จ";
    }
    default: {
      const who = t.members.find((m) => m.id === t.speaking);
      return who ? `ทีมเอเจนต์ 5 คน ${memberLabel(who)}` : "ทีมเอเจนต์ 5 คนกำลังทำงาน";
    }
  }
}
