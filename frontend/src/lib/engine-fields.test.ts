// Plan 20 Task 11: the merged engine fields in the report's view model (docs/api.md "Answer and key findings",
// "Reports of the same trial", "Splits between reviews and primary studies").
import { describe, expect, it } from "vitest";
import { engineP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { directionTally } from "./charts-data";
import { litRows } from "./lit-matrix";
import { isReviewDiscordant, keyFindingViews, sofRows, type OutcomeContext } from "./report-view";
import { includedCounts, isRelatedReport, relatedLabel, relatedReasonText, studyRefs } from "./trial-reports";
import type { Paper, Review } from "./types";

function ctxOf(review: Review, lang: "th" | "en" = "th"): OutcomeContext {
  const r = review.result!;
  return { rows: r.synthesis!.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang };
}
const papers = engineP20ReviewFixture.result!.papers!;
const byRef = new Map(papers.map((p) => [p.ref, p]));

describe("reports of the same trial", () => {
  it("a further report is told by related_to; the primary and every other paper are not", () => {
    expect(papers.filter(isRelatedReport).map((p) => p.ref)).toEqual(["P6"]);
    expect(isRelatedReport({ related_to: null })).toBe(false);
    expect(isRelatedReport({})).toBe(false);
  });

  it("studyRefs counts a trial once: a further report stands for its primary, never twice", () => {
    expect(studyRefs(["P1", "P6", "P3"], byRef)).toEqual(["P1", "P3"]);
    expect(studyRefs(["P6", "P3"], byRef)).toEqual(["P1", "P3"]);
    // already excluded by the engine (a comparison row): nothing is subtracted again
    expect(studyRefs(["P1", "P2", "P3", "P4"], byRef)).toEqual(["P1", "P2", "P3", "P4"]);
    // a primary that is not in the result: the report stays (it is the only record of that trial here)
    const orphan = new Map<string, Paper>([["P9", { ref: "P9", title: "t", related_to: "P99" }]]);
    expect(studyRefs(["P9"], orphan)).toEqual(["P9"]);
  });

  it("the label and the reason follow the report language", () => {
    expect(relatedLabel("P1", "th")).toBe("รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน)");
    expect(relatedLabel("P1", "en")).toBe("Related report of [P1] (same trial)");
    expect(relatedReasonText("same trial (EMPEROR-Preserved)", "th")).toBe("การทดลองเดียวกัน (EMPEROR-Preserved)");
    expect(relatedReasonText("same trial (NCT03057951)", "en")).toBe("same trial (NCT03057951)");
    expect(relatedReasonText("near-identical title, same first author, same sample size", "th"))
      .toBe("ชื่อเรื่องเกือบเหมือนกัน ผู้แต่งคนแรกคนเดียวกัน และขนาดตัวอย่างเท่ากัน");
    expect(relatedReasonText("near-identical title, same first author, same registry number", "th"))
      .toBe("ชื่อเรื่องเกือบเหมือนกัน ผู้แต่งคนแรกคนเดียวกัน และเลขทะเบียนการทดลองเดียวกัน");
    expect(relatedReasonText("something new", "th")).toBe("something new");
    expect(relatedReasonText(null, "th")).toBeNull();
  });

  it("included counts: studies read, further reports aside, papers that could not be read aside", () => {
    expect(includedCounts(papers)).toEqual({ studies: 4, related: 1, unread: 1 });
    expect(includedCounts(slrP20ReviewFixture.result!.papers!)).toEqual({ studies: 4, related: 0, unread: 1 });
  });

  it("the literature matrix keeps the further report as a row, marked with its primary", () => {
    const rows = litRows(papers, "th");
    expect(rows.find((r) => r.ref === "P6")?.relatedTo).toBe("P1");
    expect(rows.filter((r) => r.relatedTo)).toHaveLength(1);
  });

  it("the direction tally counts studies: a further report adds nothing", () => {
    const withReport = directionTally(papers);
    const without = directionTally(papers.filter((p) => p.ref !== "P6"));
    expect(withReport).toEqual(without);
  });

  it("key findings and the summary of findings never count a further report as a second study", () => {
    const kf = [{ outcome: "Unknown outcome", statement: "s", refs: ["P1", "P6"], k: 2, certainty: "low" as const }];
    const [view] = keyFindingViews(kf, undefined, ctxOf(engineP20ReviewFixture));
    expect(view.k).toBe(1);
    expect(view.refs).toEqual(["P1", "P6"]); // both still open in the rail
    const [row] = sofRows(kf, undefined, ctxOf(engineP20ReviewFixture), "low");
    expect(row.k).toBe(1);
    // participants of the trial once (P1's 48,210), not P6's follow-up subset on top
    expect(row.participants).toEqual({ kind: "sum", total: 48210, counted: 1, of: 1, reviews: 0 });
  });
});

describe("per-finding certainty", () => {
  it("key findings carry their own certainty; absent (legacy) stays null, never the review's grade", () => {
    const r = engineP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(engineP20ReviewFixture));
    expect(v.map((f) => f.certainty)).toEqual(["low", "low"]);
    const legacy = slrP20ReviewFixture.result!;
    expect(keyFindingViews(legacy.synthesis!.key_findings!, undefined, ctxOf(slrP20ReviewFixture)).map((f) => f.certainty)).toEqual([null, null]);
  });

  it("the fixed lead clause stays part of the statement, as written", () => {
    const r = engineP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis_en!.key_findings!, undefined, ctxOf(engineP20ReviewFixture, "en"));
    expect(v[0].statement).toBe("Low-certainty evidence suggests: Metformin lowers colorectal cancer incidence in most observational studies.");
  });

  it("summary of findings: finding rows use the finding's certainty; a null certainty (not graded) is never replaced", () => {
    const r = engineP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(engineP20ReviewFixture), "low");
    expect(rows.map((x) => x.certaintySource)).toEqual(["finding", "finding"]);
    const ungraded = [{ ...r.synthesis!.key_findings![0], certainty: null }];
    expect(sofRows(ungraded, undefined, ctxOf(engineP20ReviewFixture), "low")[0]).toMatchObject({ certainty: null, certaintySource: null });
  });
});

describe("review-discordant splits", () => {
  it("the engine flag decides; without it the engine's fixed statement wording does", () => {
    const [plain, discordant] = engineP20ReviewFixture.result!.synthesis!.conflicts!;
    expect(isReviewDiscordant(plain)).toBe(false);
    expect(isReviewDiscordant(discordant)).toBe(true);
    const base = { refs: ["P1"], explanation: "e" };
    // results stored between the engine merge and the flag on synthesis entries
    expect(isReviewDiscordant({ ...base, statement: "Mortality: systematic reviews and primary studies disagree" })).toBe(true);
    expect(isReviewDiscordant({ ...base, statement: "อัตราตาย: ผลของการทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิไม่สอดคล้องกัน" })).toBe(true);
    expect(isReviewDiscordant({ ...base, statement: "Mortality: findings show no significant association; systematic reviews disagree" })).toBe(true);
    expect(isReviewDiscordant({ ...base, statement: "อัตราตาย: ไม่พบความสัมพันธ์ แต่การทบทวนวรรณกรรมอย่างเป็นระบบให้ผลต่างออกไป" })).toBe(true);
    expect(isReviewDiscordant({ ...base, statement: "Mortality: studies disagree" })).toBe(false);
    // the explicit flag wins over the wording
    expect(isReviewDiscordant({ ...base, statement: "Mortality: systematic reviews and primary studies disagree", review_discordant: false })).toBe(false);
  });
});
