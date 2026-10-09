"use client";

import { useEffect, useRef, useState } from "react";

export interface NavItem { id: string; label: string }

/** Section headings the nav links to: the jump clears the site header (--header-h) and this sticky nav. */
export const SECTION_H2 = "scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+3.5rem)] text-lg font-semibold";

/**
 * In-page section links, sticky inside the reading column just under the site header (`--header-h`; 0 offline).
 * Highlights the section in view with aria-current (skipped where IntersectionObserver is missing: jsdom, old browsers).
 * No next/* imports: this is also rendered in the offline report build.
 */
export function ReportNav({ items, label = "ในรายงานนี้" }: { items: NavItem[]; label?: string }) {
  const [current, setCurrent] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const key = items.map((i) => i.id).join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = key.split("|").filter(Boolean);
    const seen = new Map<string, boolean>();
    // Ignore what sits under the site header and this nav (their height changes as the header wraps on a phone).
    const el = nav.current;
    const covered = el ? Math.round((parseFloat(getComputedStyle(el).top) || 0) + el.offsetHeight) : 112;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = ids.find((id) => seen.get(id));
      if (first) setCurrent(first);
    }, { rootMargin: `-${covered}px 0px -60% 0px` });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);

  if (!items.length) return null;
  return (
    <nav ref={nav} aria-label={label}
      className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] z-10 -mx-5 overflow-x-auto border-b border-rule bg-surface px-5 sm:-mx-8 sm:px-8 print:hidden">
      <ul className="flex w-max min-w-full gap-x-5">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} aria-current={current === i.id ? "location" : undefined}
              className="inline-flex min-h-11 items-center whitespace-nowrap font-display text-[0.9rem] text-muted no-underline hover:text-ink aria-[current=location]:font-semibold aria-[current=location]:text-ink md:min-h-10">
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
