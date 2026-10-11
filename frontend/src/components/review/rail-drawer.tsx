"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const NARROW = "(max-width: 1023.98px)"; // below Tailwind `lg`
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/**
 * Wraps the source rail. From `lg` up it is a plain sticky column (unchanged). Below `lg` it is a bottom sheet
 * that, while open, is a modal dialog: flat backdrop, focus moves to the heading and is kept inside, Esc or a
 * backdrop click closes, body scroll is locked and focus returns to `returnFocus` on close.
 * No next/* imports: this is also rendered in the offline report build.
 */
export function RailDrawer({ open, onClose, headingId, returnFocus, children }: {
  open: boolean; onClose: () => void; headingId: string;
  returnFocus: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const narrow = useNarrow();
  const modal = open && narrow;
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.getElementById(headingId)?.focus({ preventScroll: true });
    const trigger = () => returnFocus.current; // set at select time, so read it when closing
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // an open glossary term already consumed this Esc
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = items[0];
        const last = items[items.length - 1];
        if (!panel.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus({ preventScroll: true });
        } else if (e.shiftKey && (document.activeElement === first || document.activeElement === document.getElementById(headingId))) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      const back = trigger();
      if (back?.isConnected) back.focus();
    };
  }, [modal, headingId, returnFocus]);

  return (
    <>
      {modal && <div data-testid="rail-backdrop" aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-ink/40 lg:hidden print:hidden" />}
      {/* not printed (Plan 20 Task 8): the appendix carries every number's source sentence on paper */}
      <div ref={panel} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby={modal ? headingId : undefined}
        className={`min-w-0 print:hidden lg:sticky lg:top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] lg:max-h-[calc(100dvh-var(--header-h)-1rem)] lg:self-start lg:overflow-auto ${open ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[70dvh] max-lg:overflow-auto max-lg:border-t max-lg:border-ink" : "max-lg:hidden"}`}>
        {children}
      </div>
    </>
  );
}
