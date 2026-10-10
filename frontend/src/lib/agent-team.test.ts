import { describe, expect, it } from "vitest";
import { type Scene, initialScene, reduceScene } from "./agent-scene";
import { AS_READ_TH, NO_DIRECTION_TH } from "./copy";
import { DIRECTION_LABEL } from "./i18n";
import {
  type MemberId, type MemberState, PHASES, PHASE_LABEL, TEAM, handoffs, memberLabel, memberOf, teamOf, teamSummary,
} from "./agent-team";
import type { ReviewEvent } from "./types";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene =>
  events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);

const WALK: ReviewEvent[] = [
  ev(1, "queued"), ev(2, "started", { elapsed_s: 0.1 }), ev(3, "checking_topic", { elapsed_s: 0.5 }),
  ev(4, "refining", { elapsed_s: 0.8 }), ev(5, "question_refined", { elapsed_s: 4 }),
  ev(6, "planning", { queries: ["q1", "q2", "q3"], elapsed_s: 6 }),
  ev(7, "searching", { found: 87, queries: 3, failed: 1, elapsed_s: 9 }), ev(8, "enriching", { candidates: 25, elapsed_s: 11 }),
  ev(9, "screening", { batch: 10, elapsed_s: 12 }), ev(10, "screening", { batch: 10, elapsed_s: 13 }),
  ev(11, "screened", { kept: 3, total: 25, elapsed_s: 16 }),
  ev(12, "reading", { ref: "P1", title: "Paper one" }), ev(13, "reading", { ref: "P2", title: "Paper two" }),
  ev(14, "reading", { ref: "P3", title: "Paper three" }),
  ev(15, "extracted", { ref: "P2", ok: true, direction: "negative", design: "rct", verified: 2 }),
  ev(16, "extracted", { ref: "P1", ok: true, direction: "positive", design: "rct", verified: 1 }),
  ev(17, "extracted", { ref: "P3", ok: false }),
  ev(18, "citations_fetched", { edges: 4, covered: 3, total: 3 }),
  ev(19, "synthesizing", { papers: 2, elapsed_s: 30 }), ev(20, "pooled", { pools: 1, k_total: 2 }),
  ev(21, "localizing", { elapsed_s: 40 }), ev(22, "finalizing", { elapsed_s: 45 }), ev(23, "done", { elapsed_s: 47 }),
];
const upTo = (seq: number, events = WALK, s?: Scene) => run(events.filter((e) => e.seq <= seq), s);
const mem = (s: Scene, id: MemberId): MemberState => teamOf(s).members.find((m) => m.id === id) as MemberState;
const sig = (s: Scene, id: MemberId) => {
  const m = mem(s, id);
  return `${m.status}/${m.phase}/${m.passed.join(",")}`;
};

describe("TEAM constants", () => {
  it("5 members with distinct steps covering every agent once", () => {
    expect(TEAM.map((m) => m.id)).toEqual(["planner", "researcher", "screener", "reader", "synthesizer"]);
    const steps = TEAM.flatMap((m) => m.steps);
    expect(new Set(steps).size).toBe(11);
    expect(memberOf("external")).toBe("reader");
    expect(PHASES.map((p) => PHASE_LABEL[p])).toEqual(["คิด", "วิเคราะห์", "วางแผน", "ลงมือ"]);
  });
});

