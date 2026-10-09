"use client";
import { useEffect, useRef } from "react";
import { formatElapsed, type TraceRow } from "@/lib/agent-scene";

const NEAR_PX = 48;

/** True when the scroll container is (almost) at its bottom. Pure. */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = NEAR_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TraceLog({ rows }: { rows: TraceRow[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // updated on scroll: was the reader near the bottom?

  const last = rows.length ? rows[rows.length - 1] : null;
  useEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    if (prefersReducedMotion() || typeof el.scrollTo !== "function") el.scrollTop = el.scrollHeight;
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [last?.key, last?.repeat, rows.length]);

  return (
    <section aria-labelledby="h-trace">
      <h2 className="label" id="h-trace">บันทึกการทำงาน</h2>
      <div
        ref={box}
        tabIndex={0}
        aria-labelledby="h-trace"
        onScroll={(e) => { stick.current = nearBottom(e.currentTarget); }}
        className="mt-2 max-h-72 overflow-y-auto border border-rule"
      >
        <ol>
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 border-b border-rule px-2 py-1 last:border-b-0">
              <span className="font-display tabular-nums text-muted">{formatElapsed(r.elapsed)}</span>
              <span>
                {r.text}{" "}
                <span className="font-code text-xs text-muted">[{r.type}]</span>
                {r.repeat > 1 && <span className="font-display tabular-nums text-muted"> ×{r.repeat}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
