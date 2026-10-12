import { describe, expect, it } from "vitest";
import { dashboardChartOption } from "@/lib/admin-dashboard-view";
import { DASHBOARD } from "@/test/admin-fixtures";
import { init } from "./echarts-runtime";

const C = { done: "#111111", error: "#a33a12", rejected: "#9aa8a0", cancelled: "#4a5e57", running: "#4a5e57", queued: "#bccac1",
  cost: "#222222", text: "#10241e", rule: "#bccac1", font: "sans-serif" };

describe("echarts runtime", () => {
  // Guards the registered components: a missing one (LineChart, LegendComponent, AriaComponent) drops that part of the
  // drawing silently, so only a real render shows it.
  it("renders the admin dashboard option: the legend, the dashed cost line and decal patterns on the bars", () => {
    const chart = init(null as unknown as HTMLElement, undefined, { renderer: "svg", ssr: true, width: 600, height: 280 });
    chart.setOption(dashboardChartOption(DASHBOARD, C) as never);
    const svg = (chart as unknown as { renderToSVGString(): string }).renderToSVGString();
    chart.dispose();
    expect(svg).toContain("ค่าใช้จ่าย (USD)");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("เสร็จ");
    expect(svg).toContain("<pattern");
  });
});
