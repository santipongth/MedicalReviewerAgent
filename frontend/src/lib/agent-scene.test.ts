import { describe, expect, it } from "vitest";
import {
  type AgentId, type Pulse, type Scene, currentAgent, formatElapsed, initialScene, planDots, reduceScene, sceneSummary,
  takeFreshPulses,
} from "./agent-scene";
import type { ReviewEvent } from "./types";

// Same shape as e2e/mock-api.ts LIVE_EVENTS (plus the tail the backend stub emits).
const EVENTS: [string, Record<string, unknown>][] = [
  ["queued", { topic: "metformin" }], ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }], ["refining", { elapsed_s: 0.8 }],
  ["question_refined", { refined_question: "q", elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer", "b"], elapsed_s: 6 }],
  ["searching", { found: 41, queries: 2, failed: 0, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }], ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
  ["reading", { ref: "P1", title: "t", elapsed_s: 17 }],
  ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false, elapsed_s: 30 }],
];

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
function run(events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene {
  return events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);
}
const live = (n: number) => EVENTS.slice(0, n).map(([t, p], i) => ev(i + 1, t, p));
const agents = (s: Scene, ...ids: AgentId[]) => ids.map((i) => s.agents[i]);

function reading(n: number, startSeq = 100): ReviewEvent[] {
  return Array.from({ length: n }, (_, i) => ev(startSeq + i, "reading", { ref: `P${i + 1}` }));
}

describe("reduceScene: LIVE_EVENTS walk", () => {
  it("queued -> waiting", () => {
    expect(run(live(1)).status).toBe("waiting");
  });
  it("started -> running; checking_topic activates guard", () => {
    const s = run(live(3));
    expect(s.status).toBe("running");
    expect(s.agents.guard).toBe("active");
    expect(s.elapsed).toBe(0.5);
  });
  it("refining finishes guard, pulses guard>refine", () => {
    const s = run(live(4));
    expect(agents(s, "guard", "refine")).toEqual(["done", "active"]);
    expect(s.edges["guard>refine"]).toBe("live");
    expect(s.pulses.at(-1)).toMatchObject({ edge: "guard>refine", kind: "signal" });
  });
  it("question_refined -> refine done and refine>plan signal", () => {
    const s = run(live(5));
    expect(s.agents.refine).toBe("done");
    expect(s.edges["guard>refine"]).toBe("visited");
    expect(s.pulses.at(-1)).toMatchObject({ edge: "refine>plan", kind: "signal" });
  });
  it("planning -> plan done, search working, queries", () => {
    const s = run(live(6));
    expect(agents(s, "plan", "search")).toEqual(["done", "working"]);
    expect(s.queries).toHaveLength(2);
    expect(s.edges["plan>search"]).toBe("live");
    expect(s.pulses.at(-1)).toMatchObject({ edge: "plan>search", kind: "query", n: 2 });
  });
  it("searching -> enrich working, counts, paper pulse capped at 8", () => {
    const s = run(live(7));
    expect(agents(s, "search", "enrich")).toEqual(["done", "working"]);
    expect(s.counts).toMatchObject({ found: 41, queries: 2, searchFailed: 0 });
    expect(s.pulses.at(-1)).toMatchObject({ edge: "search>enrich", kind: "paper", n: 8 });
    expect(s.edges["plan>search"]).toBe("visited");
  });
  it("enriching -> screen working, batchesExpected", () => {
    const s = run(live(8));
    expect(agents(s, "enrich", "screen")).toEqual(["done", "working"]);
    expect(s.counts).toMatchObject({ candidates: 60, batchesExpected: 6 });
  });
  it("screening -> screen active, batches++ capped at expected", () => {
    const s = run(live(9));
    expect(s.agents.screen).toBe("active");
    expect(s.counts.batches).toBe(1);
    const many = run([...live(9), ...Array.from({ length: 9 }, (_, i) => ev(50 + i, "screening", { batch: 10 }))]);
    expect(many.counts.batches).toBe(6);
  });
  it("screened -> read working, 30 waiting slots, kept pulse", () => {
    const s = run(live(10));
    expect(agents(s, "screen", "read")).toEqual(["done", "working"]);
    expect(s.slots).toHaveLength(30);
    expect(s.slots.every((x) => x.state === "waiting")).toBe(true);
    expect(s.counts).toMatchObject({ kept: 30, screenedTotal: 60 });
    expect(s.pulses.at(-1)).toMatchObject({ edge: "screen>read", kind: "kept", n: 8 });
  });
  it("reading/extracted fill the first slot; read stays active", () => {
    const s = run(live(12));
    expect(s.slots[0]).toEqual({ ref: "P1", state: "ok" });
    expect(s.agents.read).toBe("active");
    expect(s.counts).toMatchObject({ readOk: 1, readFailed: 0 });
    expect(s.pulses.at(-1)).toMatchObject({ edge: "read>synth", kind: "card", n: 1 });
  });
  it("tail: synthesizing, localizing, finalizing, done", () => {
    let s = run([...live(12), ev(13, "synthesizing", { papers: 1 })]);
    expect(agents(s, "read", "synth")).toEqual(["done", "working"]);
    expect(s.counts.synthPapers).toBe(1);
    s = run([ev(14, "localizing")], s);
    expect(agents(s, "synth", "localize")).toEqual(["done", "working"]);
    s = run([ev(15, "finalizing")], s);
    expect(agents(s, "localize", "finish")).toEqual(["done", "working"]);
    expect(s.pulses.at(-1)).toMatchObject({ edge: "localize>finish" });
    s = run([ev(16, "done")], s);
    expect(s.status).toBe("done");
    expect(Object.entries(s.agents).filter(([k]) => k !== "external").every(([, v]) => v === "done")).toBe(true);
    expect(s.agents.external).toBe("idle");
    expect(s.edges["synth>localize"]).toBe("visited");
    expect(s.edges["localize>finish"]).toBe("visited");
  });
  it("marks earlier agents skipped when question_refined/refining are absent", () => {
    const s = run([ev(1, "queued"), ev(2, "started"), ev(3, "planning", { queries: ["a"] })]);
    expect(agents(s, "guard", "refine", "plan", "search")).toEqual(["skipped", "skipped", "done", "working"]);
  });
  it("external_lookup lights the side node", () => {
    let s = run([...live(10), ev(20, "external_lookup")]);
    expect(s.external).toBe(true);
    expect(s.agents.external).toBe("active");
    expect(s.pulses.at(-1)).toMatchObject({ edge: "read>external", kind: "signal" });
    s = run([ev(21, "synthesizing", { papers: 3 })], s);
    expect(s.agents.external).toBe("done");
  });
});

