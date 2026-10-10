// Pure helpers for the 3D stage (no three, no React): status -> visual mapping, packet scheduling, camera goal,
// reader-pool summary. The components in this folder stay thin wrappers around these, so jsdom can test the logic.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
import {
  currentAgent, planDots, readDone, type AgentId, type AgentStatus, type EdgeState, type PulseKind, type Scene,
  type SlotState,
} from "@/lib/agent-scene";
import {
  PILE_LABEL_DROP, PILE_LABEL_FORWARD, POOL_LABEL_GAP, SLOT_HALF, type Layout3D, type Seg3, type Vec3,
} from "@/lib/agent-layout-3d";
import { DIRECTION_ORDER } from "@/lib/i18n";
import type { Direction } from "@/lib/types";
import type { Token3D } from "./tokens-3d";

// --- status -> visual --------------------------------------------------------------------------------------------

export type RingStyle = "solid" | "dashed" | "wire";
export interface NodeVisual {
  color: Token3D;
  scale: number;
  ring: RingStyle; // dashed = rotating "working" ring; wire = skipped
  spin: boolean; // only while working
  mark: "done" | "failed" | null; // shape cue in the DOM label (check / cross)
  dim: boolean; // label uses `muted`
}

export const NODE_VISUAL: Record<AgentStatus, NodeVisual> = {
  idle: { color: "rule", scale: 1, ring: "solid", spin: false, mark: null, dim: true },
  active: { color: "primary", scale: 1.12, ring: "solid", spin: false, mark: null, dim: false },
  working: { color: "primary", scale: 1, ring: "dashed", spin: true, mark: null, dim: false },
  done: { color: "ink", scale: 1, ring: "solid", spin: false, mark: "done", dim: false },
  failed: { color: "err", scale: 1, ring: "solid", spin: false, mark: "failed", dim: false },
  skipped: { color: "muted", scale: 1, ring: "wire", spin: false, mark: null, dim: true },
  paused: { color: "warn", scale: 1, ring: "solid", spin: false, mark: null, dim: false },
};

export const EDGE_COLOR: Record<EdgeState, Token3D> = { idle: "rule", visited: "ink", live: "primary" };
export const SLOT_COLOR: Record<SlotState, Token3D> = {
  waiting: "rule", reading: "primary", ok: "ok", failed: "err", uncertain: "warn",
};
/**
 * Reader-pool instance scale [x, y, z] per slot state, so state is never colour-only (err/warn is a colour-blind pair):
 * waiting a small sphere, reading a large sphere, ok a flat round disc, failed a tall narrow spindle (upright),
 * uncertain a lying capsule along x (unlike the round ok disc, it is narrow in depth). Every state has its own silhouette.
 */
export const SLOT_SCALE: Record<SlotState, readonly [number, number, number]> = {
  waiting: [0.7, 0.7, 0.7], reading: [1.4, 1.4, 1.4], ok: [1.05, 0.45, 1.05], failed: [0.6, 1.3, 0.6], uncertain: [1.5, 0.6, 0.6],
};

export const PACKET_COLOR: Record<PulseKind, Token3D> = {
  query: "ink", paper: "ink", kept: "primary", card: "primary", failed: "err", signal: "muted",
};

/** Edge tube radius (world units): idle and visited thin, live thicker. */
export const EDGE_RADIUS: Record<EdgeState, number> = { idle: 0.012, visited: 0.012, live: 0.02 };

// --- evidence piles ----------------------------------------------------------------------------------------------

export type PileShape = "sphere" | "octahedron" | "bar" | "dome" | "torus";
/**
 * Pile token silhouette per direction, matching the 2D `Glyph` (evidence.tsx / globals.css .g-*): positive a filled
 * circle -> sphere, negative the harm diamond -> octahedron (a vertex up reads as ◆), "null" (no association) the flat
 * bar -> flat box, mixed the half-filled circle -> dome, unclear the dashed ring -> thin upright torus. Colour is never
 * the only cue: none and unclear share a colour and differ by shape.
 */
