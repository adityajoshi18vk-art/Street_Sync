import { ethers } from "hardhat";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * StreetSync Deploy Script – Arc Testnet (Chain ID: 5042002) or local node
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network arcTestnet
 *   npx hardhat node & npx hardhat run scripts/deploy.ts --network localhost
 *
 * Environment variables (see root .env.example):
 *   DEPLOYER_PRIVATE_KEY  – deployer wallet
 *   ATTESTER_ADDRESS      – backend EIP-712 signer
 *   USDC_ADDRESS          – (optional) Arc Testnet USDC; omit to deploy MockUSDC
 *
 * Writes contracts/deployments/<network>.json with addresses + ABIs in the
 * shape consumed by app/src/config/contracts.ts.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("=== StreetSync Deployment ===");
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", chainId.toString());

  // ── 1. USDC ──────────────────────────────────────────────────────────────
  let usdcAddress = process.env.USDC_ADDRESS ?? "";
  let usdcDeployTx: string | null = null;
  let deployedMock = false;

  if (!usdcAddress || usdcAddress === "0x" + "0".repeat(40)) {
    console.log("USDC_ADDRESS not set — deploying MockUSDC for demo/local testing");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    usdcDeployTx = mockUsdc.deploymentTransaction()?.hash ?? null;
    deployedMock = true;
    console.log("MockUSDC deployed at:", usdcAddress);

    // Seed deployer with 10,000 USDC for demo
    const tx = await mockUsdc.mint(deployer.address, 10_000n * 10n ** 6n);
    await tx.wait();
    console.log("Minted 10,000 USDC to deployer");
  } else {
    console.log("Using existing USDC at:", usdcAddress);
  }

  // ── 2. Attester ──────────────────────────────────────────────────────────
  const attesterAddress = process.env.ATTESTER_ADDRESS;
  if (!attesterAddress) {
    throw new Error("ATTESTER_ADDRESS env var is required");
  }
  console.log("Attester:", attesterAddress);

  // ── 3. Window parameters ────────────────────────────────────────────────
  const commitWindow  = BigInt(process.env.COMMIT_WINDOW  ?? "300");
  const revealWindow  = BigInt(process.env.REVEAL_WINDOW  ?? "300");
  const claimDuration = BigInt(process.env.CLAIM_DURATION ?? "3600");
  console.log(`commitWindow: ${commitWindow}s, revealWindow: ${revealWindow}s, claimDuration: ${claimDuration}s`);

  // ── 4. Deploy StreetSyncEscrow ──────────────────────────────────────────
  const Escrow = await ethers.getContractFactory("StreetSyncEscrow");
  const escrow = await Escrow.deploy(
    usdcAddress,
    attesterAddress,
    commitWindow,
    revealWindow,
    claimDuration,
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const escrowDeployTx = escrow.deploymentTransaction()?.hash ?? null;

  // ── 5. Sanity checks ────────────────────────────────────────────────────
  const usdcOnChain    = await escrow.USDC();
  const attesterOnChain = await escrow.attester();
  const stakeOnChain    = await escrow.REVIEWER_STAKE();
  const cutOnChain      = await escrow.REVIEWER_CUT_BPS();

  if (usdcOnChain.toLowerCase() !== usdcAddress.toLowerCase()) throw new Error("USDC mismatch");
  if (attesterOnChain.toLowerCase() !== attesterAddress.toLowerCase()) throw new Error("attester mismatch");
  if (stakeOnChain !== 10_000_000n) throw new Error("stake must be 10.00 USDC");
  if (cutOnChain !== 500n) throw new Error("cut must be 5%");

  // ── 6. Write deployments JSON ───────────────────────────────────────────
  const networkName = chainId === 31337 ? "localhost" : "arcTestnet";
  // CommonJS project (Hardhat 2 + ts-node): import.meta would make Node load this file as ESM.
  const rootDir = join(__dirname, "..");
  const outPath = join(rootDir, "deployments", `${networkName}.json`);

  const readAbi = (contractName: string) => {
    const artifactPath = join(
      rootDir, "artifacts", "src", `${contractName}.sol`, `${contractName}.json`,
    );
    return JSON.parse(readFileSync(artifactPath, "utf8")).abi;
  };

  const deployment = {
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    note: `Deployed by contracts/scripts/deploy.ts. Attester: ${attesterAddress}.`,
    parameters: {
      reviewerStakeUsdc: "10.00",
      reviewerStakeRaw: "10000000",
      reviewerCutBps: 500,
      panelSize: 3,
      quorum: 2,
      commitWindowSeconds: Number(commitWindow),
      revealWindowSeconds: Number(revealWindow),
      claimDurationSeconds: Number(claimDuration),
      usdcDecimals: 6,
    },
    contracts: {
      StreetSyncEscrow: {
        address: escrowAddress,
        transactionHash: escrowDeployTx,
        abi: readAbi("StreetSyncEscrow"),
      },
      ...(deployedMock
        ? {
            MockUSDC: {
              address: usdcAddress,
              transactionHash: usdcDeployTx,
              abi: readAbi("MockUSDC"),
            },
          }
        : {
            USDC: {
              address: usdcAddress,
              transactionHash: null,
              abi: readAbi("MockUSDC"), // ERC-20 interface subset for viem calls
            },
          }),
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log("Wrote deployment file:", outPath);

  // ── 7. Summary ──────────────────────────────────────────────────────────
  console.log("");
  console.log("=== Deployment Summary ===");
  console.log("StreetSyncEscrow :", escrowAddress);
  console.log("USDC             :", usdcAddress, deployedMock ? "(MockUSDC)" : "(existing)");
  console.log("Attester         :", attesterAddress);
  console.log("Owner            :", deployer.address);
  console.log("Domain Separator :", await escrow.domainSeparator());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

