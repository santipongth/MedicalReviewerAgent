import { describe, expect, it } from "vitest";
import { CHART_SYMBOL, GLYPH_PATH, haloWidth } from "./glyphs";
import { DIRECTION_ORDER } from "./i18n";

describe("one glyph vocabulary for the legend and the charts (DESIGN.md)", () => {
  it("every chart marker is a custom path, one per direction, none of ECharts' built-in shapes", () => {
    const symbols = DIRECTION_ORDER.map((d) => CHART_SYMBOL[d]);
    expect(symbols.every((s) => s.startsWith("path://"))).toBe(true);
    expect(new Set(symbols).size).toBe(5);
    for (const builtin of ["triangle", "rect", "emptyCircle", "circle", "diamond"]) expect(symbols).not.toContain(builtin);
    for (const d of DIRECTION_ORDER) expect(CHART_SYMBOL[d]).toBe(`path://${GLYPH_PATH[d]}`);
  });

  it("shapes: circle = supports, diamond = harm, flat bar = no association, half-filled circle = mixed, dashed ring = unclear", () => {
    expect(GLYPH_PATH.positive).toMatch(/^M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z$/);
    expect(GLYPH_PATH.negative).toBe("M50 0L100 50L50 100L0 50Z");
    expect(GLYPH_PATH.null).toBe("M0 0H100V28H0Z"); // flat: 100 x 28, drawn with symbolKeepAspect
    // ring (outer clockwise, inner hole counter-clockwise) + a left half disc
    expect(GLYPH_PATH.mixed).toContain("A50 50 0 1 1");
    expect(GLYPH_PATH.mixed).toContain("A36 36 0 1 0");
    expect(GLYPH_PATH.mixed).toContain("M50 86A36 36 0 0 1 50 14Z");
    // eight separate ring segments
    expect(GLYPH_PATH.unclear.match(/M/g)).toHaveLength(8);
    expect(GLYPH_PATH.unclear.match(/Z/g)).toHaveLength(8);
  });

  it("outlined glyphs get no surface halo (it would erase the ring)", () => {
    expect(haloWidth("mixed")).toBe(0);
    expect(haloWidth("unclear")).toBe(0);
    expect(haloWidth("positive")).toBeGreaterThan(0);
    expect(haloWidth("negative")).toBeGreaterThan(0);
  });
});