export const PILE_SHAPE: Record<Direction, PileShape> = {
  positive: "sphere", negative: "octahedron", null: "bar", mixed: "dome", unclear: "torus",
};
export const PILE_COLOR: Record<Direction, Token3D> = {
  positive: "sup", negative: "harm", null: "none", mixed: "mixed", unclear: "unclear",
};
/** The flat "no association" bar (x, y, z); 1.5x the first cut, whose 4-6px tokens read as indistinct specks. */
export const PILE_BAR: readonly [number, number, number] = [0.33, 0.09, 0.15];
/** Radii of the round pile tokens (torus: ring radius and a thick tube, so the ring still reads at small sizes). */
export const PILE_R = { sphere: 0.1, octahedron: 0.12, dome: 0.12, torus: 0.093, torusTube: 0.026 } as const;

export const ARRIVAL_STAGGER_MS = 60;
export interface Arrival<T> { item: T; delayMs: number }

/**
 * Burst/replay collapse for pile tokens: only the newest `cap` items with key > `seenKey` fly in (oldest first, 60ms
 * apart); everything else (seen at mount, or older than the newest `cap`) appears in place.
 */
export function planArrivals<T extends { key: number }>(
  items: readonly T[], seenKey: number, cap: number,
): { animate: Arrival<T>[]; snap: T[] } {
  const fresh = items.filter((it) => it.key > seenKey).sort((a, b) => a.key - b.key);
  const flying = fresh.slice(Math.max(0, fresh.length - Math.max(0, cap)));
  const set = new Set(flying);
  return {
    animate: flying.map((item, i) => ({ item, delayMs: i * ARRIVAL_STAGGER_MS })),
    snap: items.filter((it) => !set.has(it)),
  };
}

/** True while any visible node shows the rotating working ring (the frame loop must keep running). */
export function anySpinning(scene: Scene, layout: Layout3D): boolean {
  for (const id of Object.keys(layout.nodes) as AgentId[]) if (NODE_VISUAL[scene.agents[id]].spin) return true;
  return false;
}

// --- packets -----------------------------------------------------------------------------------------------------

export const FLIGHT_MS = 700;

/** One slot of the fixed packet pool. `seg === null` means idle (instance hidden). */
export interface Flight { seg: Seg3 | null; kind: PulseKind; start: number }

export function makeFlights(n: number): Flight[] {
  return Array.from({ length: n }, () => ({ seg: null, kind: "signal" as PulseKind, start: 0 }));
}

/**
 * Assigns planned dots (from `planDots`) to pool slots round-robin starting at `cursor`, each starting at
 * `now + delayMs`. Dots on an edge the layout does not draw are dropped without taking a slot.
 * Returns the next cursor. Mutates `flights` only.
 */
export function schedulePackets(
  flights: Flight[], cursor: number, dots: ReturnType<typeof planDots>, edges: Layout3D["edges"], now: number,
): number {
  if (flights.length === 0) return 0;
  let c = ((cursor % flights.length) + flights.length) % flights.length;
  for (const d of dots) {
    const e = edges.find((x) => x.id === d.edge);
    if (!e) continue;
    const f = flights[c];
    f.seg = e.seg;
    f.kind = d.kind;
    f.start = now + Math.max(0, d.delayMs);
    c = (c + 1) % flights.length;
  }
  return c;
}

/** Raw progress: < 0 waiting for its delay, 0..1 flying, > 1 finished; Infinity when idle. */
export function flightT(f: Flight, now: number, dur = FLIGHT_MS): number {
  return f.seg ? (now - f.start) / dur : Infinity;
}

export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Instance scale over a flight: grows in over the first 10%, shrinks out over the last 10% (2D fades the same way). */
export function packetScale(t: number): number {
  if (t < 0 || t > 1) return 0;
  return Math.min(1, t / 0.1, (1 - t) / 0.1);
}

// --- camera ------------------------------------------------------------------------------------------------------

