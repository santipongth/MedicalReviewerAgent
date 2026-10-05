import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewFixture } from "@/test/fixtures";

vi.mock("@/lib/standalone-assets", () => ({ loadStandaloneAssets: async () => ({ js: "/*app*/", css: "/*css*/" }) }));

import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

function call(id: string) {
  return GET(new Request(`http://web/r/${id}/report.html`), { params: Promise.resolve({ id }) });
}

describe("GET /r/[id]/report.html", () => {
  it("returns the offline report as a download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(reviewFixture), { status: 200 })));
    const res = await call(reviewFixture.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="review-11111111.html"');
    expect(await res.text()).toContain("window.__MRA_REVIEW__=");
  });

  it("passes through unknown reviews and refuses unfinished ones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect((await call("nope")).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...reviewFixture, status: "running" }))));
    expect((await call(reviewFixture.id)).status).toBe(409);
  });

  it("answers 502 and logs where it looked when the API cannot be reached", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await call(reviewFixture.id)).status).toBe(502);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("localhost:8000"), expect.anything());
    log.mockRestore();
  });

  it("answers 502, not a crash, when the API sends something that is not JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>proxy error</html>", { status: 200 })));
    expect((await call(reviewFixture.id)).status).toBe(502);
    log.mockRestore();
  });

  it("answers 502 when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect((await call(reviewFixture.id)).status).toBe(502);
  });
});
