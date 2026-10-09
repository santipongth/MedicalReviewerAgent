"use client";
// Eases the camera toward the current agent (a partial pan; the whole lane stays framed). Requests frames only while
// moving. Under reduced motion this view is never offered, but the rig still jumps instead of easing.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Camera } from "three";
import type { AgentId } from "@/lib/agent-scene";
import type { Layout3D } from "@/lib/agent-layout-3d";
import { cameraGoal, easeToward } from "./model-3d";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Rig { cur: number[]; goal: number[]; moving: boolean; reduced: boolean; placed: boolean }

function apply(camera: Camera, cur: number[]): void {
  camera.position.set(cur[0], cur[1], cur[2]);
  camera.lookAt(cur[3], cur[4], cur[5]);
}

export function CameraRig({ layout, agent }: { layout: Layout3D; agent: AgentId | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const rig = useRef<Rig>({ cur: [0, 0, 0, 0, 0, 0], goal: [0, 0, 0, 0, 0, 0], moving: false, reduced: false, placed: false });

  useEffect(() => {
    const r = rig.current;
    cameraGoal(layout, agent, r.goal);
    r.reduced = prefersReduced(); // read on scene change, not per frame
    if (!r.placed) {
      // first placement starts on the goal (no fly-in)
      for (let i = 0; i < 6; i++) r.cur[i] = r.goal[i];
      r.placed = true;
    }
    r.moving = true;
    invalidate();
  }, [layout, agent, invalidate]);

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
