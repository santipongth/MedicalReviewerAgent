"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ThaiText } from "../ui/thai-text";

export interface NavItem { id: string; label: string }

/** Section headings the nav links to: the jump clears the site header (--header-h) and the sticky nav. */
export const SECTION_H2 = "scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+3.5rem)] text-lg font-semibold";
/** A block inside a group section (Plan 20): one level down, same jump offset. */
export const SECTION_H3 = "scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+3.5rem)] font-display text-base font-semibold";

const Nested = createContext(false);

/** Wraps the blocks of a group section (results, landscape …): their headings become H3 under the group's H2. */
export function Subsections({ children }: { children: ReactNode }) {
  return <Nested.Provider value>{children}</Nested.Provider>;
}

/** True inside a group section: a block's own sub-headings go one level down too. */
export function useNested(): boolean {
  return useContext(Nested);
}

/** A block's heading: H2 on its own, H3 inside a group section. Thai text wraps only between words (ThaiText). */
export function SectionHeading({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const text = typeof children === "string" ? <ThaiText>{children}</ThaiText> : children;
  return useContext(Nested)
    ? <h3 id={id} className={`${SECTION_H3} ${className}`}>{text}</h3>
    : <h2 id={id} className={`${SECTION_H2} ${className}`}>{text}</h2>;
}

/** The section in view (aria-current), skipped where IntersectionObserver is missing (jsdom, old browsers). */
function useCurrentSection(items: NavItem[], offsetOf: () => number): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const key = items.map((i) => i.id).join("|");
  const offset = useRef(offsetOf);
  useEffect(() => { offset.current = offsetOf; });
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = key.split("|").filter(Boolean);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = ids.find((id) => seen.get(id));
      if (first) setCurrent(first);
    }, { rootMargin: `-${offset.current()}px 0px -60% 0px` });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return current;
}

/**
 * In-page section links, sticky inside the reading column just under the site header (`--header-h`; 0 offline).
 * Below 1280px only (the left table of contents takes over from `xl`), or at every width when `always` (a report with
 * no study has no left table of contents). It scrolls sideways on a phone, with an edge fade on the side that has more
 * links. No next/* imports: this is also rendered in the offline report build.
 */
export function ReportNav({ items, label, always = false }: { items: NavItem[]; label: string; always?: boolean }) {
  const nav = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  // Ignore what sits under the site header and this nav (their height changes as the header wraps on a phone).
  const current = useCurrentSection(items, () => {
    const el = nav.current;
    return el ? Math.round((parseFloat(getComputedStyle(el).top) || 0) + el.offsetHeight) : 112;
  });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", update); ro?.disconnect(); };
  }, [items.length]);

  if (!items.length) return null;
  return (
    <nav ref={nav} aria-label={label}
      className={`sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] z-10 -mx-5 border-b border-rule bg-surface sm:-mx-8 print:hidden ${always ? "" : "xl:hidden"}`}>
      <ul ref={scroller} data-fade-start={edges.start || undefined} data-fade-end={edges.end || undefined}
        className="nav-fade flex gap-x-5 overflow-x-auto px-5 sm:px-8">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a href={`#${i.id}`} aria-current={current === i.id ? "location" : undefined}
              className="inline-flex min-h-11 items-center whitespace-nowrap font-display text-[0.9rem] text-muted no-underline hover:text-ink aria-[current=location]:font-semibold aria-[current=location]:text-ink">
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The left table of contents from 1280px (`xl`): sticky under the site header, short labels, one link per section,
 * the section in view marked with aria-current. Hidden below `xl`, where ReportNav runs along the top instead.
 */
export function ReportToc({ items, label }: { items: NavItem[]; label: string }) {
  const sticky = useRef<HTMLDivElement>(null);
  // Ignore what sits under the site header (the sticky list's own top offset).
  const current = useCurrentSection(items, () => {
    const el = sticky.current;
    return Math.round((el ? parseFloat(getComputedStyle(el).top) || 0 : 56) + 16);
  });
  if (!items.length) return null;
  return (
    <nav aria-label={label}
      className="hidden min-w-0 border-r border-rule xl:block print:hidden">
      <div ref={sticky} className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] max-h-[calc(100dvh-var(--header-h))] overflow-y-auto px-4 py-6">
        <p className="label mb-2">{label}</p>
        <ol className="grid">
          {items.map((i) => (
            <li key={i.id}>
              <a href={`#${i.id}`} aria-current={current === i.id ? "location" : undefined}
                className="-mx-2 flex min-h-11 items-center border-l-2 border-transparent px-2 font-display text-[0.9rem] leading-snug text-muted no-underline hover:text-ink aria-[current=location]:border-ink aria-[current=location]:font-semibold aria-[current=location]:text-ink">
                {i.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
