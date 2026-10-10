"use client";
// One team member as a flat geometric robot: a short cylinder body, a box head with two sphere eyes, a stick antenna
// with a ball, and four flat phase tiles on an arc above the head (คิด, วิเคราะห์, วางแผน, ลงมือ, left to right).
// Colours come from memberVisual / TILE_COLOR (tokens only, no emissive glow). While the member works, a thin ring
// grows and fades around the antenna ball (the 2D `stage-ping`); it does not request frames itself (Stage3D's
// SpinTicker requests a throttled frame while any member pings), it just advances on whatever frames get drawn.
// Also the low round table the team stands around.
import { Edges } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshStandardMaterial } from "three";
import {
  ANTENNA_H, BALL_R, BALL_Y, BODY_H, BODY_R, EYE_DX, EYE_R, HEAD, HEAD_Y, TABLE_LEG_R, TABLE_T, TILE, TILE_T,
  type Member3D, type TeamLayout3D,
} from "@/lib/agent-layout-3d";
import { PHASES, type MemberStatus, type Phase } from "@/lib/agent-team";
import { TILE_COLOR, memberVisual, tileState } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const PING_S = 1.8; // seconds per ping (Plan 17b)
const PING_R = 0.11;
const ACTIVE_TILE_SCALE = 1.2;

function Mat({ color }: { color: string }) {
  return <meshStandardMaterial color={color} flatShading roughness={1} metalness={0} />;
}

function Ping({ at, color }: { at: readonly [number, number, number]; color: string }) {
  const ping = useRef<Mesh>(null);
  useFrame((state) => {
    const p = ping.current;
    if (!p) return;
    const k = (state.clock.elapsedTime % PING_S) / PING_S; // frames come from the spin ticker while working
    p.scale.setScalar(1 + k * 1.0);
    (p.material as MeshStandardMaterial).opacity = 0.55 * (1 - k);
  });
  return (
    <mesh ref={ping} position={[at[0], at[1], at[2]]}>
      <torusGeometry args={[PING_R, 0.012, 6, 40]} />
      <meshStandardMaterial color={color} transparent opacity={0.55} depthWrite={false} roughness={1} metalness={0} />
    </mesh>
  );
}

export function Robot3D({ m, status, speaking, phase, passed, tokens }: {
  m: Member3D; status: MemberStatus; speaking: boolean; phase: Phase | null; passed: readonly Phase[]; tokens: Tokens3D;
}) {
  const v = memberVisual(status, speaking);
  const fill = tokens[v.fill];
  const edge = tokens[v.edge];
  const eyes = tokens[v.eyes];
  return (
    <group>
      <group position={m.feet} rotation={[0, m.yaw, 0]}>
        <mesh position={[0, BODY_H / 2, 0]}>
          {/* 8 sides: a flat, faceted body whose vertical edges carry the outline */}
          <cylinderGeometry args={[BODY_R, BODY_R * 1.08, BODY_H, 8]} />
          <Mat color={fill} />
          <Edges color={edge} threshold={20} />
        </mesh>
        <mesh position={[0, HEAD_Y, 0]}>
          <boxGeometry args={HEAD} />
          <Mat color={fill} />
          <Edges color={edge} />
        </mesh>
        {[-EYE_DX, EYE_DX].map((x) => (
          <mesh key={x} position={[x, HEAD_Y + 0.02, HEAD[2] / 2]}>
            <sphereGeometry args={[EYE_R, 12, 8]} />
            <Mat color={eyes} />
          </mesh>
        ))}
        <mesh position={[0, HEAD_Y + HEAD[1] / 2 + ANTENNA_H / 2, 0]}>
          <cylinderGeometry args={[0.018, 0.018, ANTENNA_H, 6]} />
          <Mat color={edge} />
        </mesh>
        <mesh position={[0, BALL_Y, 0]}>
          <sphereGeometry args={[BALL_R, 12, 8]} />
          <Mat color={edge} />
        </mesh>
      </group>
      {v.ping && <Ping at={m.ball} color={tokens.primary} />}
      {PHASES.map((p, i) => {
        const st = tileState(p, phase, passed);
        const active = st === "active";
        return (
          <mesh
            key={p} position={active ? m.raised[i] : m.tiles[i]} rotation={[0, 0, m.tileRot[i]]}
            scale={active ? ACTIVE_TILE_SCALE : 1}
          >
            <boxGeometry args={[TILE, TILE, TILE_T]} />
            <Mat color={tokens[TILE_COLOR[st]]} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * The low round table: a thin top in `rail` with a `rule` rim and a short pedestal. Unlit and not tone-mapped (a lit
 * top came out darker than `surface` in the dark theme), so it shows the tokens exactly.
 */
export function Table3D({ table, tokens }: { table: TeamLayout3D["table"]; tokens: Tokens3D }) {
  const [x, y, z] = table.at;
  const legH = y - TABLE_T;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, y - TABLE_T / 2, 0]} scale={[table.stretch, 1, 1]}>
        <cylinderGeometry args={[table.r, table.r, TABLE_T, 64]} />
        <meshBasicMaterial attach="material-0" color={tokens.rule} toneMapped={false} />
        <meshBasicMaterial attach="material-1" color={tokens.rail} toneMapped={false} />
        <meshBasicMaterial attach="material-2" color={tokens.rule} toneMapped={false} />
      </mesh>
      <mesh position={[0, legH / 2, 0]}>
        <cylinderGeometry args={[TABLE_LEG_R, TABLE_LEG_R * 1.3, legH, 24]} />
        <meshBasicMaterial color={tokens.rule} toneMapped={false} />
      </mesh>
    </group>
  );
}
