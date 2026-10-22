import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Native canvas binary + the sign photos and fonts it reads from disk at request time.
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: { "/api/poster/[code]": ["./lib/poster-assets/**/*"] },
  async rewrites() {
    // The owner dashboard is a static SPA (built from ./app into public/app).
    // Any deep link under /app/* must serve its index so client routing works.
    return [
      { source: "/app", destination: "/app/index.html" },
      { source: "/app/:path*", destination: "/app/index.html" },
    ];
  },
  async redirects() {
    // The site is now the question form on the home page; old links land there.
    // /websites became /web-design (Oct 13 2026, /organic).
    return [
      { source: "/websites", destination: "/web-design", permanent: true },
      ...["/work", "/automations", "/how-it-works", "/book"].map((source) => ({ source, destination: "/", permanent: false })),
    ];
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
