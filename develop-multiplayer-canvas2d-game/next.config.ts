import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "1" ? "export" : "standalone",
  // Allow E2B preview + sandbox wrapper to load Turbopack chunks/HMR
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.e2b.app",
    "3000-ihyetj5powat5evg1glq2.e2b.app",
    "3100-ihyetj5powat5evg1glq2.e2b.app",
    "3000-*.e2b.app",
    "3100-*.e2b.app",
  ],
  // also allow all hosts via headers fallback (Next checks origin)
  async headers() {
    return [];
  },
};

export default nextConfig;
