"use client";
// Fixed pool of packet spheres in one InstancedMesh. Packets come only from takeFreshPulses/planDots on a scene
// change, with `seen` initialised at mount (a replay or a burst never queues minutes of animation). The frame loop
// runs (invalidates) only while a packet is waiting for its delay or in flight; no per-frame allocations.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { MAX_DOTS, PACKET_CAP, planDots, takeFreshPulses, type Scene } from "@/lib/agent-scene";
import { arc3X, arc3Y, arc3Z, type Layout3D } from "@/lib/agent-layout-3d";
import { PACKET_COLOR, easeInOut, flightT, makeFlights, packetScale, schedulePackets, type Flight } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const R = 0.07;

interface Pool { flights: Flight[]; cursor: number; obj: Object3D; color: Color }
const makePool = (): Pool => ({ flights: makeFlights(MAX_DOTS), cursor: 0, obj: new Object3D(), color: new Color() });

function paint(mesh: InstancedMesh, pool: Pool, tokens: Tokens3D): void {
  for (let i = 0; i < pool.flights.length; i++) mesh.setColorAt(i, pool.color.set(tokens[PACKET_COLOR[pool.flights[i].kind]]));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

const TRAIL = [0.06, 0.12]; // trailing ghosts (Plan 17b), as fractions of the flight behind the packet
const TRAIL_SCALE = [0.7, 0.45];

/** Places (or hides) the trailing ghosts of flight `i` in the trail mesh. */
function stepTrail(trail: InstancedMesh | null, pool: Pool, i: number, t: number | null): void {
  if (!trail) return;
  const { flights, obj } = pool;
  const f = flights[i];
  for (let j = 0; j < TRAIL.length; j++) {
    const tj = t === null ? -1 : t - TRAIL[j];
    if (f.seg && tj >= 0 && tj <= 1) {
      const e = easeInOut(tj);
      obj.position.set(arc3X(f.seg, e), arc3Y(f.seg, e), arc3Z(f.seg, e));
      obj.scale.setScalar(packetScale(tj) * TRAIL_SCALE[j]);
    } else obj.scale.setScalar(0);
    obj.updateMatrix();
    trail.setMatrixAt(i * TRAIL.length + j, obj.matrix);
  }
}

/** Advances every flight to `now`; hides idle/pending/finished instances. Returns true while any is pending/flying. */
function step(mesh: InstancedMesh, pool: Pool, now: number, trail: InstancedMesh | null = null): boolean {
  const { flights, obj } = pool;
  let busy = false;
  let dirty = false;
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (!f.seg) continue;
    const t = flightT(f, now);
    dirty = true;
    stepTrail(trail, pool, i, t);
    if (t > 1 + TRAIL[TRAIL.length - 1]) {
      f.seg = null; // finished, wake included: hide
      obj.scale.setScalar(0);
    } else if (t > 1) {
      busy = true; // the head has landed; its wake is still catching up
      obj.scale.setScalar(0);
    } else if (t < 0) {
      busy = true; // waiting for its delay
      obj.scale.setScalar(0);
    } else {
      busy = true;
      const e = easeInOut(t);
      obj.position.set(arc3X(f.seg, e), arc3Y(f.seg, e), arc3Z(f.seg, e));
      obj.scale.setScalar(packetScale(t));
    }
    obj.updateMatrix();
    mesh.setMatrixAt(i, obj.matrix);
  }
  if (dirty) {
    mesh.instanceMatrix.needsUpdate = true;
    if (trail) trail.instanceMatrix.needsUpdate = true;
  }
  return busy;
}

export function Packets3D({ scene, layout, tokens }: { scene: Scene; layout: Layout3D; tokens: Tokens3D }) {
  const mesh = useRef<InstancedMesh>(null);
  const trail = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const seen = useRef(scene.lastSeq); // pulses that existed at mount are never animated
  const pool = useRef<Pool | null>(null); // preallocated; a ref because the frame loop mutates it in place
  const latest = useRef({ scene, layout, tokens });
  useEffect(() => { latest.current = { scene, layout, tokens }; });

  // hide every instance and give instanceColor a buffer before the first frame
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    pool.current ??= makePool();
    const p = pool.current;
    p.obj.scale.setScalar(0);
    p.obj.updateMatrix();
    for (let i = 0; i < MAX_DOTS; i++) m.setMatrixAt(i, p.obj.matrix);
    m.instanceMatrix.needsUpdate = true;
    const tr = trail.current;
    if (tr) {
      for (let i = 0; i < MAX_DOTS * TRAIL.length; i++) tr.setMatrixAt(i, p.obj.matrix);
      tr.instanceMatrix.needsUpdate = true;
    }
    paint(m, p, latest.current.tokens);
  }, []);

  useEffect(() => {
    if (mesh.current && pool.current) paint(mesh.current, pool.current, tokens);
    invalidate();
  }, [tokens, invalidate]);

  const seq = scene.lastSeq;
  useEffect(() => {
    const { scene: sc, layout: lay, tokens: tk } = latest.current;
    const fresh = takeFreshPulses(sc.pulses, seen.current, PACKET_CAP);
    seen.current = seq;
    const p = pool.current;
    if (!p || fresh.length === 0 || (typeof document !== "undefined" && document.hidden)) return;
    p.cursor = schedulePackets(p.flights, p.cursor, planDots(fresh, MAX_DOTS), lay.edges, performance.now());
    if (mesh.current) paint(mesh.current, p, tk);
    invalidate();
  }, [seq, invalidate]);

  useFrame(() => {
    if (mesh.current && pool.current && step(mesh.current, pool.current, performance.now(), trail.current)) invalidate();
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false}>
        <sphereGeometry args={[R, 12, 8]} />
        <meshStandardMaterial roughness={1} metalness={0} />
      </instancedMesh>
      {/* the wake: two smaller, translucent ghosts per packet, in the muted tone (flat, no glow) */}
      <instancedMesh ref={trail} args={[undefined, undefined, MAX_DOTS * TRAIL.length]} frustumCulled={false}>
        <sphereGeometry args={[R, 10, 6]} />
        <meshStandardMaterial color={tokens.muted} transparent opacity={0.45} depthWrite={false} roughness={1} metalness={0} />
      </instancedMesh>
    </>
  );
}
