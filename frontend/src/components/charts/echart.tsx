"use client";

import type { ECharts, EChartsCoreOption } from "echarts/core";
import { useEffect, useRef } from "react";

export type EChartsOption = EChartsCoreOption;

/** Same escaping as echarts.format.encodeHTML, kept here so building tooltip strings never pulls in echarts. */
export function encodeHTML(source: unknown): string {
  return source == null
    ? ""
    : String(source).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

let runtime: Promise<typeof import("./echarts-runtime")> | null = null;
/** Loads (once) the echarts runtime chunk. The offline report build inlines it, so it works without a network. */
function loadEcharts() {
  runtime ??= import("./echarts-runtime");
  return runtime;
}

/** Thin React wrapper: SVG renderer (crisp text, small bundle), resizes with its container, disposes on unmount.
 *  echarts itself loads on first mount; the div keeps its height meanwhile so nothing shifts. */
export function EChart({
  option, height, label, onItemClick,
}: { option: EChartsOption; height: number; label: string; onItemClick?: (data: unknown) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const clickRef = useRef(onItemClick);
  const optionRef = useRef(option);

  useEffect(() => {
    clickRef.current = onItemClick;
  }, [onItemClick]);

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    loadEcharts().then(({ init }) => {
      if (!alive || !el.current) return;
      const c = init(el.current, undefined, { renderer: "svg" });
      chart.current = c;
      c.on("click", (params) => clickRef.current?.((params as { data?: unknown }).data));
      c.setOption(optionRef.current, { notMerge: true }); // whatever option is current once the runtime arrives
      ro = new ResizeObserver(() => c.resize());
      ro.observe(el.current);
    });
    return () => {
      alive = false;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    optionRef.current = option;
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}
