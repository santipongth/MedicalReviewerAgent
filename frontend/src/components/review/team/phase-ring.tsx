"use client";
import { m, useReducedMotion } from "motion/react";
import { PHASES, PHASE_LABEL, type Phase } from "@/lib/agent-team";
import { CHECK } from "../stage/icons";
import { useChangedSinceMount } from "../stage/use-changed";

export const RING_R = 39;
const GAP_DEG = 8; // half the gap between two segments

export type SegState = "active" | "passed" | "rest";
/** The state of each phase segment: the current phase is active, the ones behind it passed, the rest not reached. */
export function segState(p: Phase, phase: Phase | null, passed: readonly Phase[]): SegState {
  if (p === phase) return "active";
  return passed.includes(p) ? "passed" : "rest";
}

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
};
/** Segment i of four, clockwise from 12 o'clock (คิด, วิเคราะห์, วางแผน, ลงมือ). */
export function segPath(i: number, r = RING_R): string {
  return `M ${pt(i * 90 + GAP_DEG, r)} A ${r} ${r} 0 0 1 ${pt((i + 1) * 90 - GAP_DEG, r)}`;
}

const SEG: Record<SegState, { cls: string; w: number }> = {
  active: { cls: "stroke-primary", w: 4 },
  passed: { cls: "stroke-ink", w: 2.5 },
  rest: { cls: "stroke-rule", w: 2 },
};

function Segment({ i, state }: { i: number; state: SegState }) {
  const reduced = useReducedMotion();
  // a segment that becomes active live draws itself clockwise (600ms, like an edge going live); final state otherwise
  const draw = useChangedSinceMount(state) && state === "active" && !reduced;
  const s = SEG[state];
  return (
    <g data-seg={PHASES[i]} data-state={state}>
      {state === "active" && <path d={segPath(i)} fill="none" className={SEG.rest.cls} strokeWidth={SEG.rest.w} strokeLinecap="round" />}
      <m.path key={state} d={segPath(i)} fill="none" className={s.cls} strokeWidth={s.w} strokeLinecap="round"
        initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} />
    </g>
  );
}

/** Four arc segments around the avatar (SVG group). The labels are text in PhaseLabels, never colour alone. */
export function PhaseRing({ phase, passed }: { phase: Phase | null; passed: readonly Phase[] }) {
  return (
    <g aria-hidden="true" data-phase-ring>
      {PHASES.map((p, i) => <Segment key={p} i={i} state={segState(p, phase, passed)} />)}
    </g>
  );
}

/** Marker shape per state: filled square (now), check (passed), hollow square (not reached): shape as well as colour. */
function Marker({ state }: { state: SegState }) {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="-5 -5 10 10" className="flex-none">
      {state === "active" && <rect x={-4} y={-4} width={8} height={8} rx={1} className="fill-primary" />}
      {state === "passed" && <path d={CHECK} fill="none" className="stroke-ink" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      {state === "rest" && <rect x={-3.5} y={-3.5} width={7} height={7} rx={1} fill="none" className="stroke-rule" strokeWidth={1} />}
    </svg>
  );
}

/** The four phase names as text, in order; the current one is marked with aria-current="step". */
export function PhaseLabels({ name, phase, passed, cols }: { name: string; phase: Phase | null; passed: readonly Phase[]; cols: 2 | 4 }) {
  return (
    <ol aria-label={`ขั้นของ${name}`}className={`grid font-display text-xs leading-4 ${cols === 2 ? "grid-cols-2 gap-x-2 gap-y-0.5" : "grid-flow-col justify-start gap-x-3"}`}>
      {PHASES.map((p) => {
        const st = segState(p, phase, passed);
        return (
          <li key={p} data-phase={p} data-state={st} aria-current={st === "active" ? "step" : undefined}
            className={`flex items-center gap-1 whitespace-nowrap ${st === "active" ? "font-semibold text-ink" : st === "passed" ? "text-ink" : "text-muted"}`}>
            <Marker state={st} />
            {PHASE_LABEL[p]}
          </li>
        );
      })}
    </ol>
  );
}
