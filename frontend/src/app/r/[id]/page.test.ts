import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "./page";

const props = { params: Promise.resolve({ id: "abc 1" }) } as Parameters<typeof generateMetadata>[0];
const FALLBACK = "รายงานทบทวนงานวิจัย";

afterEach(() => vi.unstubAllGlobals());

describe("generateMetadata", () => {
  it("uses the review topic as the title", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ topic: "metformin และไต" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateMetadata(props)).toEqual({ title: "metformin และไต", openGraph: { title: "metformin และไต" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/reviews\/abc%201$/);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
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
