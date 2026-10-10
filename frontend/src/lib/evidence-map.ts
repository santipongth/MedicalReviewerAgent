// Evidence map (scoping reviews): how many studies exist per concept, design and period.
// Pure counts of papers; no number is read from or computed about a paper's results.
import { designKey, designLabel } from "./charts-data";
import { DESIGN_LABEL, type Lang } from "./i18n";
import type { ComparisonRow, Paper } from "./types";

export interface MapRow {
  key: string;
  label: string;
  counts: Record<string, number>;
  total: number;
}

export interface MapTable {
  designs: { key: string; label: string }[];
  rows: MapRow[];
}

export interface EvidenceMap {
  byConcept: MapTable;
  byYear: MapTable;
  /** Papers missing from the year table (no card, so no design, or no year). */
  unplaced: number;
  /** Papers with a card that appear in no concept row of the first table. */
  outsideConcepts: number;
}

export const EMPTY_MAP: EvidenceMap = { byConcept: { designs: [], rows: [] }, byYear: { designs: [], rows: [] }, unplaced: 0, outsideConcepts: 0 };

const DESIGN_ORDER = Object.keys(DESIGN_LABEL.th);

function orderedDesigns(keys: Set<string>, lang: Lang): MapTable["designs"] {
  const known = DESIGN_ORDER.filter((k) => keys.has(k));
  const other = [...keys].filter((k) => !DESIGN_ORDER.includes(k)).sort();
  return [...known, ...other].map((key) => ({ key, label: designLabel(key, lang) }));
}

function table(rows: MapRow[], lang: Lang): MapTable {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.counts)) keys.add(k);
  return { designs: orderedDesigns(keys, lang), rows };
}

/** The design key of a paper, or null when it was not read (no card). */
function paperDesign(p: Paper | undefined): string | null {
  const card = p?.card_en ?? p?.card;
  return card ? designKey(card) : null;
}

/** The tint step (0 = none, 1–4) of a count on a one-hue ramp up to the table's largest count; the number is always shown too. */
export function rampLevel(n: number | undefined, max: number): number {
  if (!n || n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * n) / max)));
}

export function yearBin(year: number): { key: string; label: string } {
  const start = Math.floor(year / 5) * 5;
  return { key: String(start), label: `${start}–${start + 4}` };
}

/**
 * Rows are the comparison rows (concepts/aspects), columns the design categories present, plus a total.
 * Only the given papers count (so report filters apply); a paper counts once per row.
 */
export function evidenceMap(papers: Paper[], comparison: ComparisonRow[], lang: Lang): EvidenceMap {
  const byRef = new Map(papers.map((p) => [p.ref, p]));
  const conceptRows: MapRow[] = [];
  const inConcepts = new Set<string>();
  for (const [index, row] of comparison.entries()) {
    const seen = new Set<string>();
    const counts: Record<string, number> = {};
    for (const cell of row.cells) {
      const paper = byRef.get(cell.ref);
      if (!paper || seen.has(cell.ref)) continue;
      seen.add(cell.ref);
      inConcepts.add(cell.ref);
      const d = paperDesign(paper) ?? cell.design_category ?? "other";
      counts[d] = (counts[d] ?? 0) + 1;
    }
    if (seen.size) conceptRows.push({ key: `${index}:${row.outcome}`, label: row.outcome, counts, total: seen.size });
  }
  conceptRows.sort((a, b) => b.total - a.total); // most studies first (stable: ties keep the synthesis order)

  const bins = new Map<string, MapRow>();
  let unplaced = 0;
  for (const p of papers) {
    const d = paperDesign(p);
    if (d == null || p.year == null) { unplaced += 1; continue; }
    const { key, label } = yearBin(p.year);
    const row = bins.get(key) ?? { key, label, counts: {}, total: 0 };
    row.counts[d] = (row.counts[d] ?? 0) + 1;
    row.total += 1;
    bins.set(key, row);
  }
  const yearRows = [...bins.values()].sort((a, b) => Number(a.key) - Number(b.key));
  const outsideConcepts = papers.filter((p) => paperDesign(p) != null && !inConcepts.has(p.ref)).length;
  return { byConcept: table(conceptRows, lang), byYear: table(yearRows, lang), unplaced, outsideConcepts };
}
