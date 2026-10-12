"use client";

import { useEffect, useRef, useState } from "react";
import { BUTTON_DANGER, BUTTON_GHOST } from "./ui";

/** A destructive action that asks again inside the page (never the browser's confirm()). */
export function ConfirmButton({ label, confirmLabel, onConfirm, name, disabled = false }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => unknown | Promise<unknown>;
  /** accessible name when several rows carry the same visible label */
  name?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" aria-label={name} disabled={disabled} onClick={() => setAsking(true)} className={BUTTON_GHOST}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-2">
      <button ref={confirmRef} type="button" disabled={busy} className={BUTTON_DANGER} onClick={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setAsking(false);
        }
      }}>
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={BUTTON_GHOST}>ไม่ใช่</button>
    </span>
  );
}
