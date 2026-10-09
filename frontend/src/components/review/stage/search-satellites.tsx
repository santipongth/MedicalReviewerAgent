import type { Scene } from "@/lib/agent-scene";
import type { StageLayout } from "@/lib/agent-layout";

/**
 * The search engines the hub fans out to. They light up only while search is working/active.
 * No per-source counts: the events carry only the merged total, so nothing here implies per-engine progress.
 */
export function SearchSatellites({ scene, layout }: { scene: Scene; layout: StageLayout }) {
  const hub = layout.nodes.search;
  if (!hub) return null;
  const lit = scene.agents.search === "working" || scene.agents.search === "active";
  const wide = layout.kind === "wide";
  return (
    <g data-cluster="satellites" data-lit={lit ? "true" : "false"}>
      {layout.satellites.map((s) => {
        const tx = wide ? (s.anchor === "end" ? s.at.x - 8 : s.anchor === "start" ? s.at.x + 8 : s.at.x) : s.at.x;
        const ty = wide ? (s.anchor === "middle" ? s.at.y - 8 : s.at.y + 3) : s.at.y + 14;
        return (
          <g key={s.label} data-satellite={s.label}>
            <line x1={hub.x} y1={hub.y} x2={s.at.x} y2={s.at.y} className="stroke-rule" strokeWidth={1} />
            <circle cx={s.at.x} cy={s.at.y} r={5} className={`fill-surface ${lit ? "stroke-primary" : "stroke-rule"}`} strokeWidth={1.25} />
            <text x={tx} y={ty} textAnchor={wide ? s.anchor : "middle"} fontSize={10} className="font-display fill-muted">{s.label}</text>
          </g>
        );
      })}
    </g>
  );
}
