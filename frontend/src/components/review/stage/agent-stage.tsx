"use client";
// Adapts ideas from AI-Agent-observatory by sakshigupta372, used with the author's permission.
// See NOTICE.md at the repo root.
import { useMemo } from "react";
import { m } from "motion/react";
import { AGENT_LABEL, PIPELINE, currentAgent, readDone, sceneSummary, type AgentId, type Scene } from "@/lib/agent-scene";
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

function countFor(s: Scene, id: AgentId): string | undefined {
  const c = s.counts;
  switch (id) {
    case "search": return c.found > 0 ? String(c.found) : undefined;
    case "enrich": return c.candidates > 0 ? String(c.candidates) : undefined;
    case "screen": return c.screenedTotal > 0 ? `${c.kept}/${c.screenedTotal}` : undefined;
    case "read": return s.slots.length > 0 ? `${readDone(s)}/${s.slots.length}` : undefined;
    default: return undefined;
  }
}

export function AgentStage({ scene, connection }: { scene: Scene; connection?: Connection }) {
  const wide = useWide();
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
  const synthWorking = scene.agents.synth === "working";

  // At most one caption, as the last child of the figure. Polling wins: it explains why the stage updates in steps.
  const caption = connection === "polling" ? "อัปเดตทุกไม่กี่วินาที" : scene.status === "waiting" ? "รอคิว · เอเจนต์จะเริ่มทำงานเมื่อถึงคิว" : null;

  return (
    <StageMotion>
      <figure className="grid gap-2">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={sceneSummary(scene)} className="h-auto w-full max-w-[960px]">
          {(Object.keys(layout.zone) as AgentId[]).map((id) => {
            const r = layout.zone[id]!;
            return (
              <m.rect
                key={id} data-zone={id} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} className="fill-rail"
                initial={false} animate={{ opacity: tinted === id ? 1 : 0 }} transition={{ duration: 0.3, ease: "easeOut" }}
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
          {synthWorking && synth && (
            <text
              x={wide ? synth.x : 14} y={wide ? layout.height - 8 : synth.y + 38} textAnchor={wide ? "middle" : "start"}
              fontSize={10} className="font-display fill-muted" data-caption="synth"
            >
              กำลังเทียบผลและเขียนสรุป (ขั้นนี้ไม่มีความคืบหน้าให้ดู)
            </text>
          )}
          <PacketLayer scene={scene} layout={layout} />
        </svg>
        <StageLegend />
        {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
      </figure>
    </StageMotion>
  );
}
