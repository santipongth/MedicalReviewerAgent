// Citation network (Plan 14b): which papers of this review cite each other, laid out without any simulation.
// Pure and deterministic. x = publication year (papers with no year sit in their own column at the left), y = lanes
// inside each year (design order, then ref). Edges come only from result.citations (citing -> cited, both in this
// review); a paper whose coverage is null has no data, which is not the same as "cites nothing". Counts are plain counts
// from OpenAlex / Europe PMC, never numbers read from a paper.
import { designKey, designLabel } from "./charts-data";
import { DESIGN_LABEL, type Lang } from "./i18n";
import { surnameOf } from "./author";
import type { Citations, Paper } from "./types";

export type CitationSource = "openalex" | "europepmc";

/** Coarse design groups that colour the nodes (neutral tones: direction colours are reserved for directions). */
export type DesignGroup = "trial" | "observational" | "review";
export const DESIGN_GROUPS: DesignGroup[] = ["trial", "observational", "review"];

export interface NetNode {
  ref: string;
  title: string;
  byline: string;
  year: number | null;
  /** Design category key ("" when the paper has no card). */
  design: string;
  designText: string;
  group: DesignGroup;
  /** Cited-by count over all literature, and where it comes from (null: no count). */
  citedBy: number | null;
  citedBySource: CitationSource | null;
  /** Where the reference list came from; null = no data (not "cites nothing"). */
  coverage: CitationSource | null;
  /** Papers of this review this one cites, and those citing it (natural ref order). */
  cites: string[];
  citedByIn: string[];
  /** Layout: x on the year axis (the unknown-year column has its own value), lane index inside the column. */
  x: number;
  lane: number;
  /** Marker diameter in px (sqrt of the cited-by count, capped). */
  size: number;
}

export interface CitationNetwork {
  nodes: NetNode[];
  edges: { from: string; to: string }[];
  /** Year axis: first and last year present (null when no paper has a year). */
  minYear: number | null;
  maxYear: number | null;
  /** x of the "unknown year" column, or null when every paper has a year. */
  unknownX: number | null;
  /** Axis label positions (years, plus the unknown column when present). */
  ticks: number[];
  /** Axis range. */
  xMin: number;
  xMax: number;
  /** Tallest column (number of lanes). */
  lanes: number;
  /** Number of distinct x columns (for the minimum drawing width). */
  columns: number;
  covered: number;
  total: number;
  /** The lookup timed out and the data is partial. */
  partial: boolean;
}

const SIZE_MIN = 12;
const SIZE_MAX = 30;
/** Counts at or above this get the largest marker. */
export const CITED_BY_CAP = 1000;
const MAX_TICKS = 6;

const refNumber = (ref: string) => Number(/\d+/.exec(ref)?.[0] ?? Number.MAX_SAFE_INTEGER);
const byRef = (a: string, b: string) => refNumber(a) - refNumber(b) || a.localeCompare(b);
const DESIGN_ORDER = Object.keys(DESIGN_LABEL.th);

export function designGroup(design: string): DesignGroup {
  if (design === "rct" || design === "non_randomized_trial") return "trial";
  if (design.startsWith("sr_ma") || design === "narrative_review") return "review";
  return "observational";
}

export function markerSize(citedBy: number | null): number {
  if (citedBy == null || citedBy <= 0) return SIZE_MIN;
  const f = Math.sqrt(Math.min(citedBy, CITED_BY_CAP) / CITED_BY_CAP);
  return Math.round(SIZE_MIN + (SIZE_MAX - SIZE_MIN) * f);
}

const PARTIAL = /partial: the lookup timed out/i;

export function isPartial(c: Citations | null | undefined): boolean {
  return !!c && PARTIAL.test(c.source_note ?? "");
}

const isSource = (s: unknown): s is CitationSource => s === "openalex" || s === "europepmc";

/** Year step for axis labels: every year up to MAX_TICKS columns, else a round step. */
function yearStep(span: number): number {
  for (const s of [1, 2, 5, 10, 20, 50]) if (Math.floor(span / s) + 1 <= MAX_TICKS) return s;
  return 100;
}

