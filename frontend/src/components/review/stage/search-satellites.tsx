import type { Scene } from "@/lib/agent-scene";
import type { StageLayout } from "@/lib/agent-layout";

/**
 * The search engines the hub fans out to. They light up only while search is working/active.
 * No per-source counts: the events carry only the merged total, so nothing here implies per-engine progress.
 */
export function SearchSatellites({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  if (!layout.nodes.search) return null;
  const lit = scene.agents.search === "working" || scene.agents.search === "active";
  return (
    <g data-cluster="satellites" data-lit={lit ? "true" : "false"}>
      {layout.satellites.map((s) => (
        <g key={s.label} data-satellite={s.label}>
          <line x1={s.from.x} y1={s.from.y} x2={s.at.x} y2={s.at.y} className="stroke-rule" strokeWidth={1} />
          <circle cx={s.at.x} cy={s.at.y} r={5} className={`fill-surface ${lit ? "stroke-primary" : "stroke-rule"}`} strokeWidth={1.25} />
          <text x={s.text.x} y={s.text.y} textAnchor={s.anchor} fontSize={12} className="font-display fill-muted">{s.label}</text>
        </g>
      ))}
    </g>
  );
}
