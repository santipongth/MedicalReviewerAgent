"use client";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { stageCaption, type ReaderSlot, type Scene } from "@/lib/agent-scene";
import { arc, SLOT_R, type Pt } from "@/lib/agent-layout";
import {
  PHASE_NOTE, TEAM, handoffs, memberLabel, teamOf, teamSummary, type MemberState, type TeamOpts,
} from "@/lib/agent-team";
import { handoffDots, lookToward } from "@/lib/team-motion";
import type { Connection } from "@/lib/use-review";
import { numbersIn, withNumbers } from "../stage/count-up";
import { StageMotion } from "../stage/motion";
import { PacketDot, type DotHandle } from "../stage/packet-layer";
import { ReaderPool } from "../stage/reader-pool";
import { LegendGroup, LegendItem, PapersLegendGroup } from "../stage/stage-legend";
import { useWide } from "../stage/use-wide";
import { AgentAvatar, AVATAR_BOX } from "./agent-avatar";
import { PhaseLabels, PhaseRing } from "./phase-ring";
import { SpeechBubble, type BubbleTone } from "./speech-bubble";
import { CHECK } from "../stage/icons";

const DOTS = 12;
const LOOK_MS = 700; // a packet's flight
const POOL_COLS = 10;
const PITCH = 28;

/** Reader slots in a 10-column grid (the steps view's pool geometry, in the card's own svg). */
function poolSlots(n: number): Pt[] {
  return Array.from({ length: Math.min(n, 30) }, (_, i) => ({ x: PITCH / 2 + (i % POOL_COLS) * PITCH, y: PITCH / 2 + Math.floor(i / POOL_COLS) * PITCH }));
}

