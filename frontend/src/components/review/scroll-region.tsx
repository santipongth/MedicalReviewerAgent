"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { L } from "./text";

/**
 * A table that may be wider than the reading column scrolls inside this region, never the page (Plan 20 Task 5). It is
 * a focusable, labelled region (arrow keys scroll it); while more content sits off to the right, that edge fades (a mask
 * on the content, like the section nav: no painted gradient or shadow) and a "เลื่อนดู →" hint shows above it. The
 * left edge never fades: it holds the sticky first column.
 */
export function ScrollRegion({ label, lang, children, className = "", bordered = true }: {
  label: string; lang: Lang; children: ReactNode; className?: string; bordered?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const update = () => setEdges({ start: box.scrollLeft > 2, end: box.scrollLeft + box.clientWidth < box.scrollWidth - 2 });
    update();
    box.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(box);
    if (box.firstElementChild) ro?.observe(box.firstElementChild);
    return () => { box.removeEventListener("scroll", update); ro?.disconnect(); };
  }, []);
  const scrollable = edges.start || edges.end;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1" data-scroll-region={scrollable ? "scrollable" : "fits"}>
      {scrollable && (
        <p aria-hidden="true" className="justify-self-end font-display text-[0.78rem] text-muted" data-scroll-hint>
          {edges.end ? L(lang, "เลื่อนดู →", "Scroll →") : L(lang, "← เลื่อนกลับ", "← Scroll back")}
        </p>
      )}
      <div ref={el} role="region" aria-label={label} tabIndex={0}
        data-fade-end={edges.end || undefined}
        className={`edge-fade overflow-x-auto ${bordered ? "rounded-sm border border-rule" : ""} ${className}`}>
        {children}
      </div>
    </div>
  );
}