describe("phase sequence per member", () => {
  it("planner: คิด -> วิเคราะห์ -> วางแผน -> done", () => {
    expect(sig(upTo(1), "planner")).toBe("idle/null/");
    expect(sig(upTo(3), "planner")).toBe("working/think/");
    expect(sig(upTo(4), "planner")).toBe("working/analyse/think");
    expect(sig(upTo(5), "planner")).toBe("working/plan/think,analyse"); // between refine and planning
    expect(sig(upTo(6), "planner")).toBe("done/null/think,analyse,plan,act");
  });
  it("researcher: ลงมือ while searching and enriching, then done", () => {
    expect(sig(upTo(5), "researcher")).toBe("idle/null/");
    expect(sig(upTo(6), "researcher")).toBe("working/act/think,plan");
    expect(sig(upTo(7), "researcher")).toBe("working/act/think,plan");
    expect(sig(upTo(8), "researcher")).toBe("done/null/think,analyse,plan,act");
  });
  it("screener: คิด with 0 batches, วิเคราะห์ with batches, done on screened", () => {
    expect(sig(upTo(8), "screener")).toBe("working/think/");
    expect(sig(upTo(9), "screener")).toBe("working/analyse/think");
    expect(mem(upTo(10), "screener").line).toBe("ให้คะแนนชุดที่ 2 จาก 3");
    expect(sig(upTo(11), "screener")).toBe("done/null/think,analyse,plan,act");
    expect(mem(upTo(11), "screener").line).toBe("เลือก 3 จาก 25");
  });
  it("reader: วิเคราะห์ until a paper finishes, then ลงมือ", () => {
    expect(sig(upTo(10), "reader")).toBe("idle/null/");
    expect(sig(upTo(14), "reader")).toBe("working/analyse/think");
    expect(mem(upTo(14), "reader").line).toBe("3 ฉบับกำลังอ่านหรือรอคิว");
    expect(sig(upTo(15), "reader")).toBe("working/act/think,analyse");
    expect(sig(upTo(18), "reader")).toBe("done/null/think,analyse,plan,act"); // citations_fetched changes no phase
  });
  it("synthesizer: คิด, วิเคราะห์ after pooled, ลงมือ on localize/finish, done", () => {
    expect(sig(upTo(18), "synthesizer")).toBe("working/think/"); // all reads final -> synth starts
    expect(sig(upTo(19), "synthesizer")).toBe("working/think/");
    expect(sig(upTo(20), "synthesizer")).toBe("working/analyse/think");
    expect(mem(upTo(20), "synthesizer").line).toBe("เทียบผลจาก 2 ฉบับและเขียนสรุป · คำนวณค่ารวมแล้ว 1 ชุด");
    expect(mem(upTo(20), "synthesizer").tally).toBe("ค่ารวม 1 ชุด");
    expect(sig(upTo(21), "synthesizer")).toBe("working/act/think,analyse");
    expect(sig(upTo(22), "synthesizer")).toBe("working/act/think,analyse");
    expect(sig(upTo(23), "synthesizer")).toBe("done/null/think,analyse,plan,act");
  });
  it("without pooled the synthesizer stays in คิด", () => {
    const noPool = WALK.filter((e) => e.type !== "pooled");
    expect(sig(upTo(19, noPool), "synthesizer")).toBe("working/think/");
  });
  it("speaking follows the current step's member and clears when the run ends", () => {
    expect(teamOf(upTo(1)).speaking).toBeNull();
    expect(teamOf(upTo(3)).speaking).toBe("planner");
    expect(teamOf(upTo(5)).speaking).toBe("planner"); // between steps
    expect(teamOf(upTo(7)).speaking).toBe("researcher");
    expect(teamOf(upTo(10)).speaking).toBe("screener");
    expect(teamOf(upTo(15)).speaking).toBe("reader");
    expect(teamOf(upTo(20)).speaking).toBe("synthesizer");
    expect(teamOf(upTo(23)).speaking).toBeNull();
  });
});

describe("skipped localize, external, English", () => {
  const english = (events: ReviewEvent[]) => run(events, initialScene({ language: "en" }));
  it("synthesizer reaches done when localize is skipped", () => {
    const s = english(WALK.filter((e) => e.type !== "localizing"));
    expect(s.agents.localize).toBe("skipped");
    expect(sig(s, "synthesizer")).toBe("done/null/think,analyse,plan,act");
    expect(teamSummary(s)).toBe("ทีมเอเจนต์ทำงานเสร็จแล้ว");
  });
  it("English finish is still ลงมือ and speaking", () => {
    const s = english(WALK.filter((e) => e.seq <= 22 && e.type !== "localizing"));
    expect(sig(s, "synthesizer")).toBe("working/act/think,analyse");
    expect(mem(s, "synthesizer").line).toBe("รวมผลเป็นรายงานพร้อมที่มาของตัวเลข");
  });
  it("external belongs to the reader", () => {
    const evs = [...WALK.filter((e) => e.seq <= 11), ev(30, "external_lookup")];
    const s = run(evs);
    expect(s.agents.external).toBe("active");
    expect(teamOf(s).speaking).toBe("reader");
    expect(mem(s, "reader").status).toBe("working");
    const ext = run([...WALK.filter((e) => e.seq <= 8), ev(30, "external_lookup")]);
    expect(mem(ext, "reader").status).toBe("working");
    expect(mem(ext, "reader").line).toContain("ไม่ใช่แหล่งอ้างอิง");
    expect(mem(s, "synthesizer").status).toBe("idle");
    const full = run([...WALK.filter((e) => e.seq <= 11), ev(30, "external_lookup"), ...WALK.filter((e) => e.seq > 11).map((e) => ({ ...e, seq: e.seq + 30 }))]);
    expect(mem(full, "reader").status).toBe("done");
  });
});