/** A count in a tally that counts up to its new value (display only; React always renders the final text). */
function CountUpText({ text, className }: { text: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const prev = useRef<string | null>(null);
  const latest = useRef(text);
  const reduced = useReducedMotion();
  useLayoutEffect(() => { latest.current = text; }, [text]);
  useEffect(() => {
    const from = prev.current;
    prev.current = text;
    const node = el.current;
    if (reduced || !node || from === null || from === text) return;
    const a = numbersIn(from);
    const b = numbersIn(text);
    if (a.length !== b.length || b.every((v, i) => v === a[i])) return;
    const ctl = animate(0, 1, {
      duration: 0.6, ease: "easeOut",
      onUpdate: (t) => { node.textContent = withNumbers(text, b.map((v, i) => a[i] + (v - a[i]) * t)); },
      onComplete: () => { node.textContent = text; },
    });
    return () => { ctl.stop(); node.textContent = latest.current; };
  }, [text, reduced]);
  return <span ref={el} className={className}>{text}</span>;
}

/** Wide avatars grow with the box (container units on the stage box), so a 1440px stage is not half empty. */
const AV_WIDE = "clamp(72px, 9cqw - 10px, 100px)";

function Avatar({ m, wide }: { m: MemberState; wide: boolean }) {
  const h = AVATAR_BOX / 2;
  return (
    <svg aria-hidden="true" data-avatar-svg viewBox={`${-h} ${-h} ${AVATAR_BOX} ${AVATAR_BOX}`}
      className={`flex-none overflow-visible ${wide ? "size-(--av)" : "size-[68px]"}`}>
      <PhaseRing phase={m.phase} passed={m.passed} />
      <AgentAvatar id={m.id} status={m.status} />
    </svg>
  );
}

function Pool({ slots, fixedRows }: { slots: ReaderSlot[]; fixedRows: boolean }) {
  const rows = fixedRows ? 3 : Math.max(1, Math.ceil(slots.length / POOL_COLS));
  const layout = useMemo(() => ({ slots: poolSlots(slots.length), slotR: SLOT_R }), [slots.length]);
  if (!fixedRows && slots.length === 0) return null;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${POOL_COLS * PITCH} ${rows * PITCH}`} className="block h-auto w-full max-w-[280px]" data-pool>
      <ReaderPool slots={slots} layout={layout} />
    </svg>
  );
}

function toneOf(m: MemberState, speaking: boolean): BubbleTone {
  if (m.status === "failed") return "alert";
  if (speaking) return "speaking";
  return m.status === "working" || m.status === "paused" ? "working" : "quiet";
}

function MemberCard({ m, speaking, wide, slots }: { m: MemberState; speaking: boolean; wide: boolean; slots: ReaderSlot[] }) {
  const name = TEAM.find((t) => t.id === m.id)!.name;
  const reader = m.id === "reader";
  const tone = toneOf(m, speaking);
  const head = (
    <>
      <span className="block font-display text-[13px] font-semibold leading-5 text-ink @min-[1100px]:text-sm">{name}</span>
      <span className="block min-h-4 font-display text-xs leading-4 tabular-nums text-muted" data-tally>
        {m.tally && <CountUpText text={m.tally} />}
      </span>
    </>
  );
  const phases = <PhaseLabels name={name} phase={m.phase} passed={m.passed} cols={wide ? 2 : 4} />;
  const card = `min-w-0 rounded-sm border ${speaking ? "border-primary bg-rail" : "border-rule bg-surface"}`;
  const data = { "data-member": m.id, "data-status": m.status, "data-phase": m.phase ?? "none", "data-speaking": speaking ? "1" : "0" };
  if (wide && !reader) {
    return (
      <li aria-label={memberLabel(m)} {...data} className={`${card} flex flex-col items-center gap-(--gap) px-2.5 pt-(--gap) pb-2.5 text-center`}>
        <Avatar m={m} wide />
        <div>{head}</div>
        {phases}
        <div className="mt-1.5 w-full text-left"><SpeechBubble text={m.line} tone={tone} tail="up" /></div>
      </li>
    );
  }
  if (wide) {
    // the reader: avatar beside its name and phases, then the speech (tail under the avatar) and the reader pool
    return (
      <li aria-label={memberLabel(m)} {...data} className={`${card} flex flex-col gap-(--gap) px-2.5 pt-(--gap) pb-2.5`}>
        <div className="flex items-center gap-3">
          <Avatar m={m} wide />
          <div className="grid min-w-0 gap-1">{head}{phases}</div>
        </div>
        <div className="mt-1.5"><SpeechBubble text={m.line} tone={tone} tail="up" tailAt="calc(var(--av) / 2)" lines={3} /></div>
        <div className="flex flex-1 items-center justify-center"><Pool slots={slots} fixedRows /></div>
      </li>
    );
  }
  return (
    <li aria-label={memberLabel(m)} {...data} className={`${card} grid gap-2 p-2.5`}>
      <div className="flex items-start gap-2.5">
        <Avatar m={m} wide={false} />
        <div className="grid min-w-0 flex-1 gap-1 pt-0.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">{head}</div>
          {phases}
          <div className="ml-1.5 mt-1"><SpeechBubble text={m.line} tone={tone} tail="left" /></div>
        </div>
      </div>
      {reader && <Pool slots={slots} fixedRows={false} />}
    </li>
  );
}

/**
 * Hand-off packets between avatars: an overlay svg in CSS pixels over the cards. It carries the stage's role="img" and
 * the team summary. Avatar centres are measured when a hand-off launches, so the arcs follow any layout. Only pulses
 * newer than those seen at mount animate (a replayed run shows its final state at once), and the sender glances at
 * the receiver while its packet flies. Nothing renders in motion under reduced motion.
 */
function TeamPackets({ scene, box, label, wide }: { scene: Scene; box: RefObject<HTMLDivElement | null>; label: string; wide: boolean }) {
  const reduced = useReducedMotion();
  const seen = useRef(scene.lastSeq);
  const next = useRef(0);
  const dots = useRef<(DotHandle | null)[]>([]);
  const timers = useRef<number[]>([]);
  const [setters] = useState(() => Array.from({ length: DOTS }, (_, i) => (h: DotHandle | null) => { dots.current[i] = h; }));
  const latest = useRef(scene);
  useEffect(() => { latest.current = scene; });
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const seq = scene.lastSeq;
  useEffect(() => {
    const fresh = handoffs(latest.current, seen.current);
    seen.current = seq;
    const root = box.current;
    if (reduced || fresh.length === 0 || !root || (typeof document !== "undefined" && document.hidden)) return;
    const b = root.getBoundingClientRect();
    const centre = (id: string): Pt | null => {
      const el = root.querySelector(`[data-member="${id}"] [data-avatar-svg]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
    };
    for (const d of handoffDots(fresh, DOTS)) {
      const a = centre(d.from);
      const z = centre(d.to);
      const h = dots.current[next.current];
      next.current = (next.current + 1) % DOTS;
      if (!a || !z || !h) continue;
      h.launch(arc(a, z, wide ? 0.2 : 0.12), d.kind, d.delayMs);
      const eyes = root.querySelector(`[data-member="${d.from}"] [data-eyes]`);
      if (eyes) {
        const dir = lookToward(a, z);
        timers.current.push(window.setTimeout(() => eyes.setAttribute("data-look", dir), d.delayMs));
        timers.current.push(window.setTimeout(() => eyes.removeAttribute("data-look"), d.delayMs + LOOK_MS));
      }
    }
    if (timers.current.length > 64) timers.current = timers.current.slice(-64);
  }, [seq, reduced, box, wide]);
  return (
    <svg role="img" aria-label={label} className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" data-team-overlay>
      {!reduced && (
        <g aria-hidden="true">
          {Array.from({ length: DOTS }, (_, i) => <PacketDot key={i} handle={setters[i]} />)}
        </g>
      )}
    </svg>
  );
}

