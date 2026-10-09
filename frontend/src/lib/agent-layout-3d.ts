// Pure 3D layout for the optional 3D agent stage: node positions, edge curves, reader-pool slots, evidence piles,
// the tray under them, and bounds. Plain tuples only (no three import) so it stays tiny, testable and out of every
// eager chunk.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
// The arc formula (lifted midpoint, quadratic control through it) is adapted from the AI-Agent-observatory project.
import { PIPELINE, type AgentId, type EdgeId } from "./agent-scene";
import { DIRECTION_ORDER } from "./i18n";
import type { Direction } from "./types";

export type Vec3 = [number, number, number];
export interface Seg3 { a: Vec3; c: Vec3; b: Vec3 } // quadratic control through the lifted midpoint
export interface Tray3D { y: number; x0: number; x1: number; z0: number; z1: number }
export interface Layout3D {
  nodes: Partial<Record<AgentId, Vec3>>; // visible agents only
  edges: { id: EdgeId; seg: Seg3 }[];
  slots: Vec3[];
  piles: Record<Direction, Vec3> | null; // base of each direction's pile; null while there are no slots
  tray: Tray3D | null; // flat plane under the pool and the piles; null while there are no slots
  frame: Vec3[]; // what the camera must keep in view: geometry plus the room DOM labels take (see layout3dFor)
  bounds: { min: Vec3; max: Vec3 }; // box around every frame point
}
export interface Layout3DOpts { showLocalize: boolean; showExternal: boolean; slots: number }

const MAX_SLOTS = 30;
const STEP = 1.9; // spacing between lane agents along x
const CURVE = 0.008; // z = -CURVE * x^2 (a gentle bow: a deeper curve crowded the two end nodes in perspective)
const EXTERNAL_Y = 1.6;
// Far enough below the lane that the read label's count never sits on the pool.
export const POOL_Y = -2.3;
// The pool, piles and tray sit this far in front of the lane: closer to the camera they draw larger (the fit is
// bound by the lane's width, so the stage's spare height takes the shift), and full piles (10 tokens high) stay clear
// of the synth label above them on screen.
export const POOL_FORWARD = 1.6;
const POOL_COLS = 6;
const POOL_PITCH = 0.35;
/** Half-extent of the largest reader-pool silhouette (sphere radius 0.12 x the 1.5 uncertain scale). */
export const SLOT_HALF = 0.18;

// --- evidence piles: one pile per direction, tokens stacked 10 high, later tokens start stacks further back -------
// 0.6, not 0.4: at the fitted distance (~45 px per unit) a 0.4 pitch put the per-pile DOM labels (glyph / count /
// flag count) on top of each other.
export const PILE_PITCH = 0.6;
// Tokens are ~0.2 tall (1.5x the first cut); a 0.15 rise keeps a stack reading as one column without growing a full
// pile much taller.
export const PILE_RISE = 0.15;
export const PILE_STACK = 10;
export const PILE_STACK_DZ = 0.3; // deeper than the widest token (0.24), so stacks behind never intersect
export const PILE_CAP = 30;
/** Half-width of the widest pile token (the flat "no association" bar is 0.33 wide). */
export const PILE_HALF = 0.165;
const PILE_FROM_SYNTH = 0.6; // first base starts near synth.x - 0.6 ...
const POOL_PILE_GAP = 0.2; // ... but never closer than this to the pool's silhouettes
const TRAY_PAD = 0.3;
const TRAY_DROP = 0.2;
const THOUGHT_HEADROOM = 0.9; // the floating thought label (centred 0.85 above its node) sits above the highest node

// Room the DOM labels take, in world units at the fitted distance (~39 px per unit across, ~30 px per unit of height
// on screen; 12px Thai text, 15px lines). Label anchors in model-3d.ts use the same constants, so framing and labels
// stay in step. The piles' caption hangs a fixed number of pixels under the pile labels (CSS), so it is framed here
// as part of PILE_LABEL_ROOM.
export const PILE_LABEL_DROP = 0.32; // top of a pile's label (and of the caption's box), below its base
export const PILE_LABEL_FORWARD = 0.2; // pile labels and caption sit slightly in front of the bases
export const POOL_LABEL_GAP = 0.25; // pool label's right edge, left of the pool's silhouettes
const NODE_LABEL_ROOM: [number, number] = [0.9, 2.1]; // half-width, depth below the node (up to 3 lines)
const THOUGHT_ROOM: [number, number] = [1.4, 1.2]; // half-width of a short thought label, top above its node
const SIDE_LABEL_ROOM = 2.4; // external node's label: to its left
const POOL_LABEL_ROOM: [number, number] = [3.9, 0.5]; // width (to the left), half-height
const PILE_LABEL_ROOM = 2.1; // 3-line pile labels (45px) plus the caption line under them
const CAPTION_HALF = 1.8; // half-width of the caption