describe("reduceScene: dedupe and replay", () => {
  it("ignores seq <= lastSeq", () => {
    const s = run(live(8));
    expect(reduceScene(s, { kind: "event", ev: ev(8, "done") })).toBe(s);
    expect(reduceScene(s, { kind: "event", ev: ev(3, "error") })).toBe(s);
  });
  it("replaying the full sequence twice gives the same scene", () => {
    const once = run(live(12));
    expect(run(live(12), once)).toEqual(once);
  });
  it("lang action sets expectLocalize", () => {
    const s = reduceScene(initialScene(), { kind: "lang", language: "th" });
    expect(s.expectLocalize).toBe(true);
    expect(reduceScene(s, { kind: "lang", language: "en" }).expectLocalize).toBe(false);
  });
});

describe("reader slots", () => {
  it("assigns by ref, then first free, then appends", () => {
    let s = run([...live(10), ev(30, "reading", { ref: "P7" }), ev(31, "reading", { ref: "P2" })]);
    expect(s.slots.slice(0, 2)).toEqual([{ ref: "P7", state: "reading" }, { ref: "P2", state: "reading" }]);
    s = run([ev(32, "reading", { ref: "P7" })], s);
    expect(s.slots.filter((x) => x.ref === "P7")).toHaveLength(1);
  });
  it("appends when screened was never seen, capped at 30", () => {
    const s = run(reading(35));
    expect(s.slots).toHaveLength(30);
    expect(s.slots.every((x) => x.state === "reading")).toBe(true);
  });
  it("repeated extracted is idempotent for slots and counts", () => {
    const base = run([...live(10), ...reading(2)]);
    const a = run([ev(200, "extracted", { ref: "P1", ok: true })], base);
    const b = run([ev(201, "extracted", { ref: "P1", ok: true })], a);
    expect(b.slots).toEqual(a.slots);
    expect(b.counts).toEqual(a.counts);
    expect(b.pulses).toHaveLength(a.pulses.length);
  });
  it("ok / failed / uncertain states and counts", () => {
    const s = run([
      ...live(10), ...reading(3),
      ev(200, "extracted", { ref: "P1", ok: true }),
      ev(201, "extracted", { ref: "P2", ok: false }),
      ev(202, "extracted", { ref: "P3", ok: true, uncertain: true }),
    ]);
    expect(s.slots.slice(0, 3).map((x) => x.state)).toEqual(["ok", "failed", "uncertain"]);
    expect(s.counts).toMatchObject({ readOk: 2, readFailed: 1, uncertain: 1 });
    expect(s.pulses.filter((p) => p.kind === "failed")).toHaveLength(1);
    expect(sceneSummary(s)).toBe("เอเจนต์กำลังอ่านงานวิจัย อ่านแล้ว 3 จาก 30 ฉบับ");
  });
  it("read is done only when all slots are final", () => {
    const three = [ev(1, "screened", { kept: 3, total: 9 }), ...reading(3, 10)];
    let s = run([...three, ev(20, "extracted", { ref: "P1", ok: true }), ev(21, "extracted", { ref: "P2", ok: false })]);
    expect(s.agents.read).toBe("active");
    expect(s.agents.synth).not.toBe("working");
    s = run([ev(22, "extracted", { ref: "P3", ok: true })], s);
    expect(agents(s, "read", "synth")).toEqual(["done", "working"]);
  });
  it("extracted without screened appends and still finalises", () => {
    const s = run([ev(1, "extracted", { ref: "P1", ok: true })]);
    expect(s.slots).toEqual([{ ref: "P1", state: "ok" }]);
    expect(s.agents.synth).toBe("working");
  });
});

