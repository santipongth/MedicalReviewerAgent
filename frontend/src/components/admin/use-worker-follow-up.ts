"use client";

import { useCallback, useEffect, useState } from "react";
import { POLL_MS, POLL_WINDOW_MS, SETTLING_MS } from "@/lib/admin-workers";

/** What a page that shows worker reports does after a write (moved out of ModelsView, Plan 23b): while `lagging` (a
 * reporting worker is not on the page's version yet) it calls `poll` every POLL_MS, for at most POLL_WINDOW_MS, and
 * every `wrote()` starts a fresh window; `settling` is true for SETTLING_MS after the page's own write, when a lagging
 * worker is "changing" and not yet a warning. `poll` must be stable (useCallback). */
export function useWorkerFollowUp(lagging: boolean, poll: () => void): { settling: boolean; wrote: () => void } {
  const [settling, setSettling] = useState(false);
  const [writeCount, setWriteCount] = useState(0);

  useEffect(() => {
    if (!lagging) return;
    const since = Date.now();
    const id = setInterval(() => {
      if (Date.now() - since >= POLL_WINDOW_MS) clearInterval(id);
      else poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [lagging, writeCount, poll]);

  useEffect(() => {
    if (!settling) return;
    const id = setTimeout(() => setSettling(false), SETTLING_MS);
    return () => clearTimeout(id);
  }, [settling, writeCount]);

  const wrote = useCallback(() => {
    setSettling(true);
    setWriteCount((n) => n + 1);
  }, []);
  return { settling, wrote };
}
