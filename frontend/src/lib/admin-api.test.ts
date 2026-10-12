import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminApi, adminErrorText } from "./admin-api";

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  // a fresh Response per call: a body can be read only once, and one test makes two calls
  const fn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("adminApi", () => {
  it("reads with a relative same-origin GET and no CSRF header", async () => {
    const fn = stub(200, { kind: "user", label: "owner" });
    expect(await adminApi.me()).toEqual({ kind: "user", label: "owner" });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/me");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-MRA-Admin"]).toBeUndefined();
  });

  it("sends writes with the CSRF header and a JSON body; 204 resolves to undefined", async () => {
    const fn = stub(204);
    expect(await adminApi.signIn("owner", "pw")).toBeUndefined();
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/session");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-MRA-Admin": "1", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ username: "owner", password: "pw" });
  });

  it("builds the review query with trimmed search, filters and the cursor", async () => {
    const fn = stub(200, { items: [], next: null });
    await adminApi.reviews({ q: "  statins ", status: "done", listed: "false", before: "2026-10-12T09:00:00|abc" });
    const url = new URL(fn.mock.calls[0][0] as string, "http://x");
    expect(url.pathname).toBe("/api/v1/admin/reviews");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "statins", status: "done", listed: "false", before: "2026-10-12T09:00:00|abc" });
    await adminApi.reviews();
    expect(fn.mock.calls[1][0]).toBe("/api/v1/admin/reviews");
  });

  it("maps failures to AdminApiError with the detail and Retry-After", async () => {
    stub(429, { detail: "too many failed sign-ins; try again later" }, { "Retry-After": "600" });
    const err = await adminApi.signIn("owner", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 429, retryAfter: 600, message: "too many failed sign-ins; try again later" });
    expect(adminErrorText(err)).toBe("ลองใหม่ได้ในอีก 10 นาที");
  });

  it("turns a network failure into status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await adminApi.keys().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0 });
    expect(adminErrorText(err)).toContain("ติดต่อเซิร์ฟเวอร์ไม่ได้");
  });

  it("gives Thai text for the other statuses", () => {
    expect(adminErrorText(new AdminApiError(409, "review is running; cancel it before deleting"))).toBe("review is running; cancel it before deleting");
    expect(adminErrorText(new AdminApiError(404, "x"))).toBe("ไม่พบรายการนี้แล้ว");
    expect(adminErrorText(new AdminApiError(500, "x"))).toContain("(500)");
    expect(adminErrorText(new Error("x"))).toBe("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  });
});
