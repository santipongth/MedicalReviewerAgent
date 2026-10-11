"use client";

import { useRef } from "react";
import { useCurrentSection, type NavItem } from "../review/report-nav";
import { DisclosureChevron } from "../ui/disclosure-chevron";

const LABEL = "ในหน้านี้";

/** Ignore what sits under the sticky site header when deciding which section is in view. */
const headerOffset = () => Math.round(document.querySelector("body > header")?.getBoundingClientRect().height ?? 64) + 24;

function Links({ items, current, onPick }: { items: NavItem[]; current: string | null; onPick?: () => void }) {
  return (
    <ul className="grid">
      {items.map((i) => (
        <li key={i.id}>
          <a href={`#${i.id}`} onClick={onPick} aria-current={current === i.id ? "location" : undefined}
            className="-ml-px flex min-h-11 items-center border-l-2 border-transparent py-1.5 pl-3 text-[0.95rem] text-muted hover:text-ink aria-[current]:border-primary aria-[current]:font-semibold aria-[current]:text-ink lg:min-h-0">
            {i.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The developer page's table of contents: a sticky column from 1024px, and below that a closed "ในหน้านี้" disclosure
 * above the content that closes again once a link is picked. The section in view carries aria-current.
 */
export function DocsToc({ items }: { items: NavItem[] }) {
  const current = useCurrentSection(items, headerOffset);
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <>
      <nav aria-label={LABEL}
        className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px)+1.5rem)] hidden self-start lg:grid lg:gap-3">
        <p className="label">{LABEL}</p>
        <div className="border-l border-rule"><Links items={items} current={current} /></div>
      </nav>
      <details ref={details} className="group border-y border-rule lg:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 font-display font-medium">
          <DisclosureChevron />{LABEL}
        </summary>
        <nav aria-label={LABEL} className="mb-3 border-l border-rule">
          <Links items={items} current={current} onPick={() => details.current?.removeAttribute("open")} />
        </nav>
      </details>
    </>
  );
}
