import type { Scene } from "@/lib/agent-scene";
import type { StageLayout } from "@/lib/agent-layout";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * Screening as one segmented bar, a segment per expected batch: pending segments are outlined, the first `batches`
 * are solid `primary` and pulse until `screened`, then every segment is solid `ink`. The caption is the kept/cut split.
 */
export function ScreenBatches({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const finished = scene.agents.screen === "done";
  const { kept, screenedTotal, batches } = scene.counts;
  const note = layout.notes.screen;
  return (
    <g data-cluster="batches">
      {layout.batchChips.map((r, i) => {
        const state = finished ? "done" : i < batches ? "active" : "pending";
        const cls = state === "done" ? "fill-ink stroke-ink" : state === "active" ? "fill-primary stroke-primary stage-pulse" : "fill-surface stroke-rule";
        return <rect key={i} data-batch={state} x={r.x} y={r.y} width={r.w} height={r.h} rx={1} className={cls} strokeWidth={1} />;
      })}
      {layout.batchChips.length > 0 && finished && screenedTotal > 0 && (
        <text x={note.x} y={note.y} textAnchor={note.anchor} fontSize={12} className="font-display fill-muted" style={NUM} data-caption="screened">
          {`ผ่าน ${kept} · ตัดออก ${Math.max(0, screenedTotal - kept)}`}
        </text>
      )}
    </g>
  );
}
