import { describe, expect, it } from "vitest";
import { type Scene, MAX_TRACE, initialScene, reduceScene } from "./agent-scene";
import { stepSummary, timelineGroups } from "./agent-timeline";
import type { ReviewEvent } from "./types";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene =>
  events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);

const HEAD: ReviewEvent[] = [
  ev(1, "queued"), ev(2, "started", { elapsed_s: 0.1 }), ev(3, "checking_topic", { elapsed_s: 0.5 }),
  ev(4, "refining", { elapsed_s: 0.8 }), ev(5, "question_refined", { elapsed_s: 4 }),
  ev(6, "planning", { queries: ["a", "b", "c"], elapsed_s: 6 }), ev(7, "searching", { found: 41, queries: 3, failed: 1, elapsed_s: 9 }),
  ev(8, "enriching", { candidates: 20, elapsed_s: 11 }), ev(9, "screening", { batch: 10, elapsed_s: 12 }),
  ev(10, "screening", { batch: 10, elapsed_s: 13 }),
];

describe("timelineGroups", () => {
  it("groups consecutive rows of the same agent; status rows form their own group", () => {
    const g = timelineGroups(run(HEAD));
    expect(g.map((x) => x.id)).toEqual(["status-1", "guard-3", "refine-4", "plan-6", "search-7", "enrich-8", "screen-9"]);
    expect(g[0]).toMatchObject({ agent: null, status: null, title: "เข้าคิวแล้ว", summary: null, durationS: null, current: false });
    expect(g[0].rows.map((r) => r.type)).toEqual(["queued", "started"]);
    expect(g[2].rows.map((r) => r.type)).toEqual(["refining", "question_refined"]);
    expect(g[1]).toMatchObject({ title: "ตรวจหัวข้อ", summary: "ผ่านการตรวจ", startS: 0.5 });
    expect(g[1].durationS).toBeCloseTo(0.3, 6);
    expect(g[3]).toMatchObject({ title: "วางคำค้น", summary: "3 คำค้น", startS: 4, durationS: 2 });
    expect(g[4]).toMatchObject({ summary: "ค้นเจอ 41 รายการ · ค้นไม่สำเร็จ 1", durationS: 3 });
    expect(g[5]).toMatchObject({ summary: "มีบทคัดย่อพอให้อ่าน 20 ฉบับ", durationS: 2 });
    expect(g[6]).toMatchObject({ title: "คัดกรอง", summary: "เริ่มชุดที่ 2", startS: 11, durationS: null, current: true, status: "active" });
  });
  it("a status row splits an agent; duration only on the agent's last group", () => {
    const s = run([...HEAD, ev(11, "interrupted", { elapsed_s: 14 }), ev(12, "started", { resume: true, elapsed_s: 20 }),
      ev(13, "screening", { batch: 10, elapsed_s: 21 }), ev(14, "screened", { kept: 2, total: 20, elapsed_s: 22 })]);
    const g = timelineGroups(s);
    const screens = g.filter((x) => x.agent === "screen");
    expect(screens).toHaveLength(2);
    expect(screens[0]).toMatchObject({ durationS: null, current: false });
    expect(screens[1]).toMatchObject({ durationS: 11, summary: "ผ่าน 2 จาก 20 ฉบับ", current: false });
    expect(g.at(-2)).toMatchObject({ agent: null, rows: [{ type: "interrupted" }, { type: "started" }] });
  });
  it("read summary and synth; the last group of the current agent is current", () => {
    const s = run([...HEAD, ev(11, "screened", { kept: 3, total: 20, elapsed_s: 16 }),
      ev(12, "reading", { ref: "P1" }), ev(13, "reading", { ref: "P2" }), ev(14, "reading", { ref: "P3" }),
      ev(15, "extracted", { ref: "P1", ok: true, uncertain: true, direction: "positive" }),
      ev(16, "extracted", { ref: "P2", ok: false })]);
    const read = timelineGroups(s).filter((x) => x.agent === "read");
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ summary: "อ่านเสร็จ 2/3 · ไม่สำเร็จ 1 · สองโมเดลอ่านต่างกัน 1", current: true, startS: 16 });
    const t = run([ev(17, "extracted", { ref: "P3", ok: true, elapsed_s: 30 }), ev(18, "synthesizing", { papers: 2, elapsed_s: 31 })], s);
    const g = timelineGroups(t);
    expect(g.find((x) => x.agent === "read")).toMatchObject({ durationS: 14, current: false });
    expect(g.at(-1)).toMatchObject({ agent: "synth", summary: "จาก 2 ฉบับ", current: true });
  });
  it("citations_fetched and pooled stay inside their agent's group (no status group, no split)", () => {
    const s = run([...HEAD, ev(11, "screened", { kept: 3, total: 20, elapsed_s: 16 }),
      ev(12, "reading", { ref: "P1" }), ev(13, "reading", { ref: "P2" }),
      ev(14, "extracted", { ref: "P1", ok: true, elapsed_s: 20 }),
      ev(15, "citations_fetched", { edges: 2, covered: 2, total: 2, elapsed_s: 21 }),
      ev(16, "extracted", { ref: "P2", ok: true, elapsed_s: 25 }),
      ev(17, "synthesizing", { papers: 2, elapsed_s: 26 }),
      ev(18, "pooled", { pools: 1, k_total: 3, elapsed_s: 27 })]);
    const g = timelineGroups(s);
    expect(g.filter((x) => x.agent === "read")).toHaveLength(1);
    expect(g.find((x) => x.agent === "read")!.rows.map((r) => r.type)).toContain("citations_fetched");
    expect(g.filter((x) => x.agent === "synth")).toHaveLength(1);
    expect(g.find((x) => x.agent === "synth")!.rows.map((r) => r.type)).toEqual(["synthesizing", "pooled"]);
    expect(g.some((x) => x.agent === null && x.rows.some((r) => r.type === "citations_fetched" || r.type === "pooled"))).toBe(false);
    expect(s.trace.some((r) => r.text === "citations_fetched" || r.text === "pooled")).toBe(false);
  });
  it("trace cap still yields summaries from counts", () => {
    const many = Array.from({ length: 120 }, (_, i) => ev(100 + i, i % 2 ? "refining" : "question_refined"));
    const s = run([ev(1, "planning", { queries: ["a", "b"] }), ev(2, "searching", { found: 7, queries: 2 }),
      ev(3, "enriching", { candidates: 4 }), ...many]);
    expect(s.trace).toHaveLength(MAX_TRACE);
    expect(s.trace.some((r) => r.type === "searching")).toBe(false);
    expect(stepSummary(s, "search")).toBe("ค้นเจอ 7 รายการ");
    expect(stepSummary(s, "enrich")).toBe("มีบทคัดย่อพอให้อ่าน 4 ฉบับ");
    expect(timelineGroups(s).every((x) => x.agent === "refine")).toBe(true);
  });
});

describe("stepSummary", () => {
  it("guard failed, nothing yet, other agents null", () => {
    expect(stepSummary(run([ev(1, "checking_topic"), ev(2, "rejected")]), "guard")).toBe("หัวข้อไม่ผ่าน");
    const s = initialScene();
    for (const id of ["guard", "plan", "search", "enrich", "screen", "read", "synth", "refine", "external", "localize", "finish"] as const) {
      expect(stepSummary(s, id)).toBeNull();
    }
    expect(stepSummary(run(HEAD), "refine")).toBeNull();
  });
});