function TeamLegend() {
  return (
    <ul aria-label="สัญลักษณ์" className="flex flex-wrap gap-x-10 gap-y-2 text-xs text-muted">
      <LegendGroup title="ขั้นคิด">
        <LegendItem sample={<rect x={-4} y={-4} width={8} height={8} rx={1} className="fill-primary" />}>ขั้นที่กำลังทำ</LegendItem>
        <LegendItem sample={<path d={CHECK} fill="none" className="stroke-ink" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}>ผ่านแล้ว</LegendItem>
        <LegendItem sample={<rect x={-3.5} y={-3.5} width={7} height={7} rx={1} fill="none" className="stroke-rule" strokeWidth={1} />}>ยังไม่ถึง</LegendItem>
      </LegendGroup>
      <PapersLegendGroup />
    </ul>
  );
}

/**
 * The live run as a team of five AI agents (Plan 18): each a flat robot head with a four-phase ring, its phase names
 * as text, and a speech bubble built only from received events (agent-team.ts). Wide: five cards in a row inside the
 * steps view's constant 960/288 box (the reader's card is wider and holds the reader pool). Narrow: a vertical list.
 */
export function TeamStage({ scene, connection, ...opts }: { scene: Scene; connection?: Connection } & TeamOpts) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const { framework, question } = opts;
  const team = useMemo(() => teamOf(scene, { framework, question }), [scene, framework, question]);
  const label = useMemo(() => teamSummary(scene, { framework, question }), [scene, framework, question]);
  const caption = stageCaption(scene, connection);
  return (
    <StageMotion>
      <figure className="grid gap-2" data-team-stage={wide ? "wide" : "narrow"}>
        <div ref={box} data-stage-box className={`relative w-full ${wide ? "@container aspect-[960/288]" : "mx-auto max-w-[560px]"}`}>
          <TeamPackets scene={scene} box={box} label={label} wide={wide} />
          <ol aria-label="สมาชิกทีมเอเจนต์" style={wide ? { ["--av" as string]: AV_WIDE, ["--gap" as string]: "clamp(6px, 0.9cqw, 12px)" } : undefined}
            className={wide ? "grid h-full grid-cols-[1fr_1fr_1fr_1.45fr_1fr] gap-2.5" : "grid gap-2"}>
            {team.members.map((m) => (
              <MemberCard key={m.id} m={m} speaking={team.speaking === m.id} wide={wide} slots={m.id === "reader" ? scene.slots : []} />
            ))}
          </ol>
        </div>
        <div className="grid gap-2 border-t border-rule pt-3">
          <TeamLegend />
          <p className="text-xs text-muted" data-phase-note>{PHASE_NOTE}</p>
          {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
        </div>
      </figure>
    </StageMotion>
  );
}
