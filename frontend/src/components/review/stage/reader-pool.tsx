"use client";
import { m, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { ReaderSlot, SlotState } from "@/lib/agent-scene";
import { REF_FONT, type StageLayout } from "@/lib/agent-layout";
import { FLAG_PATHS } from "@/components/ui/evidence";
import { CHECK, CROSS } from "./icons";
import { useChangedSinceMount } from "./use-changed";

const RING: Record<SlotState, string> = {
  waiting: "stroke-rule", reading: "stroke-primary", ok: "stroke-ok", failed: "stroke-err", uncertain: "stroke-warn",
};

function Slot({ slot, r }: { slot: ReaderSlot; r: number }) {
  const st = slot.state;
  return (
    <>
      <circle
        r={r} className={`fill-surface ${RING[st]}${st === "reading" ? " stage-pulse" : ""}`}
        strokeWidth={st === "reading" ? 1.5 : 1.25} strokeDasharray={st === "waiting" ? "3 3" : undefined}
      />
      {st === "reading" && slot.ref && (
        <text textAnchor="middle" y={4} fontSize={REF_FONT} className="font-display fill-ink" style={{ fontVariantNumeric: "tabular-nums" }}>{slot.ref}</text>
      )}
      {st === "ok" && <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      {st === "failed" && <path d={CROSS} fill="none" className="stroke-err" strokeWidth={1.5} strokeLinecap="round" />}
      {st === "uncertain" && (
        <g transform="translate(-4.8 -4.8) scale(.8)" className="fill-warn">
          <path d={FLAG_PATHS[0]} />
          <path d={FLAG_PATHS[1]} />
        </g>
      )}
    </>
  );
}

const RIPPLE_S = 0.018; // per slot, only among slots that started reading in the same scene update

/** Position (0, 1, ...) of each slot that entered "reading" in this update, in slot order; others are absent. */
export function burstRanks(prev: ReaderSlot[], next: ReaderSlot[]): Map<number, number> {
  const ranks = new Map<number, number>();
  next.forEach((s, i) => {
    if (s.state === "reading" && prev[i]?.state !== "reading") ranks.set(i, ranks.size);
  });
  return ranks;
}

function PoolSlot({ slot, r, x, y, rank }: { slot: ReaderSlot; r: number; x: number; y: number; rank: number }) {
  const reduced = useReducedMotion();
  // no pop on first mount (finished or replayed run) or under reduced motion (MotionConfig does not stop opacity)
  const pop = useChangedSinceMount(slot.state) && !reduced;
  return (
    <g data-testid={`reader-${slot.state}`} data-pop={pop ? "1" : "0"} transform={`translate(${x} ${y})`}>
      {/* each state change pops the slot (keyed on state); a burst ripples in slot order (Plan 17b) */}
      <m.g key={slot.state} initial={pop ? { scale: 0.55, opacity: 0.35 } : false} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18, delay: slot.state === "reading" ? rank * RIPPLE_S : 0 }}>
        <Slot slot={slot} r={r} />
      </m.g>
    </g>
  );
}

/** One round slot per paper. A "reading" slot means reading or queued behind the LLM limit; it never claims to be in flight. */
export function ReaderPool({ slots, layout }: { slots: ReaderSlot[]; layout: StageLayout }) {
  // the ripple is ranked within the burst, so a slot that starts reading alone pops at once
  const [seen, setSeen] = useState(slots);
  const [ranks, setRanks] = useState<Map<number, number>>(() => new Map());
  if (seen !== slots) {
    setSeen(slots);
    setRanks(burstRanks(seen, slots));
  }
  return (
    <g data-cluster="readers">
      {layout.slots.map((p, i) => {
        const slot = slots[i];
        if (!slot) return null;
        return <PoolSlot key={i} slot={slot} r={layout.slotR} x={p.x} y={p.y} rank={ranks.get(i) ?? 0} />;
      })}
    </g>
  );
}
