"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import type { Lang } from "@/lib/i18n";
import { L } from "@/components/review/text";

/**
 * Inline glossary term: a dotted-underline button that toggles a short explanation.
 * A Term must never be placed inside another button or link (nested interactive content).
 * No next/* imports: this is also rendered in the offline report build.
 */
export function Term({
  k,
  lang = "th",
  children,
}: {
  k: TermKey;
  lang?: Lang;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const entry = GLOSSARY[k];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b border-dotted border-primary bg-transparent p-0 text-inherit"
      >
        {children ?? L(lang, entry.label.th, entry.label.en)}
      </button>
      {open && (
        <span
          role="note"
          id={id}
          className="fixed inset-x-0 bottom-0 z-30 block rounded-sm border border-rule bg-surface p-3 text-sm font-normal text-ink sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-72 sm:max-w-[min(18rem,calc(100vw-2rem))]"
        >
          {L(lang, entry.body.th, entry.body.en)}
        </span>
      )}
    </span>
  );
}
