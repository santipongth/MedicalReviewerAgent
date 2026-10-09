// Pure 3D layout for the optional 3D agent stage: node positions, edge curves, reader-pool slots and bounds.
// Plain tuples only (no three import) so it stays tiny, testable and out of every eager chunk.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
// The arc formula (lifted midpoint, quadratic control through it) is adapted from the AI-Agent-observatory project.
import { PIPELINE, type AgentId, type EdgeId } from "./agent-scene";

export type Vec3 = [number, number, number];
export interface Seg3 { a: Vec3; c: Vec3; b: Vec3 } // quadratic control through the lifted midpoint
export interface Layout3D {
  nodes: Partial<Record<AgentId, Vec3>>; // visible agents only
  edges: { id: EdgeId; seg: Seg3 }[];
  slots: Vec3[];
  bounds: { min: Vec3; max: Vec3 };
}
export interface Layout3DOpts { showLocalize: boolean; showExternal: boolean; slots: number }

const MAX_SLOTS = 30;
const STEP = 2.2; // spacing between lane agents along x
const CURVE = 0.025; // z = -CURVE * x^2
const EXTERNAL_Y = 1.6;
const POOL_Y = -1.6;
const POOL_COLS = 6;
const POOL_PITCH = 0.35;

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

  // reader pool: 6 columns on the y = -1.6 plane, centred under read/synth
  const ns = clampInt(o.slots, 0, MAX_SLOTS);
  const slots: Vec3[] = [];
  const cx = (nodes.read![0] + nodes.synth![0]) / 2;
  const cz = (nodes.read![2] + nodes.synth![2]) / 2;
  const rows = Math.ceil(MAX_SLOTS / POOL_COLS);
  for (let i = 0; i < ns; i++) {
    const col = i % POOL_COLS;
    const row = Math.floor(i / POOL_COLS);
    slots.push([cx + (col - (POOL_COLS - 1) / 2) * POOL_PITCH, POOL_Y, cz + (row - (rows - 1) / 2) * POOL_PITCH]);
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number): void => {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };
  for (const p of Object.values(nodes)) grow(p![0], p![1], p![2]);
  for (const p of slots) grow(p[0], p[1], p[2]);
  for (const e of edges) for (let k = 0; k <= 10; k++) grow(arc3X(e.seg, k / 10), arc3Y(e.seg, k / 10), arc3Z(e.seg, k / 10));
  return { nodes, edges, slots, bounds: { min, max } };
}
