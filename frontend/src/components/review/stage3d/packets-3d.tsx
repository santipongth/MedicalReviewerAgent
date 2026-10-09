"use client";
// Fixed pool of packet spheres in one InstancedMesh. Packets come only from takeFreshPulses/planDots on a scene
// change, with `seen` initialised at mount (a replay or a burst never queues minutes of animation). The frame loop
// runs (invalidates) only while a packet is waiting for its delay or in flight; no per-frame allocations.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { planDots, takeFreshPulses, type Scene } from "@/lib/agent-scene";
import { arc3X, arc3Y, arc3Z, type Layout3D } from "@/lib/agent-layout-3d";
import { MAX_DOTS, PACKET_CAP } from "../stage/packet-layer";
import { PACKET_COLOR, easeInOut, flightT, makeFlights, packetScale, schedulePackets, type Flight } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const R = 0.07;

interface Pool { flights: Flight[]; cursor: number; obj: Object3D; color: Color }
const makePool = (): Pool => ({ flights: makeFlights(MAX_DOTS), cursor: 0, obj: new Object3D(), color: new Color() });

function paint(mesh: InstancedMesh, pool: Pool, tokens: Tokens3D): void {
  for (let i = 0; i < pool.flights.length; i++) mesh.setColorAt(i, pool.color.set(tokens[PACKET_COLOR[pool.flights[i].kind]]));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Advances every flight to `now`; hides idle/pending/finished instances. Returns true while any is pending/flying. */
function step(mesh: InstancedMesh, pool: Pool, now: number): boolean {
  const { flights, obj } = pool;
  let busy = false;
  let dirty = false;
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (!f.seg) continue;
    const t = flightT(f, now);
    dirty = true;
    if (t > 1) {
      f.seg = null; // finished: hide
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
  if (dirty) mesh.instanceMatrix.needsUpdate = true;
  return busy;
}

export function Packets3D({ scene, layout, tokens }: { scene: Scene; layout: Layout3D; tokens: Tokens3D }) {
  const mesh = useRef<InstancedMesh>(null);
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
    if (mesh.current && pool.current && step(mesh.current, pool.current, performance.now())) invalidate();
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false}>
      <sphereGeometry args={[R, 12, 8]} />
      <meshStandardMaterial roughness={1} metalness={0} />
    </instancedMesh>
  );
}