export function arc3(a: Vec3, b: Vec3, bend = 0.18): Seg3 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const lift = len * bend + 0.6;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2 + lift;
  const mz = (a[2] + b[2]) / 2;
  return {
    a: [a[0], a[1], a[2]],
    c: [2 * mx - (a[0] + b[0]) / 2, 2 * my - (a[1] + b[1]) / 2, 2 * mz - (a[2] + b[2]) / 2],
    b: [b[0], b[1], b[2]],
  };
}

export function arc3X(s: Seg3, t: number): number {
  const u = 1 - t;
  return u * u * s.a[0] + 2 * u * t * s.c[0] + t * t * s.b[0];
}

export function arc3Y(s: Seg3, t: number): number {
  const u = 1 - t;
  return u * u * s.a[1] + 2 * u * t * s.c[1] + t * t * s.b[1];
}

export function arc3Z(s: Seg3, t: number): number {
  const u = 1 - t;
  return u * u * s.a[2] + 2 * u * t * s.c[2] + t * t * s.b[2];
}

/**
 * Position of token `i` (0-based, clamped to PILE_CAP - 1) of a direction's pile, written into `out` (no allocation;
 * called per frame). Tokens rise PILE_RISE each, PILE_STACK per stack; tokens 10-19 and 20-29 start new stacks
 * PILE_STACK_DZ and 2 x PILE_STACK_DZ further back. Returns null when the layout has no piles.
 */
export function pileSpot(layout: Layout3D, dir: Direction, i: number, out: Vec3): Vec3 | null {
  const base = layout.piles?.[dir];
  if (!base) return null;
  const k = Math.max(0, Math.min(PILE_CAP - 1, Math.floor(i)));
  const stack = Math.floor(k / PILE_STACK);
  out[0] = base[0];
  out[1] = base[1] + (k % PILE_STACK) * PILE_RISE;
  out[2] = base[2] - stack * PILE_STACK_DZ;
  return out;
}

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : 0)));

