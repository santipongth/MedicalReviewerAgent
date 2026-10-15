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

  it("builds the model catalog query with a trimmed search and only the filters that are set", async () => {
    const fn = stub(200, { items: [], available: true });
    await adminApi.llmModels({ q: " qwen ", structured: true, max_price: 1 });
    expect(fn.mock.calls[0][0]).toBe("/api/v1/admin/llm-models?q=qwen&structured=true&max_price=1");
    await adminApi.llmModels();
    expect(fn.mock.calls[1][0]).toBe("/api/v1/admin/llm-models");
  });

  it("saves a model config with the CSRF header and the base version in the JSON body", async () => {
    const fn = stub(201, { id: 4, workers_notified: true });
    await adminApi.saveLlm({ yaml: "active_preset: cheap\n", base_version: 3, note: "cheaper" });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/llm-config");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-MRA-Admin": "1", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ yaml: "active_preset: cheap\n", base_version: 3, note: "cheaper" });
  });

  it("builds the runtime and harness URLs and bodies", async () => {
    const fn = stub(200, { items: [], next: null });
    await adminApi.runtimeVersions("glossary", 4);
    await adminApi.harnessCompare("2026-10-11.1/baseline", "pv/run b");
    await adminApi.restoreRuntime("settings", 2, 3);
    const urls = fn.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/v1/admin/glossary/versions?before=4",
      "/api/v1/admin/harness/compare?a=2026-10-11.1%2Fbaseline&b=pv%2Frun%20b",
      "/api/v1/admin/settings/versions/2/restore"]);
    const init = fn.mock.calls[2][1];
    expect(init.headers).toMatchObject({ "X-MRA-Admin": "1" });
    expect(JSON.parse(init.body as string)).toEqual({ base_version: 3 });
  });

  it("keeps the body on the error, with its field errors and reasons only when they have the right shape (Plan 23c)", async () => {
    const MAX = "max_queued_reviews: must be between 1 and 1000";
    const refused = { detail: MAX, errors: [{ field: "max_queued_reviews", message: MAX }, { field: null, message: "bad document" }] };
    stub(422, refused);
    const err = await adminApi.saveSettings({ values: { max_queued_reviews: 0 }, base_version: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 422, message: MAX, body: refused, errors: refused.errors, reasons: null });
    expect(adminErrorText(err)).toBe(MAX); // the text other callers show is unchanged
    stub(503, { detail: "the harness cannot start a run now: no_worker", reasons: ["no_worker"] });
    const body = { max_usd: 1, repeats: 1, strata: [], max_reviews: null, compare_run: null, confirm: true as const };
    expect(await adminApi.startHarness(body).catch((e: unknown) => e)).toMatchObject({ status: 503, reasons: ["no_worker"], errors: null });
    stub(422, { detail: [{ loc: ["body", "values"], msg: "Field required", type: "missing" }] });
    expect(await adminApi.saveSettings({ values: {}, base_version: null }).catch((e: unknown) => e))
      .toMatchObject({ structuredDetail: true, errors: [{ field: "values", message: "Field required" }], reasons: null });
    stub(422, { detail: "x", errors: [{ field: 3, message: "x" }], reasons: ["no_worker", 1] });
    expect(await adminApi.saveSettings({ values: {}, base_version: null }).catch((e: unknown) => e))
      .toMatchObject({ errors: null, reasons: null });
    expect(new AdminApiError(500, "x")).toMatchObject({ body: null, errors: null, reasons: null });
  });

  it("reads a FastAPI detail[] list as field errors, and lets a body's errors win (Plan 31)", () => {
    const detail = [
      { type: "greater_than", loc: ["body", "max_usd"], msg: "Input should be greater than 0" },
      { type: "extra_forbidden", loc: ["body", "<extra>"], msg: "Extra inputs are not permitted" },
      { type: "x", loc: ["query", "q"], msg: "bad" },
    ];
    expect(new AdminApiError(422, "x", null, true, { detail }).errors).toEqual([
      { field: "max_usd", message: "Input should be greater than 0" },
      { field: null, message: "Extra inputs are not permitted" },
      { field: null, message: "bad" },
    ]);
    expect(new AdminApiError(422, "x", null, true, { detail, errors: [{ field: "a", message: "m" }] }).errors)
      .toEqual([{ field: "a", message: "m" }]);
    expect(new AdminApiError(422, "x", null, true, { detail: [{ loc: "body", msg: "x" }] }).errors).toBeNull();
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

  it("shows a fixed Thai line for a 422 whose detail is a validation list, not the raw list", async () => {
    stub(422, { detail: [{ loc: ["body", "password"], msg: "String should have at most 256 characters", type: "string_too_long" }] });
    const err = await adminApi.signIn("owner", "x".repeat(300)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 422 });
    expect(adminErrorText(err)).toBe("ข้อมูลที่กรอกไม่ถูกต้อง ตรวจแล้วลองใหม่");
    stub(422, { detail: "daily_quota must be at least 1" });
    expect(adminErrorText(await adminApi.updateKey("k", { daily_quota: 0 }).catch((e: unknown) => e))).toBe("daily_quota must be at least 1");
  });

  it("gives Thai text for the other statuses", () => {
    expect(adminErrorText(new AdminApiError(409, "review is running; cancel it before deleting"))).toBe("review is running; cancel it before deleting");
    expect(adminErrorText(new AdminApiError(404, "x"))).toBe("ไม่พบรายการนี้แล้ว");
    expect(adminErrorText(new AdminApiError(500, "x"))).toContain("(500)");
    expect(adminErrorText(new Error("x"))).toBe("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  });
});
