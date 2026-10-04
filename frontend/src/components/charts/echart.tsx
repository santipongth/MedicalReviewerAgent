"use client";

import { BarChart, CustomChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, CustomChart, ScatterChart, AriaComponent, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

export type EChartsOption = echarts.EChartsCoreOption;
export const encodeHTML = echarts.format.encodeHTML;

/** Thin React wrapper: SVG renderer (crisp text, small bundle), resizes with its container, disposes on unmount. */
export function EChart({
  option, height, label, onItemClick,
}: { option: EChartsOption; height: number; label: string; onItemClick?: (data: unknown) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onItemClick);

  useEffect(() => {
    clickRef.current = onItemClick;
  }, [onItemClick]);

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "svg" });
    chart.current = c;
    c.on("click", (params) => clickRef.current?.((params as { data?: unknown }).data));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}
