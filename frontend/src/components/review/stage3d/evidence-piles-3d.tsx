"use client";
// Evidence piles: one InstancedMesh per direction (cap 30), one token per finished read on the live evidence board,
// stacked in the order they finished. Shapes match the 2D glyphs (PILE_SHAPE) and colours come from the finding tokens,
// so a pile is never colour-only. Direction is the reading model's judgement of one abstract (labels say
// "ตามที่เอเจนต์อ่าน"); piles are in a fixed order and nothing ranks them.
// Arrivals: only tokens finished after mount fly in (newest PACKET_CAP, planArrivals), from their paper's pool slot
// along a low arc; the frame loop invalidates only while one is waiting or in flight; no per-frame allocations.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Object3D, type InstancedMesh } from "three";
import { PACKET_CAP, type Scene } from "@/lib/agent-scene";
import { arc3, arc3X, arc3Y, arc3Z, PILE_CAP, pileSpot, type Layout3D, type Seg3, type Vec3 } from "@/lib/agent-layout-3d";
import { DIRECTION_ORDER, liveTally } from "@/lib/live-evidence";
import type { Direction } from "@/lib/types";
import { FLIGHT_MS, PILE_BAR, PILE_COLOR, PILE_SHAPE, easeInOut, planArrivals, type PileShape } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

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
    case "sphere": return <sphereGeometry args={[0.065, 10, 8]} />;
    case "octahedron": return <octahedronGeometry args={[0.08, 0]} />;
    case "bar": return <boxGeometry args={[PILE_BAR[0], PILE_BAR[1], PILE_BAR[2]]} />;
    case "dome": return <sphereGeometry args={[0.08, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />;
    case "torus": return <torusGeometry args={[0.062, 0.014, 6, 20]} />;
  }
}

/** Places every instance of one pile for time `now`; returns true while any is waiting or flying. */
function place(mesh: InstancedMesh, lane: Lane, dir: Direction, w: Work, layout: Layout3D, now: number): boolean {
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

export function EvidencePiles3D({ scene, layout, tokens }: { scene: Scene; layout: Layout3D; tokens: Tokens3D }) {
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
        const slot = scene.slots.findIndex((sl) => sl.ref === item.ref);
        const from = slot >= 0 ? layout.slots[slot] : undefined;
        const to = pileSpot(layout, item.direction, idx, [0, 0, 0]);
        if (!from || !to || idx >= PILE_CAP) continue;
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
  }, [scene, tally, layout, invalidate]);

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

/**
 * Flat tray under the reader pool and the piles in `rail` (no shadows, no transparency). Unlit and not tone-mapped:
 * a Lambert plane under these two lights came out darker than `surface` in the dark theme (a black slab), breaking
 * DESIGN.md's ground < surface < rail order, so the tray shows the rail token exactly.
 */
export function Tray3D({ layout, tokens }: { layout: Layout3D; tokens: Tokens3D }) {
  const t = layout.tray;
  if (!t) return null;
  return (
    <mesh position={[(t.x0 + t.x1) / 2, t.y, (t.z0 + t.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[t.x1 - t.x0, t.z1 - t.z0]} />
      <meshBasicMaterial color={tokens.rail} toneMapped={false} />
    </mesh>
  );
}
