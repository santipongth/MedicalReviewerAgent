"use client";
// Evidence piles: one InstancedMesh per direction (cap PILE_CAP), one token per finished read on the live evidence board,
// stacked in the order they finished. Shapes match the 2D glyphs (PILE_SHAPE) and colours come from the finding tokens,
// so a pile is never colour-only. Direction is the reading model's judgement of one abstract (labels say
// "ตามที่เอเจนต์อ่าน"); piles are in a fixed order and nothing ranks them.
// The piles stand on the team's table. Arrivals: only tokens finished after mount fly in (newest PACKET_CAP,
// planArrivals), from the reader's antenna along a low arc; the frame loop invalidates only while one is waiting or
// in flight; no per-frame allocations.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Object3D, type InstancedMesh } from "three";
import { PACKET_CAP, type Scene } from "@/lib/agent-scene";
import { arc3, arc3X, arc3Y, arc3Z, PILE_CAP, pileSpot, type TeamLayout3D, type Seg3, type Vec3 } from "@/lib/agent-layout-3d";
import { DIRECTION_ORDER, liveTally } from "@/lib/live-evidence";
import type { Direction } from "@/lib/types";
import { FLIGHT_MS, PILE_BAR, PILE_COLOR, PILE_R, PILE_SHAPE, easeInOut, planArrivals, type PileShape } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

type PileLayout = Pick<TeamLayout3D, "piles">;
const ARC_BEND = 0.12;

/** Per-direction instance state, preallocated: flight segment + start time per instance index. */
interface Lane { n: number; keys: Float64Array; starts: Float64Array; segs: (Seg3 | null)[] }
interface Work { obj: Object3D; spot: Vec3; lanes: Record<Direction, Lane>; flights: Map<number, { seg: Seg3; start: number }> }

const makeWork = (): Work => {
  const lanes = {} as Record<Direction, Lane>;
  for (const d of DIRECTION_ORDER) {
    lanes[d] = { n: 0, keys: new Float64Array(PILE_CAP), starts: new Float64Array(PILE_CAP), segs: new Array<Seg3 | null>(PILE_CAP).fill(null) };
  }
  return { obj: new Object3D(), spot: [0, 0, 0], lanes, flights: new Map() };
};

function Geometry({ shape }: { shape: PileShape }) {
  switch (shape) {
    case "sphere": return <sphereGeometry args={[PILE_R.sphere, 12, 10]} />;
    case "octahedron": return <octahedronGeometry args={[PILE_R.octahedron, 0]} />;
    case "bar": return <boxGeometry args={[PILE_BAR[0], PILE_BAR[1], PILE_BAR[2]]} />;
    case "dome": return <sphereGeometry args={[PILE_R.dome, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2]} />;
    case "torus": return <torusGeometry args={[PILE_R.torus, PILE_R.torusTube, 8, 24]} />;
  }
}

/** Places every instance of one pile for time `now`; returns true while any is waiting or flying. */
function place(mesh: InstancedMesh, lane: Lane, dir: Direction, w: Work, layout: PileLayout, now: number): boolean {
  const { obj, spot } = w;
  let busy = false;
  for (let i = 0; i < lane.n; i++) {
    const seg = lane.segs[i];
    const t = seg ? (now - lane.starts[i]) / FLIGHT_MS : Infinity;
    if (seg && t < 0) {
      busy = true;
      obj.scale.setScalar(0); // waiting for its stagger
    } else if (seg && t < 1) {
      busy = true;
      const e = easeInOut(t);
      obj.position.set(arc3X(seg, e), arc3Y(seg, e), arc3Z(seg, e));
      obj.scale.setScalar(1);
    } else {
      if (seg) {
        lane.segs[i] = null; // landed
        w.flights.delete(lane.keys[i]);
      }
      if (pileSpot(layout, dir, i, spot)) {
        obj.position.set(spot[0], spot[1], spot[2]);
        obj.scale.setScalar(1);
      } else {
        obj.scale.setScalar(0);
      }
    }
    obj.updateMatrix();
    mesh.setMatrixAt(i, obj.matrix);
  }
  mesh.count = lane.n;
  mesh.instanceMatrix.needsUpdate = true;
  return busy;
}

export function EvidencePiles3D({ scene, layout, from, tokens }: { scene: Scene; layout: PileLayout; from: Vec3; tokens: Tokens3D }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshes = useRef<Partial<Record<Direction, InstancedMesh | null>>>({});
  const work = useRef<Work | null>(null);
  const seen = useRef(scene.lastSeq); // tokens that existed at mount never fly
  const latest = useRef({ layout });
  useEffect(() => { latest.current = { layout }; });
  const tally = useMemo(() => liveTally(scene), [scene]);

  useLayoutEffect(() => {
    work.current ??= makeWork();
    const w = work.current;
    const now = performance.now();
    for (const [k, f] of w.flights) if (now - f.start > FLIGHT_MS) w.flights.delete(k); // landed or regrouped
    const all = DIRECTION_ORDER.flatMap((d) => tally.groups[d]);
    const { animate } = planArrivals(all, seen.current, PACKET_CAP);
    seen.current = scene.lastSeq;
    const hidden = typeof document !== "undefined" && document.hidden;
    if (!hidden) {
      for (const { item, delayMs } of animate) {
        const idx = tally.groups[item.direction].indexOf(item);
        const to = pileSpot(layout, item.direction, idx, [0, 0, 0]);
        if (!to || idx >= PILE_CAP) continue;
        w.flights.set(item.key, { seg: arc3(from, to, ARC_BEND), start: now + delayMs });
      }
    }
    for (const d of DIRECTION_ORDER) {
      const lane = w.lanes[d];
      const group = tally.groups[d];
      lane.n = Math.min(group.length, PILE_CAP);
      for (let i = 0; i < lane.n; i++) {
        const f = w.flights.get(group[i].key);
        lane.keys[i] = group[i].key;
        lane.segs[i] = f ? f.seg : null;
        lane.starts[i] = f ? f.start : 0;
      }
      const m = meshes.current[d];
      if (m) place(m, lane, d, w, layout, now);
    }
    invalidate(); // the frame loop keeps invalidating while a token is waiting or in flight
  }, [scene, tally, layout, from, invalidate]);

  useFrame(() => {
    const w = work.current;
    if (!w) return;
    let active = false;
    for (const d of DIRECTION_ORDER) {
      const lane = w.lanes[d];
      let flying = false;
      for (let i = 0; i < lane.n; i++) if (lane.segs[i]) { flying = true; break; }
      if (!flying) continue;
      const m = meshes.current[d];
      if (m && place(m, lane, d, w, latest.current.layout, performance.now())) active = true;
    }
    if (active) invalidate();
  });

  return (
    <>
      {DIRECTION_ORDER.map((d) => (
        <instancedMesh
          key={d} ref={(m) => { meshes.current[d] = m; }} args={[undefined, undefined, PILE_CAP]} frustumCulled={false}
        >
          <Geometry shape={PILE_SHAPE[d]} />
          <meshStandardMaterial color={tokens[PILE_COLOR[d]]} flatShading roughness={1} metalness={0} />
        </instancedMesh>
      ))}
    </>
  );
}
