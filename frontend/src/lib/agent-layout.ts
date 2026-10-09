// Pure layout geometry for the live "agent stage": where nodes, edges, chips and reader slots sit in the SVG viewBox.
// No React, no DOM. segX/segY run once per animation frame and must not allocate.
// The arc formula (lifted midpoint, quadratic control through it) is adapted from the AI-Agent-observatory project.
import { PIPELINE, type AgentId, type EdgeId } from "./agent-scene";

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type LayoutKind = "wide" | "narrow";
export interface Seg { a: Pt; c: Pt; b: Pt } // quadratic control through the lifted midpoint
export interface StageLayout {
  kind: LayoutKind; width: number; height: number; // viewBox
  nodes: Partial<Record<AgentId, Pt>>; // visible agents only
  label: Partial<Record<AgentId, "below" | "right">>;
  edges: { id: EdgeId; d: string; seg: Seg }[];
  satellites: { label: string; at: Pt }[];
  queryChips: Rect[]; batchChips: Rect[]; slots: Pt[]; zone: Partial<Record<AgentId, Rect>>;
}
export interface LayoutOpts { showLocalize: boolean; showExternal: boolean; slots: number; batches: number; queries: number }

/** Search engines configured for SearXNG (backend/app/config.py `searxng_engines`), in display form. */
export const SATELLITES = ["PubMed", "arXiv", "Semantic Scholar", "OpenAlex", "Crossref"] as const;

const MAX_SLOTS = 30;
const MAX_QUERY_CHIPS = 4;
const MAX_BATCH_CHIPS = 10;

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

function buildEdges(vis: AgentId[], nodes: Partial<Record<AgentId, Pt>>, showExternal: boolean): StageLayout["edges"] {
  const pairs: [AgentId, AgentId][] = [];
  for (let i = 1; i < vis.length; i++) pairs.push([vis[i - 1], vis[i]]);
  if (showExternal) pairs.push(["read", "external"], ["external", "synth"]);
  return pairs.map(([p, q]) => {
    const seg = arc(nodes[p]!, nodes[q]!);
    return { id: `${p}>${q}` as EdgeId, d: segPath(seg), seg };
  });
}

function wideLayout(o: LayoutOpts): StageLayout {
  const width = 960;
  const height = 420;
  const laneY = 96;
  const margin = 60;
  const zoneY = 170;
  const vis = visibleAgents(o);
  const step = (width - 2 * margin) / (vis.length - 1);
  const nodes: Partial<Record<AgentId, Pt>> = {};
  const label: Partial<Record<AgentId, "below" | "right">> = {};
  vis.forEach((id, i) => { nodes[id] = { x: margin + i * step, y: laneY }; label[id] = "below"; });
  const zone: Partial<Record<AgentId, Rect>> = {};

  // query chips under plan (max 4 + "+n")
  const q = clampInt(o.queries, 0, 1000);
  const nq = q > MAX_QUERY_CHIPS ? MAX_QUERY_CHIPS + 1 : q;
  const queryChips: Rect[] = [];
  const plan = nodes.plan!;
  for (let i = 0; i < nq; i++) queryChips.push({ x: plan.x - 42, y: zoneY + i * 22, w: 84, h: 18 });
  if (nq > 0) zone.plan = { x: plan.x - 46, y: zoneY - 4, w: 92, h: nq * 22 + 4 };

  // satellites on an arc above search
  const search = nodes.search!;
  const satellites = SATELLITES.map((name, i) => {
    const ang = (-150 + i * 30) * (Math.PI / 180);
    return { label: name, at: { x: search.x + 58 * Math.cos(ang), y: search.y + 58 * Math.sin(ang) } };
  });
  zone.search = { x: search.x - 64, y: laneY - 64, w: 128, h: 42 };

  // batch chips under screen (max 10, 2 rows of 5)
  const nb = clampInt(o.batches, 0, MAX_BATCH_CHIPS);
  const batchChips: Rect[] = [];
  const screen = nodes.screen!;
  for (let i = 0; i < nb; i++) batchChips.push({ x: screen.x - 45 + (i % 5) * 18, y: zoneY + Math.floor(i / 5) * 18, w: 16, h: 16 });
  if (nb > 0) zone.screen = { x: screen.x - 48, y: zoneY - 4, w: 96, h: Math.ceil(nb / 5) * 18 + 4 };

  // reader pool under read/synth (6 cols x 5 rows, 26px pitch)
  const ns = clampInt(o.slots, 0, MAX_SLOTS);
  const slots: Pt[] = [];
  const cx = (nodes.read!.x + nodes.synth!.x) / 2;
  for (let i = 0; i < ns; i++) slots.push({ x: cx - 65 + (i % 6) * 26, y: zoneY + 15 + Math.floor(i / 6) * 26 });
  if (ns > 0) zone.read = { x: cx - 78, y: zoneY, w: 156, h: Math.ceil(ns / 6) * 26 + 4 };

  if (o.showExternal) {
    nodes.external = { x: nodes.read!.x - 70, y: 350 };
    label.external = "below";
    zone.external = { x: nodes.external.x - 30, y: 326, w: 60, h: 80 };
  }
  return { kind: "wide", width, height, nodes, label, edges: buildEdges(vis, nodes, o.showExternal), satellites, queryChips, batchChips, slots, zone };
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

  let y = 36;
  for (const id of vis) {
    nodes[id] = { x: laneX, y };
    label[id] = "right";
    const zy = y + 20; // zones start below the (right-hand) label
    let zh = 0;
    if (id === "plan" && nq > 0) {
      for (let i = 0; i < nq; i++) queryChips.push({ x: zx, y: zy + i * 22, w: zw, h: 18 });
      zh = nq * 22;
    } else if (id === "search") {
      zh = 40;
      satellites = SATELLITES.map((name, i) => ({ label: name, at: { x: zx + 28 + i * 56, y: zy + 10 } }));
    } else if (id === "screen" && nb > 0) {
      for (let i = 0; i < nb; i++) batchChips.push({ x: zx + i * 27, y: zy, w: 24, h: 18 });
      zh = 22;
    } else if (id === "read" && ns > 0) {
      for (let i = 0; i < ns; i++) slots.push({ x: zx + 15 + (i % 7) * 30, y: zy + 15 + Math.floor(i / 7) * 30 });
      zh = Math.ceil(ns / 7) * 30;
    }
    if (zh > 0) zone[id] = { x: zx, y: zy, w: zw, h: zh };
    let next = y + Math.max(76, zh + 50);
    if (id === "read" && o.showExternal) {
      // side node: right of the lane, below the pool; synth follows underneath
      const ey = next;
      nodes.external = { x: 120, y: ey };
      label.external = "right";
      zone.external = { x: 170, y: ey - 22, w: 180, h: 44 };
      next = ey + 60;
    }
    y = next;
  }
  const last = nodes.finish!;
  return {
    kind: "narrow", width, height: last.y + 44, nodes, label,
    edges: buildEdges(vis, nodes, o.showExternal), satellites, queryChips, batchChips, slots, zone,
  };
}

export function layoutFor(kind: LayoutKind, o: LayoutOpts): StageLayout {
  return kind === "wide" ? wideLayout(o) : narrowLayout(o);
}