/** Network of the given (filtered) papers; edges are kept only when both ends are among them. */
export function citationNetwork(papers: Paper[], citations: Citations, lang: Lang): CitationNetwork {
  const refs = new Set(papers.map((p) => p.ref));
  const seen = new Set<string>();
  const edges = (citations.edges ?? []).filter((e) => {
    const key = `${e.from}\u0000${e.to}`;
    if (e.from === e.to || !refs.has(e.from) || !refs.has(e.to) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const years = papers.map((p) => p.year).filter((y): y is number => typeof y === "number" && Number.isFinite(y));
  const minYear = years.length ? Math.min(...years) : null;
  const maxYear = years.length ? Math.max(...years) : null;
  const span = minYear != null && maxYear != null ? maxYear - minYear : 0;
  const step = yearStep(span);
  const hasUnknown = papers.some((p) => p.year == null || !Number.isFinite(p.year));
  // The unknown column sits one label step (at least 1.5 years) left of the first year, so it never reads as a year.
  const gap = Math.max(1.5, step);
  const unknownX = hasUnknown ? (minYear ?? 0) - gap : null;

  const nodes: NetNode[] = papers.map((p) => {
    const card = p.card_en ?? p.card;
    const design = card ? designKey(card) : "";
    const citedBy = citations.cited_by?.[p.ref];
    const count = typeof citedBy === "number" && Number.isFinite(citedBy) ? citedBy : null;
    const src = citations.cited_by_source?.[p.ref];
    const cov = citations.coverage?.[p.ref];
    const year = typeof p.year === "number" && Number.isFinite(p.year) ? p.year : null;
    return {
      ref: p.ref, title: p.title, byline: [surnameOf(p.authors?.[0]), year].filter(Boolean).join(" "), year,
      design, designText: design ? designLabel(design, lang) : lang === "th" ? "ไม่ทราบรูปแบบ" : "Design unknown",
      group: designGroup(design),
      citedBy: count,
      // An older block has no cited_by_source; a count then came from OpenAlex (the only source before the fallback).
      citedBySource: count == null ? null : isSource(src) ? src : citations.cited_by_source ? null : "openalex",
      coverage: isSource(cov) ? cov : null,
      cites: edges.filter((e) => e.from === p.ref).map((e) => e.to).sort(byRef),
      citedByIn: edges.filter((e) => e.to === p.ref).map((e) => e.from).sort(byRef),
      x: year ?? unknownX ?? 0, lane: 0, size: markerSize(count),
    };
  });

  // Lanes: inside each column, design order (then free-text designs, then none), then ref.
  const rank = (d: string) => { const i = DESIGN_ORDER.indexOf(d); return i >= 0 ? i : d ? DESIGN_ORDER.length : DESIGN_ORDER.length + 1; };
  const columns = new Map<number, NetNode[]>();
  for (const n of nodes) columns.set(n.x, [...(columns.get(n.x) ?? []), n]);
  for (const col of columns.values()) {
    col.sort((a, b) => rank(a.design) - rank(b.design) || a.design.localeCompare(b.design) || byRef(a.ref, b.ref));
    col.forEach((n, i) => { n.lane = i; });
  }

  const ticks: number[] = [];
  if (unknownX != null) ticks.push(unknownX);
  if (minYear != null && maxYear != null) {
    const first = Math.ceil(minYear / step) * step;
    const set = new Set<number>([minYear, maxYear]);
    for (let y = first; y <= maxYear; y += step) set.add(y);
    // Drop a round year that would crowd the first or last label.
    const sorted = [...set].sort((a, b) => a - b).filter((y) => y === minYear || y === maxYear || (y - minYear >= step / 2 && maxYear - y >= step / 2));
    ticks.push(...sorted);
  }
  const lo = unknownX ?? minYear ?? 0;
  const hi = maxYear ?? lo;
  const pad = Math.max(0.6, (hi - lo) * 0.06);
  const covered = nodes.filter((n) => n.coverage).length;
  return {
    nodes: [...nodes].sort((a, b) => byRef(a.ref, b.ref)), edges, minYear, maxYear, unknownX, ticks,
    xMin: lo - pad, xMax: hi + pad,
    lanes: Math.max(1, ...[...columns.values()].map((c) => c.length)), columns: columns.size,
    covered, total: nodes.length, partial: isPartial(citations),
  };
}

export interface EdgeCurve {
  from: string;
  to: string;
  /** ECharts lineStyle.curveness (control point offset = curveness × chord length). */
  curveness: number;
  /** Bulge of the arc from its chord, in px. */
  peak: number;
  /** Which side the arc bulges to: right-to-left edges bend below, left-to-right above (ECharts' convention). */
  side: "below" | "above" | "side";
}

const BASE_CURVE = 0.12;
const MAX_CURVE = 0.6;
/** Clearance from a marker's centre that an arc keeps when it passes one (largest radius + room for its label). */
export const ARC_CLEARANCE = 26;

/**
 * Curveness per edge so a long arc clears the markers it passes: for every other marker near the straight chord, the
 * quadratic arc's offset at that point (2·c·L·t(1−t)) must reach ARC_CLEARANCE. `pxPerYear` and `lanePx` estimate the
 * drawing scale. Short edges with nothing in between keep a slight bend.
 */
export function edgeCurves(net: CitationNetwork, pxPerYear: number, lanePx: number): EdgeCurve[] {
  const at = new Map(net.nodes.map((n) => [n.ref, n]));
  return net.edges.map(({ from, to }) => {
    const a = at.get(from)!;
    const b = at.get(to)!;
    const ax = a.x * pxPerYear, ay = a.lane * lanePx, bx = b.x * pxPerYear, by = b.lane * lanePx;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let curveness = BASE_CURVE;
    for (const n of net.nodes) {
      if (n === a || n === b) continue;
      const nx = n.x * pxPerYear - ax, ny = n.lane * lanePx - ay;
      const t = (nx * dx + ny * dy) / (len * len);
      if (t <= 0 || t >= 1) continue;
      const dist = Math.abs(nx * dy - ny * dx) / len;
      if (dist >= ARC_CLEARANCE) continue;
      curveness = Math.max(curveness, ARC_CLEARANCE / (2 * len * t * (1 - t)));
    }
    curveness = Math.min(MAX_CURVE, curveness);
    return { from, to, curveness, peak: (curveness * len) / 2, side: dx < 0 ? "below" : dx > 0 ? "above" : "side" };
  });
}

export interface CitedByCell {
  count: number | null;
  source: CitationSource | null;
}

/** The literature matrix's "cited by" value for one paper (null count = no data). */
export function citedByCell(citations: Citations, ref: string): CitedByCell {
  const v = citations.cited_by?.[ref];
  const count = typeof v === "number" && Number.isFinite(v) ? v : null;
  const src = citations.cited_by_source?.[ref];
  return { count, source: count == null ? null : isSource(src) ? src : citations.cited_by_source ? null : "openalex" };
}

export const SOURCE_LABEL: Record<CitationSource, string> = { openalex: "OpenAlex", europepmc: "Europe PMC" };
/** Short visible tags for tight cells (the full name goes to screen readers and the title). */
export const SOURCE_ABBR: Record<CitationSource, string> = { openalex: "OA", europepmc: "EPMC" };
