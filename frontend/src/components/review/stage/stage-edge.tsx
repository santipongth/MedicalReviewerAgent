"use client";
import { m } from "motion/react";
import type { EdgeState } from "@/lib/agent-scene";

const STYLE: Record<EdgeState, { cls: string; w: number }> = {
  idle: { cls: "stroke-rule", w: 1 },
  visited: { cls: "stroke-ink", w: 1 }, // ghost edge
  live: { cls: "stroke-primary", w: 1.5 },
};

/**
 * A pipeline edge. When an edge goes live, its primary stroke draws itself from the sending agent to the receiving one
 * (Plan 17b), so the hand-off reads as a direction; the base stroke underneath always shows the edge's state, so a
 * skipped animation (reduced motion) still shows the right picture.
 */
export function StageEdge({ d, state }: { d: string; state: EdgeState }) {
  const s = STYLE[state];
  return (
    <g data-edge-state={state}>
      <path d={d} fill="none" className={state === "live" ? STYLE.visited.cls : s.cls} strokeWidth={state === "live" ? 1 : s.w} />
      {state === "live" && (
        <m.path
          d={d} fill="none" className={s.cls} strokeWidth={s.w} strokeLinecap="round" data-edge-draw
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }}
        />
      )}
    </g>
  );
}
