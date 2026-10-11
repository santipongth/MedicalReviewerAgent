import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_FIXTURE } from "@/test/status-fixture";
import { paperRangeTh, usableLimits } from "./limits";
import { getServerStatus } from "./server-api";

describe("usableLimits", () => {
  it("keeps limits whose paper count and pool are min <= default <= max ranges", () => {
    expect(usableLimits(STATUS_FIXTURE.limits)).toBe(STATUS_FIXTURE.limits);
  });
  it("rejects anything else", () => {
    const l = STATUS_FIXTURE.limits;
    for (const bad of [null, undefined, 3, {}, { ...l, max_papers: { min: 5, max: 50 } }, { ...l, max_papers: { min: 5, max: 50, default: 60 } },
      { ...l, candidate_limit: null }, { ...l, max_papers: { min: "5", max: 50, default: 30 } }]) expect(usableLimits(bad)).toBeNull();
  });
});

describe("paperRangeTh", () => {
  it("states the range and default from /status", () => {
    expect(paperRangeTh(STATUS_FIXTURE.limits)).toBe("(5–50 ฉบับ ค่าเริ่มต้น 30)");
  });
});

describe("getServerStatus", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads /status with a 60 s data-cache revalidate and a timeout", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(STATUS_FIXTURE), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await getServerStatus()).toEqual(STATUS_FIXTURE);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toMatch(/\/api\/v1\/status$/);
    expect(init.next).toEqual({ revalidate: 60 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is null when the API is down, errors or sends unusable limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await getServerStatus()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await getServerStatus()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...STATUS_FIXTURE, limits: {} }), { status: 200 })));
    expect(await getServerStatus()).toBeNull();
  });
});
