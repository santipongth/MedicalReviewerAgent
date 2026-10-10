"use client";

import type { ECharts, EChartsCoreOption } from "echarts/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { fitChartForPrint } from "@/lib/print";
import { usePrinting } from "../review/print-mode";

export type EChartsOption = EChartsCoreOption;

/**
 * A chart's width on paper (CSS px): A4 less the print margins (globals.css `@page`, 182mm ≈ 688px) and a little room.
 * The SVG has a fixed size, so it is redrawn at this width instead of the screen's (vector, never scaled).
 */
export const PRINT_CHART_WIDTH = 660;

/** Same escaping as echarts.format.encodeHTML, kept here so building tooltip strings never pulls in echarts. */
export function encodeHTML(source: unknown): string {
  return source == null
    ? ""
    : String(source).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

let runtime: Promise<typeof import("./echarts-runtime")> | null = null;
/** Loads (once) the echarts runtime chunk. The offline report build inlines it, so it works without a network. */
function loadEcharts() {
  // A failed load is not cached: the next chart mount retries (flaky network, or chunks rotated by a deploy).
  runtime ??= import("./echarts-runtime").catch((e: unknown) => {
    runtime = null;
    throw e;
  });
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
  // drawn at the print size (between beforeprint and afterprint), and the print fitting to undo afterwards
  const printed = useRef(false);
  const unViewBox = useRef<(() => void) | null>(null);

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
      // while printing the drawing keeps its print size: the page box resizing must not redraw it (fix round 1)
      ro = new ResizeObserver(() => { if (!printed.current) c.resize(); });
      ro.observe(el.current);
    }).catch((e: unknown) => {
      // The box stays empty at its reserved height; every figure also has a table view with the same numbers.
      console.warn("chart unavailable: could not load echarts", e);
    });
    return () => {
      alive = false;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  // Layout effects: in print mode (Plan 20 Task 8) the chart must be redrawn before the browser lays the page out for
  // print, right after `beforeprint`. setOption draws synchronously; with no animation the printout never catches a
  // half-way transition (the colours switch to the light theme at the same time).
  const printing = usePrinting();
  useLayoutEffect(() => {
    optionRef.current = option;
    const c = chart.current;
    if (!c) return;
    unViewBox.current?.();
    unViewBox.current = null;
    if (printing) {
      c.resize({ width: PRINT_CHART_WIDTH, height, animation: { duration: 0 } });
      printed.current = true;
    } else if (printed.current) {
      // back to the container's width (explicit: the drawing still has its print width at this point)
      c.resize({ width: el.current?.clientWidth || undefined, height, animation: { duration: 0 } });
      printed.current = false;
    }
    c.setOption(printing ? { ...option, animation: false } : option, { notMerge: true });
    // fix round 1: the drawing scales to the width the page has, in proportion (never clipped)
    if (printing && el.current) unViewBox.current = fitChartForPrint(el.current, PRINT_CHART_WIDTH, height);
  }, [option, printing, height]);

  // Tabular figures for every tick, count and label. font-feature-settings (unlike font-variant-numeric) survives the
  // `font` shorthand the SVG renderer writes on each text node, so it inherits into the chart's text.
  return <div ref={el} role="img" aria-label={label} data-echart style={{ height, width: "100%", fontFeatureSettings: '"tnum"' }} />;
}
