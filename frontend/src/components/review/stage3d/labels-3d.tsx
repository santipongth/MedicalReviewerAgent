"use client";
// Thai labels are DOM (drei Html), never canvas text: one per visible agent (AGENT_LABEL lines + count, ✓/✕ shape cue)
// plus a single reader-pool summary (P-refs being read, ✓ / ✕ / flag counts). All aria-hidden and pointer-events:none;
// the text ledger below the stage stays the accessible source of truth.
import { Html } from "@react-three/drei";
import { AGENT_LABEL, PIPELINE, type Scene } from "@/lib/agent-scene";
import type { Layout3D } from "@/lib/agent-layout-3d";
import { FLAG_PATHS } from "@/components/ui/evidence";
import { countFor } from "../stage/agent-stage";
import { CHECK, CROSS } from "../stage/icons";
import { NODE_VISUAL, poolLabelAt, poolSummary, visibleAgents } from "./model-3d";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const Z_RANGE: [number, number] = [10, 0]; // keep labels below page chrome (drei's default is ~16.7M)
const LABEL_DROP = 0.72; // world units below a node centre
const BOX = "pointer-events-none select-none whitespace-nowrap rounded-sm bg-surface/85 px-1 text-center font-display text-xs leading-tight";

function Mark({ d, cls }: { d: string; cls: string }) {
  return (
    <svg width="12" height="12" viewBox="-4 -4 8 8" aria-hidden="true" className={`inline-block align-[-1px] ${cls}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Flag() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor" className="inline-block align-[-1px] text-warn">
      <path d={FLAG_PATHS[0]} />
      <path d={FLAG_PATHS[1]} />
    </svg>
  );
}

export function Labels3D({ scene, layout }: { scene: Scene; layout: Layout3D }) {
  const ids = visibleAgents(layout, PIPELINE);
  const pool = poolSummary(scene);
  const poolAt = poolLabelAt(layout);
  return (
    <>
      {ids.map((id) => {
        const p = layout.nodes[id]!;
        const st = scene.agents[id];
        const v = NODE_VISUAL[st];
        const count = countFor(scene, id);
        const above = id === "external"; // the side node sits over the lane; its label goes on top
        return (
          <Html
            key={id} position={[p[0], p[1] + (above ? LABEL_DROP : -LABEL_DROP), p[2]]} center pointerEvents="none"
            zIndexRange={Z_RANGE}
          >
            <div aria-hidden="true" data-label3d={id} data-status={st} className={`${BOX} ${v.dim ? "text-muted" : "text-ink"}`}>
              {AGENT_LABEL[id].th.map((line, i) => (
                <div key={i}>
                  {line}
                  {i === AGENT_LABEL[id].th.length - 1 && v.mark === "done" && <> <Mark d={CHECK} cls="text-ok" /></>}
                  {i === AGENT_LABEL[id].th.length - 1 && v.mark === "failed" && <> <Mark d={CROSS} cls="text-err" /></>}
                </div>
              ))}
              {count && <div className="text-muted" style={NUM} data-count>{count}</div>}
            </div>
          </Html>
        );
      })}
      {pool.total > 0 && poolAt && (
        <Html position={poolAt} center pointerEvents="none" zIndexRange={Z_RANGE}>
          <div aria-hidden="true" data-label3d="pool" className={`${BOX} text-ink`}>
            {pool.reading.length > 0 && (
              <span className="mr-2" style={NUM}>
                {pool.reading.join(" ")}{pool.more > 0 ? ` +${pool.more}` : ""}
              </span>
            )}
            <span className="mr-2" style={NUM}><Mark d={CHECK} cls="text-ok" /> {pool.ok}</span>
            <span className="mr-2" style={NUM}><Mark d={CROSS} cls="text-err" /> {pool.failed}</span>
            <span style={NUM}><Flag /> {pool.uncertain}</span>
          </div>
        </Html>
      )}
    </>
  );
}
