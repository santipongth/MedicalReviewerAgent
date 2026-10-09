import type { Scene } from "@/lib/agent-scene";
import { clip, type StageLayout } from "@/lib/agent-layout";
import { CHECK } from "./icons";

const MAX_CHIPS = 4;

/**
 * One chip per planned query (max 4 + "+n"). Chips exist only once `planning` has delivered the queries, and that same
 * event finishes plan, so every chip is drawn done (there is no pending state to show).
 */
export function QueryChips({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const total = scene.queries.length;
  return (
    <g data-cluster="queries">
      {layout.queryChips.map((r, i) => {
        const more = total > MAX_CHIPS && i === MAX_CHIPS;
        const full = more ? `+${total - MAX_CHIPS}` : (scene.queries[i] ?? "");
        const max = Math.min(26, Math.floor((r.w - 18) / 7.2)); // ~7.2px per 12px code glyph
        const text = more ? full : clip(full, max);
        return (
          <g key={i} data-chip="done">
            <title>{full}</title>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2} className="fill-surface stroke-ink" strokeWidth={1} />
            <text x={r.x + 6} y={r.y + 13} fontSize={12} className="font-code fill-ink">{text}</text>
            {!more && (
              <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${r.x + r.w - 8} ${r.y + r.h / 2})`} />
            )}
          </g>
        );
      })}
    </g>
  );
}
