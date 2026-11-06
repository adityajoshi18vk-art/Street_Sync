// One-command local JanLekha demo: fresh Hardhat chain, deploy, synthetic seed data, then `next dev`.
//   npm run dev:demo            (from janlekha/)   or   npm run dev   (from the repository root)
// Writes .env.development.local (gitignored) so the app reads this chain. Ctrl+C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const CHAIN_PORT = Number(process.env.JANLEKHA_CHAIN_PORT ?? 8547);
const APP_PORT = Number(process.env.JANLEKHA_PORT ?? 3100);
const RPC_URL = `http://127.0.0.1:${CHAIN_PORT}`;

if (!existsSync("node_modules/.bin/hardhat")) {
  console.error("[janlekha] Dependencies are missing. Run `npm install` in the repository root (or in janlekha/).");
  process.exit(1);
}

const children = [];
function stopAll(code = 0) {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

async function rpcReady() {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (await rpcReady()) {
  console.error(`[janlekha] Port ${CHAIN_PORT} is already in use. Stop that process or set JANLEKHA_CHAIN_PORT.`);
  process.exit(1);
}

const chain = spawn("npx", ["hardhat", "node", "--port", String(CHAIN_PORT)], { stdio: ["ignore", "ignore", "inherit"] });
children.push(chain);
chain.on("exit", (code) => {
  console.error(`[janlekha] Local chain exited (${code}).`);
  stopAll(1);
});

for (let i = 0; i < 60 && !(await rpcReady()); i++) await new Promise((r) => setTimeout(r, 1000));
if (!(await rpcReady())) {
  console.error("[janlekha] Local chain did not start.");
  stopAll(1);
}

const env = { ...process.env, JANLEKHA_LOCAL_RPC_URL: RPC_URL };
rmSync("deployments/localhost.json", { force: true }); // the in-memory chain is new every run
for (const script of ["scripts/deploy.ts", "scripts/seed-demo.ts"]) {
  const r = spawnSync("npx", ["hardhat", "run", script, "--network", "localhost"], { stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`[janlekha] ${script} failed.`);
    stopAll(1);
  }
}

const deployment = JSON.parse(readFileSync("deployments/localhost.json", "utf8"));
writeFileSync(
  ".env.development.local",
  [
    "# Written by scripts/dev-demo.mjs for the local synthetic demo chain. Safe to delete.",
    "NEXT_PUBLIC_HEDERA_CHAIN_ID=31337",
    `NEXT_PUBLIC_HEDERA_RPC_URL=${RPC_URL}`,
    `NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS=${deployment.contract.address}`,
    `NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK=${deployment.deployment.blockNumber}`,
    "",
  ].join("\n"),
);

console.log(`[janlekha] Demo chain ${RPC_URL}, contract ${deployment.contract.address}. Starting app on http://localhost:${APP_PORT}`);
// Drop an inherited PORT (e.g. from the root runner) so it cannot override -p.
const appEnv = { ...process.env };
delete appEnv.PORT;
const app = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], { stdio: "inherit", env: appEnv });
children.push(app);
app.on("exit", (code) => stopAll(code ?? 0));
