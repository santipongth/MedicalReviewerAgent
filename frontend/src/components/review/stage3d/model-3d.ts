// Pure helpers for the 3D stage (no three, no React): status -> visual mapping, packet scheduling, camera goal,
// reader-pool summary. The components in this folder stay thin wrappers around these, so jsdom can test the logic.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
import {
  currentAgent, planDots, type AgentId, type AgentStatus, type EdgeState, type PulseKind, type Scene,
  type SlotState,
} from "@/lib/agent-scene";
import type { Layout3D, Seg3, Vec3 } from "@/lib/agent-layout-3d";
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
export const PACKET_COLOR: Record<PulseKind, Token3D> = {
  query: "ink", paper: "ink", kept: "primary", card: "primary", failed: "err", signal: "muted",
};

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

export const CAMERA_BASE: Vec3 = [0, 4, 9.5];
const PAN = 0.3; // fraction of the way from the lane centre toward the current agent (keeps the whole lane framed)

/** Camera position + look-at for the current agent (lane centre when none). Writes into `out` (6 numbers). */
export function cameraGoal(layout: Layout3D, agent: AgentId | null, out: number[] = new Array(6).fill(0)): number[] {
  const { min, max } = layout.bounds;
  const cx = Number.isFinite(min[0] + max[0]) ? (min[0] + max[0]) / 2 : 0;
  const cz = Number.isFinite(min[2] + max[2]) ? (min[2] + max[2]) / 2 : 0;
  const node = agent ? layout.nodes[agent] : undefined;
  const tx = node ? cx + (node[0] - cx) * PAN : cx;
  out[0] = tx; out[1] = CAMERA_BASE[1]; out[2] = CAMERA_BASE[2];
  out[3] = tx; out[4] = -0.3; out[5] = cz / 2;
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

export interface PoolSummary { reading: string[]; more: number; ok: number; failed: number; uncertain: number; total: number }

const MAX_REFS = 4;

/** One summary line for the reader pool (never 30 labels). ok excludes uncertain, which shows as a flag. */
export function poolSummary(scene: Scene): PoolSummary {
  const refs: string[] = [];
  let reading = 0;
  for (const sl of scene.slots) {
    if (sl.state !== "reading") continue;
    reading++;
    if (sl.ref && refs.length < MAX_REFS) refs.push(sl.ref);
  }
  const c = scene.counts;
  return {
    reading: refs, more: reading - refs.length, ok: Math.max(0, c.readOk - c.uncertain), failed: c.readFailed,
    uncertain: c.uncertain, total: scene.slots.length,
  };
}

/** Visible nodes in draw order (pipeline, then the external side node). */
export function visibleAgents(layout: Layout3D, pipeline: readonly AgentId[]): AgentId[] {
  const out = pipeline.filter((id) => layout.nodes[id]);
  if (layout.nodes.external) out.push("external");
  return out;
}

/** Pool summary label anchor: just in front of the pool's front row, centred on the drawn slots. */
export function poolLabelAt(layout: Layout3D): Vec3 | null {
  const s = layout.slots;
  if (s.length === 0) return null;
  let x = 0;
  let zMax = -Infinity;
  for (const p of s) {
    x += p[0];
    if (p[2] > zMax) zMax = p[2];
  }
  return [x / s.length, s[0][1] - 0.3, zMax + 0.35];
}
