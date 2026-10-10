import { describe, expect, it } from "vitest";
import { P20_FIXTURES, metaReviewFixture, narrativeP20ReviewFixture, resultFixture } from "@/test/fixtures";
import { ROB_ORDER, robSummary } from "./rob-summary";
import type { Paper } from "./types";

describe("robSummary", () => {
  it("counts each judgement by design, in the design order, with totals", () => {
    const s = robSummary(metaReviewFixture.result!.papers!, "en")!;
    expect(ROB_ORDER).toEqual(["low", "moderate", "high", "unclear"]);
    const total = s.rows.reduce((n, r) => n + r.total, 0);
    expect(total).toBe(s.total);
    expect(ROB_ORDER.reduce((n, k) => n + s.totals[k], 0)).toBe(s.total);
    // rows follow the fixed design order (RCT, …, cohort, …, SR/MA, narrative), never ranked by count
    const order = s.rows.map((r) => r.design);
    expect([...order].sort((a, b) => DESIGNS.indexOf(a) - DESIGNS.indexOf(b))).toEqual(order);
  });

  it("skips papers that could not be read and reports of a trial already counted", () => {
    const papers = resultFixture.papers!;
    const base = robSummary(papers, "en")!;
    const unread: Paper = { ...papers[0], ref: "P9", card: null, card_en: null, error: "timeout" };
    expect(robSummary([...papers, unread], "en")!.total).toBe(base.total);
    const related: Paper = { ...papers[0], ref: "P8", related_to: "P1", related_reason: "same trial (X)" };
    const withRelated = robSummary([...papers, related], "en")!;
    expect(withRelated.total).toBe(base.total);
    expect(withRelated.related).toBe(1);
  });

  it("is null when no paper has a judgement", () => {
    expect(robSummary([], "en")).toBeNull();
    expect(robSummary([{ ...resultFixture.papers![0], card: null, card_en: null }], "en")).toBeNull();
  });

  it("qualitative and mixed-methods studies are listed under their design (no direction is involved)", () => {
    const s = robSummary(narrativeP20ReviewFixture.result!.papers!, "th")!;
    const q = s.rows.find((r) => r.design === "qualitative")!;
    expect(q.label).toBe("เชิงคุณภาพ");
    expect(q.themes).toBe(true);
    expect(s.rows.find((r) => r.design === "mixed_methods")!.themes).toBe(true);
  });

  it("works on every Plan 20 fixture", () => {
    for (const r of Object.values(P20_FIXTURES)) expect(robSummary(r.result!.papers!, "en")).not.toBeNull();
  });
});

const DESIGNS = ["rct", "non_randomized_trial", "cohort", "case_control", "cross_sectional", "case_series", "mendelian_randomization",
  "sr_ma_rct", "sr_ma_observational", "sr_ma_mixed", "narrative_review", "qualitative", "mixed_methods", "other"];
