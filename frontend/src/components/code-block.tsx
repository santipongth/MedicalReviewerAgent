"use client";

import { useRef, useState } from "react";

/** A code snippet with a copy button; when clipboard access is refused it selects the text instead. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      const sel = window.getSelection();
      if (pre.current && sel) {
        const range = document.createRange();
        range.selectNodeContents(pre.current);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setState("selected");
    }
  }

  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-3 py-1.5">
        <span className="label">{label}</span>
        <span className="flex items-center gap-2">
          {state !== "idle" && <span className="text-[0.8rem] text-muted" aria-live="polite">{state === "copied" ? "คัดลอกแล้ว" : "เลือกข้อความแล้ว กด Ctrl+C"}</span>}
          <button type="button" onClick={copy} aria-label={`คัดลอก ${label}`}
            className="rounded-sm border border-rule px-2 py-0.5 font-display text-[0.8rem] hover:border-ink">คัดลอก</button>
        </span>
      </div>
      <pre ref={pre} tabIndex={0} role="region" aria-label={label}
        className="overflow-x-auto p-3 font-code text-[0.82rem] leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"><code>{code}</code></pre>
    </div>
  );
}
