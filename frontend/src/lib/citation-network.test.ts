import { describe, expect, it } from "vitest";
import { citationsFixture, metaReviewFixture, resultFixture } from "@/test/fixtures";
import { ARC_CLEARANCE, CITED_BY_CAP, citationNetwork, citedByCell, designGroup, edgeCurves, isPartial, markerSize } from "./citation-network";
import type { Citations, Paper } from "./types";

const papers = resultFixture.papers!;

describe("citationNetwork", () => {
  it("places papers by year, lanes by design then ref, and keeps every edge between them", () => {
    const net = citationNetwork(papers, citationsFixture, "th");
    expect(net.nodes.map((n) => n.ref)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(net.nodes.map((n) => n.x)).toEqual([2019, 2017, 2021, 2020, 2018]);
    expect(net.nodes.every((n) => n.lane === 0)).toBe(true); // one paper per year
    expect(net.edges).toEqual(citationsFixture.edges);
    expect(net.minYear).toBe(2017);
    expect(net.maxYear).toBe(2021);
    expect(net.unknownX).toBeNull();
    expect(net.ticks).toEqual([2017, 2018, 2019, 2020, 2021]);
    expect(net.lanes).toBe(1);
    expect(net.columns).toBe(5);
    expect(net.covered).toBe(4);
    expect(net.total).toBe(5);
    expect(net.partial).toBe(false);
  });

  it("lists who cites whom inside the review, in ref order", () => {
    const net = citationNetwork(papers, citationsFixture, "en");
    const p1 = net.nodes.find((n) => n.ref === "P1")!;
    expect(p1.cites).toEqual(["P2"]);
    expect(p1.citedByIn).toEqual(["P3", "P4"]);
    expect(net.nodes.find((n) => n.ref === "P2")!.citedByIn).toEqual(["P1", "P3"]);
  });

  it("a paper with null coverage has no data, and its count stays null (never zero)", () => {
    const p5 = citationNetwork(papers, citationsFixture, "th").nodes.find((n) => n.ref === "P5")!;
    expect(p5.coverage).toBeNull();
    expect(p5.citedBy).toBeNull();
    expect(p5.citedBySource).toBeNull();
    expect(p5.cites).toEqual([]);
    // P5 has no card (failed extraction): an unknown design, grouped with "observational and other"
    expect(p5.design).toBe("");
    expect(p5.designText).toBe("ไม่ทราบรูปแบบ");
    expect(p5.group).toBe("observational");
  });

  it("drops edges whose ends are filtered out, self loops and duplicates", () => {
    const c: Citations = { ...citationsFixture, edges: [...citationsFixture.edges, { from: "P1", to: "P1" }, { from: "P1", to: "P2" }, { from: "P9", to: "P1" }] };
    const net = citationNetwork(papers.filter((p) => p.ref !== "P2"), c, "th");
    expect(net.edges).toEqual([{ from: "P3", to: "P1" }, { from: "P4", to: "P1" }]);
  });

  it("puts papers without a year in their own column left of the first year", () => {
    const noYear: Paper[] = [{ ...papers[0], year: null }, { ...papers[1], year: undefined }, papers[2], papers[3]];
    const net = citationNetwork(noYear, citationsFixture, "th");
    expect(net.unknownX).toBe(2020 - 1.5);
    expect(net.ticks[0]).toBe(net.unknownX);
    expect(net.nodes.filter((n) => n.x === net.unknownX).map((n) => [n.ref, n.lane])).toEqual([["P1", 0], ["P2", 1]]);
    expect(net.xMin).toBeLessThan(net.unknownX!);
    expect(net.lanes).toBe(2);
  });

  it("stacks a column by design order (RCT before cohort before reviews), then ref", () => {
    const meta = metaReviewFixture.result!;
    const same = meta.papers!.map((p) => ({ ...p, year: 2020 }));
    const net = citationNetwork(same, meta.citations!, "th");
    const order = [...net.nodes].sort((a, b) => a.lane - b.lane).map((n) => n.ref);
    expect(order).toEqual(["P1", "P2", "P3", "P4", "P7", "P5", "P6"]);
    expect(net.lanes).toBe(7);
  });

  it("flags a partial (timed out) lookup from the source note", () => {
    const partial = { ...citationsFixture, source_note: `${citationsFixture.source_note}; partial: the lookup timed out` };
    expect(isPartial(partial)).toBe(true);
    expect(citationNetwork(papers, partial, "th").partial).toBe(true);
    expect(isPartial(citationsFixture)).toBe(false);
    expect(isPartial(null)).toBe(false);
  });

  it("thins year labels for long spans but always labels the first and last year", () => {
    const spread = papers.slice(0, 3).map((p, i) => ({ ...p, year: [1998, 2007, 2024][i] }));
    const net = citationNetwork(spread, citationsFixture, "th");
    expect(net.ticks[0]).toBe(1998);
    expect(net.ticks.at(-1)).toBe(2024);
    expect(net.ticks.length).toBeLessThanOrEqual(7);
  });
});

describe("edgeCurves", () => {
  // Five papers in one row, one year apart: P3 (2021) -> P2 (2017) passes P5, P1 and P4.
  const net = citationNetwork(papers, citationsFixture, "th");
  const curves = edgeCurves(net, 64, 46);
  const of = (from: string, to: string) => curves.find((c) => c.from === from && c.to === to)!;

  it("bends a long arc enough to clear every marker it passes", () => {
    for (const c of curves) {
      const a = net.nodes.find((n) => n.ref === c.from)!;
      const b = net.nodes.find((n) => n.ref === c.to)!;
      const len = Math.abs(b.x - a.x) * 64;
      for (const n of net.nodes) {
        if (n === a || n === b || n.lane !== a.lane) continue;
        const t = (n.x - a.x) / (b.x - a.x);
        if (t <= 0 || t >= 1) continue;
        expect(2 * c.curveness * len * t * (1 - t), `${c.from}->${c.to} at ${n.ref}`).toBeGreaterThanOrEqual(ARC_CLEARANCE - 1e-9);
      }
    }
  });

  it("keeps a slight bend where nothing is in the way, and longer spans bend relatively less", () => {
    expect(of("P1", "P2").curveness).toBeGreaterThan(of("P3", "P2").curveness); // 2 columns vs 4
    expect(of("P3", "P2").peak).toBeGreaterThan(of("P1", "P2").peak);
    const lone = edgeCurves(citationNetwork(papers.slice(0, 2), citationsFixture, "th"), 64, 46);
    expect(lone).toEqual([{ from: "P1", to: "P2", curveness: 0.12, peak: (0.12 * 128) / 2, side: "below" }]);
  });

  it("names the side an arc bulges to (right-to-left below, left-to-right above)", () => {
    expect(of("P3", "P1").side).toBe("below");
    const back = edgeCurves({ ...net, edges: [{ from: "P2", to: "P3" }] }, 64, 46);
    expect(back[0].side).toBe("above");
  });
});

describe("helpers", () => {
  it("sizes markers by the square root of the count, capped", () => {
    expect(markerSize(null)).toBe(12);
    expect(markerSize(0)).toBe(12);
    expect(markerSize(CITED_BY_CAP)).toBe(30);
    expect(markerSize(CITED_BY_CAP * 50)).toBe(30);
    expect(markerSize(250)).toBe(21);
  });

  it("groups designs into trials, observational and reviews", () => {
    expect(designGroup("rct")).toBe("trial");
    expect(designGroup("non_randomized_trial")).toBe("trial");
    expect(designGroup("cohort")).toBe("observational");
    expect(designGroup("other")).toBe("observational");
    expect(designGroup("sr_ma_rct")).toBe("review");
    expect(designGroup("narrative_review")).toBe("review");
  });

  it("reads the cited-by count and its source; null is no data", () => {
    expect(citedByCell(citationsFixture, "P3")).toEqual({ count: 46, source: "europepmc" });
    expect(citedByCell(citationsFixture, "P5")).toEqual({ count: null, source: null });
    expect(citedByCell(citationsFixture, "P9")).toEqual({ count: null, source: null });
    // a block from before cited_by_source counted with OpenAlex only
    const { cited_by_source: _, ...old } = citationsFixture;
    void _;
    expect(citedByCell(old as Citations, "P1")).toEqual({ count: 312, source: "openalex" });
  });
});
