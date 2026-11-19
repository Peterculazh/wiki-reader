import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // A self-contained server in .next/standalone, for the Docker image (Dockerfile)
  output: "standalone",
  turbopack: {
    // This app has its own lockfile, next to the Nest apps' one in the repo root.
    // Next would take the topmost lockfile's folder as the root: the whole repo
    // in Turbopack's scope, and the standalone server nested under apps/web/.
    // outputFileTracingRoot follows this value.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