describe("failure, cancel, pause, rejection", () => {
  it("error marks the working member failed", () => {
    const e = run([...WALK.filter((x) => x.seq <= 10), ev(50, "error")]);
    expect(sig(e, "screener")).toBe("failed/analyse/think");
    expect(mem(e, "screener").line).toBe("คัดกรอง ไม่สำเร็จ");
    expect(teamOf(e).speaking).toBeNull();
    expect(teamSummary(e)).toBe("ทีมเอเจนต์ทำงานไม่สำเร็จ ผู้คัดกรอง: ไม่สำเร็จ · ชุดที่ 2 จาก 3");
    expect(mem(e, "reader").status).toBe("idle");
    expect(mem(e, "planner").status).toBe("done");
  });
  it("cancel stops the working member only", () => {
    const e = run([...WALK.filter((x) => x.seq <= 15), ev(50, "cancelled")]);
    expect(mem(e, "reader").status).toBe("stopped");
    expect(mem(e, "reader").line).toBe("ถูกยกเลิกระหว่างอ่านงานวิจัย");
    expect(mem(e, "synthesizer").status).toBe("idle");
    expect(mem(e, "screener").status).toBe("done");
    expect(teamSummary(e)).toBe("การทำงานของทีมเอเจนต์ถูกยกเลิก");
  });
  it("interrupted pauses the working member and resume restores it", () => {
    const p = run([...WALK.filter((x) => x.seq <= 15), ev(50, "interrupted")]);
    expect(mem(p, "reader").status).toBe("paused");
    expect(mem(p, "reader").phase).toBe("act");
    expect(teamOf(p).speaking).toBeNull();
    expect(teamSummary(p)).toContain("หยุดชั่วคราว");
    const r = run([ev(51, "started")], p);
    expect(mem(r, "reader").status).toBe("working");
  });
  it("rejected: planner failed, nobody else touched", () => {
    const s = run([ev(1, "started"), ev(2, "checking_topic"), ev(3, "rejected")]);
    expect(sig(s, "planner")).toBe("failed/think/");
    expect(mem(s, "planner").line).toBe("หัวข้อไม่ผ่านการตรวจ");
    for (const id of ["researcher", "screener", "reader", "synthesizer"] as MemberId[]) expect(mem(s, id).status).toBe("idle");
    expect(teamSummary(s)).toBe("หัวข้อไม่ผ่านการตรวจ ทีมเอเจนต์หยุดทำงาน");
  });
  it("waiting scene: everyone idle with role lines", () => {
    const s = upTo(1);
    for (const m of teamOf(s).members) {
      expect(m.status).toBe("idle");
      expect(m.line).toBe(TEAM.find((t) => t.id === m.id)?.role);
    }
    expect(teamSummary(s)).toBe("ทีมเอเจนต์ 5 คนกำลังรอคิว");
  });
});