// Framing: the camera keeps a fixed elevation (the Plan 12 view direction, from [0, 3.1, 7] toward [0, -1.1, 0]) and
// backs off along it just far enough that the whole layout (lane, labels' room, pool, full piles, thought headroom)
// fits the 960/288 wrapper (the 2D stage's constant box, so toggling never shifts the page) with an 8% side margin
// and a 2% vertical one, plus a small pan toward the current agent.
export const CAMERA_BASE: Vec3 = [0, 3.1, 7]; // initial Canvas camera only; the rig places the fitted camera at once
const VIEW_UP = 4.2; // camera offset direction from the look-at point (y, z), i.e. ~31 degrees above the horizon
const VIEW_BACK = 7;
const VIEW_LEN = Math.hypot(VIEW_UP, VIEW_BACK);
const DIR_Y = VIEW_UP / VIEW_LEN;
const DIR_Z = VIEW_BACK / VIEW_LEN;
export const STAGE_ASPECT = 960 / 288; // = PLACEHOLDER_SIZE.wide (pinned by stage-3d.test.tsx)
export const STAGE_FOV = 45;
export const FIT_MARGIN = 0.08;
/**
 * Vertical margin. The wide box is flat (the 2D stage's aspect), so the fit is height-bound; the frame points already
 * include the DOM labels' room (thought headroom, label drop, pile captions), so a slim vertical margin is enough and
 * lets the lane use more of the width.
 */
export const FIT_MARGIN_V = 0.02;
const PAN = 0.1; // fraction of the way from the lane centre toward the current agent (keeps the whole lane framed)
const NEAR_MIN = 0.5;

const boundsCorners = (b: { min: Vec3; max: Vec3 }): Vec3[] =>
  Array.from({ length: 8 }, (_, c) => [(c & 1) ? b.max[0] : b.min[0], (c & 2) ? b.max[1] : b.min[1], (c & 4) ? b.max[2] : b.min[2]] as Vec3);

/** Smallest camera distance along the fixed view direction that keeps `points` inside tanH/tanV of target t. */
function fitDistance(points: readonly Vec3[], t: Vec3, tanH: number, tanV: number, padX: number): number {
  let d = NEAR_MIN;
  for (const p of points) {
    const qx = p[0] - t[0];
    const qy = p[1] - t[1];
    const qz = p[2] - t[2];
    // view basis for a camera at t + d * (0, DIR_Y, DIR_Z): right +x, up (0, DIR_Z, -DIR_Y), forward -(0, DIR_Y, DIR_Z)
    const depth0 = -DIR_Y * qy - DIR_Z * qz; // the point's depth is depth0 + d
    const vy = DIR_Z * qy - DIR_Y * qz;
    d = Math.max(d, (Math.abs(qx) + padX) / tanH - depth0, Math.abs(vy) / tanV - depth0, NEAR_MIN - depth0);
  }
  return d;
}

const fitTarget: Vec3 = [0, 0, 0];

/**
 * Camera position + look-at (6 numbers into `out`) at the fixed elevation, as close as possible while every one of
 * `points` (default: the 8 corners of `bounds`) stays within (1 - FIT_MARGIN) of the side edges and (1 - FIT_MARGIN_V)
 * of the top and bottom edges of the frustum (pinhole
 * projection, vertical `fovDeg`, `aspect` = width / height). The look-at starts at the bounds centre and is re-centred
 * in view space so the points' projected extent is centred (a perspective view of a deep box is not symmetric).
 * `padX` reserves room for a later sideways pan of that many world units.
 */
