"use client";
// Eases the camera toward a goal (6 numbers: position + look-at; for the team, a partial pan toward the speaking
// member, the whole table stays framed). Requests frames only while moving. Under reduced motion this view is never
// offered, but the rig still jumps instead of easing.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Camera } from "three";
import { easeToward } from "./model-3d";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Rig { cur: number[]; goal: number[]; moving: boolean; reduced: boolean; placed: boolean }

function apply(camera: Camera, cur: number[]): void {
  camera.position.set(cur[0], cur[1], cur[2]);
  camera.lookAt(cur[3], cur[4], cur[5]);
}

export function CameraRig({ goal }: { goal: readonly number[] }) {
  const invalidate = useThree((s) => s.invalidate);
  const rig = useRef<Rig>({ cur: [0, 0, 0, 0, 0, 0], goal: [0, 0, 0, 0, 0, 0], moving: false, reduced: false, placed: false });

  useEffect(() => {
    const r = rig.current;
    for (let i = 0; i < 6; i++) r.goal[i] = goal[i];
    r.reduced = prefersReduced(); // read on goal change, not per frame
    if (!r.placed) {
      // first placement starts on the goal (no fly-in)
      for (let i = 0; i < 6; i++) r.cur[i] = r.goal[i];
      r.placed = true;
    }
    r.moving = true;
    invalidate();
  }, [goal, invalidate]);

  useFrame((state, delta) => {
    const r = rig.current;
    if (!r.moving) return;
    const settled = easeToward(r.cur, r.goal, delta, r.reduced);
    apply(state.camera, r.cur);
    if (settled) r.moving = false;
    else state.invalidate();
  });

  return null;
}
