import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

afterEach(() => vi.unstubAllEnvs());

describe("next.config admin rewrite", () => {
  it("proxies the admin API only under next dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_DEV_API_URL", "http://localhost:8000/");
    const rules = await nextConfig.rewrites!();
    expect(rules).toEqual([{ source: "/api/v1/admin/:path*", destination: "http://localhost:8000/api/v1/admin/:path*" }]);
    vi.stubEnv("NODE_ENV", "production");
    expect(await nextConfig.rewrites!()).toEqual([]);
  });
});
