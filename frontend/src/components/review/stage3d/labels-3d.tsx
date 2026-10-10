"use client";
// Thai labels are DOM (drei Html), never canvas text: each member's name under its feet (with the ✓ / ✕ shape cue,
// and the active phase for the speaking member), one speech bubble over the speaking member (its line from
// agent-team.ts, built only from received events), one count label per non-empty evidence pile (Glyph + count + flag
// count) and the piles' caption ("ทิศทางผลตามที่เอเจนต์อ่าน": a model judgement, never a ranking). All aria-hidden and
// pointer-events:none; the stage's role="img" summary, the text ledger and the evidence board below the stage stay the
// accessible source of truth.
import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import type { Scene } from "@/lib/agent-scene";
import type { TeamLayout3D } from "@/lib/agent-layout-3d";
import { PHASE_LABEL, TEAM, type MemberState, type Team } from "@/lib/agent-team";
import { DIRECTION_ORDER, liveTally } from "@/lib/live-evidence";
import { FLAG_PATHS, Glyph } from "@/components/ui/evidence";
import { CHECK, CROSS } from "../stage/icons";
import { bubbleAnchor, bubbleLeader, memberVisual, nameAnchor, pileCaptionAt, pileLabelAt } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const Z_RANGE: [number, number] = [10, 0]; // keep labels below page chrome (drei's default is ~16.7M)
const BOX = "pointer-events-none select-none whitespace-nowrap rounded-sm bg-surface/85 px-1 text-center font-display text-xs leading-tight";
export const PILES_CAPTION = "ทิศทางผลตามที่เอเจนต์อ่าน";
export const BUBBLE_MAX_PX = 260;
const TAIL_INSET_PX = 24; // = BUBBLE_TAIL_IN in world units at the fitted distance

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

export function PileLabels({ scene, layout }: { scene: Scene; layout: Pick<TeamLayout3D, "piles"> }) {
  const tally = liveTally(scene);
  const captionAt = pileCaptionAt(layout);
  if (tally.counted === 0 || !captionAt) return null;
  // one line per pile (glyph, count, flag count); the caption shares the labels' anchor row and is pushed below them
  return (
    <>
      {DIRECTION_ORDER.map((d) => {
        const items = tally.groups[d];
        const at = pileLabelAt(layout, d);
        if (items.length === 0 || !at) return null;
        const flagged = items.filter((it) => it.uncertain).length;
        return (
          <Html key={d} position={at} pointerEvents="none" zIndexRange={Z_RANGE}>
            <div aria-hidden="true" data-label3d={`pile-${d}`} className="pointer-events-none flex select-none -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-sm bg-surface/85 px-0.5 font-display text-xs leading-tight text-ink" style={NUM}>
              <Glyph direction={d} lang="th" />
              <span data-count>{items.length}</span>
              {flagged > 0 && <span className="text-warn"><Flag />{flagged}</span>}
            </div>
          </Html>
        );
      })}
      <Html position={captionAt} pointerEvents="none" zIndexRange={Z_RANGE}>
        <div
          aria-hidden="true" data-label3d="piles" className={`${BOX} -translate-x-1/2 text-muted`}
          style={{ marginTop: LINE_PX + 4 }}
        >
          {PILES_CAPTION}
        </div>
      </Html>
    </>
  );
}

function NameLabel({ m, speaking, layout }: { m: MemberState; speaking: boolean; layout: TeamLayout3D }) {
  const v = memberVisual(m.status, speaking);
  const name = TEAM.find((t) => t.id === m.id)!.name;
  return (
    <Html position={nameAnchor(layout, m.id)} pointerEvents="none" zIndexRange={Z_RANGE}>
      <div
        aria-hidden="true" data-label3d={m.id} data-status={m.status} data-speaking={speaking ? "1" : "0"}
        className={`${BOX} -translate-x-1/2 ${speaking ? "font-semibold text-ink" : v.dim ? "text-muted" : "text-ink"}`}
      >
        {name}
        {speaking && m.phase && <span className="font-normal text-primary"> · {PHASE_LABEL[m.phase]}</span>}
        {v.mark === "done" && <> <Mark d={CHECK} cls="text-ok" /></>}
        {v.mark === "failed" && <> <Mark d={CROSS} cls="text-err" /></>}
      </div>
    </Html>
  );
}

/** The speaking member's line in the 2D bubble's style (bordered, primary edge, tail down to its tiles, no shadow). */
function Bubble({ m, layout, tokens }: { m: MemberState; layout: TeamLayout3D; tokens: Tokens3D }) {
  const text = m.line.trim();
  const at = bubbleAnchor(layout, m.id);
  const leader = useMemo(() => bubbleLeader(layout, m.id), [layout, m.id]);
  if (text === "") return null;
  const alert = m.status === "failed";
  const align = layout.members[m.id].bubble;
  // the end members' bubbles grow inward from a tail TAIL_INSET_PX from their outer edge, so they stay in the box
  const shift = align === "start" ? `translate(-${TAIL_INSET_PX}px, -100%)`
    : align === "end" ? `translate(calc(-100% + ${TAIL_INSET_PX}px), -100%)` : "translate(-50%, -100%)";
  const tail = align === "start" ? { left: TAIL_INSET_PX - 7 } : align === "end" ? { right: TAIL_INSET_PX - 7 } : { left: "calc(50% - 7px)" };
  return (
    <>
      {/* a lifted bubble hangs from a hairline `rule` leader down to its member's tiles */}
      {leader && <Line points={leader} color={tokens.rule} lineWidth={1} />}
      <Html position={at} pointerEvents="none" zIndexRange={Z_RANGE}>
        <div aria-hidden="true" data-label3d="bubble" data-member={m.id} data-align={align}
          className="pointer-events-none relative w-max select-none pb-[7px]"
          style={{ maxWidth: BUBBLE_MAX_PX, transform: shift }}>
          <div className={`rounded-sm border px-2.5 py-1.5 ${alert ? "border-err bg-err-bg" : "border-primary bg-surface"}`}>
            <p className="line-clamp-3 whitespace-normal break-words text-xs leading-[1.45] tabular-nums text-ink">{text}</p>
          </div>
          <svg aria-hidden="true" width="14" height="8" viewBox="0 0 14 8" className="absolute bottom-0 overflow-visible" style={tail}>
            <path d="M0.5 0 L7 7 L13.5 0" className={alert ? "fill-err-bg stroke-err" : "fill-surface stroke-primary"} strokeWidth={1} strokeLinejoin="round" />
          </svg>
        </div>
      </Html>
    </>
  );
}

export function TeamLabels3D({ team, layout, tokens }: { team: Team; layout: TeamLayout3D; tokens: Tokens3D }) {
  const speaker = team.speaking ? team.members.find((m) => m.id === team.speaking) : undefined;
  return (
    <>
      {team.members.map((m) => <NameLabel key={m.id} m={m} speaking={team.speaking === m.id} layout={layout} />)}
      {speaker && <Bubble m={speaker} layout={layout} tokens={tokens} />}
    </>
  );
}
