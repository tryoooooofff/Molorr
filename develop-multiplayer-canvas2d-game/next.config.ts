import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "1" ? "export" : "standalone",
  // Allow every Arena / E2B preview host and any localhost variant
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    // E2B preview URLs  (port-prefixed)
    "*.e2b.app",
    "3000-*.e2b.app",
    "3100-*.e2b.app",
    // Arena.site preview URLs (no port prefix)
    "*.arena.site",
    "sbx-*.arena.site",
  ],
  async headers() {
    return [];
  },
};

export default nextConfig;
