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

export interface AgentNodeProps {
  id: AgentId;
  at: Pt; // tile centre
  status: AgentStatus;
  label: string[]; // predefined lines (AGENT_LABEL[id].th)
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
  // right: the label block (plus count line) is centred on the tile; count sits one line below the last label line
  const lines = label.length + (hasCount ? 1 : 0);
  const ly = right ? -((lines - 1) * 6) + 3 : HALF + 12;
  const cy = ly + label.length * 12;
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
      <text x={lx} y={ly} textAnchor={right ? "start" : "middle"} className={`font-display ${textCls}`} fontSize={10}>
        {label.map((line, i) => (
          <tspan key={i} x={lx} dy={i === 0 ? 0 : 12}>{line}</tspan>
        ))}
      </text>
      {hasCount && (
        <text x={lx} y={cy} textAnchor={right ? "start" : "middle"} className="font-display fill-muted" style={NUM} fontSize={10} data-count>
          {count}
        </text>
      )}
    </g>
  );
}
