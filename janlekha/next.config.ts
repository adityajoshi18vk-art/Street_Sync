import type { NextConfig } from "next";
import { assertNoPublicSecrets } from "./src/env/guard";
import "./src/env/public";

// Fail dev/build early on misconfigured or leaked environment variables.
assertNoPublicSecrets();

const nextConfig: NextConfig = {
  // Lets the e2e suite build against its own chain without clobbering the dev build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
