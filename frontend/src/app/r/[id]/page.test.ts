import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "./page";

const props = { params: Promise.resolve({ id: "abc 1" }) } as Parameters<typeof generateMetadata>[0];
const FALLBACK = "รายงานทบทวนงานวิจัย";

afterEach(() => vi.unstubAllGlobals());

describe("generateMetadata", () => {
  it("uses the review topic as the title", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ topic: "metformin และไต", status: "done" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateMetadata(props)).toEqual({ title: "metformin และไต", openGraph: { title: "metformin และไต" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/reviews\/abc%201$/);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("clamps a long topic to 120 characters with an ellipsis", async () => {
    const topic = "ก".repeat(600);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ topic, status: "done" }), { status: 200 })));
    const meta = await generateMetadata(props);
    const title = meta.title as string;
    expect(Array.from(title)).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
    expect(meta.openGraph?.title).toBe(title);
  });

  it("never puts a personal medical question in the title or the preview", async () => {
    const body = { topic: "ฉันปวดหัวทุกวัน กินยาอะไรดี", status: "rejected" };
    for (const extra of [{ refusal_code: "personal_medical" }, { error: "personal_medical: ข้อความ" }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...body, ...extra }), { status: 200 })));
      expect(await generateMetadata(props)).toEqual({ title: FALLBACK });
    }
  });

  it("keeps the topic for another refusal code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ topic: "pizza", status: "done", refusal_code: "declined" }), { status: 200 })));
    expect(await generateMetadata(props)).toEqual({ title: "pizza", openGraph: { title: "pizza" } });
  });

  it("keeps the topic out of the title while the review is queued or running", async () => {
    for (const status of ["queued", "running"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ topic: "ฉันปวดหัว", status }), { status: 200 })));
      expect(await generateMetadata(props)).toEqual({ title: FALLBACK });
    }
  });

  it("falls back on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await generateMetadata(props)).toEqual({ title: FALLBACK });
  });

  it("falls back when the request times out (abort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    expect(await generateMetadata(props)).toEqual({ title: FALLBACK });
  });

  it("falls back on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await generateMetadata(props)).toEqual({ title: FALLBACK });
  });
});
