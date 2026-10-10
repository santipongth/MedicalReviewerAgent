// Pure layout geometry for the live "agent stage": where nodes, edges, details and reader slots sit in the SVG viewBox.
// No React, no DOM. segX/segY run once per animation frame and must not allocate.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
// The arc formula (lifted midpoint, quadratic control through it) is adapted from the AI-Agent-observatory project.
import { PIPELINE, type AgentId, type EdgeId } from "./agent-scene";

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type LayoutKind = "wide" | "narrow";
export type Anchor = "start" | "middle" | "end";
export interface Seg { a: Pt; c: Pt; b: Pt } // quadratic control through the lifted midpoint
/**
 * Composition. Wide: one centred row of uniform tiles spanning the viewBox, a single-line label and a count on fixed
 * baselines under every tile, then one detail band (`band.y` is its common top edge) whose blocks sit in their agent's
 * column: queries hang right-aligned from the plan tile, the eight sources list down from the search tile, the
 * screening bar is centred under screen, and the reader pool fills the read..finish columns. Narrow: a vertical lane
 * with every detail left-aligned in one column right of the spine (x = 70), under its agent's label.
 */
export interface StageLayout {
  kind: LayoutKind; width: number; height: number; // viewBox
  nodes: Partial<Record<AgentId, Pt>>; // visible agents only
  label: Partial<Record<AgentId, "below" | "right">>;
  edges: { id: EdgeId; d: string; seg: Seg }[];
  band: { y: number; h: number } | null; // wide only: the detail band under the node row (narrow details follow the lane)
  /** Source list: status dot centre `at`, name baseline start `text` (12px, <= 100px wide). */
  satellites: { label: string; at: Pt; text: Pt }[];
  /** One row per query (max 4 + "+n"); text is right-aligned (wide) or left-aligned (narrow) inside its row. */
  queryChips: Rect[]; queryAlign: "start" | "end";
  /** Segments of the screening bar, one per expected batch (max 10). */
  batchChips: Rect[];
  slots: Pt[]; slotR: number;
  zone: Partial<Record<AgentId, Rect>>;
  /** Caption anchors: the screening split ("ผ่าน n · ตัดออก n") and the indeterminate synth caption (stacked = two lines). */
  notes: { screen: Pt & { anchor: Anchor }; synth: Pt & { anchor: Anchor; stacked: boolean } };
}
export interface LayoutOpts { showLocalize: boolean; showExternal: boolean; slots: number; batches: number; queries: number }

/** Search engines configured for SearXNG (backend/app/config.py `searxng_engines`), in display form. */
export const SATELLITES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"] as const;

const MAX_SLOTS = 30;
const MAX_QUERY_CHIPS = 4;
const MAX_BATCH_CHIPS = 10;
const HALF = 22; // half a 44px tile
const ROW = 18; // detail row pitch (12px text)
const TEXT_BASE = 13; // a detail row's text baseline below the row's top (dots sit 4px above it)
const POOL_COLS = 10;
const SLOT_PITCH = 28;
// Wide box: the height never depends on what the run turns on, so the page never shifts mid-run.
const LANE_Y = 62; // tile row centre; the headroom above holds the external node (when shown)
const EXT_RISE = 38; // external node centre above the row, nested in the gap between the read and synth tiles
const BAND_GAP = 72; // row centre -> band top: under the tiles (+22), labels (baseline +38) and counts (baseline +55)
const TAIL = 10; // under the band (the source list is its tallest block)
const BLOCK_H = 5 * ROW; // queries (4 + "+n") and the 3-row reader pool; the synth caption hangs under them
const BAR_W_WIDE = 84;
const BAR_W_NARROW = 96;
const SRC_W = 126; // wide source list width (dot + the longest name, "Semantic Scholar")
const SRC_COL = 140; // narrow: second source column offset
/** Reader slot radius and ref font: "P30" (about 3 x 0.6em at 11px) fits inside the ring, clear of its stroke. */
export const SLOT_R = 12;
export const REF_FONT = 11;
/** How many 12px code characters (~7.2px each) fit a query row of width `w`, after the check mark and padding. */
export const queryChars = (w: number): number => Math.max(0, Math.min(34, Math.floor((w - 20) / 7.2)));

