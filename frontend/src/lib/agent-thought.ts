// Pure: the "what the agent is doing" thought block, derived only from the scene (current agent, counts, queries,
// slots, spans). No React, no DOM, no timers. Honesty rules: never claim a paper is being read now (all `reading`
// events arrive together at fan-out), speak only of finished papers or "กำลังอ่านหรือรอคิว"; a direction is always
// "ตามที่เอเจนต์อ่าน" (the model's judgement of one abstract); missing/unknown direction -> "ไม่มีข้อมูลทิศทาง".
import { type AgentId, type AgentStatus, type ReaderSlot, type Scene, AGENT_LABEL, currentAgent, readDone } from "./agent-scene";
import { AS_READ_TH, NO_DIRECTION_TH, READING_OR_QUEUED } from "./copy";
import { DESIGN_LABEL, DIRECTION_LABEL } from "./i18n";
import type { DesignCategory, Direction } from "./types";

export type ThoughtDetail =
  | { kind: "queries"; items: string[]; more: number }
  | {
    kind: "paper"; ref: string; title: string | null; ok: boolean; direction: Direction | null;
    design: DesignCategory | null; uncertain: boolean; verified: number | null; directionless?: boolean;
  };
export interface Thought {
  key: string; agent: AgentId | null; status: AgentStatus | null; heading: string; body: string; short: string;
  detail: ThoughtDetail | null; since: number | null; indeterminate: boolean;
}

const SHOWN_QUERIES = 2;
const SEARCH_SOURCES = "PubMed, Europe PMC, OpenAlex และฐานข้อมูลอื่น";

/** Headings per agent (also the grouped log's step titles). */
export const STEP_TITLE: Record<AgentId, string> = {
  guard: "ตรวจหัวข้อ", refine: "ตีความคำถาม", plan: "วางคำค้น", search: "ค้นฐานข้อมูล", enrich: "ดึงบทคัดย่อ",
  screen: "คัดกรอง", read: "อ่านงานวิจัย", external: "ปรึกษาเครื่องมือภายนอก", synth: "สังเคราะห์ผล", localize: "แปลภาษา",
  finish: "เรียบเรียงรายงาน",
};

/** "และอีก {m} คำค้น" under the first queries (search detail). */
export function moreQueriesText(m: number): string {
  return `และอีก ${m} คำค้น`;
}

/** The lines of a finished-paper detail, in display order (the UI adds the Glyph before `finding`). */
export function paperLines(d: Extract<ThoughtDetail, { kind: "paper" }>): {
  lead: string; finding: string | null; verified: string | null; flag: string | null;
} {
  if (!d.ok) return { lead: `อ่าน ${d.ref} ไม่สำเร็จ`, finding: null, verified: null, flag: null };
  const dir = d.direction ? `${DIRECTION_LABEL.th[d.direction]} ${AS_READ_TH}` : NO_DIRECTION_TH;
  // A scoping review reports no direction at all (not even "no direction"): only the design, when known.
  const finding = d.directionless ? (d.design ? DESIGN_LABEL.th[d.design] : null) : d.design ? `${dir} · ${DESIGN_LABEL.th[d.design]}` : dir;
  return {
    lead: `อ่านเสร็จล่าสุด ${d.ref}`,
    finding,
    verified: d.verified !== null && d.verified > 0 ? `ตรวจตัวเลขผ่าน ${d.verified} ค่า` : null,
    flag: d.uncertain ? "สองโมเดลอ่านต่างกัน" : null,
  };
}

/** The most recently finished slot (highest doneKey), or null when no read has finished. */
export function latestFinished(s: Scene): ReaderSlot | null {
  let best: ReaderSlot | null = null;
  for (const sl of s.slots) {
    if (sl.doneKey === null || sl.ref === null) continue;
    if (!best || sl.doneKey > (best.doneKey ?? 0)) best = sl;
  }
  return best;
}

function make(
  key: string, agent: AgentId | null, status: AgentStatus | null, heading: string, body: string, shortBody: string | null,
  extra: { detail?: ThoughtDetail | null; since?: number | null; indeterminate?: boolean } = {},
): Thought {
  return {
    key, agent, status, heading, body, short: shortBody ? `${heading} · ${shortBody}` : heading,
    detail: extra.detail ?? null, since: extra.since ?? null, indeterminate: extra.indeterminate ?? false,
  };
}

