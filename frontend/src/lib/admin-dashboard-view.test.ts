import { describe, expect, it } from "vitest";
import { DASHBOARD } from "@/test/admin-fixtures";
import { dashboardChartOption, type StatusColors } from "./admin-dashboard-view";

const C: StatusColors = { done: "#0a0", error: "#a00", rejected: "#999", cancelled: "#777", running: "#a80", queued: "#ccc",
  cost: "#111", text: "#222", rule: "#ddd", font: "Bai Jamjuree" };

describe("dashboardChartOption", () => {
  it("stacks only the statuses that occur, with the cost on its own axis", () => {
    const o = dashboardChartOption(DASHBOARD, C) as { xAxis: { data: string[] }; series: Record<string, unknown>[] };
    expect(o.xAxis.data).toEqual(["10-11", "10-12"]);
    const names = o.series.map((s) => s.name);
    expect(names).toEqual(["เสร็จ", "ผิดพลาด", "ค่าใช้จ่าย (USD)"]);
    expect(o.series[0]).toMatchObject({ type: "bar", stack: "reviews", data: [3, 4], itemStyle: { color: "#0a0" } });
    expect(o.series[1]).toMatchObject({ data: [0, 1], itemStyle: { color: "#a00" } });
    expect(o.series[2]).toMatchObject({ type: "line", yAxisIndex: 1, data: [0.21, 0.31] });
  });
});
