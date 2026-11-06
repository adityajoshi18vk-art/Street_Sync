/**
 * scripts/arc-smoke.ts
 * Live lifecycle smoke test against the StreetSync deployment on Arc Testnet:
 * create → pledge → claim (backend-signed attestation) → submitEvidence →
 * 3 reviewers register → assignPanel → commit/reveal (2 approve, 1 reject) →
 * settle → payouts → backend indexer reflects the result.
 *
 * Needs contracts/.env (DEPLOYER_PRIVATE_KEY, funded with Arc USDC for gas) and
 * backend/.env.arc (ATTESTER_PRIVATE_KEY matching the deployed escrow's attester).
 * Ephemeral actor wallets get a little gas from the deployer. Takes ~6 minutes
 * because the commit window is real time. Run: npm run smoke:arc
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { ethers } from "ethers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(ROOT, "contracts", ".env"));
process.loadEnvFile(join(ROOT, "backend", ".env.arc"));

const deployment = JSON.parse(readFileSync(join(ROOT, "contracts", "deployments", "arcTestnet.json"), "utf8"));
const RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const API = process.env.BACKEND_API_URL ?? "http://localhost:3001";
const ESCROW = deployment.contracts.StreetSyncEscrow.address as string;
const USDC = (deployment.contracts.MockUSDC ?? deployment.contracts.USDC).address as string;
const U = (n: number) => BigInt(Math.round(n * 1e6));
// Fresh region per run: panels draw from every active reviewer in the bounty's region cell.
const REGION = 1000 + Math.floor(Math.random() * 60000);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 5042002, { staticNetwork: true });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const escrow = new ethers.Contract(ESCROW, deployment.contracts.StreetSyncEscrow.abi, provider);
  const usdc = new ethers.Contract(USDC, (deployment.contracts.MockUSDC ?? deployment.contracts.USDC).abi, provider);

  process.env.CHAIN_ID = "5042002";
  process.env.DB_PATH = join(os.tmpdir(), `arc-smoke-${Date.now()}.db`);
  const signer = await import(pathToFileURL(join(ROOT, "backend", "src", "signer.ts")).href);
  signer.setVerifyingContract(ESCROW);
  check("escrow attester == backend attester", (await escrow.attester()) === signer.attesterAddress);

  console.log("\n— Fund ephemeral actors (gas + MockUSDC)");
  const [funder2, worker, r1, r2, r3] = Array.from({ length: 5 }, () => ethers.Wallet.createRandom().connect(provider));
  const actors = [funder2, worker, r1, r2, r3];
  for (const a of actors) await (await deployer.sendTransaction({ to: a.address, value: ethers.parseEther("0.05") })).wait();
  for (const a of [deployer, ...actors]) {
    const u = usdc.connect(a) as any;
    if (a !== deployer) await (await u.mint(a.address, U(100))).wait();
    await (await u.approve(ESCROW, ethers.MaxUint256)).wait();
  }
  const e = (w: ethers.Wallet) => escrow.connect(w) as any;

  console.log("\n— Create bounty (25) + pledge (5)");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const rc = await (await e(deployer).createBounty(ethers.id(`arc-smoke ${Date.now()}`), 4001200, -7513000, REGION, U(25), deadline)).wait();
  const id: bigint = escrow.interface.parseLog(rc.logs.find((l: any) => l.address.toLowerCase() === ESCROW.toLowerCase()))!.args.bountyId;
  console.log(`  bounty #${id}`);
  await (await e(funder2).pledge(id, U(5))).wait();
  check("bounty holds 30 USDC", (await escrow.getBounty(id)).totalPledged === U(30));

  console.log("\n— Claim with attestation + submit evidence");
  const wa = await signer.signAttestation(worker.address, signer.RoleEnum.Worker, id);
  await (await e(worker).claim(id, wa.nonce, wa.expiry, wa.signature)).wait();
  const code = Number((await escrow.getBounty(id))[10]);
  check("claimed with 4-digit challenge code", code >= 1000 && code <= 9999, String(code));
  await (await e(worker).submitEvidence(id, ethers.id("arkiv-key"), ethers.id("evidence"))).wait();

  console.log("\n— Register 3 reviewers, assign panel");
  const reviewers = [r1, r2, r3];
  for (const r of reviewers) {
    const ra = await signer.signAttestation(r.address, signer.RoleEnum.Reviewer, 0n);
    await (await e(r).registerReviewer(REGION, ra.nonce, ra.expiry, ra.signature)).wait();
  }
  const sel = (await escrow.getBounty(id))[13] as bigint;
  while (BigInt(await provider.getBlockNumber()) <= sel + 1n) await sleep(1000);
  await (await e(deployer).assignPanel(id)).wait();
  const b = await escrow.getBounty(id);
  check("status InReview", Number(b[16]) === 3, String(b[16]));
  const round = Number(b[14]);
  const panel: string[] = [...(await escrow.getPanel(id, round))];
  check("panel = 3 distinct registered reviewers", new Set(panel).size === 3 && panel.every((p) => reviewers.some((r) => r.address === p)));

  console.log("\n— Commit, wait for commit window, reveal, settle");
  const byAddr = new Map(reviewers.map((r) => [r.address, r]));
  const votes = [true, true, false];
  const salts = votes.map((_, i) => ethers.id(`salt-${i}-${Date.now()}`));
  for (let i = 0; i < 3; i++) {
    const h = ethers.solidityPackedKeccak256(["uint256", "uint8", "bool", "bytes32", "address"], [id, round, votes[i], salts[i], panel[i]]);
    await (await e(byAddr.get(panel[i])!).commitVote(id, h)).wait();
  }
  const commitEnd = Number(await escrow.commitDeadline(id));
  console.log(`  waiting ~${Math.max(0, commitEnd - Math.floor(Date.now() / 1000))}s for the commit window…`);
  while (Number((await provider.getBlock("latest"))!.timestamp) <= commitEnd) await sleep(5000);
  for (let i = 0; i < 3; i++) await (await e(byAddr.get(panel[i])!).revealVote(id, votes[i], salts[i])).wait();
  const workerPre = await usdc.balanceOf(worker.address);
  await (await e(deployer).settle(id)).wait();
  check("bounty Approved", Number((await escrow.getBounty(id))[16]) === 4);
  check("worker paid 95% (28.5 USDC)", (await usdc.balanceOf(worker.address)) - workerPre === U(28.5));
  const minority = await escrow.reviewers(panel[2]);
  check("minority reviewer slashed", minority[2] === 0n && minority[3] === false);
  for (const p of panel.slice(0, 2)) {
    const pre = await usdc.balanceOf(p);
    await (await e(byAddr.get(p)!).withdrawReward()).wait();
    check(`majority reviewer ${p.slice(0, 8)}… withdrew reward`, (await usdc.balanceOf(p)) > pre);
  }

  console.log("\n— Backend indexer");
  let indexed: any = null;
  for (let i = 0; i < 40 && Number(indexed?.status) !== 4; i++) {
    await sleep(3000);
    indexed = await fetch(`${API}/api/bounties/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    indexed = indexed?.bounty ?? indexed;
  }
  check("backend indexed bounty as Approved", Number(indexed?.status) === 4, JSON.stringify(indexed)?.slice(0, 200));

  console.log(`\nARC SMOKE: ${passed} passed, ${failed} failed (bounty #${id}, escrow ${ESCROW})`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error("Arc smoke fatal:", err);
  process.exit(1);
});
