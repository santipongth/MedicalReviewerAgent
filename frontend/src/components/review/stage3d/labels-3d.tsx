"use client";
// Thai labels are DOM (drei Html), never canvas text: one per visible agent (AGENT_LABEL lines + count, ✓/✕ shape cue),
// a single reader-pool summary (counts only: unfinished papers are "กำลังอ่านหรือรอคิว", never refs shown as being
// read now; ✓ / ✕ / flag counts), one count label per non-empty evidence pile (Glyph + count + flag count) and the
// piles' caption ("ทิศทางผลตามที่เอเจนต์อ่าน": a model judgement, never a ranking). All aria-hidden and
// pointer-events:none; the text ledger and the evidence board below the stage stay the accessible source of truth.
import { Html } from "@react-three/drei";
import { AGENT_LABEL, PIPELINE, countFor, type Scene } from "@/lib/agent-scene";
import type { Layout3D } from "@/lib/agent-layout-3d";
import { READING_OR_QUEUED } from "@/lib/copy";
import { DIRECTION_ORDER, liveTally } from "@/lib/live-evidence";
import { FLAG_PATHS, Glyph } from "@/components/ui/evidence";
import { CHECK, CROSS } from "../stage/icons";
import { NODE_VISUAL, pileCaptionAt, pileLabelAt, poolLabelAt, poolSummary, visibleAgents } from "./model-3d";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const Z_RANGE: [number, number] = [10, 0]; // keep labels below page chrome (drei's default is ~16.7M)
const LABEL_DROP = 0.62; // world units below a node centre: clears the ring (radius 0.42, 1.12x when active) so labels hang from there
const SIDE_GAP = 0.55; // the external node's label sits left of its ring (the thought label may float above it)
const BOX = "pointer-events-none select-none whitespace-nowrap rounded-sm bg-surface/85 px-1 text-center font-display text-xs leading-tight";
export const PILES_CAPTION = "ทิศทางผลตามที่เอเจนต์อ่าน";

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

const LINE_PX = 15; // text-xs leading-tight line box

function PileLabels({ scene, layout }: { scene: Scene; layout: Layout3D }) {
  const tally = liveTally(scene);
  const captionAt = pileCaptionAt(layout);
  if (tally.counted === 0 || !captionAt) return null;
  // the caption shares the labels' anchor row and is pushed below their tallest (glyph / count / flag count) line box
  const lines = DIRECTION_ORDER.some((d) => tally.groups[d].some((it) => it.uncertain)) ? 3 : 2;
  return (
    <>
      {DIRECTION_ORDER.map((d) => {
        const items = tally.groups[d];
        const at = pileLabelAt(layout, d);
        if (items.length === 0 || !at) return null;
        const flagged = items.filter((it) => it.uncertain).length;
        return (
          <Html key={d} position={at} pointerEvents="none" zIndexRange={Z_RANGE}>
            <div aria-hidden="true" data-label3d={`pile-${d}`} className="pointer-events-none select-none -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface/85 text-center font-display text-xs leading-tight text-ink" style={NUM}>
              <div><Glyph direction={d} lang="th" /></div>
              <div data-count>{items.length}</div>
              {flagged > 0 && <div className="text-warn"><Flag />{flagged}</div>}
            </div>
          </Html>
        );
      })}
      <Html position={captionAt} pointerEvents="none" zIndexRange={Z_RANGE}>
        <div
          aria-hidden="true" data-label3d="piles" className={`${BOX} -translate-x-1/2 text-muted`}
          style={{ marginTop: lines * LINE_PX + 4 }}
        >
          {PILES_CAPTION}
        </div>
      </Html>
    </>
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
        const side = id === "external"; // the side node sits over the lane; its label goes to its left
        return (
          <Html
            key={id} position={[p[0] - (side ? SIDE_GAP : 0), p[1] - (side ? 0 : LABEL_DROP), p[2]]} pointerEvents="none"
            zIndexRange={Z_RANGE}
          >
            <div aria-hidden="true" data-label3d={id} data-status={st} className={`${BOX} ${side ? "-translate-x-full -translate-y-1/2 text-right" : "-translate-x-1/2"} ${v.dim ? "text-muted" : "text-ink"}`}>
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
        <Html position={poolAt} pointerEvents="none" zIndexRange={Z_RANGE}>
          <div aria-hidden="true" data-label3d="pool" className={`${BOX} -translate-x-full -translate-y-1/2 text-right text-ink`}>
            {pool.pending > 0 && <div style={NUM}>{pool.pending} ฉบับ{READING_OR_QUEUED}</div>}
            <div>
              <span className="mr-2" style={NUM}><Mark d={CHECK} cls="text-ok" /> {pool.ok}</span>
              <span className="mr-2" style={NUM}><Mark d={CROSS} cls="text-err" /> {pool.failed}</span>
              <span style={NUM}><Flag /> {pool.uncertain}</span>
            </div>
          </div>
        </Html>
      )}
      <PileLabels scene={scene} layout={layout} />
    </>
  );
}
