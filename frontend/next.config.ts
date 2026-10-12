import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // the API and MCP page moved from /about (its old name did not say what it is)
  async redirects() {
    return [{ source: "/about", destination: "/developers", permanent: true }];
  },
  // `next dev` only: send the admin API to the local backend so the admin cookie stays same-origin. Behind Caddy
  // (docker, production) /api/* never reaches Next, and a production build carries no rewrite.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = (process.env.ADMIN_DEV_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
    return [{ source: "/api/v1/admin/:path*", destination: `${api}/api/v1/admin/:path*` }];
  },
};

export default nextConfig;
