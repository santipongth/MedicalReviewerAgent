"use client";
// One pipeline edge drawn along its cached quadratic arc: idle `rule`, visited `ink`, live `primary` (and thicker).
import { QuadraticBezierLine } from "@react-three/drei";
import type { EdgeState } from "@/lib/agent-scene";
import type { Seg3 } from "@/lib/agent-layout-3d";
import { EDGE_COLOR } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

export function Edge3D({ seg, state, tokens }: { seg: Seg3; state: EdgeState; tokens: Tokens3D }) {
  return (
    <QuadraticBezierLine
      start={seg.a} mid={seg.c} end={seg.b}
      color={tokens[EDGE_COLOR[state]]} lineWidth={state === "live" ? 2.5 : 1.25}
    />
  );
}
