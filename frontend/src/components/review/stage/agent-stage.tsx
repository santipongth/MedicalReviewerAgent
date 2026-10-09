"use client";
// Adapts ideas from AI-Agent-observatory by sakshigupta372, used with the author's permission.
// See NOTICE.md at the repo root.
import { useMemo } from "react";
import { m, useReducedMotion } from "motion/react";
import {
  AGENT_LABEL, PIPELINE, SYNTH_CAPTION, countFor, currentAgent, sceneSummary, showSynthCaption, stageCaption, type AgentId, type Scene,
} from "@/lib/agent-scene";
import { layoutFor } from "@/lib/agent-layout";
import type { Connection } from "@/lib/use-review";
import { AgentNode } from "./agent-node";
import { PacketLayer } from "./packet-layer";
import { QueryChips } from "./query-chips";
import { ReaderPool } from "./reader-pool";
import { ScreenBatches } from "./screen-batches";
import { SearchSatellites } from "./search-satellites";
import { StageEdge } from "./stage-edge";
import { StageLegend } from "./stage-legend";
import { StageMotion } from "./motion";
import { useWide } from "./use-wide";

export function AgentStage({ scene, connection }: { scene: Scene; connection?: Connection }) {
  const wide = useWide();
  // MotionConfig does not cover this WAAPI-backed opacity fade, so reduced motion sets its duration to 0 explicitly.
  const reduced = useReducedMotion() ?? false;
  const kind = wide ? "wide" : "narrow";
  const showLocalize = scene.expectLocalize;
  const showExternal = scene.external;
  const slots = scene.slots.length;
  const batches = scene.counts.batchesExpected;
  const queries = scene.queries.length;
  const layout = useMemo(
    () => layoutFor(kind, { showLocalize, showExternal, slots, batches, queries }),
    [kind, showLocalize, showExternal, slots, batches, queries],
  );
  const cur = currentAgent(scene);
  const tinted: AgentId | null = cur === "synth" ? "read" : cur; // synth has no zone of its own; the pool stays tinted
  const order: AgentId[] = [...PIPELINE.filter((id) => layout.nodes[id]), ...(layout.nodes.external ? (["external"] as AgentId[]) : [])];
  const synth = layout.nodes.synth;
  const synthWorking = showSynthCaption(scene);

  // At most one caption, as the last child of the figure (shared with the 3D view).
  const caption = stageCaption(scene, connection);

  return (
    <StageMotion>
      <figure className="grid gap-2">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={sceneSummary(scene)} className={`h-auto w-full ${wide ? "max-w-[960px]" : "max-w-[480px]"}`}>
          {(Object.keys(layout.zone) as AgentId[]).map((id) => {
            const r = layout.zone[id]!;
            return (
              <m.rect
                key={id} data-zone={id} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} className="fill-rail"
                initial={false} animate={{ opacity: tinted === id ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }} data-fade={reduced ? 0 : 0.3}
              />
            );
          })}
          {layout.edges.map((e) => <StageEdge key={e.id} d={e.d} state={scene.edges[e.id] ?? "idle"} />)}
          <SearchSatellites scene={scene} layout={layout} />
          <QueryChips scene={scene} layout={layout} />
          <ScreenBatches scene={scene} layout={layout} />
          <ReaderPool slots={scene.slots} layout={layout} />
          {order.map((id) => (
            <AgentNode
              key={id} id={id} at={layout.nodes[id]!} status={scene.agents[id]} label={AGENT_LABEL[id].th}
              count={countFor(scene, id)} labelAt={layout.label[id]}
            />
          ))}
          {synthWorking && synth && (wide ? (
            <text x={synth.x} y={layout.height - 8} textAnchor="middle" fontSize={12} className="font-display fill-muted" data-caption="synth">
              {SYNTH_CAPTION.join(" ")}
            </text>
          ) : (
            // narrow: under the synth label (x 66), right of the lane edges (which bulge to x <= 66)
            <text x={70} y={synth.y + 26} textAnchor="start" fontSize={12} className="font-display fill-muted" data-caption="synth">
              {SYNTH_CAPTION.map((line, i) => <tspan key={i} x={70} dy={i === 0 ? 0 : 14}>{line}</tspan>)}
            </text>
          ))}
          <PacketLayer scene={scene} layout={layout} />
        </svg>
        <StageLegend />
        {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
      </figure>
    </StageMotion>
  );
}
