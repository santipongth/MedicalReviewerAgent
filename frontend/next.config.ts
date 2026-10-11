import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // the API and MCP page moved from /about (its old name did not say what it is)
  async redirects() {
    return [{ source: "/about", destination: "/developers", permanent: true }];
  },
};

export default nextConfig;
