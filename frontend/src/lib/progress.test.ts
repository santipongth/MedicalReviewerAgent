import { describe, expect, it } from "vitest";
import { initialRun, readCounts, reduceRun, STEPS } from "./progress";
import type { ReviewEvent } from "./types";

function run(events: [string, Record<string, unknown>][]) {
  return events.reduce((s, [type, payload], i) => reduceRun(s, { seq: i + 1, type, payload } as ReviewEvent),
    initialRun());
}

describe("reduceRun", () => {
  it("walks the steps and tracks the counts", () => {
    const s = run([
      ["queued", {}], ["started", { resume: false, elapsed_s: 0 }], ["checking_topic", {}], ["refining", {}],
      ["question_refined", { refined_question: "Does metformin reduce CRC?", interpretation: "i",
        sub_questions: ["Is it safe?"], assumptions: [] }],
      ["planning", { queries: ["metformin crc"] }], ["searching", { found: 41 }], ["enriching", { candidates: 20 }],
      ["screening", { batch: 10 }], ["screened", { kept: 8, total: 20 }],
      ["reading", { ref: "P1", title: "Paper one" }], ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false }],
      ["reading", { ref: "P2", title: "Paper two" }], ["extracted", { ref: "P2", ok: false }],
      ["synthesizing", { papers: 1, elapsed_s: 41.5 }],
    ]);
    expect(s.status).toBe("running");
    expect(s.step).toBe("synthesize");
    expect(s.question?.refined_question).toBe("Does metformin reduce CRC?");
    expect(s.queries).toEqual(["metformin crc"]);
    expect(s.found).toBe(41);
    expect(s.candidates).toBe(20);
    expect(s.kept).toBe(8);
    expect(s.reading.map((r) => [r.ref, r.state])).toEqual([["P1", "ok"], ["P2", "failed"]]);
    expect(s.elapsed).toBe(41.5);
    expect(s.lastSeq).toBe(15);
  });

  it("keeps 60 candidates and the 30 analysed as plain counts", () => {
    const s = run([["enriching", { candidates: 60 }], ["screened", { kept: 30, total: 60 }]]);
    expect(s.candidates).toBe(60);
    expect(s.kept).toBe(30);
  });

  it("records terminal states with their reasons", () => {
    expect(run([["rejected", { reason: "not a medical topic" }]])).toMatchObject(
      { status: "rejected", message: "not a medical topic", terminal: true });
    expect(run([["error", { message: "boom" }]])).toMatchObject({ status: "error", message: "boom", terminal: true });
    expect(run([["cancelled", { by: "owner" }]])).toMatchObject({ status: "cancelled", terminal: true });
    expect(run([["done", { cost_usd: 0.1 }]])).toMatchObject({ status: "done", step: "done", terminal: true });
    expect(run([["interrupted", { will_resume: true }]])).toMatchObject({ status: "queued", terminal: false });
  });

  it("ignores events it has already applied (replay after reconnect)", () => {
    const s1 = reduceRun(initialRun(), { seq: 5, type: "searching", payload: { found: 9 } });
    const s2 = reduceRun(s1, { seq: 5, type: "searching", payload: { found: 99 } });
    expect(s2.found).toBe(9);
  });
});

describe("readCounts", () => {
  it("counts finished reads (ok or failed) and passes the pipeline counts through", () => {
    const s = run([
      ["searching", { found: 41 }], ["enriching", { candidates: 20 }], ["screened", { kept: 8, total: 20 }],
      ["reading", { ref: "P1", title: "a" }], ["extracted", { ref: "P1", ok: true }],
      ["reading", { ref: "P2", title: "b" }], ["extracted", { ref: "P2", ok: false }],
      ["reading", { ref: "P3", title: "c" }],
    ]);
    expect(readCounts(s)).toEqual({ found: 41, candidates: 20, kept: 8, read: 2 });
    expect(readCounts(initialRun())).toEqual({ found: 0, candidates: 0, kept: 0, read: 0 });
  });

  it("starts the step list with the queue", () => {
    expect(STEPS[0]).toBe("queue");
  });
});
