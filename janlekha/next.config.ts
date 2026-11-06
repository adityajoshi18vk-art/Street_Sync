import type { NextConfig } from "next";
import { assertNoPublicSecrets } from "./src/env/guard";
import "./src/env/public";

// Fail dev/build early on misconfigured or leaked environment variables.
assertNoPublicSecrets();

const nextConfig: NextConfig = {
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
