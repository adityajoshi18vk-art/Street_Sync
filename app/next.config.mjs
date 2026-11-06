import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// @aliimam/* declare "main": "dist/index.cjs", which they don't ship; point at their ESM build.
const esmEntry = (pkg) => join(dirname(require.resolve(`${pkg}/package.json`)), "dist/index.mjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same-origin proxy to the backend, so the app works behind a tunnel or preview URL
  // where the browser can't reach localhost:3001. Use with NEXT_PUBLIC_API_URL=/backend.
  async rewrites() {
    const target = process.env.BACKEND_PROXY_TARGET ?? "http://127.0.0.1:3001";
    return [{ source: "/backend/:path*", destination: `${target}/:path*` }];
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true
    };
    // Optional x402 payment subdeps of @coinbase/cdp-sdk (pulled in via the
    // Coinbase connector barrel in wagmi/connectors) that ship uninstalled.
    // Our app never touches x402 payments, so stub every referenced subpath.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@aliimam/icons$": esmEntry("@aliimam/icons"),
      "@aliimam/logos$": esmEntry("@aliimam/logos"),
      "@x402/core/client": false,
      "@x402/core/schemas": false,
      "@x402/core/server": false,
      "@x402/evm": false,
      "@x402/evm/auth-capture/client": false,
      "@x402/evm/batch-settlement/client": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/exact/server": false,
      "@x402/evm/exact/v1/client": false,
      "@x402/evm/upto/client": false,
      "@x402/evm/upto/server": false,
      "@x402/express": false,
      "@x402/extensions/bazaar": false,
      "@x402/extensions/builder-code": false,
      "@x402/fetch": false,
      "@x402/svm/exact/client": false,
      "@x402/svm/exact/server": false,
      "@x402/svm/exact/v1/client": false,
      "@x402/svm/upto/client": false,
      "@x402/svm/upto/server": false
    };
    if (isServer) {
      // Workspace packages (@streetsync/*) resolve through symlinks to paths
      // outside node_modules, so Next bundles them into the server build and
      // their raw `node:` scheme imports would hit webpack's UnhandledScheme
      // error. Externalize them back to real Node builtins server-side.
      config.externals.push(({ request }, callback) => {
        if (/^node:/.test(request)) return callback(null, `commonjs ${request}`);
        callback();
      });
    } else {
      // @streetsync/evidence + @streetsync/arkiv-client are isomorphic: they
      // statically import node:crypto (fallback path never taken in browsers,
      // where crypto.subtle always exists) and dynamically import sharp
      // (Node-only image codec; the browser Canvas path is used instead).
      // webpack's resolver short-circuits `node:` scheme requests before
      // alias/fallback can apply, so strip the scheme prefix at module-factory
      // time (same mechanism as NormalModuleReplacementPlugin) and let
      // resolve.fallback stub the bare builtins out of the browser bundle.
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.normalModuleFactory.tap("NodeSchemeStub", (factory) => {
            factory.hooks.beforeResolve.tap("NodeSchemeStub", (data) => {
              if (data && typeof data.request === "string" && data.request.startsWith("node:")) {
                data.request = data.request.slice(5);
              }
            });
          });
        }
      });
      config.resolve.alias = {
        ...config.resolve.alias,
        sharp: false
      };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "node:crypto": false,
        crypto: false,
        fs: false,
        path: false
      };
    }
    return config;
  }
};

export default nextConfig;