describe("speech honesty", () => {
  it("quotes only scene numbers", () => {
    const s = upTo(8);
    expect(mem(s, "planner").line).toBe("วางคำค้น 3 คำ");
    expect(mem(s, "researcher").line).toBe("พบ 87 รายการ · มีบทคัดย่อพอให้อ่าน 25 · ค้นไม่สำเร็จ 1");
    expect(mem(upTo(7), "researcher").tally).toBe("พบ 87 รายการ");
  });
  it("reader line reports finished papers with the as-read qualifier, never 'reading now'", () => {
    const s = upTo(15);
    const line = mem(s, "reader").line;
    expect(line.startsWith(`อ่านเสร็จ 1 จาก 3 ฉบับ · P2 ${DIRECTION_LABEL.th.negative} ${AS_READ_TH}`)).toBe(true);
    expect(line).toContain(AS_READ_TH);
    expect(line).not.toMatch(/กำลังอ่าน P\d/);
    expect(mem(s, "reader").tally).toBe("อ่านเสร็จ 1 จาก 3");
    expect(memberLabel(mem(s, "reader"))).toBe("ผู้อ่าน: กำลังลงมือ · อ่านเสร็จ 1 จาก 3");
  });
  it("a failed latest paper is reported as failed, without direction", () => {
    const s = upTo(17);
    expect(mem(s, "reader").line).toBe("อ่านเสร็จ 3 จาก 3 ฉบับ · อ่านไม่สำเร็จ 1");
  });
  it("memberLabel formats status, phase and tally", () => {
    expect(memberLabel(mem(upTo(3), "planner"))).toBe("ผู้วางแผน: กำลังคิด");
    expect(memberLabel(mem(upTo(4), "planner"))).toBe("ผู้วางแผน: กำลังวิเคราะห์");
    expect(memberLabel(mem(upTo(1), "reader"))).toBe("ผู้อ่าน: รอถึงคิว");
    expect(memberLabel(mem(upTo(23), "synthesizer"))).toBe("ผู้สังเคราะห์: เสร็จแล้ว · ค่ารวม 1 ชุด");
    expect(teamSummary(upTo(14))).toBe("ทีมเอเจนต์ 5 คน ผู้อ่าน: กำลังวิเคราะห์ · อ่านเสร็จ 0 จาก 3");
  });
});

// Mirrors LiveRun's derivation for a scoping review (no directions): the flag plus every slot direction nulled.
const scoping = (scene: Scene): Scene => ({
  ...scene, directionless: true, slots: scene.slots.map((sl) => (sl.direction ? { ...sl, direction: null } : sl)),
});

describe("scoping (directionless)", () => {
  it("never mentions a direction in any line, tally, label or summary", () => {
    const s = scoping(upTo(17));
    const all: string[] = [teamSummary(s)];
    for (const m of teamOf(s).members) all.push(m.line, memberLabel(m), m.tally ?? "");
    const banned = [AS_READ_TH, NO_DIRECTION_TH, ...Object.values(DIRECTION_LABEL.th)];
    for (const t of all) for (const b of banned) expect(t).not.toContain(b);
    // while a paper finished positive/negative the reader still reports progress and design only
    const mid = scoping(upTo(15));
    const line = mem(mid, "reader").line;
    expect(line.startsWith("อ่านเสร็จ 1 จาก 3 ฉบับ")).toBe(true);
    for (const b of banned) expect(line).not.toContain(b);
  });
});

describe("hand-offs", () => {
  it("maps cross-member edges only", () => {
    const hs = handoffs(upTo(23));
    const pairs = hs.map((h) => `${h.from}>${h.to}`);
    expect(pairs).toContain("planner>researcher"); // plan>search
    expect(pairs).toContain("researcher>screener"); // enrich>screen
    expect(pairs).toContain("screener>reader");
    expect(pairs).toContain("reader>synthesizer");
    expect(pairs).toEqual([
      "planner>researcher", "researcher>screener", "screener>reader",
      "reader>synthesizer", "reader>synthesizer", "reader>synthesizer", "reader>synthesizer",
    ]);
    // guard>refine, refine>plan, search>enrich and synth>localize stay inside one member
    expect(handoffs(upTo(5))).toEqual([]);
    expect(handoffs(upTo(7))).toEqual([{ key: 6, from: "planner", to: "researcher", kind: "query", n: 3 }]);
  });
  it("only fresh pulses are returned", () => {
    expect(handoffs(upTo(11), 8).map((h) => h.key)).toEqual([11]);
    expect(handoffs(upTo(11), 11)).toEqual([]);
  });
  it("external hand-off stays inside the reader", () => {
    const s = run([...WALK.filter((e) => e.seq <= 11), ev(30, "external_lookup")]);
    expect(handoffs(s, 11)).toEqual([]);
  });
});

describe("replay", () => {
  it("the same events give the same team, and re-applying them changes nothing", () => {
    const a = run(WALK);
    const b = run(WALK);
    expect(teamOf(a)).toEqual(teamOf(b));
    const again = run(WALK, a);
    expect(teamOf(again)).toEqual(teamOf(a));
    expect(handoffs(again)).toEqual(handoffs(a));
  });
});

