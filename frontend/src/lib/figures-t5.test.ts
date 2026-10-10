// Plan 20 Task 5: evidence map order and ramp, concept-map top outcomes, literature matrix columns, frameworks, pages.
import { describe, expect, it } from "vitest";
import {
  narrativeP20ReviewFixture, qualitativeReviewFixture, resultFixture, scopingReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";
import { conceptTree, topOutcomes } from "./concept-map";
import { evidenceMap, rampLevel } from "./evidence-map";
import { litColumnLabel, litColumns, litFramework, litRows, outcomesClamped, paginate } from "./lit-matrix";
import type { ComparisonRow, Paper, ReviewResult } from "./types";

const papers = resultFixture.papers!;

describe("evidence map (scoping)", () => {
  it("concept rows sort by total, most studies first; periods stay in time order", () => {
    const rows: ComparisonRow[] = [
      { outcome: "small", cells: [{ ref: "P1", finding: "✓", direction: "unclear" }] },
      { outcome: "big", cells: ["P1", "P2", "P3"].map((ref) => ({ ref, finding: "✓", direction: "unclear" as const })) },
      { outcome: "mid", cells: ["P1", "P3"].map((ref) => ({ ref, finding: "✓", direction: "unclear" as const })) },
    ];
    const m = evidenceMap(papers, rows, "th");
    expect(m.byConcept.rows.map((r) => [r.label, r.total])).toEqual([["big", 3], ["mid", 2], ["small", 1]]);
    expect(m.byYear.rows.map((r) => r.label)).toEqual(["2015–2019", "2020–2024"]);
  });

  it("a one-hue ramp in five steps; zero is always the blank step", () => {
    expect([0, 1, 2, 3, 4, 8].map((n) => rampLevel(n, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(rampLevel(1, 1)).toBe(4);
    expect(rampLevel(0, 0)).toBe(0);
  });
});

describe("topOutcomes (concept map)", () => {
  const many: ReviewResult = {
    ...resultFixture, review_type: "slr",
    synthesis: { ...resultFixture.synthesis!, comparison: Array.from({ length: 10 }, (_, i) => ({
      outcome: `Outcome ${i}`,
      cells: papers.slice(0, 1 + (i % 4)).filter((p) => p.card).map((p) => ({ ref: p.ref, finding: "x", direction: "positive" as const })),
    })) },
  };

  it("keeps the outcomes most studies report (at most 8), most first, and says how many were left out", () => {
    const full = conceptTree(many, "en", "slr");
    const { tree, shown, total } = topOutcomes(full, 8);
    expect(total).toBe(10);
    expect(shown).toBe(8);
    const outs = tree.nodes.filter((n) => n.kind === "outcome");
    expect(outs).toHaveLength(8);
    const k = (id: string) => new Set(full.nodes.find((n) => n.id === id)!.children.flatMap((g) => g.refs ?? [])).size;
    const ks = outs.map((o) => k(o.id));
    expect([...ks].sort((a, b) => b - a)).toEqual(ks);
    expect(tree.leaves).toBe(tree.nodes.filter((n) => n.kind === "group").length);
    expect(tree.drawnLeaves).toBe(tree.nodes.filter((n) => !n.children.length).length);
    // the full tree (for the outline) is untouched
    expect(full.nodes.filter((n) => n.kind === "outcome")).toHaveLength(10);
  });

  it("a tree within the limit is unchanged", () => {
    const t = conceptTree({ ...resultFixture, review_type: "slr" }, "th", "slr");
    expect(topOutcomes(t, 8)).toEqual({ tree: t, shown: 2, total: 2 });
  });
});

describe("literature matrix: compact columns and frameworks", () => {
  it("study, year, design, population/sample, intervention, outcomes, then direction and risk of bias", () => {
    const rows = litRows(papers, "th");
    expect(litColumns("slr", rows, "pico")).toEqual(["ref", "year", "design", "population", "exposure", "outcomes", "direction", "risk"]);
    expect(rows.find((r) => r.ref === "P3")!.year).toBe(2021);
  });

  it("scoping and qualitative reviews hide the direction; scoping hides risk of bias", () => {
    const s = litRows(scopingReviewFixture.result!.papers!, "th");
    expect(litColumns("scoping", s, "pcc")).toEqual(["ref", "year", "design", "population", "exposure", "outcomes"]);
    expect(litColumns("narrative", s, "pico_qual")).not.toContain("direction");
    expect(litColumns("narrative", s, "spider")).not.toContain("direction");
  });

  it("the framework follows what the result carries", () => {
    expect(litFramework("slr", papers, resultFixture.question)).toBe("pico");
    expect(litFramework("scoping", papers, scopingReviewFixture.result!.question)).toBe("pcc");
    // mixed quantitative and qualitative studies: still PICO
    expect(litFramework("narrative", narrativeP20ReviewFixture.result!.papers!, null)).toBe("pico");
    const themes = qualitativeReviewFixture.result!.papers!.slice(0, 2);
    expect(litFramework("narrative", themes, null)).toBe("spider");
    expect(litFramework("narrative", themes.slice(0, 1), null)).toBe("pico_qual");
  });

  it("labels per framework: PICo and SPIDER-like for themes reviews", () => {
    expect(litColumnLabel("exposure", "pico_qual", "en")).toBe("Phenomenon of interest (I)");
    expect(litColumnLabel("outcomes", "pico_qual", "th")).toBe("ประเด็นที่พบ");
    expect(litColumnLabel("population", "spider", "en")).toBe("Sample (S)");
    expect(litColumnLabel("outcomes", "spider", "en")).toBe("Evaluation (E)");
    expect(litColumnLabel("exposure", "pcc", "en")).toBe("Concept");
    expect(litColumnLabel("population", "pico", "en")).toBe("Population / sample");
  });

  it("clamps a long outcomes cell (more than two outcomes, or long text)", () => {
    const rows = litRows(papers, "th");
    expect(outcomesClamped(rows.find((r) => r.ref === "P1")!)).toBe(false);
    const long = { ...rows[0], outcomes: [0, 1, 2].map((i) => ({ ...rows[0].outcomes[0], name: `Outcome ${i}` })) };
    expect(outcomesClamped(long)).toBe(true);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 32 }, (_, i) => i);
  it("15 per page, the page clamped to the range", () => {
    expect(paginate(items, 0, 15)).toMatchObject({ page: 0, pages: 3, start: 0, end: 15 });
    expect(paginate(items, 2, 15).items).toEqual([30, 31]);
    expect(paginate(items, 9, 15).page).toBe(2);
    expect(paginate([], 0, 15)).toMatchObject({ page: 0, pages: 1, items: [] });
  });
});

describe("fixtures used by the figures", () => {
  it("the SLR fixture's papers all have a year", () => {
    expect((slrP20ReviewFixture.result!.papers as Paper[]).every((p) => p.year != null)).toBe(true);
  });
});
