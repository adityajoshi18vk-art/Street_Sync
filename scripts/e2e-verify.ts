/**
 * scripts/e2e-verify.ts
 * StreetSync full-stack End-to-End integration test.
 *
 * Covers the complete lifecycle:
 *   1. Contract unit tests (hardhat test)
 *   2. Local deploy (MockUSDC 6-decimal + StreetSyncEscrow) via in-process Hardhat node
 *   3. Funder1 creates bounty 50 USDC + Funder2 pledges 25 USDC → escrow = 75_000_000
 *   4. Worker attestation (role=1) signed by the REAL backend signer → claim() → 4-digit code
 *   5. Evidence pipeline: before/after photos + GPS metadata → @streetsync/evidence
 *      CBOR + Zstd WASM compression → benchmark (<128,000 bytes) → Arkiv write (in-memory
 *      IArkivClient recording payloads) → submitEvidence on-chain
 *   6. 3 reviewers register with 2 USDC stake each
 *   7. Advance blocks → assignPanel (3-of-3)
 *   8. Commit/reveal: 2 Approve + 1 Reject → settle
 *   9. Assert: worker 90%, majority reviewers stake back + reward incl. slashed stake,
 *      minority reviewer slashed; verifyEvidenceBundle PASS; flip 1 byte → TAMPER_DETECTED
 *
 * Run: npm run test:e2e
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { ethers } from "ethers";
import sharp from "sharp";
import { packBundle, resizeAndEncodePhoto } from "@streetsync/evidence";
import {
  writeEvidenceBundle,
  verifyEvidenceBundle,
  entityKeyToBytes32,
  type IArkivClient,
} from "@streetsync/arkiv-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = join(ROOT, "contracts");
const RPC_PORT = 18545 + (process.pid % 500);
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const USDC_6 = (n: number) => BigInt(Math.round(n * 1e6));

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  const tag = cond ? "PASS" : "FAIL";
  if (cond) passed++;
  else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
  }
  console.log(`  [${tag}] ${name}${detail && !cond ? ` — ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n═══ ${title} ═══`);
}

// ─── In-memory Arkiv client (records payloads for construction verification) ──

class MemArkivClient implements IArkivClient {
  entities = new Map<string, { payload: Uint8Array; attributes: Record<string, string> }>();
  private counter = 0;

  async writeEntity(payload: Uint8Array, attributes: Record<string, string>) {
    const key = `arkiv-e2e-${++this.counter}`;
    this.entities.set(key, { payload: payload.slice(), attributes: { ...attributes } });
    return { key };
  }

  async readEntity(key: string) {
    const e = this.entities.get(key);
    if (!e) throw new Error(`entity not found: ${key}`);
    return { payload: e.payload.slice(), attributes: { ...e.attributes } };
  }

  tamper(key: string, byteOffset: number): void {
    const e = this.entities.get(key);
    if (!e) throw new Error(`entity not found: ${key}`);
    e.payload[byteOffset % e.payload.length] ^= 0xff;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadArtifact(contractName: string) {
  const p = join(CONTRACTS_DIR, "artifacts", "src", `${contractName}.sol`, `${contractName}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function regionCellFromLatLng(lat: number, lng: number): number {
  const latIdx = Math.min(127, Math.max(0, Math.floor(((lat + 90) / 180) * 128)));
  const lngIdx = Math.min(127, Math.max(0, Math.floor(((lng + 180) / 360) * 128)));
  return (latIdx << 7) | lngIdx;
}

async function waitForRpc(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error(`RPC at ${url} did not become ready in ${timeoutMs}ms`);
}

async function mineBlocks(provider: ethers.JsonRpcProvider, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await provider.send("evm_mine", []);
  }
}

async function advanceTime(provider: ethers.JsonRpcProvider, seconds: number): Promise<void> {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

/**
 * ethers v6's block-tag cache can resolve "pending"/"latest" nonce lookups against a
 * stale block under Hardhat automine, producing reused nonces. Bypass it with a raw
 * eth_getTransactionCount("latest") — safe because every send awaits its receipt.
 */
async function rawNonce(url: string, address: string): Promise<bigint> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [address, "latest"] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return BigInt(json.result);
}

