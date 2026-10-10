// Pure 3D layout for the optional 3D agent stage (Plan 18): the five team members standing around a low round table,
// their phase tiles, the hand-off arcs between their heads, the evidence piles on the table, and what the camera must
// keep in view. Plain tuples only (no three import) so it stays tiny, testable and out of every eager chunk.
// Attribution: see NOTICE.md (AI-Agent-observatory by sakshigupta372, used with permission).
// The arc formula (lifted midpoint, quadratic control through it) is adapted from the AI-Agent-observatory project.
import type { MemberId } from "./agent-team";
import { DIRECTION_ORDER } from "./i18n";
import type { Direction } from "./types";

export type Vec3 = [number, number, number];
export interface Seg3 { a: Vec3; c: Vec3; b: Vec3 } // quadratic control through the lifted midpoint

/** Member order around the table, left to right as seen from the camera (the pipeline order). */
export const TEAM_ORDER: readonly MemberId[] = ["planner", "researcher", "screener", "reader", "synthesizer"];

// --- robot geometry (world units; a robot stands on y = 0) --------------------------------------------------------
export const BODY_R = 0.24;
export const BODY_H = 0.5;
export const HEAD: Vec3 = [0.6, 0.46, 0.44]; // width, height, depth
export const HEAD_Y = BODY_H + 0.05 + HEAD[1] / 2; // head centre
export const EYE_R = 0.065;
export const EYE_DX = 0.14;
export const ANTENNA_H = 0.22;
export const BALL_R = 0.065;
export const BALL_Y = HEAD_Y + HEAD[1] / 2 + ANTENNA_H + BALL_R * 0.5;

// --- phase tiles: four flat tiles on a shallow arc above the head, left to right คิด, วิเคราะห์, วางแผน, ลงมือ ---------
export const TILE = 0.17; // side of a square tile
export const TILE_T = 0.035; // thickness
export const TILE_RAISE = 0.1; // the active tile sits this much higher
const TILE_X = [-0.345, -0.115, 0.115, 0.345]; // centres across the head
const TILE_BOW = [0, 0.055, 0.055, 0]; // the middle tiles sit higher: a shallow arc
const TILE_TILT = [0.22, 0.07, -0.07, -0.22]; // each tile leans with the arc (rad about z)
const TILE_LIFT = 0.3; // outer tiles' centres above the antenna ball

// --- the table: round, drawn a little wider than deep so the team can spread across the flat box -------------------
export const TABLE_R = 2.0;
export const TABLE_STRETCH = 1.4; // x scale of the table top
export const TABLE_TOP = 0.32; // a low table: the top is below a robot's waist
export const TABLE_T = 0.07;
export const TABLE_LEG_R = 0.3;

// --- members around the table: an elliptical arc behind it, open toward the camera ---------------------------------
const RING_X = 6.8;
const RING_Z = 2.8;
const RING_DEG = [180, 136, 90, 44, 0];
const FACE_Z = 3.5; // robots turn toward a point in front of the table (toward the viewer), not straight at its centre

// --- evidence piles on the table: one per direction, 5 tokens high, later tokens start stacks further back ----------
// 0.75 apart, so the one-line per-pile DOM labels (glyph, count, flag count) never sit on each other.
export const PILE_PITCH = 0.75;
export const PILE_RISE = 0.12;
export const PILE_STACK = 5;
export const PILE_STACK_DZ = 0.27; // deeper than the widest token (0.24), so stacks behind never intersect
export const PILE_CAP = 30;
/** Half-width of the widest pile token (the flat "no association" bar is 0.33 wide). */
export const PILE_HALF = 0.165;
const PILE_FRONT_Z = 0.85; // the first stack sits toward the table's front edge, later stacks behind it
const PILE_BASE_LIFT = 0.1; // token centres sit this far above the table top

