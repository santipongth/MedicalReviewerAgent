"use client";
import { m, useReducedMotion } from "motion/react";
import type { MemberId, MemberStatus } from "@/lib/agent-team";
import { CHECK, CROSS } from "../stage/icons";
import { useChangedSinceMount } from "../stage/use-changed";

/**
 * Geometry (avatar units, centred on 0,0; the phase ring sits outside it at r = RING_R). The head is a 34px square with
 * 2px corners, centred a little low so the antenna and its ping stay inside the ring.
 */
export const AVATAR_BOX = 88; // viewBox side: -44..44
const HEAD = 34;
const HX = -HEAD / 2;
const HY = -13; // head top
const TIP_Y = -25; // antenna tip centre

const HEAD_CLS: Record<MemberStatus, { fill: string; stroke: string; w: number; dash?: string }> = {
  idle: { fill: "fill-surface", stroke: "stroke-muted", w: 1 }, // dimmed with muted (never opacity), thinner than done
  working: { fill: "fill-surface", stroke: "stroke-primary", w: 2 },
  done: { fill: "fill-surface", stroke: "stroke-ink", w: 1.5 },
  failed: { fill: "fill-surface", stroke: "stroke-err", w: 2 },
  paused: { fill: "fill-warn-bg", stroke: "stroke-warn", w: 1.5 },
  stopped: { fill: "fill-surface", stroke: "stroke-muted", w: 1.25, dash: "3 3" },
};
// full class names (Tailwind only generates classes it finds whole in the source)
const FACE: Record<MemberStatus, string> = {
  idle: "fill-muted", working: "fill-ink", done: "fill-ink", failed: "fill-err", paused: "fill-ink", stopped: "fill-muted",
};

/** Blink period (4-6 s) and phase per member, so the team never blinks in unison. */
export const BLINK: Record<MemberId, { dur: number; delay: number }> = {
  planner: { dur: 4.4, delay: -0.6 }, researcher: { dur: 5.6, delay: -2.1 }, screener: { dur: 4.9, delay: -3.4 },
  reader: { dur: 5.3, delay: -1.2 }, synthesizer: { dur: 4.1, delay: -2.8 },
};

/**
 * A flat geometric robot head (SVG group, drawn inside a parent svg): square head, two eye dots, an antenna and a
 * mouth line, all in theme tokens. While working the antenna pings (`stage-ping`) and the eyes blink (CSS loops, both
 * off under reduced motion). Done adds a ✓ badge, failed a ✕ badge. `[data-eyes]` is where a hand-off sets `data-look`
 * so the sender glances at the receiver. Each status change pops the head (live changes only).
 */
export function AgentAvatar({ id, status }: { id: MemberId; status: MemberStatus }) {
  const reduced = useReducedMotion();
  const pop = useChangedSinceMount(status) && !reduced;
  const h = HEAD_CLS[status];
  const face = FACE[status];
  const working = status === "working";
  const blink = BLINK[id];
  return (
    <g data-avatar={id} data-status={status}>
      {working && !reduced && (
        <circle cx={0} cy={TIP_Y} r={6} fill="none" className="stroke-primary stage-ping" strokeWidth={1} data-ping />
      )}
      <m.g key={status} initial={pop ? { scale: 0.8, opacity: 0.4 } : false} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18 }} data-pop={pop ? "1" : "0"}>
        <line x1={0} y1={HY} x2={0} y2={TIP_Y + 3} className={working ? "stroke-primary" : h.stroke} strokeWidth={1.5} />
        <circle cx={0} cy={TIP_Y} r={3} className={working ? "fill-primary" : status === "idle" || status === "stopped" ? "fill-muted" : "fill-ink"} />
        <rect x={HX} y={HY} width={HEAD} height={HEAD} rx={2} className={`${h.fill} ${h.stroke}`} strokeWidth={h.w} strokeDasharray={h.dash} />
        <g data-eyes className="team-eyes">
          <g className={working ? "team-blink" : undefined} style={working ? { animationDuration: `${blink.dur}s`, animationDelay: `${blink.delay}s` } : undefined}>
            <circle cx={-7} cy={1} r={2.6} className={face} />
            <circle cx={7} cy={1} r={2.6} className={face} />
          </g>
        </g>
        <rect x={-6} y={10} width={12} height={2} rx={1} className={`${face} team-mouth`} />
        {status === "done" && (
          <g transform={`translate(${-HX} ${HY})`} data-mark="done">
            <circle r={6} className="fill-surface stroke-ink" strokeWidth={1} />
            <path d={CHECK} fill="none" className="stroke-ok" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
        {status === "failed" && (
          <g transform={`translate(${-HX} ${HY})`} data-mark="failed">
            <circle r={6} className="fill-surface stroke-err" strokeWidth={1} />
            <path d={CROSS} fill="none" className="stroke-err" strokeWidth={1.5} strokeLinecap="round" transform="scale(.85)" />
          </g>
        )}
      </m.g>
    </g>
  );
}
