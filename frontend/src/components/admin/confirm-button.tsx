"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BUTTON_DANGER, BUTTON_GHOST } from "./ui";

/** A destructive action that asks again inside the page (never the browser's confirm()). */
export function ConfirmButton({ label, confirmLabel, onConfirm, name, hint, disabled = false }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => unknown | Promise<unknown>;
  /** what the action does, shown (and read out as the confirm button's description) only while asking */
  hint?: string;
  /** accessible name when several rows carry the same visible label */
  name?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  const askRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Focus follows the control: to "confirm" when it opens, back to the ask button when it closes without the row
  // going away (an unmounted button has nothing to focus; the page decides where focus goes then).
  useEffect(() => {
    if (asking) {
      wasAsking.current = true;
      confirmRef.current?.focus();
    } else if (wasAsking.current) {
      wasAsking.current = false;
      askRef.current?.focus();
    }
  }, [asking]);

  if (!asking) {
    return (
      <button ref={askRef} type="button" aria-label={name} disabled={disabled} onClick={() => setAsking(true)} className={BUTTON_GHOST}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-2">
      {hint && <span id={hintId} className="basis-full max-w-prose text-sm text-muted">{hint}</span>}
      <button ref={confirmRef} type="button" disabled={busy} aria-describedby={hint ? hintId : undefined} className={BUTTON_DANGER} onClick={async () => {
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
