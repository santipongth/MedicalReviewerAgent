import { m } from "motion/react";
import type { AgentId, AgentStatus } from "@/lib/agent-scene";
import type { Pt } from "@/lib/agent-layout";
import { CHECK, CROSS, ICON } from "./icons";

const SIZE = 44;
const HALF = SIZE / 2;

const STROKE: Record<AgentStatus, { cls: string; w: number; dash?: string }> = {
  idle: { cls: "stroke-rule", w: 1 },
  active: { cls: "stroke-primary", w: 2 },
  working: { cls: "stroke-primary", w: 1.5, dash: "4 3" },
  done: { cls: "stroke-ink", w: 1 },
  failed: { cls: "stroke-err", w: 2 },
  skipped: { cls: "stroke-rule", w: 1, dash: "4 3" },
  paused: { cls: "stroke-warn", w: 1 },
};

const NUM = { fontVariantNumeric: "tabular-nums" } as const;
export const LABEL_FONT = 12; // >= 12px effective: narrow viewBox is ~1:1 at 390px, wide is >= ~0.96 from 1024px up
const COUNT_GAP = 17; // label baseline -> count baseline: a 12px Thai glyph cell is ~17px tall, so the boxes never meet
/** Label baseline under the tile (wide): the count always sits on the next fixed baseline, COUNT_GAP lower. */
export const LABEL_BELOW = HALF + 16;

export interface AgentNodeProps {
  id: AgentId;
  at: Pt; // tile centre
  status: AgentStatus;
  label: string[]; // predefined parts (AGENT_LABEL[id].th), drawn joined on one line
  count?: string; // e.g. "87", "30/60"
  labelAt?: "below" | "right";
}

/** One agent tile. Dimming uses `muted` colours, never opacity. */
export function AgentNode({ id, at, status, label, count, labelAt = "below" }: AgentNodeProps) {
  const st = STROKE[status];
  const dim = status === "idle" || status === "skipped";
  const iconCls = dim ? "stroke-muted" : status === "failed" ? "stroke-err" : "stroke-ink";
  const textCls = dim ? "fill-muted" : "fill-ink";
  const right = labelAt === "right";
  const lx = right ? HALF + 8 : 0;
  const hasCount = count != null && count !== "";
  // One line, never broken inside a Thai word. Below: label and count on fixed baselines shared by every tile.
  // Right (narrow): the label is centred on the tile, or the label + count pair is when there is a count.
  const ly = right ? (hasCount ? -4 : 4) : LABEL_BELOW;
  const cy = right ? 13 : LABEL_BELOW + COUNT_GAP;
  return (
    <g data-agent={id} data-status={status} transform={`translate(${at.x} ${at.y})`}>
      <m.g animate={{ scale: status === "active" ? 1.06 : 1 }} transition={{ duration: 0.2, ease: "easeOut" }}>
        <rect
          x={-HALF} y={-HALF} width={SIZE} height={SIZE} rx={2}
          className={`${status === "paused" ? "fill-warn-bg" : "fill-surface"} ${st.cls}${status === "working" ? " stage-march" : ""}`}
          strokeWidth={st.w}
          strokeDasharray={st.dash}
        />
        <path d={ICON[id]} fill="none" className={iconCls} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
        {status === "done" && (
          <g transform={`translate(${HALF - 5} ${-HALF + 5})`} data-mark="done">
            <circle r={5} className="fill-surface stroke-ink" strokeWidth={1} />
            <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" transform="scale(.8)" />
          </g>
        )}
        {status === "failed" && (
          <g transform={`translate(${HALF - 5} ${-HALF + 5})`} data-mark="failed">
            <circle r={5} className="fill-surface stroke-err" strokeWidth={1} />
            <path d={CROSS} fill="none" className="stroke-err" strokeWidth={1.25} strokeLinecap="round" transform="scale(.8)" />
          </g>
        )}
      </m.g>
      <text x={lx} y={ly} textAnchor={right ? "start" : "middle"} className={`font-display ${textCls}`} fontSize={LABEL_FONT}>
        {label.join("")}
      </text>
      {hasCount && (
        <text x={lx} y={cy} textAnchor={right ? "start" : "middle"} className="font-display fill-muted" style={NUM} fontSize={LABEL_FONT} data-count>
          {count}
        </text>
      )}
    </g>
  );
}
