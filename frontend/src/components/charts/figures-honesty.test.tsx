// Plan 20 Task 2: Martian Mono (the verified face) never sets a tick, a count or a label in a chart; markers use the
// shared glyph paths (lib/glyphs.ts) so they match the legend.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHART_SYMBOL } from "@/lib/glyphs";
import { metaReviewFixture, resultFixture } from "@/test/fixtures";

const options: unknown[] = [];
vi.mock("./echart", () => ({
  encodeHTML: (s: string) => s,
  EChart: ({ option, label }: { option: unknown; label: string }) => {
    options.push(option);
    return <div role="img" aria-label={label} />;
  },
}));
vi.mock("../theme-toggle", () => ({ useTheme: () => "light" }));

import { Charts } from "../review/charts";
import { MetaAnalysisSection } from "../review/meta-analysis";
import { readTokens } from "./tokens";

/** Every value of `key` anywhere in the option (functions such as tooltip formatters are not walked). */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, key, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      collect(v, key, out);
    }
  }
  return out;
}

function renderAll() {
  options.length = 0;
  render(<Charts result={resultFixture} papers={resultFixture.papers!} lang="en" onSelect={() => {}} />);
  const meta = metaReviewFixture.result!;
  render(<MetaAnalysisSection meta={meta.meta_analysis} papers={meta.papers!} rows={meta.synthesis_en!.comparison!} lang="en" english
    filtered={false} onSelect={() => {}} />);
  return options;
}

describe("chart text never uses the verified-number face", () => {
  it("forest, pooled forest, PRISMA and study map: ticks, counts and labels are in the display face", () => {
    const t = readTokens();
    expect(t.fontNum).not.toBe(t.fontDisplay);
    const all = renderAll();
    expect(all.length).toBeGreaterThanOrEqual(4); // forest, study map, PRISMA, pooled forest
    const fonts = collect(all, "fontFamily");
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts).not.toContain(t.fontNum);
    expect(new Set(fonts)).toEqual(new Set([t.fontDisplay]));
  });

  it("every direction marker is a shared glyph path drawn at its own aspect", () => {
    const all = renderAll();
    const symbols = collect(all, "symbol").filter((s): s is string => typeof s === "string");
    const markers = symbols.filter((s) => s.startsWith("path://"));
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((s) => Object.values(CHART_SYMBOL).includes(s))).toBe(true);
    for (const legacy of ["triangle", "rect", "emptyCircle", "diamond"]) expect(symbols).not.toContain(legacy);
    const scatter = collect(all, "series").flat().filter((s) => (s as { type?: string }).type === "scatter" && (s as { data?: unknown[] }).data?.length);
    expect(scatter.length).toBeGreaterThan(0);
    for (const s of scatter) expect((s as { symbolKeepAspect?: boolean }).symbolKeepAspect).toBe(true);
  });
});
