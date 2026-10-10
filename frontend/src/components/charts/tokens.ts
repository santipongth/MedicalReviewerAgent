"use client";

import { CHART_SYMBOL } from "@/lib/glyphs";
import type { Direction } from "@/lib/types";

/** Chart colors and fonts read from the live CSS tokens, so charts follow the active theme. */
export interface ChartTokens {
  ink: string;
  muted: string;
  rule: string;
  surface: string;
  /** The "not verified" hatch tone; used as a neutral fill (never for a direction). */
  hatch: string;
  direction: Record<Direction, string>;
  /** Every chart text: axes, ticks, counts and labels (the EChart wrapper turns on tabular figures). */
  fontDisplay: string;
  /** Martian Mono, the verified-number face: only for a verified paper number (e.g. in a tooltip), never ticks or counts. */
  fontNum: string;
  reducedMotion: boolean;
}

export function readTokens(): ChartTokens {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#10241e"),
    muted: v("--muted", "#4a5e57"),
    rule: v("--rule", "#bccac1"),
    surface: v("--surface", "#f8faf9"),
    hatch: v("--hatch", "#9aa8a0"),
    direction: {
      positive: v("--sup", "#0072b2"),
      negative: v("--harm", "#d55e00"),
      null: v("--none", "#5f6b73"),
      mixed: v("--mixed", "#8e3b7e"),
      unclear: v("--unclear", "#5f6b73"),
    },
    fontDisplay: v("--font-bai-jamjuree", "sans-serif"),
    fontNum: v("--font-martian-mono", "monospace"),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** Marker shape per direction: the shared glyph vocabulary (lib/glyphs.ts), so markers match the legend. */
export const SYMBOL: Record<Direction, string> = CHART_SYMBOL;
