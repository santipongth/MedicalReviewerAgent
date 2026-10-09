import type { EdgeState } from "@/lib/agent-scene";

const STYLE: Record<EdgeState, { cls: string; w: number }> = {
  idle: { cls: "stroke-rule", w: 1 },
  visited: { cls: "stroke-ink", w: 1 }, // ghost edge
  live: { cls: "stroke-primary", w: 1.5 },
};

/** A pipeline edge. No CSS animation: motion along edges is carried by packets only. */
export function StageEdge({ d, state }: { d: string; state: EdgeState }) {
  const s = STYLE[state];
  return <path d={d} fill="none" className={s.cls} strokeWidth={s.w} data-edge-state={state} />;
}
