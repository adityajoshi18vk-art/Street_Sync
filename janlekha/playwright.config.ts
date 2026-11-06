import { defineConfig, devices } from "@playwright/test";

const PORT = 3400;
const RPC_PORT = 8546;

/** Dedicated chain, contract address, build dir and storage so e2e never touches the dev setup. */
const appEnv = {
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_HEDERA_CHAIN_ID: "31337",
  NEXT_PUBLIC_HEDERA_RPC_URL: `http://127.0.0.1:${RPC_PORT}`,
  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK: "0",
  DOCUMENT_STORAGE_DIR: ".data/e2e-documents",
  DATABASE_URL: "",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Fresh in-memory chain per run, so the first deployment address is deterministic.
      command: `npx hardhat node --port ${RPC_PORT}`,
      port: RPC_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next build && npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/health`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 400_000,
    },
  ],
});
