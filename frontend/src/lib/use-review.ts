"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, getReview } from "./api";
import { apiUrl } from "./config";
import { followReview } from "./events";
import { initialRun, reduceRun } from "./progress";
import type { Review } from "./types";

export type Phase = "loading" | "live" | "report" | "terminal" | "notfound" | "unavailable";
export type Connection = "connecting" | "open" | "reconnecting" | "polling";

const TERMINAL_STATUS = new Set(["error", "rejected", "cancelled"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loads a review; while it runs, follows its live events (SSE with resume), then falls back to polling. */
export function useReview(id: string, { pollMs = 4000 }: { pollMs?: number } = {}) {
  const [review, setReview] = useState<Review | null>(null);
  const [run, dispatch] = useReducer(reduceRun, undefined, initialRun);
  const [phase, setPhase] = useState<Phase>("loading");
  const [connection, setConnection] = useState<Connection>("connecting");
  const [attempt, setAttempt] = useState(0);
  const lastSeq = useRef(0);

  const retry = useCallback(() => {
    setPhase("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;

    function settle(r: Review): boolean {
      setReview(r);
      if (r.status === "done") {
        setPhase("report");
        return true;
      }
      if (TERMINAL_STATUS.has(r.status)) {
        const payload = r.status === "rejected" ? { reason: r.error } : { message: r.error };
        dispatch({ seq: Number.MAX_SAFE_INTEGER, type: r.status, payload });
        setPhase("terminal");
        return true;
      }
      return false;
    }

    (async () => {
      let r: Review | undefined;
      try {
        r = await getReview(id);
      } catch (e) {
        if (alive) setPhase(e instanceof ApiError && e.status === 404 ? "notfound" : "unavailable");
        return;
      }
      if (!alive || settle(r)) return;
      setPhase("live");
      const outcome = await followReview(id, {
        apiUrl: apiUrl(),
        signal: ctrl.signal,
        lastSeq: () => lastSeq.current,
        onEvent: (ev) => {
          lastSeq.current = Math.max(lastSeq.current, ev.seq);
          dispatch(ev);
        },
        onStatus: (s) => alive && setConnection(s),
      });
      if (!alive || outcome === "aborted") return;
      if (outcome === "gave_up") setConnection("polling");
      for (;;) {
        try {
          const latest = await getReview(id);
          if (!alive) return;
          if (settle(latest)) return;
        } catch {
          // keep polling; the API may be restarting
        }
        await sleep(pollMs);
        if (!alive) return;
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [id, pollMs, attempt]);

  return { review, run, phase, connection, retry };
}
