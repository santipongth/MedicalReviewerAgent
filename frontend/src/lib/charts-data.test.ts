import { describe, expect, it } from "vitest";
import { resultFixture } from "@/test/fixtures";
import { EXCLUSION_REASON_LABEL, designLabel, directionTally, emptyFilters, hasPooledPapers, filterPapers, isPooled, forestAxis, forestData, questionDirection, studyPoints } from "./charts-data";

const papers = resultFixture.papers!;

describe("filterPapers", () => {
  it("keeps everything with empty filters and narrows by relevance, year, risk of bias and design", () => {
    expect(filterPapers(papers, emptyFilters()).map((p) => p.ref)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(filterPapers(papers, { ...emptyFilters(), minRelevance: 85 }).map((p) => p.ref)).toEqual(["P1", "P2", "P3"]);
    expect(filterPapers(papers, { ...emptyFilters(), yearFrom: 2019, yearTo: 2020 }).map((p) => p.ref)).toEqual(["P1", "P4"]);
    expect(filterPapers(papers, { ...emptyFilters(), risk: ["low"] }).map((p) => p.ref)).toEqual(["P3"]);
    expect(filterPapers(papers, { ...emptyFilters(), designs: ["case_control"] }).map((p) => p.ref)).toEqual(["P2"]);
    // a card stored before design categories filters by its free-text design
    const legacy = { ...papers[0], card_en: { ...papers[0].card_en!, design_category: undefined, study_design: "cohort" } };
    expect(filterPapers([legacy], { ...emptyFilters(), designs: ["cohort"] }).map((p) => p.ref)).toEqual(["P1"]);
    expect(designLabel("sr_ma_rct", "th")).toBe("SR/MA ของ RCT");
    expect(designLabel("some free text", "en")).toBe("some free text");
  });
});

describe("forestData", () => {
  it("plots only verified effects, groups ratio measures, and lists blanked values", () => {
    const d = forestData(papers, "en");
    expect(d.groups).toHaveLength(1);
    const g = d.groups[0];
    expect(g.family).toBe("ratio");
    expect(g.rows.map((r) => [r.ref, r.value, r.lo, r.hi, r.direction])).toEqual([
      ["P1", 0.86, 0.77, 0.96, "positive"],
      ["P3", 0.8, 0.71, 0.9, "positive"],
      ["P4", 1.28, 1.05, 1.56, "negative"],
    ]);
    expect(g.rows[1].valueText).toBe("HR 0.80");
    expect(g.rows[1].ciText).toBe("0.71–0.90");
    expect(d.unverified).toEqual([{ ref: "P2", outcome: "CRC incidence" }]);
  });

  it("never plots another comparison (matches_question false), even with verified numbers", () => {
    const other = papers.map((p) => p.ref !== "P4" ? p : {
      ...p, card_en: { ...p.card_en!, outcomes: p.card_en!.outcomes.map((o) => ({ ...o, matches_question: false, comparison: "GLP-1RA vs insulin" })) },
    });
    expect(forestData(other, "en").groups[0].rows.map((r) => r.ref)).toEqual(["P1", "P3"]);
  });

  it("axis bounds contain every interval and the null line", () => {
    const g = forestData(papers, "en").groups[0];
    const [lo, hi] = forestAxis(g);
    expect(lo).toBeLessThan(0.71);
    expect(hi).toBeGreaterThan(1.56);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(1);
  });
});

describe("studyPoints", () => {
  it("maps studies with a year and a verified sample size; others are counted, not plotted", () => {
    const pts = studyPoints(papers);
    expect(pts.points.map((p) => [p.ref, p.year, p.n])).toEqual([["P1", 2019, 48210], ["P3", 2021, 1234], ["P4", 2020, 6331]]);
    expect(pts.missing).toBe(2);
  });

  it("leaves out a paper read as a design outside the ticked study types (not evidence), like a further report", () => {
    const flagged = papers.map((p) => (p.ref === "P3" ? { ...p, design_excluded: true } : p));
    const pts = studyPoints(flagged);
    expect(pts.points.map((p) => p.ref)).toEqual(["P1", "P4"]);
    expect(pts.missing).toBe(2);
  });
});

describe("EXCLUSION_REASON_LABEL", () => {
  it("has a Thai and English label for every reason (the PRISMA flow's screening reasons)", () => {
    for (const v of Object.values(EXCLUSION_REASON_LABEL)) { expect(v.th.trim()).not.toBe(""); expect(v.en.trim()).not.toBe(""); }
    expect(Object.keys(EXCLUSION_REASON_LABEL)).toHaveLength(7);
  });
});

describe("directionTally", () => {
  it("never counts a paper read as a design outside the ticked study types (design_excluded: not evidence)", () => {
    const flagged = papers.map((p) => (p.ref === "P1" ? { ...p, design_excluded: true } : p));
    expect(directionTally(flagged)).toEqual(directionTally(papers.filter((p) => p.ref !== "P1")));
    expect(directionTally(flagged, true)).toEqual(directionTally(papers.filter((p) => p.ref !== "P1"), true));
  });

  it("can leave narrative-review articles out of the tally", () => {
    const review = { ...papers[0], card_en: { ...papers[0].card_en!, design_category: "narrative_review" as const, overall_direction: "unclear" as const } };
    const withReview = [...papers, { ...review, ref: "P9" }];
    expect(directionTally(withReview).unclear).toBe(directionTally(papers).unclear + 1);
    expect(directionTally(withReview, true)).toEqual(directionTally(papers.filter((p) => (p.card_en ?? p.card)?.design_category !== "narrative_review"), true));
    expect(directionTally(withReview, true).unclear).toBe(directionTally(papers).unclear);
  });

  it("counts a paper whose outcomes are all other comparisons as unclear, also on the study map", () => {
    const base = papers.find((p) => (p.card_en ?? p.card)?.overall_direction === "positive")!;
    const card = base.card_en ?? base.card!;
    const other = { ...card, outcomes: card.outcomes.map((o) => ({ ...o, matches_question: false })) };
    const p = { ...base, ref: "P9", card: other, card_en: other };
    expect(questionDirection(other)).toBe("unclear");
    expect(questionDirection({ ...other, outcomes: [] })).toBe("positive");
    expect(directionTally([p])).toEqual({ positive: 0, negative: 0, null: 0, mixed: 0, unclear: 1 });
    const point = studyPoints([p]).points[0];
    if (point) expect(point.direction).toBe("unclear");
  });

  it("counts papers that have a card by overall direction and flags pooled SR/MA papers", () => {
    const tally = directionTally(papers);
    const withCard = papers.filter((p) => p.card_en ?? p.card);
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(withCard.length);
    expect(tally.negative).toBe(withCard.filter((p) => (p.card_en ?? p.card)!.overall_direction === "negative").length);
    expect(tally.positive).toBeGreaterThan(0);
    expect(hasPooledPapers(papers)).toBe(true);
    expect(hasPooledPapers(papers.filter((p) => p.ref === "P1"))).toBe(false);
    expect(papers.filter(isPooled).length).toBeGreaterThan(0);
    expect(isPooled(papers.find((p) => p.ref === "P1")!)).toBe(false);
  });
});