describe("pause, resume and terminal events", () => {
  it("interrupted -> paused; started{resume} -> working again", () => {
    let s = run(live(7));
    s = run([ev(50, "interrupted")], s);
    expect(s.status).toBe("paused");
    expect(s.agents.enrich).toBe("paused");
    expect(s.agents.search).toBe("done");
    expect(sceneSummary(s)).toContain("หยุดชั่วคราว");
    s = run([ev(51, "started", { resume: true })], s);
    expect(s.status).toBe("running");
    expect(s.agents.enrich).toBe("working");
    expect(s.trace.at(-1)?.text).toBe("ทำงานต่อจากจุดที่ค้างไว้");
  });
  it("error fails the current agent", () => {
    const s = run([...live(9), ev(60, "error", { message: "x" })]);
    expect(s.status).toBe("error");
    expect(s.agents.screen).toBe("failed");
    expect(s.agents.enrich).toBe("done");
  });
  it("rejected fails guard and skips the rest", () => {
    const s = run([ev(1, "queued"), ev(2, "checking_topic"), ev(3, "rejected", { reason: "no" })]);
    expect(s.status).toBe("rejected");
    expect(s.agents.guard).toBe("failed");
    expect(s.agents.finish).toBe("skipped");
  });
  it("a synthetic rejected with no history works", () => {
    const s = run([ev(Number.MAX_SAFE_INTEGER, "rejected", { reason: "no" })]);
    expect(s.agents.guard).toBe("failed");
  });
  it("cancelled skips the current agent", () => {
    const s = run([...live(8), ev(70, "cancelled")]);
    expect(s.status).toBe("cancelled");
    expect(s.agents.screen).toBe("skipped");
  });
  it("localize is skipped when finalizing arrives without localizing", () => {
    const s = run([...live(12), ev(13, "synthesizing", { papers: 1 }), ev(14, "finalizing")]);
    expect(agents(s, "synth", "localize", "finish")).toEqual(["done", "skipped", "working"]);
    expect(s.pulses.at(-1)).toMatchObject({ edge: "synth>finish" });
  });
  it("currentAgent", () => {
    expect(currentAgent(initialScene())).toBeNull();
    expect(currentAgent(run(live(9)))).toBe("screen");
  });
});

