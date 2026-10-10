"use client";
import { m, useReducedMotion } from "motion/react";
import type { EdgeState } from "@/lib/agent-scene";
import { useChangedSinceMount } from "./use-changed";

const STYLE: Record<EdgeState, { cls: string; w: number }> = {
  idle: { cls: "stroke-rule", w: 1 },
  visited: { cls: "stroke-ink", w: 1 }, // ghost edge
  live: { cls: "stroke-primary", w: 1.5 },
};

/**
 * A pipeline edge. When an edge goes live, its primary stroke draws itself from the sending agent to the receiving one
 * (Plan 17b), so the hand-off reads as a direction; the base stroke underneath always shows the edge's state, so a
 * skipped animation still shows the right picture. No draw-in under reduced motion (MotionConfig does not stop
 * pathLength) or on first mount (a finished or replayed run shows its final state at once).
 */
export function StageEdge({ d, state }: { d: string; state: EdgeState }) {
  const s = STYLE[state];
  const reduced = useReducedMotion();
  const changed = useChangedSinceMount(state);
  const draw = changed && !reduced;
  return (
    <g data-edge-state={state}>
      <path d={d} fill="none" className={state === "live" ? STYLE.visited.cls : s.cls} strokeWidth={state === "live" ? 1 : s.w} />
      {state === "live" && (
        <m.path
          d={d} fill="none" className={s.cls} strokeWidth={s.w} strokeLinecap="round" data-edge-draw={draw ? "in" : "final"}
          initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
    </g>
  );
}