export function fitCamera(
  bounds: { min: Vec3; max: Vec3 }, aspect = STAGE_ASPECT, fovDeg = STAGE_FOV, out: number[] = new Array(6).fill(0),
  points: readonly Vec3[] | null = null, padX = 0,
): number[] {
  const { min, max } = bounds;
  let ok = true;
  for (let k = 0; k < 3; k++) if (!Number.isFinite(min[k]) || !Number.isFinite(max[k])) ok = false;
  const t = fitTarget;
  t[0] = ok ? (min[0] + max[0]) / 2 : 0;
  t[1] = ok ? (min[1] + max[1]) / 2 : 0;
  t[2] = ok ? (min[2] + max[2]) / 2 : 0;
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const tanV = tan * (1 - FIT_MARGIN_V);
  const tanH = tan * aspect * (1 - FIT_MARGIN);
  let d = NEAR_MIN;
  if (ok) {
    const pts = points && points.length > 0 ? points : boundsCorners(bounds);
    for (let iter = 0; iter < 6; iter++) {
      d = fitDistance(pts, t, tanH, tanV, padX);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        const qx = p[0] - t[0], qy = p[1] - t[1], qz = p[2] - t[2];
        const depth = -DIR_Y * qy - DIR_Z * qz + d;
        const nx = qx / (depth * tanH);
        const ny = (DIR_Z * qy - DIR_Y * qz) / (depth * tanV);
        if (nx < x0) x0 = nx;
        if (nx > x1) x1 = nx;
        if (ny < y0) y0 = ny;
        if (ny > y1) y1 = ny;
      }
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      if (Math.abs(mx) < 1e-4 && Math.abs(my) < 1e-4) break;
      // move the look-at along the view's right / up axes by the projected offset at the look-at distance
      t[0] += mx * d * tanH;
      t[1] += my * d * tanV * DIR_Z;
      t[2] -= my * d * tanV * DIR_Y;
    }
    d = fitDistance(pts, t, tanH, tanV, padX);
  }
  out[0] = t[0]; out[1] = t[1] + d * DIR_Y; out[2] = t[2] + d * DIR_Z;
  out[3] = t[0]; out[4] = t[1]; out[5] = t[2];
  return out;
}

/**
 * Camera position + look-at for the current agent (framed centre when none). Writes into `out` (6 numbers). Fits the
 * layout's frame points (what must stay visible: nodes and their labels' room, thought headroom, pool, full piles,
 * tray, captions) with room reserved for the largest pan, so panning toward an end node never crops the far end.
 */
export function cameraGoal(layout: Layout3D, agent: AgentId | null, out: number[] = new Array(6).fill(0)): number[] {
  const { min, max } = layout.bounds;
  const finite = Number.isFinite(min[0] + max[0]);
  const cx = finite ? (min[0] + max[0]) / 2 : 0;
  let reach = 0;
  for (const id of Object.keys(layout.nodes) as AgentId[]) reach = Math.max(reach, Math.abs(layout.nodes[id]![0] - cx) * PAN);
  fitCamera(layout.bounds, STAGE_ASPECT, STAGE_FOV, out, layout.frame, reach);
  const node = agent ? layout.nodes[agent] : undefined;
  const pan = node ? (node[0] - cx) * PAN : 0;
  out[0] += pan;
  out[3] += pan;
  return out;
}

/** The agent the camera follows: the scene's current agent (same choice as the 2D zone tint). */
export function cameraAgent(scene: Scene): AgentId | null {
  return currentAgent(scene);
}

/**
 * Moves `cur` toward `goal` in place with frame-rate independent exponential easing. Snaps and returns true once
 * within `eps` (settled), so the caller can stop invalidating. `jump` (reduced motion) snaps immediately.
 */
export function easeToward(cur: number[], goal: number[], dtSec: number, jump = false, rate = 4, eps = 0.005): boolean {
  const k = jump ? 1 : 1 - Math.exp(-rate * Math.max(0, Math.min(dtSec, 0.1)));
  let far = false;
  for (let i = 0; i < cur.length; i++) {
    cur[i] += (goal[i] - cur[i]) * k;
    if (Math.abs(goal[i] - cur[i]) > eps) far = true;
  }
  if (!far) for (let i = 0; i < cur.length; i++) cur[i] = goal[i];
  return !far;
}

// --- labels ------------------------------------------------------------------------------------------------------