export function arc(a: Pt, b: Pt, bend = 0.18): Seg {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  // horizontal-ish edges bulge up (-y), vertical-ish edges bulge right (+x)
  if (Math.abs(dx) >= Math.abs(dy) ? ny > 0 : nx < 0) { nx = -nx; ny = -ny; }
  const lift = len * bend + 6;
  const mx = (a.x + b.x) / 2 + nx * lift;
  const my = (a.y + b.y) / 2 + ny * lift;
  return { a: { x: a.x, y: a.y }, c: { x: 2 * mx - (a.x + b.x) / 2, y: 2 * my - (a.y + b.y) / 2 }, b: { x: b.x, y: b.y } };
}

const f1 = (n: number): string => (Math.round(n * 10) / 10 + 0).toFixed(1);

export function segPath(s: Seg): string {
  return `M ${f1(s.a.x)} ${f1(s.a.y)} Q ${f1(s.c.x)} ${f1(s.c.y)} ${f1(s.b.x)} ${f1(s.b.y)}`;
}

export function segX(s: Seg, t: number): number {
  const u = 1 - t;
  return u * u * s.a.x + 2 * u * t * s.c.x + t * t * s.b.x;
}

export function segY(s: Seg, t: number): number {
  const u = 1 - t;
  return u * u * s.a.y + 2 * u * t * s.c.y + t * t * s.b.y;
}

export function clip(text: string, max: number): string {
  if (max <= 0) return "…";
  return text.length > max ? `${text.slice(0, Math.max(max - 1, 0))}…` : text;
}

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : 0)));

function visibleAgents(o: LayoutOpts): AgentId[] {
  return PIPELINE.filter((id) => id !== "localize" || o.showLocalize);
}

/** `maxLift` caps the midpoint offset: wide arcs stay low over the row, narrow ones never bulge into the details. */
function buildEdges(vis: AgentId[], nodes: Partial<Record<AgentId, Pt>>, showExternal: boolean, maxLift = Infinity): StageLayout["edges"] {
  const pairs: [AgentId, AgentId][] = [];
  for (let i = 1; i < vis.length; i++) pairs.push([vis[i - 1], vis[i]]);
  if (showExternal) pairs.push(["read", "external"], ["external", "synth"]);
  return pairs.map(([p, q]) => {
    const a = nodes[p]!;
    const b = nodes[q]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const seg = arc(a, b, Math.min(0.18, Math.max(0, (maxLift - 6) / len)));
    return { id: `${p}>${q}` as EdgeId, d: segPath(seg), seg };
  });
}

