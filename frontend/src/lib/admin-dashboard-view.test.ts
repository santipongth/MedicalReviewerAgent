import { afterEach, describe, expect, it } from "vitest";
import { DASHBOARD } from "@/test/admin-fixtures";
import { dashboardChartOption, readStatusColors, type StatusColors } from "./admin-dashboard-view";

const C: StatusColors = { done: "#0a0", error: "#a00", rejected: "#999", cancelled: "#777", running: "#a80", queued: "#ccc",
  cost: "#111", surface: "#fafafa", text: "#222", rule: "#ddd", font: "Bai Jamjuree" };

describe("dashboardChartOption", () => {
  it("stacks only the statuses that occur, with the cost on its own axis", () => {
    const o = dashboardChartOption(DASHBOARD, C) as { xAxis: { data: string[] }; series: Record<string, unknown>[] };
    expect(o.xAxis.data).toEqual(["10-11", "10-12"]);
    // the cost line's silent halo has no name (below), so the named series are the legend entries
    expect(o.series.filter((s) => s.name).map((s) => s.name)).toEqual(["เสร็จ", "ผิดพลาด", "ค่าใช้จ่าย (USD)"]);
    expect(o.series[0]).toMatchObject({ type: "bar", stack: "reviews", data: [3, 4], itemStyle: { color: "#0a0" } });
    expect(o.series[1]).toMatchObject({ data: [0, 1], itemStyle: { color: "#a00" } });
    expect(o.series.find((s) => s.name === "ค่าใช้จ่าย (USD)")).toMatchObject({ type: "line", yAxisIndex: 1, data: [0.21, 0.31] });
  });

  // The cost line is ink like the "done" bars and crosses them anywhere (own axis): it needs a halo to stay visible.
  it("draws the cost line above the bars on a surface-coloured halo that stays out of the legend and tooltip", () => {
    const o = dashboardChartOption(DASHBOARD, C) as { series: Record<string, unknown>[] };
    const bars = o.series.filter((s) => s.type === "bar");
    const halo = o.series.find((s) => s.id === "cost-halo")!;
    const line = o.series.find((s) => s.name === "ค่าใช้จ่าย (USD)")!;
    const z = (s: Record<string, unknown>) => (s.z as number | undefined) ?? 2; // ECharts' series default
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      expect(z(halo)).toBeGreaterThan(z(b));
      expect(z(line)).toBeGreaterThan(z(halo));
    }
    expect(o.series.indexOf(halo)).toBeLessThan(o.series.indexOf(line));
    expect(halo).toMatchObject({ type: "line", yAxisIndex: 1, data: [0.21, 0.31], silent: true, symbol: "none",
      lineStyle: { color: "#fafafa", width: 6 }, tooltip: { show: false } });
    expect(halo.name).toBeUndefined(); // an unnamed series gets no legend entry
    expect(line).toMatchObject({ lineStyle: { color: "#111", type: "dashed" }, symbol: "circle",
      itemStyle: { color: "#fafafa", borderColor: "#111" } }); // hollow symbols
    expect((line.lineStyle as { width?: number }).width ?? 2).toBeLessThan((halo.lineStyle as { width: number }).width);
  });
});

describe("dashboardChartOption accessibility", () => {
  it("tells statuses apart by decal pattern, and leaves the chart's Thai label to the wrapper", () => {
    const o = dashboardChartOption(DASHBOARD, C) as { aria: Record<string, unknown> };
    expect(o.aria).toMatchObject({ enabled: true, decal: { show: true }, label: { enabled: false } });
  });
});

describe("readStatusColors", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("maps statuses to ink, error and neutral tokens only: never a brand or direction colour", () => {
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries({ "--ink": "#101010", "--err": "#e00000", "--hatch": "#909090", "--muted": "#505050",
      "--rule": "#c0c0c0", "--surface": "#f0f0f0", "--ok": "#00ff00", "--warn": "#ffff00" })) root.setProperty(name, value);
    const c = readStatusColors();
    expect(c).toMatchObject({ done: "#101010", error: "#e00000", rejected: "#909090", cancelled: "#505050", running: "#505050",
      queued: "#c0c0c0", cost: "#101010", surface: "#f0f0f0" });
    expect(Object.values(c)).not.toContain("#00ff00");
    expect(Object.values(c)).not.toContain("#ffff00");
  });
});
