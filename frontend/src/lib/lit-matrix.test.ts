import { describe, expect, it } from "vitest";
import { litColumns, litRows } from "./lit-matrix";
import { citationsFixture, narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";
import type { Paper } from "./types";

const papers = resultFixture.papers!;

describe("litRows", () => {
  it("keeps the given (filtered) order, one row per paper", () => {
    const rows = litRows([papers[2], papers[0]], "th");
    expect(rows.map((r) => r.ref)).toEqual([papers[2].ref, papers[0].ref]);
  });

  it("takes numbers as the paper wrote them and marks missing effects as none", () => {
    const p3 = litRows(papers, "th").find((r) => r.ref === "P3")!;
    expect(p3.n).toEqual({ kind: "value", text: "1,234" });
    expect(p3.outcomes[0].effect).toEqual({ label: "HR 0.80", ci: "0.71–0.90" });
    expect(p3.outcomes[1].effect).toBeNull();
  });

  it("a blanked sample size and a blanked effect are markers, not values", () => {
    const blanked: Paper = { ...papers[0], verification: { ...papers[0].verification!,
      unverified: [{ field: "sample_size", outcome: null }, { field: "effect", outcome: papers[0].card_en!.outcomes[0].outcome }] } };
    const [row] = litRows([blanked], "th");
    expect(row.n).toEqual({ kind: "blanked" });
    expect(row.outcomes[0].effect).toEqual({ blanked: true });
  });

  it("a paper without a card is a failed row", () => {
    const [row] = litRows([{ ...papers[0], card: null, card_en: null }], "th");
    expect(row.failed).toBe(true);
  });

  it("flags SR/MA designs for the glossary term", () => {
    const rows = litRows(papers, "th");
    expect(rows.find((r) => r.ref === "P4")!.design!.pooled).toBe(true);
    expect(rows.find((r) => r.ref === "P1")!.design!.pooled).toBe(false);
  });
});

describe("litColumns", () => {
  const rows = litRows(papers, "th");
  it("narrative keeps direction and risk of bias", () => {
    const cols = litColumns("narrative", litRows(narrativeReviewFixture.result!.papers!, "th"));
    expect(cols).toContain("direction");
    expect(cols).toContain("risk");
  });
  it("scoping drops direction and risk of bias", () => {
    const cols = litColumns("scoping", litRows(scopingReviewFixture.result!.papers!, "th"));
    expect(cols).not.toContain("direction");
    expect(cols).not.toContain("risk");
  });
  it("drops the comparator column when no row has one", () => {
    const none = rows.map((r) => ({ ...r, comparator: "" }));
    expect(litColumns("slr", none)).not.toContain("comparator");
    expect(litColumns("slr", rows)).toContain("comparator");
  });
  it("adds the cited-by column after n only when the review has citation data", () => {
    expect(litColumns("slr", rows)).not.toContain("citedBy");
    const cols = litColumns("slr", litRows(papers, "th", citationsFixture));
    expect(cols.indexOf("citedBy")).toBe(cols.indexOf("n") + 1);
  });
  it("drops the cited-by column when no paper has a count (a column of dashes says nothing)", () => {
    const none = Object.fromEntries(papers.map((p) => [p.ref, null]));
    const empty = { ...citationsFixture, cited_by: none, cited_by_source: none };
    expect(litColumns("slr", litRows(papers, "th", empty))).not.toContain("citedBy");
  });
  it("cited-by values are counts with their source; null stays null (no data), also for a failed row", () => {
    const rows = litRows(papers, "th", citationsFixture);
    expect(rows.find((r) => r.ref === "P2")!.citedBy).toEqual({ count: 1187, source: "openalex" });
    const p5 = rows.find((r) => r.ref === "P5")!;
    expect(p5.failed).toBe(true);
    expect(p5.citedBy).toEqual({ count: null, source: null });
    expect(litRows(papers, "th")[0].citedBy).toBeUndefined();
  });
});
