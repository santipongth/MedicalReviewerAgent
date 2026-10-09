import type { Scene } from "@/lib/agent-scene";
import type { StageLayout } from "@/lib/agent-layout";
import { CHECK } from "./icons";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

/** Screening batches: the first `batches` pulse until `screened`, then all are done; the caption is the kept/cut split. */
export function ScreenBatches({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const finished = scene.agents.screen === "done";
  const zone = layout.zone.screen;
  const { kept, screenedTotal, batches } = scene.counts;
  return (
    <g data-cluster="batches">
      {layout.batchChips.map((r, i) => {
        const state = finished ? "done" : i < batches ? "active" : "pending";
        const cls = state === "done" ? "stroke-ink" : state === "active" ? "stroke-primary stage-pulse" : "stroke-rule";
        return (
          <g key={i} data-batch={state}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2} className={`fill-surface ${cls}`} strokeWidth={state === "active" ? 1.5 : 1} />
            {state === "done" && (
              <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${r.x + r.w / 2} ${r.y + r.h / 2})`} />
            )}
          </g>
        );
      })}
      {zone && finished && screenedTotal > 0 && (
        <text x={zone.x + zone.w / 2} y={zone.y + zone.h + 12} textAnchor="middle" fontSize={10} className="font-display fill-muted" style={NUM} data-caption="screened">
          {`ผ่าน ${kept} · ตัดออก ${Math.max(0, screenedTotal - kept)}`}
        </text>
      )}
    </g>
  );
}
