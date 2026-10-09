import { describe, expect, it } from "vitest";
import { evidenceMap } from "./evidence-map";
import { resultFixture } from "@/test/fixtures";

const papers = resultFixture.papers!;
const rows = resultFixture.synthesis!.comparison!;

describe("evidenceMap", () => {
  it("counts studies per concept row and design category, with a total", () => {
    const m = evidenceMap(papers, rows, "th");
    expect(m.byConcept.designs.map((d) => d.key)).toEqual(["cohort", "case_control", "sr_ma_observational"]);
    expect(m.byConcept.rows[0].counts).toEqual({ cohort: 2, case_control: 1, sr_ma_observational: 1 });
    expect(m.byConcept.rows[0].total).toBe(4);
    expect(m.byConcept.rows[1].counts).toEqual({ cohort: 1 });
    expect(m.byConcept.rows[1].total).toBe(1);
  });

  it("bins papers by five-year period and design, oldest first", () => {
    const m = evidenceMap(papers, rows, "th");
    expect(m.byYear.rows.map((r) => r.label)).toEqual(["2015–2019", "2020–2024"]);
    expect(m.byYear.rows[0].counts).toEqual({ cohort: 1, case_control: 1 });
    expect(m.byYear.rows[1].counts).toEqual({ cohort: 1, sr_ma_observational: 1 });
    expect(m.byYear.rows.map((r) => r.total)).toEqual([2, 2]);
  });

  it("reports the papers it could not place, never guessing a design or a year", () => {
    const m = evidenceMap(papers, rows, "th");
    expect(m.unplaced).toBe(1); // P5 has no card
    const noYear = papers.map((p) => (p.ref === "P1" ? { ...p, year: null } : p));
    expect(evidenceMap(noYear, rows, "th").unplaced).toBe(2);
  });

  it("counts only the papers it is given (filters) and each paper once per row", () => {
    const m = evidenceMap(papers.filter((p) => p.ref !== "P2"), rows, "th");
    expect(m.byConcept.rows[0].total).toBe(3);
    expect(m.byConcept.designs.map((d) => d.key)).not.toContain("case_control");
    const dup = [{ outcome: "x", cells: [rows[0].cells[0], rows[0].cells[0]] }];
    expect(evidenceMap(papers, dup, "th").byConcept.rows[0].total).toBe(1);
  });

  it("is empty when there are no papers with a design", () => {
    const m = evidenceMap([papers[4]], [], "th");
    expect(m.byConcept.rows).toEqual([]);
    expect(m.byYear.rows).toEqual([]);
  });
});