function patchNonce(wallet: ethers.HDNodeWallet, url: string): ethers.HDNodeWallet {
  wallet.getNonce = async () => rawNonce(url, wallet.address);
  return wallet;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         StreetSync E2E Integration Verification              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ─── Step 1: Contract unit tests ──────────────────────────────────────────
  section("STEP 1 — Contract unit tests (hardhat test)");
  if (process.env.SKIP_UNIT_TESTS === "1") {
    console.log("  (skipped via SKIP_UNIT_TESTS=1)");
  } else {
    const res = spawnSync("npx", ["hardhat", "test"], {
      cwd: CONTRACTS_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const out = (res.stdout?.toString() ?? "") + (res.stderr?.toString() ?? "");
    const m = out.match(/(\d+)\s+passing/);
    check(`hardhat test passes (${m?.[1] ?? "?"} tests)`, res.status === 0, out.slice(-400));
  }

  // ─── Step 2: Start local node + deploy ────────────────────────────────────
  section("STEP 2 — Local deploy (MockUSDC 6-decimal + StreetSyncEscrow)");
  const node: ChildProcess = spawn("npx", ["hardhat", "node", "--port", String(RPC_PORT)], {
    cwd: CONTRACTS_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let nodeLog = "";
  node.stdout?.on("data", (d) => (nodeLog += d.toString()));
  node.stderr?.on("data", (d) => (nodeLog += d.toString()));
  const killNode = (): void => {
    node.kill("SIGKILL");
    // On Windows the shell wrapper may orphan the node child — sweep by port.
    if (process.platform === "win32") {
      try {
        const out = spawnSync("cmd.exe", ["/c", `netstat -ano | findstr :${RPC_PORT} | findstr LISTENING`], { encoding: "utf8" });
        const pid = out.stdout?.trim().split(/\s+/).pop();
        if (pid) spawnSync("taskkill", ["/F", "/PID", pid]);
      } catch { /* best effort */ }
    }
  };

  let provider: ethers.JsonRpcProvider | null = null;
  try {
    await waitForRpc(RPC_URL);
    provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    check("Hardhat node up (chainId 31337)", chainId === 31337n, `got ${chainId}`);

    const MNEMONIC = "test test test test test test test test test test test junk";
    const base = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0");
    const accts = Array.from({ length: 10 }, (_, i) => patchNonce(base.deriveChild(i).connect(provider), RPC_URL));
    const [attesterNode, funder1, funder2, worker, rev1, rev2, rev3, anyone] = accts;
    const attesterKey = attesterNode.privateKey as `0x${string}`;

    const MockUsdcAbi = loadArtifact("MockUSDC");
    const EscrowAbi = loadArtifact("StreetSyncEscrow");

    const usdc = await new ethers.ContractFactory(MockUsdcAbi.abi, MockUsdcAbi.bytecode, attesterNode).deploy();
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();

    const REVIEWER_STAKE = 2_000_000n;
    // 1-hour windows: short windows race the wall clock over JSON-RPC polling;
    // time is warped explicitly with evm_increaseTime where needed.
    const COMMIT_WINDOW = 3600n;
    const REVEAL_WINDOW = 3600n;
    const CLAIM_DURATION = 3600n;

    const escrow = await new ethers.ContractFactory(EscrowAbi.abi, EscrowAbi.bytecode, attesterNode).deploy(
      usdcAddress,
      attesterNode.address,
      COMMIT_WINDOW,
      REVEAL_WINDOW,
      CLAIM_DURATION,
    );
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();

    check("MockUSDC deployed (6 decimals)", (await usdc.decimals()) === 6n);
    check("Escrow REVIEWER_STAKE = 2 USDC", (await escrow.REVIEWER_STAKE()) === REVIEWER_STAKE);
    check("Escrow REVIEWER_CUT_BPS = 1000 (10%)", (await escrow.REVIEWER_CUT_BPS()) === 1000n);
    check("Escrow attester matches backend signer key", (await escrow.attester()) === attesterNode.address);

    // Fund actors
    const actors = [funder1, funder2, worker, rev1, rev2, rev3, anyone];
    for (const a of actors) {
      await (await usdc.mint(a.address, 1_000n * 10n ** 6n)).wait();
      await (await usdc.connect(a).approve(escrowAddress, ethers.MaxUint256)).wait();
    }

    // Configure the REAL backend signer (built backend/dist) to sign EIP-712 attestations
    const dbPath = join(os.tmpdir(), `streetsync-e2e-${Date.now()}.db`);
    process.env.ATTESTER_PRIVATE_KEY = attesterKey;
    process.env.ATTESTER_SIGNER_ADDRESS = attesterNode.address;
    process.env.CHAIN_ID = "31337";
    process.env.DB_PATH = dbPath;
    const signer = await import(pathToFileURL(join(ROOT, "backend", "dist", "signer.js")).href);
    signer.setVerifyingContract(escrowAddress);
    check("Backend signer attester address == on-chain attester", signer.getAttesterAddress() === attesterNode.address);

    // ─── Step 3: Funding ────────────────────────────────────────────────────
    section("STEP 3 — Funding: bounty 50 USDC + pledge 25 USDC");
    const LAT = 40.012;
    const LNG = -75.13;
    const cell = regionCellFromLatLng(LAT, LNG);
    const descHash = ethers.keccak256(ethers.toUtf8Bytes("e2e: pothole on main street"));
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 86400n;

    await (await escrow.connect(funder1).createBounty(descHash, 4001200, -7513000, cell, USDC_6(50), deadline)).wait();
    const bountyId = 0n;
    await (await escrow.connect(funder2).pledge(bountyId, USDC_6(25))).wait();

    const escrowBalAfterPledge = await usdc.balanceOf(escrowAddress);
    check("escrow holds 75_000_000 (50 + 25 USDC)", escrowBalAfterPledge === 75_000_000n, `got ${escrowBalAfterPledge}`);

    // ─── Step 4: Worker attestation + claim ─────────────────────────────────
    section("STEP 4 — Worker attestation (role=1) + claim()");
    const workerAtt = await signer.signAttestation(worker.address, signer.RoleEnum.Worker, bountyId);
    check("attestation role == 1 (Worker)", workerAtt.role === 1);
    await (await escrow.connect(worker).claim(bountyId, workerAtt.nonce, workerAtt.expiry, workerAtt.signature)).wait();
    const bAfterClaim = await escrow.getBounty(bountyId);
    const challengeCode = Number(bAfterClaim[10]);
    check("bounty claimed by worker", bAfterClaim[9] === worker.address);
    check("4-digit challenge code (1000-9999)", challengeCode >= 1000 && challengeCode <= 9999, `got ${challengeCode}`);

    // ─── Step 5: Evidence pipeline + Arkiv + submitEvidence ─────────────────
    section("STEP 5 — Evidence pipeline (WebP + CBOR + Zstd WASM) → Arkiv → submitEvidence");
    const makePhoto = async (label: string, r: number, g: number, b: number) => {
      const raw = await sharp({
        create: { width: 1280, height: 960, channels: 3, background: { r, g, b } },
      })
        .composite([{ input: Buffer.from(`<svg width="1280" height="960"><text x="40" y="120" font-size="90" fill="white">${label}</text></svg>`), top: 0, left: 0 }])
        .jpeg({ quality: 85 })
        .toBuffer();
      return resizeAndEncodePhoto(new Uint8Array(raw));
    };
    const before = await makePhoto("BEFORE", 130, 84, 40);
    const after = await makePhoto("AFTER", 60, 140, 70);
    check("before photo ≤ 48,000 bytes WebP", before.webpBytes.length <= 48_000, `${before.webpBytes.length} bytes`);
    check("after photo ≤ 48,000 bytes WebP", after.webpBytes.length <= 48_000, `${after.webpBytes.length} bytes`);

    const workerKey = worker.privateKey as `0x${string}`;
    const metadata = {
      v: 1 as const,
      bountyId: "0",
      workerAddress: worker.address as `0x${string}`,
      challengeCode,
      beforeTimestampMs: Date.now() - 60_000,
      afterTimestampMs: Date.now(),
      gps: { lat: 40.012, lng: -75.13, accuracyMeters: 5 },
      orientation: { alpha: 180, beta: null, gamma: null },
      beforeSha256: before.sha256Hex,
      afterSha256: after.sha256Hex,
      userAgent: "e2e-node/22",
      notes: "",
    };

    const { bundle, evidenceHash, stats } = await packBundle({
      metadata,
      beforeImage: before.webpBytes,
      afterImage: after.webpBytes,
      signerPrivateKey: workerKey,
    });

    console.log("  ── Benchmark ──────────────────────────────────────────");
    console.log(`     raw images:        ${stats.rawImagesBytes} bytes`);
    console.log(`     encoded images:    ${stats.encodedImagesBytes} bytes`);
    console.log(`     metadata CBOR:     ${stats.cborMetadataBytes} bytes → zstd ${stats.zstdMetadataBytes} bytes`);
    console.log(`     bundle total:      ${stats.totalBundleBytes} bytes (limit 128,000)`);
    console.log(`     overall ratio:     ${stats.overallCompressionRatio.toFixed(2)}x (${stats.overallSavingsPercent.toFixed(1)}% savings)`);
    check("bundle < 100,000 bytes", stats.totalBundleBytes < 100_000, `${stats.totalBundleBytes} bytes`);

    const arkiv = new MemArkivClient();
    const writeRes = await writeEvidenceBundle(arkiv, bundle, worker.address, bountyId.toString(), evidenceHash);
    check("Arkiv write ok (payload construction verified)", writeRes.evidenceHash === evidenceHash);
    const attrs = arkiv.entities.get(writeRes.entityKey)!.attributes;
    check("Arkiv attributes: project=streetsync", attrs.project === "streetsync", JSON.stringify(attrs));
    check("Arkiv attributes: entity_type=evidence", attrs.entity_type === "evidence");
    check("Arkiv attributes: bounty_id=0", attrs.bounty_id === "0");
    check("Arkiv attributes: sha256_prefix matches", attrs.sha256_prefix === evidenceHash.slice(0, 32));
    const keyBytes32 = await entityKeyToBytes32(writeRes.entityKey);
    check("entityKey→bytes32 is 0x+64 hex", /^0x[0-9a-f]{64}$/.test(keyBytes32));

    await (await escrow.connect(worker).submitEvidence(bountyId, keyBytes32, evidenceHash)).wait();
    const bAfterSubmit = await escrow.getBounty(bountyId);
    check("submitEvidence stored bytes32 key + hash on-chain",
      bAfterSubmit[11] === keyBytes32 && bAfterSubmit[12] === evidenceHash);

    // ─── Step 6: Reviewer registration ──────────────────────────────────────
    section("STEP 6 — 3 reviewers register (2 USDC stake each)");
    const reviewers = [rev1, rev2, rev3];
    for (const r of reviewers) {
      const att = await signer.signAttestation(r.address, signer.RoleEnum.Reviewer, 0n);
      await (await escrow.connect(r).registerReviewer(cell, att.nonce, att.expiry, att.signature)).wait();
    }
    const escrowBalAfterReg = await usdc.balanceOf(escrowAddress);
    check("escrow holds 75e6 pool + 6e6 stakes = 81_000_000", escrowBalAfterReg === 81_000_000n, `got ${escrowBalAfterReg}`);
    for (const r of reviewers) {
      const rv = await escrow.reviewers(r.address);
      check(`reviewer ${r.address.slice(0, 8)}… staked 2 USDC, active`, rv[2] === REVIEWER_STAKE && rv[3] === true);
    }

    // ─── Step 7: Advance blocks + assignPanel ───────────────────────────────
    section("STEP 7 — Advance 2+ blocks → assignPanel (Rule 4)");
    const bSubmitted = await escrow.getBounty(bountyId);
    const selBlock = bSubmitted[13];
    const curBlock = BigInt(await provider.getBlockNumber());
    await mineBlocks(provider, Number(selBlock - curBlock) + 1);
    await (await escrow.connect(anyone).assignPanel(bountyId)).wait();
    const bInReview = await escrow.getBounty(bountyId);
    check("panel assigned, status InReview", Number(bInReview[16]) === 3);
    const round = Number(bInReview[14]);
    const panel: string[] = await escrow.getPanel(bountyId, round);
    check("panel has 3 distinct reviewers",
      panel.length === 3 && new Set(panel).size === 3 && panel.every((p) => p !== ethers.ZeroAddress));

    // ─── Step 8: Commit/reveal (2 Approve, 1 Reject) → settle ───────────────
    section("STEP 8 — Commit/reveal (2 Approve, 1 Reject) → settle");
    const signerMap = new Map(reviewers.map((r) => [r.address, r]));
    const votes = [true, true, false];
    const salts = [1, 2, 3].map((i) => ethers.keccak256(ethers.toUtf8Bytes(`e2e-salt-${i}`)));
    for (let i = 0; i < 3; i++) {
      const vh = ethers.solidityPackedKeccak256(
        ["uint256", "uint8", "bool", "bytes32", "address"],
        [bountyId, round, votes[i], salts[i], panel[i]],
      );
      await (await escrow.connect(signerMap.get(panel[i])!).commitVote(bountyId, vh)).wait();
    }
    await advanceTime(provider, Number(COMMIT_WINDOW) + 1);
    for (let i = 0; i < 3; i++) {
      await (await escrow.connect(signerMap.get(panel[i])!).revealVote(bountyId, votes[i], salts[i])).wait();
    }
    await advanceTime(provider, Number(REVEAL_WINDOW) + 1);
    const workerPre = await usdc.balanceOf(worker.address);
    const majBalancesPre = [await usdc.balanceOf(panel[0]), await usdc.balanceOf(panel[1])];
    await (await escrow.connect(anyone).settle(bountyId)).wait();
    const bSettled = await escrow.getBounty(bountyId);
    check("bounty Approved", Number(bSettled[16]) === 4, `status=${bSettled[16]}`);

    // ─── Step 9: Settlement assertions + evidence audit + tamper ────────────
    section("STEP 9 — Settlement math, evidence audit, tamper detection");
    const workerPayout = (75_000_000n * 9000n) / 10_000n; // 67_500_000
    check("worker got 90% = 67_500_000", (await usdc.balanceOf(worker.address)) - workerPre === workerPayout);

    const reviewerPool = 75_000_000n - workerPayout + REVIEWER_STAKE; // 7_500_000 + 2_000_000 = 9_500_000
    const perMajority = reviewerPool / 2n; // 4_750_000
    for (let i = 0; i < 2; i++) {
      const rv = await escrow.reviewers(panel[i]);
      check(`majority reviewer[${i}] stake returned + reward ${perMajority}`,
        (await usdc.balanceOf(panel[i])) - majBalancesPre[i] === REVIEWER_STAKE && rv[4] === perMajority);
      const pre = await usdc.balanceOf(panel[i]);
      await (await escrow.connect(signerMap.get(panel[i])!).withdrawReward()).wait();
      check(`majority reviewer[${i}] withdrawReward pays ${perMajority}`,
        (await usdc.balanceOf(panel[i])) - pre === perMajority);
    }
    const minority = await escrow.reviewers(panel[2]);
    check("minority reviewer slashed (stake 0, inactive)", minority[2] === 0n && minority[3] === false);

    const audit = await verifyEvidenceBundle(arkiv, writeRes.entityKey, evidenceHash, worker.address);
    check("verifyEvidenceBundle: PASS", audit.valid === true, audit.errors.join("; "));

    arkiv.tamper(writeRes.entityKey, 40);
    const tampered = await verifyEvidenceBundle(arkiv, writeRes.entityKey, evidenceHash, worker.address);
    check("1-byte flip → TAMPER_DETECTED", tampered.valid === false && !tampered.evidenceHashMatch,
      tampered.errors.join("; "));

    const escrowBalFinal = await usdc.balanceOf(escrowAddress);
    check("escrow fully drained (0 USDC left)", escrowBalFinal === 0n, `got ${escrowBalFinal}`);

    try {
      rmSync(dbPath, { force: true });
    } catch {
      // sqlite handle may still hold the file on Windows; temp cleanup is best-effort
    }
  } finally {
    killNode();
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  E2E RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    console.log("══════════════════════════════════════════════════════════════");
    process.exit(1);
  }
  console.log("  ALL E2E CHECKS PASSED");
  console.log("══════════════════════════════════════════════════════════════");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E fatal error:", err);
  process.exit(1);
});
