"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CodeBlock } from "../code-block";

/** One snippet in several languages: tabs (arrow keys move between them) over a single CodeBlock. */
export function CodeTabs({ label, tabs }: { label: string; tabs: { name: string; code: string }[] }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1">
        {tabs.map((t, i) => (
          <button key={t.name} ref={(el) => { buttons.current[i] = el; }} type="button" role="tab" id={`${id}-tab-${i}`}
            aria-selected={i === active} aria-controls={`${id}-panel`} tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}
            className="min-h-11 rounded-sm border border-rule px-3 font-display text-[0.9rem] text-muted aria-selected:border-primary aria-selected:text-ink md:min-h-9">
            {t.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`}>
        <CodeBlock key={active} label={`${label} (${tabs[active].name})`} code={tabs[active].code} />
      </div>
    </div>
  );
}