export function layout3dFor(o: Layout3DOpts): Layout3D {
  const vis = PIPELINE.filter((id) => id !== "localize" || o.showLocalize);
  const nodes: Partial<Record<AgentId, Vec3>> = {};
  vis.forEach((id, i) => {
    const x = (i - (vis.length - 1) / 2) * STEP;
    nodes[id] = [x, 0, -CURVE * x * x];
  });
  if (o.showExternal) {
    const r = nodes.read!;
    nodes.external = [r[0], EXTERNAL_Y, r[2]];
  }

  const pairs: [AgentId, AgentId][] = [];
  for (let i = 1; i < vis.length; i++) pairs.push([vis[i - 1], vis[i]]);
  if (o.showExternal) pairs.push(["read", "external"], ["external", "synth"]);
  const edges = pairs.map(([p, q]) => ({ id: `${p}>${q}` as EdgeId, seg: arc3(nodes[p]!, nodes[q]!) }));

  // reader pool: 6 columns on the y = POOL_Y plane, centred under read (x), POOL_FORWARD in front of it
  const ns = clampInt(o.slots, 0, MAX_SLOTS);
  const slots: Vec3[] = [];
  const read = nodes.read!;
  const synth = nodes.synth!;
  const cx = read[0];
  const cz = read[2] + POOL_FORWARD;
  const rows = Math.ceil(MAX_SLOTS / POOL_COLS);
  for (let i = 0; i < ns; i++) {
    const col = i % POOL_COLS;
    const row = Math.floor(i / POOL_COLS);
    slots.push([cx + (col - (POOL_COLS - 1) / 2) * POOL_PITCH, POOL_Y, cz + (row - (rows - 1) / 2) * POOL_PITCH]);
  }

  // evidence piles: five bases to the right of the pool, in DIRECTION_ORDER (a fixed order, never a ranking)
  let piles: Record<Direction, Vec3> | null = null;
  let tray: Tray3D | null = null;
  if (ns > 0) {
    const poolRight = cx + ((POOL_COLS - 1) / 2) * POOL_PITCH + SLOT_HALF;
    const x0 = Math.max(synth[0] - PILE_FROM_SYNTH, poolRight + POOL_PILE_GAP + PILE_HALF);
    piles = {} as Record<Direction, Vec3>;
    DIRECTION_ORDER.forEach((d, i) => { piles![d] = [x0 + i * PILE_PITCH, POOL_Y, cz]; });
    const poolHalfZ = ((rows - 1) / 2) * POOL_PITCH;
    const lastStack = Math.floor((PILE_CAP - 1) / PILE_STACK) * PILE_STACK_DZ;
    tray = {
      y: POOL_Y - TRAY_DROP,
      x0: cx - ((POOL_COLS - 1) / 2) * POOL_PITCH - SLOT_HALF - TRAY_PAD,
      x1: x0 + (DIRECTION_ORDER.length - 1) * PILE_PITCH + PILE_HALF + TRAY_PAD,
      z0: Math.min(cz - poolHalfZ - SLOT_HALF, cz - lastStack - PILE_HALF) - TRAY_PAD,
      z1: cz + poolHalfZ + SLOT_HALF + TRAY_PAD,
    };
  }

  // frame: geometry, plus the room the DOM labels take around it
  const frame: Vec3[] = [];
  const add = (x: number, y: number, z: number): void => { frame.push([x, y, z]); };
  let top = -Infinity;
  for (const [id, p] of Object.entries(nodes) as [AgentId, Vec3][]) {
    add(p[0], p[1], p[2]);
    if (id === "external") {
      add(p[0] - SIDE_LABEL_ROOM, p[1], p[2]);
    } else {
      add(p[0] - NODE_LABEL_ROOM[0], p[1] - NODE_LABEL_ROOM[1], p[2]);
      add(p[0] + NODE_LABEL_ROOM[0], p[1] - NODE_LABEL_ROOM[1], p[2]);
    }
    add(p[0] - THOUGHT_ROOM[0], p[1] + THOUGHT_ROOM[1], p[2]);
    add(p[0] + THOUGHT_ROOM[0], p[1] + THOUGHT_ROOM[1], p[2]);
    if (p[1] > top) top = p[1];
  }
  const any = Object.values(nodes)[0];
  if (any) add(any[0], top + THOUGHT_HEADROOM, any[2]);
  for (const p of slots) add(p[0], p[1], p[2]);
  for (const e of edges) for (let k = 0; k <= 10; k++) add(arc3X(e.seg, k / 10), arc3Y(e.seg, k / 10), arc3Z(e.seg, k / 10));
  const layout: Layout3D = { nodes, edges, slots, piles, tray, frame, bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
  if (piles && tray) {
    for (const d of DIRECTION_ORDER) {
      for (let i = 0; i < PILE_CAP; i++) add(...pileSpot(layout, d, i, [0, 0, 0])!);
      const b = piles[d];
      add(b[0], b[1] - PILE_LABEL_DROP - PILE_LABEL_ROOM, b[2] + PILE_LABEL_FORWARD);
    }
    for (const x of [tray.x0, tray.x1]) for (const z of [tray.z0, tray.z1]) add(x, tray.y, z);
    const first = piles[DIRECTION_ORDER[0]];
    const last = piles[DIRECTION_ORDER[DIRECTION_ORDER.length - 1]];
    const mid = (first[0] + last[0]) / 2;
    const capY = first[1] - PILE_LABEL_DROP - PILE_LABEL_ROOM;
    add(mid - CAPTION_HALF, capY, first[2] + PILE_LABEL_FORWARD);
    add(mid + CAPTION_HALF, capY, first[2] + PILE_LABEL_FORWARD);
    const poolLeft = cx - ((POOL_COLS - 1) / 2) * POOL_PITCH - SLOT_HALF - POOL_LABEL_GAP;
    add(poolLeft - POOL_LABEL_ROOM[0], POOL_Y - POOL_LABEL_ROOM[1], cz);
    add(poolLeft - POOL_LABEL_ROOM[0], POOL_Y + POOL_LABEL_ROOM[1], cz);
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of frame) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  layout.bounds = { min, max };
  return layout;
}
