// Pure helpers for the 3D team stage (no three, no React): member status -> visual mapping, phase tiles, hand-off
// packet scheduling, camera goal, label anchors. The components in this folder stay thin wrappers around these, so
// jsdom can test the logic.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
import type { PulseKind } from "@/lib/agent-scene";
import { arcKey, NAME_DROP, PILE_LABEL_DROP, PILE_LABEL_FORWARD, type TeamLayout3D, type Seg3, type Vec3 } from "@/lib/agent-layout-3d";
import type { MemberId, MemberStatus, Phase } from "@/lib/agent-team";
import type { HandoffDot } from "@/lib/team-motion";
import { DIRECTION_ORDER } from "@/lib/i18n";
import type { Direction } from "@/lib/types";
import type { Token3D } from "./tokens-3d";

// --- member status -> visual -------------------------------------------------------------------------------------

export interface MemberVisual {
  fill: Token3D; // head and body faces
  edge: Token3D; // the outline of the head, body and antenna (the 2D avatar's stroke), and the antenna ball
  eyes: Token3D;
  ping: boolean; // the antenna ping ring (only while working)
  mark: "done" | "failed" | null; // shape cue in the DOM name label (check / cross), as the 2D badges
  dim: boolean; // the name label uses `muted`
}

/**
 * Like the 2D avatar (a `surface` head stroked in its status colour): the speaking member (or any member at work) is
 * solid `primary` (a failed member is checked first and stays `err`); done is outlined in `ink`; idle is a `rule` body outlined in `muted`; failed `err`, paused `warn`,
 * stopped `muted`. The eyes take the outline colour.
 */
export function memberVisual(status: MemberStatus, speaking: boolean): MemberVisual {
  if (status === "failed") return { fill: "surface", edge: "err", eyes: "err", ping: false, mark: "failed", dim: false };
  if (speaking || status === "working") {
    return { fill: "primary", edge: "primary", eyes: "surface", ping: status === "working", mark: null, dim: false };
  }
  switch (status) {
    case "done": return { fill: "surface", edge: "ink", eyes: "ink", ping: false, mark: "done", dim: false };
    case "paused": return { fill: "surface", edge: "warn", eyes: "warn", ping: false, mark: null, dim: false };
    case "stopped": return { fill: "surface", edge: "muted", eyes: "muted", ping: false, mark: null, dim: true };
    // idle: a `rule` body (the 2D idle head is dimmed with `muted`, never opacity; a `rule` outline vanished in dark)
    default: return { fill: "rule", edge: "muted", eyes: "muted", ping: false, mark: null, dim: true };
  }
}

export type TileState = "active" | "passed" | "rest";
export const TILE_COLOR: Record<TileState, Token3D> = { active: "primary", passed: "ink", rest: "rule" };

/** One phase tile's state: the member's current phase is active (raised, primary), passed ones ink, the rest rule. */
export function tileState(p: Phase, phase: Phase | null, passed: readonly Phase[]): TileState {
  if (p === phase) return "active";
  return passed.includes(p) ? "passed" : "rest";
}

/** True while any member pings (the frame loop must keep running at the throttled rate). */
export function anyPinging(members: readonly { status: MemberStatus }[]): boolean {
  return members.some((m) => m.status === "working");
}

// --- evidence piles ----------------------------------------------------------------------------------------------

export const PACKET_COLOR: Record<PulseKind, Token3D> = {
  query: "ink", paper: "ink", kept: "primary", card: "primary", failed: "err", signal: "muted",
};

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
/** The flat "no association" bar (x, y, z). */
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

// --- packets -----------------------------------------------------------------------------------------------------

export const FLIGHT_MS = 700;

/** One slot of the fixed packet pool. `seg === null` means idle (instance hidden). */
export interface Flight { seg: Seg3 | null; kind: PulseKind; start: number }

export function makeFlights(n: number): Flight[] {
  return Array.from({ length: n }, () => ({ seg: null, kind: "signal" as PulseKind, start: 0 }));
}

/**
 * Assigns hand-off dots (from `handoffDots`) to pool slots round-robin starting at `cursor`, each flying head to head
 * along the layout's cached arc and starting at `now + delayMs`. A dot between members the layout has no arc for is
 * dropped without taking a slot. Returns the next cursor. Mutates `flights` only.
 */
