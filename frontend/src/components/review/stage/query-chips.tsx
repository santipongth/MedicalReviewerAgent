import type { Scene } from "@/lib/agent-scene";
import { clip, queryChars, type StageLayout } from "@/lib/agent-layout";
import { CHECK } from "./icons";

const MAX_CHIPS = 4;

/**
 * One row per planned query (max 4 + "+n"): a check mark and the query text, the full text in <title>. Rows exist only
 * once `planning` has delivered the queries, and that same event finishes plan, so every row is drawn done (there is
 * no pending state to show). Wide rows are right-aligned to the plan tile; narrow rows are left-aligned.
 */
export function QueryChips({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const total = scene.queries.length;
  const end = layout.queryAlign === "end";
  return (
    <g data-cluster="queries">
      {layout.queryChips.map((r, i) => {
        const more = total > MAX_CHIPS && i === MAX_CHIPS;
        const full = more ? `+${total - MAX_CHIPS}` : (scene.queries[i] ?? "");
        const text = more ? full : clip(full, queryChars(r.w));
        const base = r.y + 13;
        // end: text ends 16px before the row's right edge, the check sits in that gap; start: check first, then text
        const tx = end ? r.x + r.w - 16 : r.x + 16;
        const cx = end ? r.x + r.w - 6 : r.x + 5;
        return (
          <g key={i} data-chip="done">
            <title>{more ? `อีก ${total - MAX_CHIPS} คำค้น` : full}</title>
            <text x={tx} y={base} textAnchor={end ? "end" : "start"} fontSize={12} className={more ? "font-display fill-muted" : "font-code fill-muted"}>{text}</text>
            {!more && (
              <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${cx} ${base - 4})`} />
            )}
          </g>
        );
      })}
    </g>
  );
}
