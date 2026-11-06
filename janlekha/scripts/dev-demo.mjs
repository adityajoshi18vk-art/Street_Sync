// One-command local JanLekha demo: fresh Hardhat chain, deploy, synthetic seed data, then `next dev`.
//   npm run dev:demo            (from janlekha/)   or   npm run dev   (from the repository root)
// Writes .env.development.local (gitignored) so the app reads this chain. Ctrl+C stops everything.
//
// Tools are started as `node <package cli>` rather than through `npx`: on Windows `npx` is `npx.cmd`,
// which child_process.spawn cannot launch without a shell.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_PORT = Number(process.env.JANLEKHA_CHAIN_PORT ?? 8547);
const APP_PORT = Number(process.env.JANLEKHA_PORT ?? 3100);
const RPC_URL = `http://127.0.0.1:${CHAIN_PORT}`;
const HARDHAT = path.join(ROOT, "node_modules", "hardhat", "dist", "src", "cli.js");
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const fail = (message) => {
  console.error(`\n[janlekha] ${message}\n`);
  stopAll(1);
};

const children = [];
function stopAll(code = 0) {
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  fail(`Node.js ${process.versions.node} is too old. JanLekha's local blockchain (Hardhat 3) needs Node.js 22 or newer. Install Node 22 LTS and run \`npm install\` again.`);
}
if (!existsSync(HARDHAT) || !existsSync(NEXT)) {
  fail("JanLekha dependencies are missing. Run `npm install` in the repository root (or in janlekha/).");
}

/** Runs a package CLI with the current Node binary; no shell, so it behaves the same on every OS. */
function startNode(script, args, options = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, ...options });
  child.on("error", (error) => fail(`Could not start ${path.basename(script)}: ${error.message}`));
  children.push(child);
  return child;
}

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
  fail(`Port ${CHAIN_PORT} is already in use. Stop that process or set JANLEKHA_CHAIN_PORT to another port.`);
}

console.log(`[janlekha] Starting local demo chain on ${RPC_URL}…`);
const chain = startNode(HARDHAT, ["node", "--port", String(CHAIN_PORT)], { stdio: ["ignore", "ignore", "inherit"] });
chain.on("exit", (code) => fail(`Local chain exited (code ${code}).`));

for (let i = 0; i < 90 && !(await rpcReady()); i++) await new Promise((r) => setTimeout(r, 1000));
if (!(await rpcReady())) fail("Local chain did not start within 90 seconds.");

const env = { ...process.env, JANLEKHA_LOCAL_RPC_URL: RPC_URL };
rmSync(path.join(ROOT, "deployments", "localhost.json"), { force: true }); // the in-memory chain is new every run
for (const script of ["scripts/deploy.ts", "scripts/seed-demo.ts"]) {
  const r = spawnSync(process.execPath, [HARDHAT, "run", script, "--network", "localhost"], { cwd: ROOT, stdio: "inherit", env });
  if (r.error) fail(`Could not run ${script}: ${r.error.message}`);
  if (r.status !== 0) fail(`${script} failed (exit ${r.status}). See the output above.`);
}

const deployment = JSON.parse(readFileSync(path.join(ROOT, "deployments", "localhost.json"), "utf8"));
writeFileSync(
  path.join(ROOT, ".env.development.local"),
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
const app = startNode(NEXT, ["dev", "-p", String(APP_PORT)], { stdio: "inherit", env: appEnv });
app.on("exit", (code) => stopAll(code ?? 0));
