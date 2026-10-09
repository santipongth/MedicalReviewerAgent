import type { ReaderSlot, SlotState } from "@/lib/agent-scene";
import { REF_FONT, type StageLayout } from "@/lib/agent-layout";
import { FLAG_PATHS } from "@/components/ui/evidence";
import { CHECK, CROSS } from "./icons";

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

/** One round slot per paper. A "reading" slot means reading or queued behind the LLM limit; it never claims to be in flight. */
export function ReaderPool({ slots, layout }: { slots: ReaderSlot[]; layout: StageLayout }) {
  return (
    <g data-cluster="readers">
      {layout.slots.map((p, i) => {
        const slot = slots[i];
        if (!slot) return null;
        return (
          <g key={i} data-testid={`reader-${slot.state}`} transform={`translate(${p.x} ${p.y})`}>
            <Slot slot={slot} r={layout.slotR} />
          </g>
        );
      })}
    </g>
  );
}
