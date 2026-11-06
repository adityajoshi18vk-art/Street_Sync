/**
 * Grants JanLekha roles to synthetic demo accounts and records them in the artifact.
 *
 *   npm run contracts:roles:hedera
 *   npm run contracts:roles:local
 *
 * Accounts come from public addresses in the environment (never keys):
 *   JANLEKHA_DEMO_DEPARTMENT  JANLEKHA_DEMO_VENDORS (comma-separated)
 *   JANLEKHA_DEMO_INSPECTOR   JANLEKHA_DEMO_PAO
 * The deployer always receives DEPARTMENT_ROLE so the smoke test can create a project.
 * Idempotent: roles already held are recorded as "already-held" and no tx is sent.
 */
import { network } from "hardhat";
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";

import {
  CONTRACT_NAME,
  assertEcdsaKeyFormat,
  requireArtifact,
  txRecord,
  writeArtifact,
  type RoleGrantRecord,
} from "./lib/deployment.js";

type RoleName = "DEPARTMENT_ROLE" | "VENDOR_ROLE" | "INSPECTOR_ROLE" | "PAO_ROLE";

function parseAddresses(envName: string): Address[] {
  const raw = process.env[envName]?.trim();
  if (!raw) return [];
  return raw.split(",").map((part, i) => {
    const value = part.trim();
    if (!isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress) {
      throw new Error(`${envName}[${i}] is not a valid non-zero address: "${value}"`);
    }
    return getAddress(value);
  });
}

const { viem, networkName } = await network.create();
if (networkName === "hederaTestnet") assertEcdsaKeyFormat("HEDERA_TESTNET_PRIVATE_KEY");
const publicClient = await viem.getPublicClient();
const [admin] = await viem.getWalletClients();
const artifact = await requireArtifact(networkName);
const chainId = await publicClient.getChainId();
if (chainId !== artifact.chainId) {
  throw new Error(`RPC chain ${chainId} does not match artifact chain ${artifact.chainId}.`);
}

const contract = await viem.getContractAt(CONTRACT_NAME, artifact.contract.address);
const adminRole = await contract.read.DEFAULT_ADMIN_ROLE();
if (!(await contract.read.hasRole([adminRole, admin.account.address]))) {
  throw new Error(`${admin.account.address} lacks DEFAULT_ADMIN_ROLE and cannot grant roles.`);
}

const plan: { role: RoleName; account: Address; label: string }[] = [
  { role: "DEPARTMENT_ROLE", account: getAddress(admin.account.address), label: "deployer (smoke-test department)" },
  ...parseAddresses("JANLEKHA_DEMO_DEPARTMENT").map((account) => ({
    role: "DEPARTMENT_ROLE" as const,
    account,
    label: "synthetic demo department",
  })),
  ...parseAddresses("JANLEKHA_DEMO_VENDORS").map((account, i) => ({
    role: "VENDOR_ROLE" as const,
    account,
    label: `synthetic demo vendor ${String.fromCharCode(65 + i)}`,
  })),
  ...parseAddresses("JANLEKHA_DEMO_INSPECTOR").map((account) => ({
    role: "INSPECTOR_ROLE" as const,
    account,
    label: "synthetic demo inspector",
  })),
  ...parseAddresses("JANLEKHA_DEMO_PAO").map((account) => ({
    role: "PAO_ROLE" as const,
    account,
    label: "synthetic demo PAO",
  })),
];

// The contract blocks vendor/inspector/PAO overlap at runtime; flag it early for demo setups.
const delivery = plan.filter((p) => p.role !== "DEPARTMENT_ROLE");
for (const p of delivery) {
  const others = delivery.filter((q) => q.account === p.account && q.role !== p.role);
  if (others.length) console.warn(`  WARNING: ${p.account} holds ${p.role} and ${others[0].role}; ConflictOfInterest checks will block some actions.`);
}

console.log(`Granting roles on ${artifact.contract.address} (${networkName})`);
const records: RoleGrantRecord[] = [];
for (const { role, account, label } of plan) {
  const roleId = (await contract.read[role]()) as Hex;
  let record: RoleGrantRecord;
  if (await contract.read.hasRole([roleId, account])) {
    record = { role, roleId, account, label, status: "already-held", transaction: null, confirmedAt: new Date().toISOString() };
    console.log(`  = ${role.padEnd(15)} ${account} (${label}) already held`);
  } else {
    const hash = await contract.write.grantRole([roleId, account]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`grantRole(${role}, ${account}) failed: ${hash}`);
    if (!(await contract.read.hasRole([roleId, account]))) {
      throw new Error(`grantRole(${role}, ${account}) confirmed but hasRole is false.`);
    }
    record = {
      role,
      roleId,
      account,
      label,
      status: "granted",
      transaction: await txRecord(chainId, hash, receipt.blockNumber),
      confirmedAt: new Date().toISOString(),
    };
    console.log(`  + ${role.padEnd(15)} ${account} (${label}) tx ${hash}`);
  }
  records.push(record);
}

// Keep earlier grant records (with their tx references) for roles this run found already held.
const byKey = new Map(artifact.roles.map((r) => [`${r.role}:${r.account}`, r]));
for (const r of records) {
  const prior = byKey.get(`${r.role}:${r.account}`);
  byKey.set(`${r.role}:${r.account}`, r.status === "already-held" && prior ? prior : r);
}
artifact.roles = [...byKey.values()];
await writeArtifact(artifact);
console.log(`Confirmed ${records.length} role assignment(s); artifact updated.`);
