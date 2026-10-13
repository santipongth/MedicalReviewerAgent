import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCES, hasThaiJo, joinThai, sourceLabels } from "./search-sources";

describe("search sources from /status (Plan 23d)", () => {
  it("lists the labels /status sends, in its order", () => {
    expect(sourceLabels([{ id: "pubmed", label: "PubMed" }, { id: "thaijo", label: "ThaiJO" }, { id: "plos", label: "PLOS" }]))
      .toEqual(["PubMed", "ThaiJO", "PLOS"]);
  });

  it("falls back to the default eight without /status, without sources, or with nothing usable", () => {
    for (const sources of [null, undefined, [], [{ id: "x", label: " " }], "PubMed" as never]) {
      expect(sourceLabels(sources)).toEqual([...DEFAULT_SOURCES]);
    }
    expect(DEFAULT_SOURCES).toHaveLength(8);
  });

  it("knows when ThaiJO is on and joins a list the Thai way", () => {
    expect(hasThaiJo([{ id: "thaijo", label: "ThaiJO" }])).toBe(true);
    expect(hasThaiJo([{ id: "pubmed", label: "PubMed" }])).toBe(false);
    expect(hasThaiJo(null)).toBe(false);
    expect(joinThai(["A", "B", "C"])).toBe("A, B และ C");
    expect(joinThai(["A"])).toBe("A");
    expect(joinThai([])).toBe("");
  });
});
