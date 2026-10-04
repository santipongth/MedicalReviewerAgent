import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createReview, listRecent } from "./api";

afterEach(() => vi.unstubAllGlobals());

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
}

describe("api", () => {
  it("posts the review request and returns the id", async () => {
    const f = reply(202, { review_id: "abc", status: "queued", cached: false });
    vi.stubGlobal("fetch", f);
    const out = await createReview({ topic: "metformin", language: "th", options: { max_papers: 8 } });
    expect(out.review_id).toBe("abc");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/reviews$/);
    expect(JSON.parse(init.body as string)).toEqual({ topic: "metformin", language: "th", options: { max_papers: 8 } });
  });

  it("maps 429 to an ApiError with the wait time", async () => {
    vi.stubGlobal("fetch", reply(429, { detail: "rate limit exceeded" }, { "retry-after": "120" }));
    const err = await createReview({ topic: "x y z", language: "en" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(120);
  });

  it("turns validation errors into a readable message", async () => {
    vi.stubGlobal("fetch", reply(422, { detail: [{ loc: ["body", "topic"], msg: "String should have at least 3 characters" }] }));
    const err = await createReview({ topic: "x", language: "en" }).catch((e) => e);
    expect(err.message).toBe("String should have at least 3 characters");
  });

  it("network failures become status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await listRecent(5).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });
});