export function schedulePackets(
  flights: Flight[], cursor: number, dots: readonly HandoffDot[], arcs: TeamLayout3D["arcs"], now: number,
): number {
  if (flights.length === 0) return 0;
  let c = ((cursor % flights.length) + flights.length) % flights.length;
  for (const d of dots) {
    const seg = arcs[arcKey(d.from, d.to)];
    if (!seg) continue;
    const f = flights[c];
    f.seg = seg;
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

// Framing: the camera keeps a fixed elevation and backs off along it just far enough that the whole team (robots,
// tiles, the speech bubble's room over any member, name labels, the table, full piles and their labels) fits the
// 960/288 wrapper (the 2D stage's constant box, so toggling never shifts the page) with an 8% side margin and a 2%
// vertical one, plus a small pan toward the speaking member.
export const CAMERA_BASE: Vec3 = [0, 3.1, 7]; // initial Canvas camera only; the rig places the fitted camera at once
// ~24 degrees above the horizon: low enough that the table's depth costs little of the flat box's height, high enough
// to see the piles on the table
export const VIEW_UP = 3.1; // camera offset direction from the look-at point (y, z)
export const VIEW_BACK = 7;
const VIEW_LEN = Math.hypot(VIEW_UP, VIEW_BACK);
const DIR_Y = VIEW_UP / VIEW_LEN;
const DIR_Z = VIEW_BACK / VIEW_LEN;
export const STAGE_ASPECT = 960 / 288; // = PLACEHOLDER_SIZE.wide, the box up to 30 papers (pinned by stage-3d.test.tsx)
// A modest vertical FOV: in the flat 960/288 box a 45-degree one spans ~106 degrees across, so the end members leaned
// visibly (keystone); at 30 the camera simply stands further back.
export const STAGE_FOV = 30;
export const FIT_MARGIN = 0.08;
/**
 * Vertical margin. The wide box is flat (the 2D stage's aspect), so the fit is height-bound; the frame points already
 * include the DOM labels' room (bubble headroom, name labels, pile captions), so a slim vertical margin is enough.
 */
export const FIT_MARGIN_V = 0.02;
export const PAN = 0.12; // fraction of the way from the table's centre toward the speaking member
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
 * of the top and bottom edges of the frustum (pinhole projection, vertical `fovDeg`, `aspect` = width / height). The
 * look-at starts at the bounds centre and is re-centred in view space so the points' projected extent is centred (a
 * perspective view of a deep box is not symmetric). `padX` reserves room for a later sideways pan of that many units.
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

/** What the camera keeps in view while `speaking` talks: the whole team, plus that member's bubble. */
export function framePoints(layout: TeamLayout3D, speaking: MemberId | null): Vec3[] {
  return speaking ? [...layout.frame, ...layout.bubbles[speaking]] : layout.frame;
}

/**
 * Camera position + look-at toward the speaking member (framed centre when none), into `out` (6 numbers). Fits the
 * team and the speaker's bubble (so the camera also comes a little closer when a front member speaks), with room
 * reserved for the largest pan, so easing toward an end member never crops the far one. Called on a speaker change
 * only, never per frame.
 */
export function teamCameraGoal(
  layout: TeamLayout3D, speaking: MemberId | null, out: number[] = new Array(6).fill(0), aspect = STAGE_ASPECT,
): number[] {
  const { min, max } = layout.bounds;
  const cx = Number.isFinite(min[0] + max[0]) ? (min[0] + max[0]) / 2 : 0;
  let reach = 0;
  for (const m of Object.values(layout.members)) reach = Math.max(reach, Math.abs(m.feet[0] - cx) * PAN);
  fitCamera(layout.bounds, aspect, STAGE_FOV, out, framePoints(layout, speaking), reach);
  const m = speaking ? layout.members[speaking] : undefined;
  const pan = m ? (m.feet[0] - cx) * PAN : 0;
  out[0] += pan;
  out[3] += pan;
  return out;
}

/**
 * Moves `cur` toward `goal` in place with frame-rate independent exponential easing. Snaps and returns true once
 * within `eps` (settled), so the caller can stop invalidating. `jump` (reduced motion) snaps immediately.
 */
export function easeToward(cur: number[], goal: readonly number[], dtSec: number, jump = false, rate = 4, eps = 0.005): boolean {
  const k = jump ? 1 : 1 - Math.exp(-rate * Math.max(0, Math.min(dtSec, 0.1)));
  let far = false;
  for (let i = 0; i < cur.length; i++) {
    cur[i] += (goal[i] - cur[i]) * k;
    if (Math.abs(goal[i] - cur[i]) > eps) far = true;
  }
  if (!far) for (let i = 0; i < cur.length; i++) cur[i] = goal[i];
  return !far;
}

// --- label anchors -----------------------------------------------------------------------------------------------

/** A member's name label: top-centre just under its feet. */
export function nameAnchor(layout: TeamLayout3D, id: MemberId): Vec3 {
  const f = layout.members[id].feet;
  return [f[0], f[1] - NAME_DROP, f[2]];
}

/** The speech bubble's tail tip: above the member's raised tile arc (the bubble grows upward from here). */
export function bubbleAnchor(layout: TeamLayout3D, id: MemberId): Vec3 {
  const m = layout.members[id];
  return [m.feet[0], m.bubbleY, m.feet[2]];
}

const LEADER_GAP = 0.05;

/**
 * A hairline from a lifted bubble's tail down to its member's tiles; null when the bubble sits right over the tiles
 * (nothing to bridge).
 */
export function bubbleLeader(layout: TeamLayout3D, id: MemberId): [Vec3, Vec3] | null {
  const m = layout.members[id];
  const from = m.tilesTop + LEADER_GAP;
  if (m.bubbleY - from < 0.2) return null;
  return [[m.feet[0], from, m.feet[2]], [m.feet[0], m.bubbleY, m.feet[2]]];
}

/** Anchor of one pile's count label: in front of the table's edge, under its pile (top-centre of the label). */
export function pileLabelAt(layout: Pick<TeamLayout3D, "piles">, dir: Direction): Vec3 | null {
  const b = layout.piles?.[dir];
  return b ? [b[0], b[1] - PILE_LABEL_DROP, b[2] + PILE_LABEL_FORWARD] : null;
}

/**
 * Anchor of the piles' caption ("ทิศทางผลตามที่เอเจนต์อ่าน"): top-centre at the pile labels' row; the label pushes
 * itself down a fixed number of pixels (CSS) so it always clears the pile labels whatever the zoom.
 */
export function pileCaptionAt(layout: Pick<TeamLayout3D, "piles">): Vec3 | null {
  const p = layout.piles;
  if (!p) return null;
  const first = p[DIRECTION_ORDER[0]];
  const last = p[DIRECTION_ORDER[DIRECTION_ORDER.length - 1]];
  return [(first[0] + last[0]) / 2, first[1] - PILE_LABEL_DROP, first[2] + PILE_LABEL_FORWARD];
}
