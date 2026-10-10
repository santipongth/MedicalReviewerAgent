"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Copies a piece of text (a citation). A 44px target on touch; a polite live region confirms the copy; when the
 * clipboard is unavailable or refused, the text appears selected in a read-only box to copy by hand.
 */
export function CopyTextButton({ text, label, name, copied, boxLabel, className = "" }: {
  text: string;
  /** visible button text */
  label: string;
  /** accessible name when the visible text alone is ambiguous (several on a page) */
  name?: string;
  /** what the live region says after a copy */
  copied: string;
  /** accessible name of the fallback box */
  boxLabel: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "fallback">("idle");
  const box = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();

  useEffect(() => {
    if (state === "fallback") box.current?.select();
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("fallback");
    }
  }

  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <button type="button" onClick={copy} aria-label={name} aria-controls={state === "fallback" ? boxId : undefined}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-rule bg-transparent px-3 font-display text-[0.85rem] font-semibold text-primary hover:border-ink md:min-h-8">
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-[0.85rem] text-muted">{state === "copied" ? copied : ""}</span>
      {state === "fallback" && (
        <textarea id={boxId} ref={box} readOnly aria-label={boxLabel} value={text} rows={3}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-sm border border-rule bg-surface px-2 py-1 text-[0.85rem] break-words" />
      )}
    </span>
  );
}
