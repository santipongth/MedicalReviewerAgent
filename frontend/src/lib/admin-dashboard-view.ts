import type { EChartsOption } from "@/components/charts/echart";
import { STATUS_LABEL, STATUS_ORDER } from "./admin-copy";
import type { AdminStatus, Dashboard } from "./admin-types";

/** Service-status colours: ink, the error and neutral tokens only, never a brand colour or the finding-direction palette
 * (DESIGN.md keeps those out of charts). Statuses that share a hue are told apart by the decal patterns, not colour alone. */
export type StatusColors = Record<AdminStatus, string> & { cost: string; text: string; rule: string; font: string };

export function readStatusColors(): StatusColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    done: v("--ink", "#10241e"), error: v("--err", "#b3261e"), rejected: v("--hatch", "#9aa8a0"),
    cancelled: v("--muted", "#4a5e57"), running: v("--muted", "#4a5e57"), queued: v("--rule", "#bccac1"),
    cost: v("--ink", "#10241e"), text: v("--ink", "#10241e"), rule: v("--rule", "#bccac1"),
    font: v("--font-bai-jamjuree", "sans-serif"),
  };
}

/** Reviews per UTC day stacked by status (bars), with the day's cost as a dashed line on its own axis. */
export function dashboardChartOption(d: Dashboard, c: StatusColors): EChartsOption {
  const present = STATUS_ORDER.filter((s) => d.per_day.some((p) => (p.by_status[s] ?? 0) > 0));
  return {
    animation: false,
    aria: { enabled: true, label: { enabled: false }, decal: { show: true } },
    textStyle: { fontFamily: c.font, color: c.text },
    grid: { left: 44, right: 56, top: 40, bottom: 28 },
    legend: { top: 0, textStyle: { color: c.text } },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: d.per_day.map((p) => p.date.slice(5)), axisLine: { lineStyle: { color: c.rule } },
      axisLabel: { color: c.text } },
    yAxis: [
      { type: "value", name: "รีวิว", minInterval: 1, splitLine: { lineStyle: { color: c.rule } }, axisLabel: { color: c.text } },
      { type: "value", name: "USD", splitLine: { show: false }, axisLabel: { color: c.text } },
    ],
    series: [
      ...present.map((s) => ({
        name: STATUS_LABEL[s], type: "bar", stack: "reviews", data: d.per_day.map((p) => p.by_status[s] ?? 0),
        itemStyle: { color: c[s] }, emphasis: { disabled: true },
      })),
      { name: "ค่าใช้จ่าย (USD)", type: "line", yAxisIndex: 1, data: d.per_day.map((p) => p.cost_usd),
        itemStyle: { color: c.cost }, lineStyle: { color: c.cost, type: "dashed" }, symbol: "circle" },
    ],
  };
}
