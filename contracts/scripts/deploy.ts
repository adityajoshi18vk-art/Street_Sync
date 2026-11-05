import { ethers } from "hardhat";

/**
 * StreetSync Deploy Script – Arc Testnet (Chain ID: 5042002)
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network arcTestnet
 *
 * Environment variables (see .env.example):
 *   DEPLOYER_PRIVATE_KEY  – deployer wallet
 *   ATTESTER_ADDRESS      – backend EIP-712 signer
 *   USDC_ADDRESS          – (optional) Arc Testnet USDC; omit to deploy MockUSDC
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== StreetSync Deployment ===");
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId.toString());

  // ── 1. USDC ──────────────────────────────────────────────────────────────
  let usdcAddress = process.env.USDC_ADDRESS ?? "";

  if (!usdcAddress || usdcAddress === "0x" + "0".repeat(40)) {
    console.log("USDC_ADDRESS not set — deploying MockUSDC for demo/local testing");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
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

  // ── 5. Sanity checks ───────────────────────────────────────────────────
  const usdcOnChain    = await escrow.USDC();
  const attesterOnChain = await escrow.attester();
  const stakeOnChain    = await escrow.REVIEWER_STAKE();
  const cutOnChain      = await escrow.REVIEWER_CUT_BPS();

  if (usdcOnChain.toLowerCase() !== usdcAddress.toLowerCase()) throw new Error("USDC mismatch");
  if (attesterOnChain.toLowerCase() !== attesterAddress.toLowerCase()) throw new Error("attester mismatch");
  if (stakeOnChain !== 2_000_000n) throw new Error("stake must be 2.00 USDC");
  if (cutOnChain !== 1000n) throw new Error("cut must be 10%");

  // ── 6. Summary ─────────────────────────────────────────────────────────
  console.log("");
  console.log("=== Deployment Summary ===");
  console.log("StreetSyncEscrow :", escrowAddress);
  console.log("USDC             :", usdcAddress);
  console.log("Attester         :", attesterAddress);
  console.log("Owner            :", deployer.address);
  console.log("Domain Separator :", await escrow.domainSeparator());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