export interface PoolSummary { pending: number; ok: number; failed: number; uncertain: number; total: number }

/**
 * One summary for the reader pool (never 30 labels). Every `reading` event arrives together at fan-out, so unfinished
 * papers are only a count ("กำลังอ่านหรือรอคิว"), never refs presented as being read now. ok excludes uncertain, which
 * shows as a flag.
 */
export function poolSummary(scene: Scene): PoolSummary {
  const c = scene.counts;
  return {
    pending: Math.max(0, scene.slots.length - readDone(scene)), ok: Math.max(0, c.readOk - c.uncertain),
    failed: c.readFailed, uncertain: c.uncertain, total: scene.slots.length,
  };
}

/** Visible nodes in draw order (pipeline, then the external side node). */
export function visibleAgents(layout: Layout3D, pipeline: readonly AgentId[]): AgentId[] {
  const out = pipeline.filter((id) => layout.nodes[id]);
  if (layout.nodes.external) out.push("external");
  return out;
}

/**
 * Pool summary label anchor: the label's right edge, just left of the pool (the piles take the space to its right and
 * their labels the space below), at the pool's middle depth.
 */
export function poolLabelAt(layout: Layout3D): Vec3 | null {
  const s = layout.slots;
  if (s.length === 0) return null;
  let xMin = Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of s) {
    if (p[0] < xMin) xMin = p[0];
    if (p[2] < zMin) zMin = p[2];
    if (p[2] > zMax) zMax = p[2];
  }
  return [xMin - SLOT_HALF - POOL_LABEL_GAP, s[0][1], (zMin + zMax) / 2];
}

/** Anchor of one pile's count label: under its base (top-centre of the label). */
export function pileLabelAt(layout: Layout3D, dir: Direction): Vec3 | null {
  const b = layout.piles?.[dir];
  return b ? [b[0], b[1] - PILE_LABEL_DROP, b[2] + PILE_LABEL_FORWARD] : null;
}

/**
 * Anchor of the piles' caption ("ทิศทางผลตามที่เอเจนต์อ่าน"): top-centre at the pile labels' row; the label pushes
 * itself down a fixed number of pixels (CSS) so it always clears the pile labels whatever the zoom.
 */
export function pileCaptionAt(layout: Layout3D): Vec3 | null {
  const p = layout.piles;
  if (!p) return null;
  const first = p[DIRECTION_ORDER[0]];
  const last = p[DIRECTION_ORDER[DIRECTION_ORDER.length - 1]];
  return [(first[0] + last[0]) / 2, first[1] - PILE_LABEL_DROP, first[2] + PILE_LABEL_FORWARD];
}

// --- floating thought label --------------------------------------------------------------------------------------

export const THOUGHT_LIFT = 0.85;
const RING_TOP = 0.47; // node ring radius 0.42, x1.12 when active
const LABEL_HALF = 0.3; // about half a one-line label's height (~11px) in world units at the fitted distance

/**
 * Centre of the floating thought label: THOUGHT_LIFT above the agent's node; for `read` while the external node is
 * shown (it sits right above read), above the external node instead. Null when the agent is not drawn.
 */
export function thoughtAnchor(layout: Layout3D, agent: AgentId | null): Vec3 | null {
  if (!agent) return null;
  const node = agent === "read" && layout.nodes.external ? layout.nodes.external : layout.nodes[agent];
  return node ? [node[0], node[1] + THOUGHT_LIFT, node[2]] : null;
}

/**
 * Leader line from the label down to its own node's ring. None when the label sits over the external node for `read`
 * (a line through the external node would read as that node's thought).
 */
export function thoughtLeader(layout: Layout3D, agent: AgentId | null): [Vec3, Vec3] | null {
  if (!agent || (agent === "read" && layout.nodes.external)) return null;
  const n = layout.nodes[agent];
  if (!n) return null;
  return [[n[0], n[1] + RING_TOP, n[2]], [n[0], n[1] + THOUGHT_LIFT - LABEL_HALF, n[2]]];
}
