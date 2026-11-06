/**
 * Seeds a local JanLekha deployment with the synthetic demo lifecycle.
 *
 *   npm run contracts:node            # terminal 1
 *   npm run contracts:deploy:local && npm run contracts:seed:local
 *
 * Local only: it uses several Hardhat test accounts and fast-forwards chain time
 * through the bid and reveal windows. Resulting state:
 *   #1 drain  - full flow; milestone 1 mock-paid, milestone 2 evidence awaiting inspection
 *   #2 solar  - project created, tender not yet published
 *   #3 roof   - tender open for bidding, one sealed commitment
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";

import { CONTRACT_NAME, requireArtifact } from "./lib/deployment.js";
import { DOCS_DIR, DRAIN, ROOF, SOLAR, publishedDocs } from "./lib/demo-data.js";

const HOUR = 3_600n;

const { viem, networkHelpers, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== 31337) throw new Error(`seed-demo is local-only (chain 31337); got chain ${chainId}.`);

// Published files must match the hashes recorded on-chain, or verification would fail.
for (const d of publishedDocs()) {
  const onDisk = await readFile(path.join(DOCS_DIR, d.file)).catch(() => null);
  if (!onDisk || !Buffer.from(d.bytes).equals(onDisk)) {
    throw new Error(`${DOCS_DIR}/${d.file} is missing or stale; run \`npm run demo:documents\`.`);
  }
}

const artifact = await requireArtifact(networkName);
const [, department, vendorA, vendorB, inspector, pao] = await viem.getWalletClients();
type Wallet = typeof department;
const contract = await viem.getContractAt(CONTRACT_NAME, artifact.contract.address);
if ((await contract.read.projectCount()) !== 0n) {
  throw new Error("Contract already has projects. Restart `npm run contracts:node` and redeploy for a clean demo.");
}

const as = (wallet: Wallet) =>
  viem.getContractAt(CONTRACT_NAME, artifact.contract.address, { client: { wallet } });
const dept = await as(department);
const vA = await as(vendorA);
const vB = await as(vendorB);
const insp = await as(inspector);
const paoC = await as(pao);

async function send(label: string, tx: Promise<Hex>) {
  const hash = await tx;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ✓ ${label.padEnd(48)} ${hash}`);
}

const roles = [
  ["DEPARTMENT_ROLE", department],
  ["VENDOR_ROLE", vendorA],
  ["VENDOR_ROLE", vendorB],
  ["INSPECTOR_ROLE", inspector],
  ["PAO_ROLE", pao],
] as const;
console.log(`Seeding synthetic demo data on ${artifact.contract.address}`);
for (const [role, wallet] of roles) {
  const roleId = await contract.read[role]();
  if (!(await contract.read.hasRole([roleId, wallet.account.address]))) {
    await send(`grant ${role} ${wallet.account.address.slice(0, 10)}…`, contract.write.grantRole([roleId, wallet.account.address]));
  }
}

function commitment(projectId: bigint, vendor: Address, amount: bigint, doc: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, uint256, bytes32, bytes32"), [
      projectId,
      vendor,
      amount,
      doc,
      salt,
    ]),
  );
}
const salt = () => toHex(randomBytes(32));
const now = async () => BigInt(await networkHelpers.time.latest());

// ── #1 drain: full lifecycle ────────────────────────────────────────────────
console.log(`#1 ${DRAIN.title}`);
const d = DRAIN.docs;
await send("createProject", dept.write.createProject([d.sanction.sha256, DRAIN.allocationPaise]));
let t = await now();
const bidDeadline = t + HOUR;
const revealDeadline = bidDeadline + HOUR;
await send("publishTender", dept.write.publishTender([1n, d.tender.sha256, bidDeadline, revealDeadline]));
const saltA = salt();
const saltB = salt();
await send("vendor A commitBid", vA.write.commitBid([1n, commitment(1n, vendorA.account.address, DRAIN.bidA, d.quotationA.sha256, saltA)]));
await send("vendor B commitBid", vB.write.commitBid([1n, commitment(1n, vendorB.account.address, DRAIN.bidB, d.quotationB.sha256, saltB)]));
await networkHelpers.time.increaseTo(bidDeadline);
await send("vendor A revealBid", vA.write.revealBid([1n, DRAIN.bidA, d.quotationA.sha256, saltA]));
await send("vendor B revealBid", vB.write.revealBid([1n, DRAIN.bidB, d.quotationB.sha256, saltB]));
await networkHelpers.time.increaseTo(revealDeadline);
await send("awardContract → vendor A", dept.write.awardContract([1n, vendorA.account.address, d.evaluation.sha256, d.contract.sha256]));
await send("defineMilestone 1", dept.write.defineMilestone([1n, DRAIN.milestone1, d.m1Spec.sha256]));
await send("defineMilestone 2", dept.write.defineMilestone([1n, DRAIN.milestone2, d.m2Spec.sha256]));
await networkHelpers.time.increase(5n * 24n * HOUR);
await send("milestone 1 evidence", vA.write.submitMilestoneEvidence([1n, 1n, d.m1Evidence.sha256]));
await networkHelpers.time.increase(24n * HOUR);
await send("milestone 1 inspection approval", insp.write.approveMilestone([1n, 1n, d.m1Inspection.sha256]));
await networkHelpers.time.increase(48n * HOUR);
await send("milestone 1 mock PFMS attestation", paoC.write.attestMockPayment([1n, 1n, DRAIN.milestone1, d.m1Payment.sha256]));
await networkHelpers.time.increase(10n * 24n * HOUR);
await send("milestone 2 evidence", vA.write.submitMilestoneEvidence([1n, 2n, d.m2Evidence.sha256]));

// ── #2 solar: created, no tender ────────────────────────────────────────────
console.log(`#2 ${SOLAR.title}`);
await send("createProject", dept.write.createProject([SOLAR.docs.sanction.sha256, SOLAR.allocationPaise]));

// ── #3 roof: tender open with one sealed bid ────────────────────────────────
console.log(`#3 ${ROOF.title}`);
await send("createProject", dept.write.createProject([ROOF.docs.sanction.sha256, ROOF.allocationPaise]));
t = await now();
await send(
  "publishTender (bidding open 7 days)",
  dept.write.publishTender([3n, ROOF.docs.tender.sha256, t + 7n * 24n * HOUR, t + 9n * 24n * HOUR]),
);
await send(
  "vendor B commitBid (sealed)",
  vB.write.commitBid([3n, commitment(3n, vendorB.account.address, ROOF.bid, ROOF.docs.quotation.sha256, salt())]),
);

console.log("\nDemo data seeded. For the app (.env.local):");
console.log("  NEXT_PUBLIC_HEDERA_CHAIN_ID=31337");
console.log("  NEXT_PUBLIC_HEDERA_RPC_URL=http://127.0.0.1:8545");
console.log(`  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS=${artifact.contract.address}`);
console.log(`  NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK=${artifact.deployment.blockNumber}`);
