"use client";
// One agent: a small flat-shaded icosahedron core inside a torus ring. Colour and ring style come from NODE_VISUAL;
// no emissive glow. The ring rotates only while the agent is `working`; it does not request frames itself (Stage3D's
// SpinTicker requests a throttled frame while any ring spins), it just advances on whatever frames get drawn.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { AgentStatus } from "@/lib/agent-scene";
import type { Vec3 } from "@/lib/agent-layout-3d";
import { NODE_VISUAL } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const CORE_R = 0.22;
const RING_R = 0.42;
const TUBE = 0.03;
const DASHES = 8;
const DASH_ARC = (Math.PI * 2) / DASHES / 1.8; // dash length; the remaining part of each 1/8th is the gap
const SPIN = 0.9; // rad/s

export function Node3D({ at, status, tokens }: { at: Vec3; status: AgentStatus; tokens: Tokens3D }) {
  const v = NODE_VISUAL[status];
  const color = tokens[v.color];
  const ring = useRef<Group>(null);
  useFrame((_state, delta) => {
    if (!v.spin || !ring.current) return;
    ring.current.rotation.z += SPIN * Math.min(delta, 0.1);
  });
  return (
    <group position={at} scale={v.scale}>
      <mesh>
        <icosahedronGeometry args={[CORE_R, 0]} />
        <meshStandardMaterial color={color} flatShading roughness={1} metalness={0} />
      </mesh>
      <group ref={ring}>
        {v.ring === "dashed" ? (
          Array.from({ length: DASHES }, (_, i) => (
            <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / DASHES]}>
              <torusGeometry args={[RING_R, TUBE, 6, 6, DASH_ARC]} />
              <meshStandardMaterial color={color} roughness={1} metalness={0} />
            </mesh>
          ))
        ) : (
          <mesh>
            <torusGeometry args={[RING_R, v.ring === "wire" ? TUBE * 0.6 : TUBE, 8, 48]} />
            <meshStandardMaterial color={color} wireframe={v.ring === "wire"} roughness={1} metalness={0} />
          </mesh>
        )}
      </group>
    </group>
  );
}
