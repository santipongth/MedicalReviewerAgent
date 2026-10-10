// The one direction-glyph vocabulary (DESIGN.md): supports = filled circle, harm = filled diamond (◆, harm only), no
// association = flat bar, mixed = half-filled circle, unclear = dashed ring. The DOM glyph (`Glyph`, CSS `.g-*`) and the
// chart markers (ECharts `path://` symbols, below) draw these same shapes, so a chart marker always matches the legend.
// Pure data: SVG path data in a 100 x 100 box (the flat bar is 100 x 28; charts keep its aspect).
import type { Direction } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A full circle of radius r around (50, 50), drawn clockwise (screen coordinates) or counter-clockwise. */
function circle(r: number, clockwise: boolean): string {
  const s = clockwise ? 1 : 0;
  return `M50 ${50 - r}A${r} ${r} 0 1 ${s} 50 ${50 + r}A${r} ${r} 0 1 ${s} 50 ${50 - r}Z`;
}

const point = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180; // 0 deg = top, clockwise
  return `${r2(50 + r * Math.cos(a))} ${r2(50 + r * Math.sin(a))}`;
};

/** Eight ring segments (30 deg drawn, 15 deg gap): a dashed ring, outer radius 50, inner 36. */
function dashedRing(): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a0 = i * 45 + 7.5;
    const a1 = a0 + 30;
    parts.push(`M${point(50, a0)}A50 50 0 0 1 ${point(50, a1)}L${point(36, a1)}A36 36 0 0 0 ${point(36, a0)}Z`);
  }
  return parts.join("");
}

/** SVG path data per direction. Rings use opposite winding for the hole (nonzero fill rule). */
export const GLYPH_PATH: Record<Direction, string> = {
  positive: circle(50, true),
  negative: "M50 0L100 50L50 100L0 50Z",
  // 100 x 36 (the CSS glyph is 14 x 5): tall enough to read as a bar, not a thicker stretch of a CI line
  null: "M0 0H100V36H0Z",
  // ring (outer clockwise, inner counter-clockwise) plus the left half of the inner disc, clockwise
  mixed: `${circle(50, true)}${circle(36, false)}M50 86A36 36 0 0 1 50 14Z`,
  unclear: dashedRing(),
};

/** ECharts marker per direction. Charts set `symbolKeepAspect: true` so the flat bar stays flat. */
export const CHART_SYMBOL: Record<Direction, string> = {
  positive: `path://${GLYPH_PATH.positive}`,
  negative: `path://${GLYPH_PATH.negative}`,
  null: `path://${GLYPH_PATH.null}`,
  mixed: `path://${GLYPH_PATH.mixed}`,
  unclear: `path://${GLYPH_PATH.unclear}`,
};

/**
 * Width of the surface-coloured outline around a chart marker. Outlined glyphs (mixed, unclear) get none (it would
 * erase the ring). The flat bar gets the widest, so it cuts through its own CI line, which has the same colour.
 */
export function haloWidth(direction: Direction): number {
  if (direction === "mixed" || direction === "unclear") return 0;
  return direction === "null" ? 2 : 1.5;
}

/** Chart marker size: the flat bar is drawn wider (and so, at its kept aspect, taller) than the round glyphs. */
export function glyphSize(direction: Direction, base: number): number {
  return direction === "null" ? Math.round(base * 1.4) : base;
}
