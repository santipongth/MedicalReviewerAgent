// Follow a review's live events: stream SSE over fetch, resume with Last-Event-ID after a drop, and give up after
// repeated failures so the caller can fall back to polling GET /reviews/{id}.
import { TERMINAL_EVENTS } from "./progress";
import { SSEParser } from "./sse";
import type { ReviewEvent } from "./types";

export type FollowOutcome = "terminal" | "aborted" | "gave_up";

export interface FollowOptions {
  apiUrl: string;
  onEvent: (ev: ReviewEvent) => void;
  onStatus?: (status: "open" | "reconnecting") => void;
  lastSeq: () => number;
  signal: AbortSignal;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function followReview(id: string, opts: FollowOptions): Promise<FollowOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;
  const maxRetries = opts.maxRetries ?? 6;
  let failures = 0;
  while (!opts.signal.aborted) {
    try {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      const last = opts.lastSeq();
      if (last > 0) headers["Last-Event-ID"] = String(last);
      const res = await doFetch(`${opts.apiUrl}/api/v1/reviews/${encodeURIComponent(id)}/events`, {
        headers, signal: opts.signal, cache: "no-store",
      });
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      opts.onStatus?.("open");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        failures = 0;
        for (const msg of parser.feed(decoder.decode(value, { stream: true }))) {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(msg.data) as Record<string, unknown>;
          } catch {
            payload = {};
          }
          const ev: ReviewEvent = { seq: Number(msg.id ?? 0), type: msg.event, payload };
          opts.onEvent(ev);
          if (TERMINAL_EVENTS.has(ev.type)) {
            await reader.cancel().catch(() => {});
            return "terminal";
          }
        }
      }
    } catch (e) {
      if (opts.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return "aborted";
      failures += 1;
    }
    if (opts.signal.aborted) return "aborted";
    if (failures > maxRetries) return "gave_up";
    opts.onStatus?.("reconnecting");
    await sleep(Math.min(1000 * 2 ** Math.max(failures - 1, 0), 15000));
  }
  return "aborted";
}
