"use client";

import { useEffect, useId, useRef, useState } from "react";

/** How long the "copied" confirmation stays: cleared after, so a second copy is announced again. */
const CLEAR_AFTER_MS = 4000;

/**
 * Copies a piece of text (a citation). A 44px target at every width; a polite live region confirms the copy and clears
 * after a few seconds. When the clipboard is unavailable or refused, the live region says so and the text appears in a
 * read-only box that takes focus with the text selected, to copy by hand.
 */
export function CopyTextButton({ text, label, name, copied, failed, boxLabel, className = "" }: {
  text: string;
  /** visible button text */
  label: string;
  /** accessible name when the visible text alone is ambiguous (several on a page) */
  name?: string;
  /** what the live region says after a copy */
  copied: string;
  /** what the live region says when the copy failed and the text is shown selected instead */
  failed: string;
  /** accessible name of the fallback box */
  boxLabel: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "fallback">("idle");
  const [message, setMessage] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxId = useId();

  useEffect(() => {
    if (state !== "fallback") return;
    box.current?.focus();
    box.current?.select();
  }, [state]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function announce(text: string) {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), CLEAR_AFTER_MS);
  }

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("copied");
      announce(copied);
    } catch {
      setState("fallback");
      announce(failed);
    }
  }

  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 print:hidden ${className}`}>
      <button type="button" onClick={copy} aria-label={name} aria-controls={state === "fallback" ? boxId : undefined}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-rule bg-transparent px-3 font-display text-[0.85rem] font-semibold text-primary hover:border-ink">
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-[0.85rem] text-muted">{message}</span>
      {state === "fallback" && (
        <textarea id={boxId} ref={box} readOnly aria-label={boxLabel} value={text} rows={3}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-sm border border-rule bg-surface px-2 py-1 text-[0.85rem] break-words" />
      )}
    </span>
  );
}
