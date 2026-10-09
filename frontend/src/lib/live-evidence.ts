// Pure: what the live evidence board shows, derived only from reader slots (each from a received `extracted` event).
// No React, no DOM, no timers. Direction is the reading model's judgement of one paper's abstract: never a ranking,
// never a conclusion. Unknown or missing direction (events stored before 2026-10-09, future enum values) counts as
// "no direction", never as `unclear`; the string "null" (no association) is a real direction, JSON null is not.
import type { ReaderSlot, Scene } from "./agent-scene";
import { DESIGN_LABEL, DIRECTION_ORDER } from "./i18n";
import type { DesignCategory, Direction } from "./types";

// Defined next to DIRECTION_LABEL so the offline report (bottom-line.tsx) shares the order without importing this module.
export { DIRECTION_ORDER };

const DIRECTIONS = new Set<string>(DIRECTION_ORDER);

/** Only the five enum strings; JSON null, unknown strings and non-strings -> null. */
export function asDirection(v: unknown): Direction | null {
  return typeof v === "string" && DIRECTIONS.has(v) ? (v as Direction) : null;
}

/** Only known design categories (keys of DESIGN_LABEL.th); anything else -> null. */
export function asDesign(v: unknown): DesignCategory | null {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DESIGN_LABEL.th, v) ? (v as DesignCategory) : null;
}

/** Systematic review / meta-analysis (same rule as charts-data `isPooled`): it may pool the primary studies counted. */
export function isPooledDesign(d: DesignCategory | null): boolean {
  return d !== null && d.startsWith("sr_ma");
}

export interface EvidenceItem {
  ref: string; direction: Direction; design: DesignCategory | null; uncertain: boolean; key: number; title: string | null;
}
export interface LiveTally {
  groups: Record<Direction, EvidenceItem[]>;
  counted: number; // items on the board (finished, read ok, with a known direction)
  noDirection: number; // read ok but no (known) direction
  failed: number; // read failed: never on the board
  uncertain: number; // finished ok reads where the two models disagreed
  pooled: number; // board items with an SR/MA design
  total: number; // slots.length
}

const isRead = (sl: ReaderSlot): boolean => sl.state === "ok" || sl.state === "uncertain";

/** The board: finished reads grouped by direction in the order they finished (doneKey). */
export function liveTally(s: Scene): LiveTally {
  const groups = { positive: [], negative: [], null: [], mixed: [], unclear: [] } as Record<Direction, EvidenceItem[]>;
  let counted = 0;
  let noDirection = 0;
  let failed = 0;
  let uncertain = 0;
  let pooled = 0;
  const done = s.slots
    .filter((sl) => sl.state === "failed" || isRead(sl))
    .sort((a, b) => (a.doneKey ?? 0) - (b.doneKey ?? 0));
  for (const sl of done) {
    if (sl.state === "failed") { failed++; continue; }
    if (sl.state === "uncertain") uncertain++;
    if (sl.direction === null || sl.ref === null) { noDirection++; continue; }
    groups[sl.direction].push({
      ref: sl.ref, direction: sl.direction, design: sl.design, uncertain: sl.state === "uncertain",
      key: sl.doneKey ?? 0, title: sl.title,
    });
    counted++;
    if (isPooledDesign(sl.design)) pooled++;
  }
  return { groups, counted, noDirection, failed, uncertain, pooled, total: s.slots.length };
}
