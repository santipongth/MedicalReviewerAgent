"use client";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChangedSinceMount } from "../stage/use-changed";

export type BubbleTone = "speaking" | "working" | "quiet" | "alert";
export type TailSide = "up" | "left";

/** Grapheme clusters, so typing never splits a Thai vowel or tone mark from its consonant. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: "grapheme" }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg("th", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Typing time: about 22ms per cluster, between 0.35s and 1.1s, so a long line never lags the next event. */
export const typeDuration = (n: number): number => Math.min(1.1, Math.max(0.35, n * 0.022));

const TONE: Record<BubbleTone, { box: string; tail: { fill: string; stroke: string }; text: string }> = {
  speaking: { box: "border-primary bg-surface", tail: { fill: "fill-surface", stroke: "stroke-primary" }, text: "text-ink" },
  working: { box: "border-rule bg-surface", tail: { fill: "fill-surface", stroke: "stroke-rule" }, text: "text-ink" },
  quiet: { box: "border-rule border-dashed bg-transparent", tail: { fill: "fill-surface", stroke: "stroke-rule" }, text: "text-muted" },
  alert: { box: "border-err bg-err-bg", tail: { fill: "fill-err-bg", stroke: "stroke-err" }, text: "text-ink" },
};

function Tail({ side, tone, at }: { side: TailSide; tone: BubbleTone; at?: string }) {
  const t = TONE[tone].tail;
  // An open path (no stroke along the bubble edge): its fill covers the border where the tail joins the box.
  if (side === "up") {
    return (
      <svg aria-hidden="true" width="14" height="8" viewBox="0 0 14 8" style={at !== undefined ? { left: `calc(${at} - 7px)` } : undefined}
        className={`absolute -top-[7px] overflow-visible ${at === undefined ? "left-1/2 -translate-x-1/2" : ""}`}>
        <path d="M0.5 8 L7 1 L13.5 8" className={`${t.fill} ${t.stroke}`} strokeWidth={1} strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="8" height="14" viewBox="0 0 8 14" className="absolute -left-[7px] top-3 overflow-visible">
      <path d="M8 0.5 L1 7 L8 13.5" className={`${t.fill} ${t.stroke}`} strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A member's speech: a bordered box with a tail, no shadow, and no live region (MilestoneStatus stays the only
 * announcer). A line that changes live types itself in (grapheme by grapheme) while the full text stays in the DOM,
 * only transparent until the typing ends; under reduced motion, on mount and for replays the final text shows at once.
 * While typing, the bubble sets `data-typing` on its member card, which moves the avatar's mouth.
 */
export function SpeechBubble({ text, tone, tail, tailAt, lines = 4 }: {
  text: string; tone: BubbleTone; tail: TailSide;
  tailAt?: string; // "up" tails: the tip's x from the bubble's left edge (a CSS length); centred when absent
  lines?: 3 | 4;
}) {
  const reduced = useReducedMotion();
  const live = useChangedSinceMount(text) && !reduced;
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = root.current;
    const out = typed.current;
    if (!live || !box || !out) return;
    const parts = graphemes(text);
    const card = box.closest<HTMLElement>("[data-member]");
    const finish = () => {
      box.removeAttribute("data-typing");
      card?.removeAttribute("data-typing");
      out.textContent = "";
    };
    box.setAttribute("data-typing", "");
    card?.setAttribute("data-typing", "");
    out.textContent = "";
    const ctl = animate(0, parts.length, {
      duration: typeDuration(parts.length), ease: "linear",
      onUpdate: (v) => { out.textContent = parts.slice(0, Math.ceil(v)).join(""); },
      onComplete: finish,
    });
    return () => { ctl.stop(); finish(); };
  }, [text, live]);
  const t = TONE[tone];
  // A clamped line gets a small "อ่านต่อ" toggle (only when it is really cut off; the full text is always in the DOM).
  // Narrow: the text grows in place. Wide: the box and cards are fixed, so the full text opens as a panel over the
  // cards below instead of pushing the layout.
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const para = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = para.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  const inline = tail === "left";
  const clamp = lines === 3 ? "line-clamp-3" : "line-clamp-4";
  const showToggle = cut || open;
  return (
    <div ref={root} data-bubble={tone} className={`group/bubble relative min-w-0 rounded-sm border px-2.5 py-1.5 ${t.box}`}>
      <Tail side={tail} tone={tone} at={tailAt} />
      <p ref={para} className={`relative text-xs leading-[1.45] break-words ${open && inline ? "" : clamp} ${t.text}`}>
        <span data-line className="group-data-[typing]/bubble:text-transparent">{text}</span>
        <span ref={typed} aria-hidden="true" data-typed className="absolute inset-0" />
      </p>
      {open && !inline && (
        <div data-bubble-full aria-hidden="true" className={`absolute inset-x-0 top-0 z-20 rounded-sm border px-2.5 py-1.5 text-xs leading-[1.45] break-words bg-surface ${t.box.replace("bg-transparent", "")} ${t.text}`}>
          {text}
          <span className="block h-6 pointer-coarse:h-11" />
        </div>
      )}
      {showToggle && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-bubble-toggle
          className={`z-30 flex min-h-6 items-center font-display text-xs text-primary underline underline-offset-2 pointer-coarse:min-h-11 ${open && !inline ? "absolute inset-x-2.5 bottom-0" : "relative"}`}>
          {open ? "ย่อ" : "อ่านต่อ"}
        </button>
      )}
    </div>
  );
}