describe("fix round 1", () => {
  const liveEdges = (s: Scene) => Object.entries(s.edges).filter(([, v]) => v === "live");
  it("synth>finish shortcut becomes visited after done", () => {
    const s = run([...live(12), ev(13, "synthesizing", { papers: 1 }), ev(14, "finalizing"), ev(15, "done")]);
    expect(s.edges["synth>finish"]).toBe("visited");
    expect(liveEdges(s)).toEqual([]);
  });
  it("no live edge after error or cancelled", () => {
    expect(liveEdges(run([...live(9), ev(60, "error")]))).toEqual([]);
    expect(liveEdges(run([...live(9), ev(60, "cancelled")]))).toEqual([]);
    expect(liveEdges(run([ev(1, "checking_topic"), ev(2, "rejected")]))).toEqual([]);
  });
  it("a second terminal event is ignored but advances lastSeq", () => {
    const a = run([...live(9), ev(60, "error")]);
    const b = run([ev(Number.MAX_SAFE_INTEGER, "error")], a);
    expect(b.trace).toEqual(a.trace);
    expect(b.agents).toEqual(a.agents);
    expect(b.lastSeq).toBe(Number.MAX_SAFE_INTEGER);
    const c = run([...live(9), ev(60, "cancelled"), ev(61, "cancelled")]);
    expect(Object.values(c.agents).filter((x) => x === "skipped")).toHaveLength(Object.values(run([...live(9), ev(60, "cancelled")]).agents).filter((x) => x === "skipped").length);
  });
  it("screened re-emitted keeps finished reads", () => {
    const first = run([ev(1, "screened", { kept: 5, total: 9 }), ...reading(3, 10), ev(20, "extracted", { ref: "P1", ok: true }),
      ev(21, "extracted", { ref: "P2", ok: false })]);
    const again = run([ev(30, "screened", { kept: 5, total: 9 })], first);
    expect(again.slots).toEqual(first.slots);
    expect(again.counts).toEqual(first.counts);
    expect(run([ev(31, "screened", { kept: 2, total: 9 })], again).slots).toHaveLength(3);
  });
  it("NaN seq ignored; unknown events keep status", () => {
    const s = initialScene();
    expect(reduceScene(s, { kind: "event", ev: ev(Number.NaN, "queued") })).toBe(s);
    expect(run([ev(1, "mystery")]).status).toBe("waiting");
  });
});

describe("rings and trace", () => {
  it("caps pulses at 24 and trace at 80", () => {
    const evs = Array.from({ length: 100 }, (_, i) => ev(i + 1, i % 2 ? "refining" : "question_refined"));
    const s = run(evs);
    expect(s.pulses).toHaveLength(24);
    expect(s.pulses.at(-1)?.key).toBe(100);
    expect(s.trace).toHaveLength(80);
    expect(s.trace.at(-1)?.key).toBe(100);
  });
  it("merges consecutive reading and screening rows with repeat", () => {
    const s = run([...live(8), ...Array.from({ length: 6 }, (_, i) => ev(30 + i, "screening", { batch: 10 })), ...reading(4, 40)]);
    const screening = s.trace.filter((r) => r.type === "screening");
    expect(screening).toHaveLength(1);
    expect(screening[0]).toMatchObject({ repeat: 6, text: "คัดกรองชุดละ 10 ฉบับ" });
    const rd = s.trace.filter((r) => r.type === "reading");
    expect(rd).toHaveLength(1);
    expect(rd[0]).toMatchObject({ repeat: 4, text: "เริ่มอ่าน 4 ฉบับ" });
  });
  it("does not merge across other events", () => {
    const s = run([ev(1, "reading", { ref: "P1" }), ev(2, "extracted", { ref: "P1", ok: true }), ev(3, "reading", { ref: "P2" })]);
    expect(s.trace.map((r) => r.repeat)).toEqual([1, 1, 1]);
    expect(s.trace[0].text).toBe("เริ่มอ่าน P1");
  });
  it("trace texts and elapsed", () => {
    const s = run(live(12));
    const t = Object.fromEntries(s.trace.map((r) => [r.type, r]));
    expect(t.planning.text).toBe("วางคำค้น 2 คำ");
    expect(t.searching.text).toBe("ค้นเจอ 41 รายการจาก 2 คำค้น");
    expect(t.screened.text).toBe("ผ่านคัดกรอง 30 จาก 60 ฉบับ");
    expect(t.extracted.text).toBe("อ่าน P1 เสร็จ");
    expect(t.extracted.elapsed).toBe(30);
    expect(t.queued.elapsed).toBeNull();
    const f = run([ev(1, "searching", { found: 5, queries: 3, failed: 2 })]);
    expect(f.trace[0].text).toBe("ค้นเจอ 5 รายการจาก 3 คำค้น · ค้นไม่สำเร็จ 2");
  });
  it("unknown events add a trace row only", () => {
    const s = run([ev(1, "mystery", { a: 1 })]);
    expect(s.trace).toHaveLength(1);
    expect(s.trace[0].text).toBe("mystery");
    expect(s.pulses).toHaveLength(0);
  });
});