// Room the DOM labels take, in world units at the fitted distance (~70 px per unit; 12px Thai text, 15px lines).
// Label anchors in model-3d.ts use the same constants, so framing and labels stay in step.
export const PILE_LABEL_DROP = 0.3; // top of a pile's label (and of the caption's box), below the front stack's base
export const PILE_LABEL_FORWARD = 0.95; // pile labels hang in front of the table's front edge
export const NAME_DROP = 0.08; // top of a member's name label, below its feet
export const BUBBLE_GAP = 0.12; // bubble's tail tip, above the top of the raised tile arc
const NAME_ROOM: [number, number] = [0.75, 0.4]; // half-width, depth below the feet (one 12px line)
export const BUBBLE_W = 4.3; // world width of the widest bubble (260px)
// World height of a 3-line bubble (about 73px: 3 x 17.4px lines, padding, border, the 7px tail) at the narrowest
// offered stage (1024px wide, where the fitted camera gives about 44 px per unit at the bubble's tail). A bubble is
// DOM text of fixed pixel size while the scene scales with the stage, so this is sized for the worst case; wider
// stages just get a little spare room above the bubble.
export const BUBBLE_H = 1.7;
/** The end members' bubbles grow inward from a tail this far (world units; 24px) from their outer edge. */
export const BUBBLE_TAIL_IN = 0.4;
/**
 * The end members stand further forward than their neighbours, so their tiles sit lower on screen; their inward bubble
 * is lifted this much more so it clears the next member's tiles.
 */
export const BUBBLE_END_LIFT = 0.75;
const PILE_LABEL_ROOM = 0.6; // one-line pile labels plus the caption line under them
const CAPTION_HALF = 1.5;

/** Where a member's bubble sits over its tail: centred, or growing inward for the two end members. */
export type BubbleAlign = "start" | "center" | "end";

export interface Member3D {
  feet: Vec3; // where the robot stands
  head: Vec3; // head centre
  ball: Vec3; // antenna ball (packets leave and land here)
  yaw: number; // rotation about +y so the face (+z) turns toward the viewer side of the table
  tiles: Vec3[]; // 4 tile centres at rest, in phase order
  raised: Vec3[]; // the same tiles raised (active)
  tileRot: number[]; // tile rotation about z, tangent to the arc
  tilesTop: number; // highest point of the raised arc (y)
  bubble: BubbleAlign;
  bubbleY: number; // the bubble's tail tip (y): above the tiles; the end members' higher, clear of the next member's tiles
}
export interface TeamLayout3D {
  members: Record<MemberId, Member3D>;
  table: { at: Vec3; r: number; stretch: number }; // centre of the table top, radius, x scale
  piles: Record<Direction, Vec3>; // base (first token centre) of each direction's pile, on the table
  arcs: Record<string, Seg3>; // `${from}>${to}` for every ordered pair of members, head to head
  frame: Vec3[]; // what the camera must always keep in view: geometry plus the room DOM labels take
  bubbles: Record<MemberId, [Vec3, Vec3]>; // top corners of each member's speech bubble (framed only while it speaks)
  bounds: { min: Vec3; max: Vec3 }; // box around every frame and bubble point
}

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

/** Key of the hand-off arc from one member to another. */
export const arcKey = (from: MemberId, to: MemberId): string => `${from}>${to}`;

/**
 * Position of token `i` (0-based, clamped to PILE_CAP - 1) of a direction's pile, written into `out` (no allocation;
 * called per frame). Tokens rise PILE_RISE each, PILE_STACK per stack; each later group of PILE_STACK starts a new
 * stack PILE_STACK_DZ further back. Returns null when the layout has no piles.
 */