/** The thought for the current state; null once the review is terminal (done/error/rejected/cancelled). */
export function thoughtFor(s: Scene, opts: { framework?: "PICO" | "PCC" } = {}): Thought | null {
  if (s.status === "waiting") return make("waiting", null, null, "รอคิว", "เอเจนต์จะเริ่มทำงานเมื่อถึงคิว", null);
  if (s.status === "paused") return make("paused", null, null, "หยุดชั่วคราว", "เซิร์ฟเวอร์หยุดชั่วคราว จะทำงานต่อเอง", null);
  if (s.status !== "running") return null;
  const id = currentAgent(s);
  if (!id) {
    const last = s.trace[s.trace.length - 1];
    return make("running", null, null, last?.text ?? "เริ่มทำงาน", "รอขั้นต่อไป", null);
  }
  const st = s.agents[id];
  const since = s.spans[id]?.start ?? null;
  const c = s.counts;
  const t = (body: string, shortBody: string | null, extra: Parameters<typeof make>[6] = {}) =>
    make(id, id, st, STEP_TITLE[id], body, shortBody, { since, ...extra });
  switch (id) {
    case "guard": return t("ตรวจว่าเป็นคำถามทางการแพทย์ก่อนเริ่มค้น", null);
    case "refine": return t(
      opts.framework === "PCC" ? "แปลงคำถามให้ชัดแบบ PCC: ประชากร แนวคิด บริบท" : "แปลงคำถามให้ชัดแบบ PICO: ใคร ทำอะไร เทียบกับอะไร วัดผลอะไร", null);
    case "plan": return t(AGENT_LABEL.plan.role, null);
    case "search": {
      const n = c.queries;
      const items = s.queries.slice(0, SHOWN_QUERIES);
      const detail: ThoughtDetail | null = items.length
        ? { kind: "queries", items, more: Math.max(0, s.queries.length - items.length) }
        : null;
      return t(`ค้นด้วย ${n} คำค้นใน ${SEARCH_SOURCES}`, `${n} คำค้น`, { detail });
    }
    case "enrich": {
      const fail = c.searchFailed > 0 ? ` · ค้นไม่สำเร็จ ${c.searchFailed}` : "";
      return t(`ค้นเจอ ${c.found} รายการ · เก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน${fail}`, `ค้นเจอ ${c.found} รายการ`);
    }
    case "screen": {
      const b = c.batches;
      const B = c.batchesExpected;
      const base = "ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ";
      if (b <= 0) return t(base, null);
      const of = B > 0 ? ` จาก ${B}` : "";
      return t(`${base} · เริ่มชุดที่ ${b}${of}`, `ชุดที่ ${b}${B > 0 ? `/${B}` : ""}`);
    }
    case "read": {
      const n = s.slots.length;
      const latest = latestFinished(s);
      if (!latest || latest.ref === null) {
        const k = n - readDone(s);
        return t(`อ่านบทคัดย่อและตรวจตัวเลขกับต้นฉบับ · ${k} ฉบับ${READING_OR_QUEUED}`, `${k} ฉบับ${READING_OR_QUEUED}`);
      }
      const d = readDone(s);
      const ok = latest.state !== "failed";
      const detail: ThoughtDetail = {
        kind: "paper", ref: latest.ref, title: latest.title, ok,
        direction: ok ? latest.direction : null, design: ok ? latest.design : null,
        uncertain: latest.state === "uncertain", verified: ok ? latest.verified : null,
        ...(s.directionless ? { directionless: true } : {}),
      };
      return t(`อ่านเสร็จ ${d} จาก ${n} ฉบับ`, `อ่านเสร็จ ${d}/${n}`, { detail });
    }
    case "external": return t("ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่แหล่งอ้างอิง", null);
    case "synth": {
      const p = c.synthPapers;
      const body = p !== null ? `เทียบผลจาก ${p} ฉบับและเขียนสรุป` : "เทียบผลและเขียนสรุป";
      // The stage caption (2D and 3D) already says this step shows no progress; not repeated here.
      return t(body, p !== null ? `จาก ${p} ฉบับ` : null, { indeterminate: true });
    }
    case "localize": return t("แปลรายงานเป็นภาษาไทย ตัวเลขต้องคงเดิม", null);
    case "finish": return t("รวมผลเป็นรายงานพร้อมที่มาของตัวเลข", null);
  }
}
