"use client";
// One pipeline edge drawn as a thin flat-shaded tube along its cached quadratic arc: idle `rule`, visited `ink`, live
// `primary` (and thicker, EDGE_RADIUS). The tube is rebuilt only when the arc or the radius changes, and disposed.
import { useEffect, useMemo } from "react";
import { QuadraticBezierCurve3, TubeGeometry, Vector3 } from "three";
import type { EdgeState } from "@/lib/agent-scene";
import type { Seg3 } from "@/lib/agent-layout-3d";
import { EDGE_COLOR, EDGE_RADIUS } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const SEGMENTS = 32;
const RADIAL = 6;

export function Edge3D({ seg, state, tokens }: { seg: Seg3; state: EdgeState; tokens: Tokens3D }) {
  const radius = EDGE_RADIUS[state];
  const geo = useMemo(() => {
    const curve = new QuadraticBezierCurve3(new Vector3(...seg.a), new Vector3(...seg.c), new Vector3(...seg.b));
    return new TubeGeometry(curve, SEGMENTS, radius, RADIAL, false);
  }, [seg, radius]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={tokens[EDGE_COLOR[state]]} flatShading roughness={1} metalness={0} />
    </mesh>
  );
}