export function pileSpot(layout: { piles: Record<Direction, Vec3> | null }, dir: Direction, i: number, out: Vec3): Vec3 | null {
  const base = layout.piles?.[dir];
  if (!base) return null;
  const k = Math.max(0, Math.min(PILE_CAP - 1, Math.floor(i)));
  const stack = Math.floor(k / PILE_STACK);
  out[0] = base[0];
  out[1] = base[1] + (k % PILE_STACK) * PILE_RISE;
  out[2] = base[2] - stack * PILE_STACK_DZ;
  return out;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** The bubble's left and right edges relative to its tail (world x offsets). */
export function bubbleSpan(m: Pick<Member3D, "bubble">): [number, number] {
  if (m.bubble === "start") return [-BUBBLE_TAIL_IN, BUBBLE_W - BUBBLE_TAIL_IN];
  if (m.bubble === "end") return [BUBBLE_TAIL_IN - BUBBLE_W, BUBBLE_TAIL_IN];
  return [-BUBBLE_W / 2, BUBBLE_W / 2];
}

function member(i: number): Member3D {
  const a = rad(RING_DEG[i]);
  const x = RING_X * Math.cos(a);
  const z = -RING_Z * Math.sin(a);
  const head: Vec3 = [x, HEAD_Y, z];
  const end = i === 0 || i === RING_DEG.length - 1;
  const tiles: Vec3[] = [];
  const raised: Vec3[] = [];
  const tileRot: number[] = [];
  let tilesTop = -Infinity;
  TILE_X.forEach((dx, k) => {
    const y = BALL_Y + TILE_LIFT + TILE_BOW[k];
    tiles.push([x + dx, y, z]);
    raised.push([x + dx, y + TILE_RAISE, z]);
    tileRot.push(TILE_TILT[k]);
    tilesTop = Math.max(tilesTop, y + TILE_RAISE + TILE / 2);
  });
  return {
    feet: [x, 0, z], head, ball: [x, BALL_Y, z], yaw: Math.atan2(-x, FACE_Z - z), tiles, raised, tileRot, tilesTop,
    bubble: end ? (i === 0 ? "start" : "end") : "center",
    bubbleY: tilesTop + BUBBLE_GAP + (end ? BUBBLE_END_LIFT : 0),
  };
}

/** The (constant) team layout: five members on an arc behind a low round table, the piles on its top. */
export function teamLayout3D(): TeamLayout3D {
  const members = {} as Record<MemberId, Member3D>;
  TEAM_ORDER.forEach((id, i) => { members[id] = member(i); });

  const arcs: Record<string, Seg3> = {};
  for (const p of TEAM_ORDER) {
    for (const q of TEAM_ORDER) if (p !== q) arcs[arcKey(p, q)] = arc3(members[p].ball, members[q].ball, 0.12);
  }

  // five piles across the table in DIRECTION_ORDER (a fixed order, never a ranking), first stacks at the front
  const piles = {} as Record<Direction, Vec3>;
  DIRECTION_ORDER.forEach((d, i) => {
    piles[d] = [(i - (DIRECTION_ORDER.length - 1) / 2) * PILE_PITCH, TABLE_TOP + PILE_BASE_LIFT, PILE_FRONT_Z];
  });

  const frame: Vec3[] = [];
  const add = (x: number, y: number, z: number): void => { frame.push([x, y, z]); };
  const bubbles = {} as Record<MemberId, [Vec3, Vec3]>;
  for (const id of TEAM_ORDER) {
    const m = members[id];
    const [x, , z] = m.feet;
    add(x - NAME_ROOM[0], -NAME_DROP - NAME_ROOM[1], z);
    add(x + NAME_ROOM[0], -NAME_DROP - NAME_ROOM[1], z);
    add(x, m.tilesTop, z);
    const [left, right] = bubbleSpan(m);
    const top = m.bubbleY + BUBBLE_H;
    bubbles[id] = [[x + left, top, z], [x + right, top, z]];
  }
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    add(TABLE_R * TABLE_STRETCH * Math.cos(t), TABLE_TOP, TABLE_R * Math.sin(t));
  }
  const layout: TeamLayout3D = {
    members, table: { at: [0, TABLE_TOP, 0], r: TABLE_R, stretch: TABLE_STRETCH }, piles, arcs, frame, bubbles,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
  const spot: Vec3 = [0, 0, 0];
  for (const d of DIRECTION_ORDER) {
    for (let i = 0; i < PILE_CAP; i++) add(...pileSpot(layout, d, i, spot)!);
  }
  const first = piles[DIRECTION_ORDER[0]];
  const capY = first[1] - PILE_LABEL_DROP - PILE_LABEL_ROOM;
  add(-CAPTION_HALF, capY, first[2] + PILE_LABEL_FORWARD);
  add(CAPTION_HALF, capY, first[2] + PILE_LABEL_FORWARD);
  // hand-offs only ever pass to the next member (agent-team handoffs), so only those arcs need to stay in view
  for (let i = 1; i < TEAM_ORDER.length; i++) {
    const s = arcs[arcKey(TEAM_ORDER[i - 1], TEAM_ORDER[i])];
    for (let k = 0; k <= 8; k++) add(arc3X(s, k / 8), arc3Y(s, k / 8), arc3Z(s, k / 8));
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [...frame, ...Object.values(bubbles).flat()]) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  layout.bounds = { min, max };
  return layout;
}
