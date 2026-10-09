// Pure: the grouped trace log. Consecutive trace rows of the same agent form one step group; status rows (queued,
// started, interrupted, done, ...) form their own groups. Summaries come from the scene counts (not the rows), so they
// survive the 80-row trace cap. Durations only from two real elapsed_s values (scene spans), never a client clock.
import { type AgentId, type AgentStatus, type Scene, type TraceRow, currentAgent, readDone } from "./agent-scene";
import { STEP_TITLE } from "./agent-thought";

export interface TimelineGroup {
  id: string; agent: AgentId | null; status: AgentStatus | null; title: string; summary: string | null;
  durationS: number | null; startS: number | null; current: boolean; rows: TraceRow[];
}

/** One-line result of a step, from counts only; null when there is nothing (yet) to say. */
export function stepSummary(s: Scene, id: AgentId): string | null {
  const c = s.counts;
  const st = s.agents[id];
  switch (id) {
    case "guard":
      if (st === "done") return "ผ่านการตรวจ";
      return st === "failed" ? "หัวข้อไม่ผ่าน" : null;
    case "plan": return c.queries > 0 ? `${c.queries} คำค้น` : null;
    case "search":
      if (st !== "done") return null;
      return `ค้นเจอ ${c.found} รายการ${c.searchFailed > 0 ? ` · ค้นไม่สำเร็จ ${c.searchFailed}` : ""}`;
    case "enrich": return st === "done" ? `มีบทคัดย่อพอให้อ่าน ${c.candidates} ฉบับ` : null;
    case "screen":
      if (st === "done" && c.screenedTotal > 0) return `ผ่าน ${c.kept} จาก ${c.screenedTotal} ฉบับ`;
      return c.batches > 0 ? `เริ่มชุดที่ ${c.batches}` : null;
    case "read": {
      if (s.slots.length === 0) return null;
      const fail = c.readFailed > 0 ? ` · ไม่สำเร็จ ${c.readFailed}` : "";
      const unc = c.uncertain > 0 ? ` · สองโมเดลอ่านต่างกัน ${c.uncertain}` : "";
      return `อ่านเสร็จ ${readDone(s)}/${s.slots.length}${fail}${unc}`;
    }
    case "synth": return c.synthPapers !== null ? `จาก ${c.synthPapers} ฉบับ` : null;
    default: return null;
  }
}

export function timelineGroups(s: Scene): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const row of s.trace) {
    const last = groups[groups.length - 1];
    if (last && last.agent === row.agent) {
      last.rows.push(row);
      continue;
    }
    const agent = row.agent;
    groups.push({
      id: `${agent ?? "status"}-${row.key}`, agent, status: agent ? s.agents[agent] : null,
      title: agent ? STEP_TITLE[agent] : row.text, summary: agent ? stepSummary(s, agent) : null,
      durationS: null, startS: agent ? (s.spans[agent]?.start ?? null) : null, current: false, rows: [row],
    });
  }
  const cur = currentAgent(s);
  const seen = new Set<AgentId>();
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g.agent || seen.has(g.agent)) continue;
    seen.add(g.agent); // the last group of this agent
    const sp = s.spans[g.agent];
    if (sp && sp.start !== null && sp.end !== null) g.durationS = Math.max(0, sp.end - sp.start);
    g.current = g.agent === cur;
  }
  return groups;
}
