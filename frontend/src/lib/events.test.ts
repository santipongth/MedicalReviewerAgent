import { describe, expect, it, vi } from "vitest";
import { followReview } from "./events";
import type { ReviewEvent } from "./types";

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("followReview", () => {
  it("delivers events and resumes after a dropped stream with Last-Event-ID", async () => {
    const calls: Headers[] = [];
    const responses = [
      streamOf(['id: 1\nevent: started\ndata: {"resume": false}\n\nid: 2\nevent: sea', 'rching\ndata: {"found": 9}\n\n']),
      streamOf(['id: 3\nevent: done\ndata: {"cost_usd": 0.1}\n\n']),
    ];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return responses.shift()!;
    });
    const seen: ReviewEvent[] = [];
    let last = 0;
    const outcome = await followReview("r1", {
      apiUrl: "http://api", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {},
      lastSeq: () => last, signal: new AbortController().signal,
      onEvent: (ev) => { seen.push(ev); last = ev.seq; },
    });
    expect(outcome).toBe("terminal");
    expect(seen.map((e) => [e.seq, e.type])).toEqual([[1, "started"], [2, "searching"], [3, "done"]]);
    expect(seen[1].payload).toEqual({ found: 9 });
    expect(calls[0].get("last-event-id")).toBeNull();
    expect(calls[1].get("last-event-id")).toBe("2");
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api/api/v1/reviews/r1/events");
  });

  it("gives up after repeated failures so the caller can poll", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("network down"); });
    const statuses: string[] = [];
    const outcome = await followReview("r1", {
      apiUrl: "http://api", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, maxRetries: 3,
      lastSeq: () => 0, signal: new AbortController().signal, onEvent: () => {}, onStatus: (s) => statuses.push(s),
    });
    expect(outcome).toBe("gave_up");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(statuses).toContain("reconnecting");
  });

  it("stops quietly when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await followReview("r1", {
      apiUrl: "http://api", fetchImpl: vi.fn() as unknown as typeof fetch, sleep: async () => {},
      lastSeq: () => 0, signal: ctrl.signal, onEvent: () => {},
    });
    expect(outcome).toBe("aborted");
  });
});