function wideLayout(o: LayoutOpts): StageLayout {
  const width = 960;
  const margin = 48;
  const laneY = LANE_Y;
  const bandY = laneY + BAND_GAP;
  const bandH = SATELLITES.length * ROW; // one row per source; the query rows and the reader pool are shorter
  const vis = visibleAgents(o);
  const step = (width - 2 * margin) / (vis.length - 1);
  const nodes: Partial<Record<AgentId, Pt>> = {};
  const label: Partial<Record<AgentId, "below" | "right">> = {};
  vis.forEach((id, i) => { nodes[id] = { x: margin + i * step, y: laneY }; label[id] = "below"; });
  const zone: Partial<Record<AgentId, Rect>> = {};

  // queries: rows right-aligned to the plan tile's right edge, as wide as guard..plan (max 4 + "+n")
  const q = clampInt(o.queries, 0, 1000);
  const nq = q > MAX_QUERY_CHIPS ? MAX_QUERY_CHIPS + 1 : q;
  const queryChips: Rect[] = [];
  const qx0 = nodes.guard!.x - HALF;
  const qx1 = nodes.plan!.x + HALF;
  for (let i = 0; i < nq; i++) queryChips.push({ x: qx0, y: bandY + i * ROW, w: qx1 - qx0, h: ROW });
  if (nq > 0) zone.plan = { x: qx0 - 6, y: bandY - 6, w: qx1 - qx0 + 12, h: nq * ROW + 10 };

  // sources: a list hanging from the search tile's left edge
  const sx = nodes.search!.x - HALF;
  const satellites = SATELLITES.map((name, i) => {
    const base = bandY + TEXT_BASE + i * ROW;
    return { label: name, at: { x: sx + 4, y: base - 4 }, text: { x: sx + 14, y: base } };
  });
  zone.search = { x: sx - 6, y: bandY - 6, w: SRC_W, h: SATELLITES.length * ROW + 10 };

  // screening: one segmented bar centred under screen, the kept/cut split under it
  const nb = clampInt(o.batches, 0, MAX_BATCH_CHIPS);
  const batchChips: Rect[] = [];
  const screen = nodes.screen!;
  const bw = BAR_W_WIDE;
  for (let i = 0; i < nb; i++) {
    const w = (bw - (nb - 1) * 2) / nb;
    batchChips.push({ x: screen.x - bw / 2 + i * (w + 2), y: bandY + 4, w, h: 8 });
  }
  // the tint wraps the bar only: the kept/cut caption appears once screen is done, when the tint has moved on
  if (nb > 0) zone.screen = { x: screen.x - bw / 2 - 8, y: bandY - 6, w: bw + 16, h: 24 };

  // reader pool: 10 columns centred on the read..finish columns (clamped to the row's right edge); a partial pool
  // fills from the same origin, so slots never move as papers arrive
  const ns = clampInt(o.slots, 0, MAX_SLOTS);
  const slots: Pt[] = [];
  const full = POOL_COLS * SLOT_PITCH;
  const fin = nodes.finish!;
  const px0 = Math.min((nodes.read!.x + fin.x) / 2 - full / 2, fin.x + HALF - full);
  for (let i = 0; i < ns; i++) {
    slots.push({ x: px0 + SLOT_PITCH / 2 + (i % POOL_COLS) * SLOT_PITCH, y: bandY + 14 + Math.floor(i / POOL_COLS) * SLOT_PITCH });
  }
  if (ns > 0) {
    const cols = Math.min(ns, POOL_COLS);
    zone.read = { x: px0 - 6, y: bandY - 6, w: cols * SLOT_PITCH + 12, h: Math.ceil(ns / POOL_COLS) * SLOT_PITCH + 10 };
  }

  if (o.showExternal) {
    // In the headroom the box always keeps, centred on the gap between the read and synth tiles (so the tiles stay
    // horizontally clear) and high enough that the read>synth arc passes under it; its label runs right, above the
    // synth tile. Below the row is the detail band, which edges must not cross.
    nodes.external = { x: (nodes.read!.x + nodes.synth!.x) / 2, y: laneY - EXT_RISE };
    label.external = "right";
  }
  return {
    kind: "wide", width, height: bandY + bandH + TAIL, nodes, label, edges: buildEdges(vis, nodes, o.showExternal, 10),
    band: { y: bandY, h: bandH }, satellites, queryChips, queryAlign: "end", batchChips, slots, slotR: SLOT_R, zone,
    notes: {
      screen: { x: screen.x, y: bandY + TEXT_BASE + ROW - 1, anchor: "middle" }, // the row under the bar
      synth: { x: px0 + full / 2, y: bandY + BLOCK_H + 18, anchor: "middle", stacked: false },
    },
  };
}

