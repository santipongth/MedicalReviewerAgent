import type { Scene } from "@/lib/agent-scene";
import type { StageLayout } from "@/lib/agent-layout";

/**
 * The search engines the search agent queries, as a compact list (status dot + name) in the search column. The dots
 * fill only while search is working/active. No per-source counts: the events carry only the merged total, so nothing
 * here implies per-engine progress.
 */
export function SearchSatellites({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  if (!layout.nodes.search) return null;
  const lit = scene.agents.search === "working" || scene.agents.search === "active";
  return (
    <g data-cluster="satellites" data-lit={lit ? "true" : "false"}>
      {layout.satellites.map((s) => (
        <g key={s.label} data-satellite={s.label}>
          <circle cx={s.at.x} cy={s.at.y} r={3.5} className={lit ? "fill-primary stroke-primary" : "fill-surface stroke-muted"} strokeWidth={1.25} />
          <text x={s.text.x} y={s.text.y} fontSize={12} className="font-display fill-muted">{s.label}</text>
        </g>
      ))}
    </g>
  );
}