describe("burst helpers", () => {
  const pulse = (key: number, n = 1): Pulse => ({ key, edge: "plan>search", kind: "query", n });
  it("takeFreshPulses keeps only the newest cap", () => {
    const burst = Array.from({ length: 40 }, (_, i) => pulse(i + 1));
    const fresh = takeFreshPulses(burst, 0, 12);
    expect(fresh).toHaveLength(12);
    expect(fresh[0].key).toBe(29);
    expect(fresh.at(-1)?.key).toBe(40);
    expect(takeFreshPulses(burst, 38, 12).map((p) => p.key)).toEqual([39, 40]);
    expect(takeFreshPulses(burst, 40, 12)).toEqual([]);
  });
  it("planDots expands with 120ms spacing and 60ms pulse offset", () => {
    const d = planDots([pulse(1, 3), pulse(2, 2)], 24);
    expect(d.map((x) => x.delayMs)).toEqual([0, 60, 120, 180, 240]);
  });
  it("planDots caps at maxDots with monotonic delays", () => {
    const d = planDots(Array.from({ length: 12 }, (_, i) => pulse(i + 1, 8)), 24);
    expect(d).toHaveLength(24);
    expect(d[0].delayMs).toBe(0);
    for (let i = 1; i < d.length; i++) expect(d[i].delayMs).toBeGreaterThanOrEqual(d[i - 1].delayMs);
    expect(planDots([], 24)).toEqual([]);
  });
});

describe("presentation helpers", () => {
  it("sceneSummary", () => {
    expect(sceneSummary(initialScene())).toBe("เอเจนต์กำลังรอคิว");
    expect(sceneSummary(run(live(7)))).toBe("เอเจนต์กำลังดึงบทคัดย่อ");
    expect(sceneSummary(run([...live(10), ...reading(12), ...Array.from({ length: 12 }, (_, i) => ev(300 + i, "extracted", { ref: `P${i + 1}`, ok: true }))])))
      .toBe("เอเจนต์กำลังอ่านงานวิจัย อ่านแล้ว 12 จาก 30 ฉบับ");
    expect(sceneSummary(run([...live(3), ev(40, "done")]))).toBe("เอเจนต์ทำงานเสร็จแล้ว");
  });
  it("formatElapsed", () => {
    expect(formatElapsed(42)).toBe("0:42");
    expect(formatElapsed(125.9)).toBe("2:05");
    expect(formatElapsed(null)).toBe("—");
    expect(formatElapsed(Number.NaN)).toBe("—");
  });
});

describe("junk payloads", () => {
  it("never throws and coerces numeric strings", () => {
    const junk: ReviewEvent[] = [
      ev(1, "planning", { queries: "nope" }), ev(2, "searching", { found: "12", queries: null, failed: "x" }),
      ev(3, "enriching", { candidates: "abc" }), ev(4, "screening", {}), ev(5, "screened", { kept: "4", total: undefined }),
      ev(6, "reading", { ref: 7, title: {} }), ev(7, "extracted", { ref: null, ok: "yes", uncertain: [] }),
      ev(8, "synthesizing", { papers: "many" }), ev(9, "localizing"), ev(10, "finalizing"), ev(11, "external_lookup"),
      { seq: 12, type: "interrupted", payload: null as unknown as Record<string, unknown> },
      { seq: 13, type: "error", payload: undefined as unknown as Record<string, unknown> },
      { seq: "14" as unknown as number, type: "done", payload: {} },
    ];
    let s = initialScene();
    expect(() => { s = run(junk, s); }).not.toThrow();
    expect(s.counts.found).toBe(12);
    expect(s.counts.kept).toBe(4);
    expect(s.counts.synthPapers).toBeNull();
    expect(s.lastSeq).toBe(13);
    expect(() => sceneSummary(s)).not.toThrow();
  });
});