function narrowLayout(o: LayoutOpts): StageLayout {
  const width = 360;
  const laneX = 36;
  const zx = 70;
  const zw = 280;
  const vis = visibleAgents(o);
  const q = clampInt(o.queries, 0, 1000);
  const nq = q > MAX_QUERY_CHIPS ? MAX_QUERY_CHIPS + 1 : q;
  const nb = clampInt(o.batches, 0, MAX_BATCH_CHIPS);
  const ns = clampInt(o.slots, 0, MAX_SLOTS);

  const nodes: Partial<Record<AgentId, Pt>> = {};
  const label: Partial<Record<AgentId, "below" | "right">> = {};
  const zone: Partial<Record<AgentId, Rect>> = {};
  const queryChips: Rect[] = [];
  const batchChips: Rect[] = [];
  const slots: Pt[] = [];
  let satellites: StageLayout["satellites"] = [];
  const bw = BAR_W_NARROW;
  let screenNote: Pt = { x: zx + bw + 12, y: 0 }; // the split follows the bar on its line
  let synthNote: Pt = { x: zx, y: 0 };

  let y = 34;
  for (const id of vis) {
    nodes[id] = { x: laneX, y };
    label[id] = "right";
    const zy = y + 30; // details start under the right-hand label and count lines
    let zh = 0;
    if (id === "plan" && nq > 0) {
      for (let i = 0; i < nq; i++) queryChips.push({ x: zx, y: zy + i * ROW, w: zw, h: ROW });
      zh = nq * ROW;
    } else if (id === "search") {
      // two columns (4 + 4) of status dot + name, so the names never meet
      satellites = SATELLITES.map((name, i) => {
        const base = zy + TEXT_BASE + (i % 4) * ROW;
        const x = zx + Math.floor(i / 4) * SRC_COL;
        return { label: name, at: { x: x + 4, y: base - 4 }, text: { x: x + 14, y: base } };
      });
      zh = 4 * ROW;
    } else if (id === "screen" && nb > 0) {
      for (let i = 0; i < nb; i++) {
        const w = (bw - (nb - 1) * 2) / nb;
        batchChips.push({ x: zx + i * (w + 2), y: zy + 5, w, h: 8 });
      }
      screenNote = { x: screenNote.x, y: zy + TEXT_BASE };
      zh = ROW;
    } else if (id === "read" && ns > 0) {
      for (let i = 0; i < ns; i++) {
        slots.push({ x: zx + SLOT_R + (i % POOL_COLS) * SLOT_PITCH, y: zy + 14 + Math.floor(i / POOL_COLS) * SLOT_PITCH });
      }
      zh = Math.ceil(ns / POOL_COLS) * SLOT_PITCH;
    } else if (id === "synth") {
      synthNote = { x: zx, y: zy + 12 };
      zh = 30; // reserved for the two-line caption, so nothing shifts when it appears
    }
    if (zh > 0 && id !== "synth") zone[id] = { x: zx - 6, y: zy - 6, w: zw + 12, h: zh + 10 };
    let next = y + (zh > 0 ? 30 + zh + 34 : 64); // the next tile (22px above its centre) clears this detail by >= 12px
    if (id === "read" && o.showExternal) {
      // side node kept in the lane (below the pool) so its edges never cross the zones; synth follows
      nodes.external = { x: laneX, y: next };
      label.external = "right";
      next += 64;
    }
    y = next;
  }
  const last = nodes.finish!;
  return {
    kind: "narrow", width, height: last.y + 40, nodes, label,
    edges: buildEdges(vis, nodes, o.showExternal, 10), band: null, satellites,
    queryChips, queryAlign: "start", batchChips, slots, slotR: SLOT_R, zone,
    notes: { screen: { ...screenNote, anchor: "start" }, synth: { ...synthNote, anchor: "start", stacked: true } },
  };
}

export function layoutFor(kind: LayoutKind, o: LayoutOpts): StageLayout {
  return kind === "wide" ? wideLayout(o) : narrowLayout(o);
}
