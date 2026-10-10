"use client";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type SVGProps } from "react";

const DIGITS = /\d+/g;

/** Every integer in `text` ("87", "30/60"), or null when the text has none. */
export function numbersIn(text: string): number[] {
  return (text.match(DIGITS) ?? []).map(Number);
}

/** `text` with its integers replaced, in order, by `values` (rounded); the rest of the text is kept. */
export function withNumbers(text: string, values: number[]): string {
  let i = 0;
  return text.replace(DIGITS, (m) => (i < values.length ? String(Math.round(values[i++])) : m));
}

/**
 * A pipeline count that counts up to its new value (display only: the numbers come from review events, never from a
 * paper). React always renders the final text; the animation only rewrites the node's text while it runs, so a stopped
 * or skipped animation (reduced motion, background tab, tests) leaves the true value on screen.
 */
export function CountUp({ text, ...rest }: { text: string } & SVGProps<SVGTextElement>) {
  const el = useRef<SVGTextElement>(null);
  const prev = useRef<string | null>(null);
  const reduced = useReducedMotion();
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
    return () => { ctl.stop(); node.textContent = text; };
  }, [text, reduced]);
  return <text ref={el} {...rest}>{text}</text>;
}
