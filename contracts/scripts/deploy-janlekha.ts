import { ethers } from "hardhat";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * JanLekha Deploy Script - Arc Testnet ONLY (Chain ID: 5042002)
 *
 * Deploys the 8 JanLekha registries ported into contracts/src, wires the
 * PaymentRegistry into the MilestoneRegistry, and optionally grants the
 * demo operational roles from env addresses.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-janlekha.ts --network arcTestnet
 *
 * Environment variables (read from the environment only, never hardcoded):
 *   PRIVATE_KEY                    - deployer key (testnet only, funded from
 *                                    https://faucet.circle.com). Required.
 *   JANLEKHA_FINANCE_ADDRESS       - optional demo Finance officer address
 *   JANLEKHA_PROCUREMENT_ADDRESS   - optional demo Procurement officer address
 *   JANLEKHA_CONTRACTOR_ADDRESS    - optional demo Contractor address
 *   JANLEKHA_AUDITOR_ADDRESS       - optional demo Auditor address
 *
 * Safety:
 *   - Refuses to run on any chain other than Arc Testnet (5042002).
 *   - Never deploys to mainnet. There is no mainnet path in this script.
 *   - Writes contracts/deployments/arcTestnet-janlekha.json. It does NOT
 *     touch contracts/deployments/arcTestnet.json (StreetSync deployment).
 *   - All seeded figures are demo data, clearly labelled as such.
 */

const ARC_TESTNET_CHAIN_ID = 5042002;

function envAddress(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return value;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy JanLekha on chain ${chainId}: this script is Arc Testnet (${ARC_TESTNET_CHAIN_ID}) only, never mainnet.`,
    );
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY env var is required (testnet deployer key, never hardcode one).");
  }
  const deployer = new ethers.Wallet(privateKey, ethers.provider);
  console.log("=== JanLekha Deployment - Arc Testnet (demo data) ===");
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", chainId.toString());

  const deploy = async (name: string, ...args: unknown[]) => {
    const Factory = await ethers.getContractFactory(name, deployer);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`${name} deployed at:`, address);
    return { contract, address };
  };

  // ── 1. Roles (deployer is the first ADMIN) ─────────────────────────────
  const { contract: roles, address: rolesAddress } = await deploy(
    "JanLekhaRoleRegistry",
    deployer.address,
  );

  // ── 2. Registries ──────────────────────────────────────────────────────
  const { address: budgetsAddress } = await deploy("JanLekhaBudgetRegistry", rolesAddress);
  const { address: projectsAddress } = await deploy("JanLekhaProjectRegistry", rolesAddress);
  const { address: procurementAddress } = await deploy("JanLekhaProcurementRegistry", rolesAddress);
  const { address: milestonesAddress } = await deploy("JanLekhaMilestoneRegistry", rolesAddress);
  const { address: paymentsAddress } = await deploy(
    "JanLekhaPaymentRegistry",
    rolesAddress,
    budgetsAddress,
    milestonesAddress,
  );
  const { address: documentsAddress } = await deploy("JanLekhaDocumentRegistry", rolesAddress);
  const { address: auditsAddress } = await deploy("JanLekhaAuditRegistry", rolesAddress);

  // ── 3. Wiring: PaymentRegistry may mark milestones Paid ────────────────
  const milestones = await ethers.getContractAt("JanLekhaMilestoneRegistry", milestonesAddress, deployer);
  const wireTx = await milestones.setPaymentRegistry(paymentsAddress);
  await wireTx.wait();
  console.log("MilestoneRegistry paymentRegistry set to:", paymentsAddress);

  // ── 4. Optional demo role grants (env addresses only) ─────────────────
  const roleGrants: Array<[string, string | null]> = [
    ["FINANCE_ROLE", envAddress("JANLEKHA_FINANCE_ADDRESS")],
    ["PROCUREMENT_ROLE", envAddress("JANLEKHA_PROCUREMENT_ADDRESS")],
    ["CONTRACTOR_ROLE", envAddress("JANLEKHA_CONTRACTOR_ADDRESS")],
    ["AUDITOR_ROLE", envAddress("JANLEKHA_AUDITOR_ADDRESS")],
  ];
  const rolesTyped = await ethers.getContractAt("JanLekhaRoleRegistry", rolesAddress, deployer);
  for (const [roleName, account] of roleGrants) {
    if (!account) continue;
    const roleId = await (rolesTyped as unknown as Record<string, () => Promise<string>>)[roleName]();
    const tx = await rolesTyped.grantRole(roleId, account);
    await tx.wait();
    console.log(`Granted ${roleName} to:`, account);
  }
  if (roleGrants.every(([, account]) => !account)) {
    console.log("No demo role addresses set in env; only the deployer holds ADMIN_ROLE.");
  }

  // ── 5. Sanity checks ───────────────────────────────────────────────────
  if ((await milestones.paymentRegistry()).toLowerCase() !== paymentsAddress.toLowerCase()) {
    throw new Error("paymentRegistry wiring mismatch");
  }
  const payments = await ethers.getContractAt("JanLekhaPaymentRegistry", paymentsAddress, deployer);
  if ((await payments.USDC_DECIMALS()) !== 6) throw new Error("USDC must be 6 decimals");

  // ── 6. Write deployments file ──────────────────────────────────────────
  const rootDir = join(__dirname, "..");
  const outPath = join(rootDir, "deployments", "arcTestnet-janlekha.json");

  const readAbi = (contractName: string) => {
    const artifactPath = join(
      rootDir, "artifacts", "src", `${contractName}.sol`, `${contractName}.json`,
    );
    return JSON.parse(readFileSync(artifactPath, "utf8")).abi;
  };

  const entry = (address: string, contractName: string) => ({
    address,
    transactionHash: null as string | null,
    abi: readAbi(contractName),
  });

  const deployment = {
    network: "arcTestnet",
    chainId,
    deployedAt: new Date().toISOString(),
    note: "JanLekha registries on Arc Testnet. Demo data only, not real expenditure. Deployed by contracts/scripts/deploy-janlekha.ts.",
    contracts: {
      JanLekhaRoleRegistry: entry(rolesAddress, "JanLekhaRoleRegistry"),
      JanLekhaBudgetRegistry: entry(budgetsAddress, "JanLekhaBudgetRegistry"),
      JanLekhaProjectRegistry: entry(projectsAddress, "JanLekhaProjectRegistry"),
      JanLekhaProcurementRegistry: entry(procurementAddress, "JanLekhaProcurementRegistry"),
      JanLekhaMilestoneRegistry: entry(milestonesAddress, "JanLekhaMilestoneRegistry"),
      JanLekhaPaymentRegistry: entry(paymentsAddress, "JanLekhaPaymentRegistry"),
      JanLekhaDocumentRegistry: entry(documentsAddress, "JanLekhaDocumentRegistry"),
      JanLekhaAuditRegistry: entry(auditsAddress, "JanLekhaAuditRegistry"),
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log("Wrote deployment file:", outPath);

  console.log("");
  console.log("=== JanLekha Deployment Summary (Arc Testnet, demo) ===");
  console.log("RoleRegistry       :", rolesAddress);
  console.log("BudgetRegistry     :", budgetsAddress);
  console.log("ProjectRegistry    :", projectsAddress);
  console.log("ProcurementRegistry:", procurementAddress);
  console.log("MilestoneRegistry  :", milestonesAddress);
  console.log("PaymentRegistry    :", paymentsAddress);
  console.log("DocumentRegistry   :", documentsAddress);
  console.log("AuditRegistry      :", auditsAddress);
  console.log("Admin              :", deployer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
