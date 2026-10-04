import { describe, expect, it } from "vitest";
import { SSEParser } from "./sse";

describe("SSEParser", () => {
  it("parses named events with ids across chunk boundaries", () => {
    const p = new SSEParser();
    expect(p.feed('id: 1\nevent: started\nda')).toEqual([]);
    const out = p.feed('ta: {"resume": false}\n\nid: 2\r\nevent: searching\r\ndata: {"found": 12}\r\n\r\n');
    expect(out).toEqual([
      { id: "1", event: "started", data: '{"resume": false}' },
      { id: "2", event: "searching", data: '{"found": 12}' },
    ]);
  });

  it("ignores comments (keep-alive pings) and joins multi-line data", () => {
    const p = new SSEParser();
    expect(p.feed(": ping - 2026-10-05\n\nevent: x\ndata: a\ndata: b\n\n")).toEqual([
      { id: undefined, event: "x", data: "a\nb" },
    ]);
  });

  it("defaults the event name to message and drops events without data", () => {
    const p = new SSEParser();
    expect(p.feed("data: hi\n\nevent: empty\n\n")).toEqual([{ id: undefined, event: "message", data: "hi" }]);
  });
});