describe("fix round 1", () => {
  const BOUNDARY = [...WALK.filter((e) => e.seq <= 7), ev(50, "cancelled")];
  it("cancel at a step boundary stops the member owning the skipped step", () => {
    const e = run(BOUNDARY);
    expect(e.agents.enrich).toBe("skipped");
    expect(e.agents.search).toBe("done");
    expect(sig(e, "researcher")).toBe("stopped/act/think,plan");
    expect(mem(e, "researcher").line).toBe("ถูกยกเลิกระหว่างดึงบทคัดย่อ");
    expect(sig(e, "planner")).toBe("done/null/think,analyse,plan,act");
    expect(mem(e, "screener").status).toBe("idle");
  });
  it("cancel in an English run stops the member, not the skipped localize", () => {
    const en = (evs: ReviewEvent[]) => run(evs, initialScene({ language: "en" }));
    const fin = en([...WALK.filter((e) => e.seq <= 22 && e.type !== "localizing"), ev(50, "cancelled")]);
    expect(fin.agents.localize).toBe("skipped");
    expect(mem(fin, "synthesizer").status).toBe("stopped");
    expect(mem(fin, "synthesizer").line).toBe("ถูกยกเลิกระหว่างเรียบเรียงรายงาน");
    const mid = en([...WALK.filter((e) => e.seq <= 15), ev(50, "cancelled")]);
    expect(mem(mid, "synthesizer").status).toBe("idle");
    expect(mem(mid, "reader").status).toBe("stopped");
  });
  it("speaking is null after error and rejected", () => {
    expect(teamOf(run([...WALK.filter((e) => e.seq <= 15), ev(50, "error")])).speaking).toBeNull();
    expect(teamOf(run([ev(1, "started"), ev(2, "checking_topic"), ev(3, "rejected")])).speaking).toBeNull();
  });
  it("PCC framework changes the planner refine line", () => {
    const s = upTo(4);
    expect(teamOf(s).members[0].line).toBe("แปลงคำถามให้ชัดแบบ PICO");
    expect(teamOf(s, { framework: "PCC" }).members[0].line).toBe("แปลงคำถามให้ชัดแบบ PCC");
  });
  it("a failed external step fails the reader", () => {
    // `error` fails the current agent; with the external node as the only live one that is the external step
    const base = upTo(11);
    const e: Scene = { ...base, status: "error", external: true, agents: { ...base.agents, screen: "done", read: "idle", external: "failed" } };
    expect(sig(e, "reader")).toBe("failed/analyse/think");
    expect(mem(e, "reader").line).toBe("ปรึกษาเครื่องมือภายนอก ไม่สำเร็จ");
  });
  it("external alone puts the reader in วิเคราะห์ with คิด passed", () => {
    const ext = run([...WALK.filter((e) => e.seq <= 8), ev(30, "external_lookup")]);
    expect(sig(ext, "reader")).toBe("working/analyse/think");
  });
  it("paused researcher and synthesizer", () => {
    const r = run([...WALK.filter((e) => e.seq <= 7), ev(50, "interrupted")]);
    expect(sig(r, "researcher")).toBe("paused/act/think,plan");
    const y = run([...WALK.filter((e) => e.seq <= 20), ev(50, "interrupted")]);
    expect(sig(y, "synthesizer")).toBe("paused/analyse/think");
    expect(memberLabel(mem(y, "synthesizer"))).toBe("ผู้สังเคราะห์: หยุดชั่วคราว · ค่ารวม 1 ชุด");
  });
  it("a reader whose finished papers all failed has still acted (ลงมือ): it tried to verify them", () => {
    const failed = [
      ...WALK.filter((e) => e.seq <= 14),
      ev(15, "extracted", { ref: "P1", ok: false }),
    ];
    const s = run(failed);
    expect(s.counts.readOk).toBe(0);
    expect(sig(s, "reader")).toBe("working/act/think,analyse");
  });
  it("handoff cap keeps cross-member pulses even after a burst of same-member ones", () => {
    const pulses = [
      { key: 1, edge: "plan>search" as const, kind: "query" as const, n: 1 },
      ...Array.from({ length: 20 }, (_, i) => ({ key: 2 + i, edge: "search>enrich" as const, kind: "paper" as const, n: 1 })),
    ];
    const hs = handoffs({ ...upTo(1), pulses }, 0);
    expect(hs.map((h) => h.key)).toEqual([1]);
  });
});
