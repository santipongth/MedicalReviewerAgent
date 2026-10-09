"use client";

import { useEffect, useRef, useState } from "react";

/** Copies the current page URL. Falls back to a selected read-only input when the clipboard is unavailable. */
export function CopyLinkButton({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "fallback">("idle");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state === "fallback") input.current?.select();
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href);
      setState("copied");
    } catch {
      setState("fallback");
    }
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={copy}
        className="cursor-pointer rounded-sm border border-rule bg-transparent px-3 py-1.5 text-sm hover:text-primary"
      >
        คัดลอกลิงก์
      </button>
      <span role="status" className="text-sm text-muted">
        {state === "copied" ? "คัดลอกแล้ว" : ""}
      </span>
      {state === "fallback" && (
        <input
          ref={input}
          readOnly
          aria-label="ลิงก์"
          defaultValue={location.href}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-sm border border-rule bg-surface px-2 py-1 font-code text-sm sm:w-80"
        />
      )}
    </span>
  );
}
