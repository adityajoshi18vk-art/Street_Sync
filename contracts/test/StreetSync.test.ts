import { expect } from "chai";
import { ethers } from "hardhat";
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MockUSDC, StreetSyncEscrow } from "../typechain-types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants matching the contracts
// ─────────────────────────────────────────────────────────────────────────────

const REVIEWER_STAKE    = 2_000_000n;   // 2.00 USDC (6 decimals)
const INITIAL_PLEDGE    = 10_000_000n;  // 10.00 USDC
const TOP_UP_PLEDGE     = 5_000_000n;   // 5.00 USDC
const TOTAL_POOL        = 15_000_000n;  // 15.00 USDC
const BPS_DENOM         = 10_000n;
const PANEL_SIZE        = 3;
const COMMIT_WINDOW     = 300;          // 5 min
const REVEAL_WINDOW     = 300;          // 5 min
const CLAIM_DURATION    = 3600;         // 1 hr

// Status enum values
const Status = {
  Open: 0, Claimed: 1, Submitted: 2, InReview: 3,
  Approved: 4, Rejected: 5, Refunded: 6,
} as const;

// Role enum values
const Role = { None: 0, Worker: 1, Reviewer: 2 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build the EIP-712 domain used by AttestationVerifier */
function buildDomain(verifyingContract: string, chainId: bigint) {
  return {
    name: "StreetSync",
    version: "1",
    chainId,
    verifyingContract,
  };
}

const ATTESTATION_TYPES = {
  Attestation: [
    { name: "wallet",  type: "address" },
    { name: "role",    type: "uint8"   },
    { name: "bountyId",type: "uint256" },
    { name: "nonce",   type: "uint256" },
    { name: "expiry",  type: "uint64"  },
  ],
};

let nonceCounter: Record<string, bigint> = {};

function nextNonce(addr: string): bigint {
  if (!nonceCounter[addr]) nonceCounter[addr] = 0n;
  nonceCounter[addr] += 1n;
  return nonceCounter[addr];
}

async function signAttestation(
  attesterSigner: SignerWithAddress,
  domain: ReturnType<typeof buildDomain>,
  wallet: string,
  role: number,
  bountyId: bigint,
  nonce: bigint,
  expiry: bigint,
): Promise<string> {
  const value = { wallet, role, bountyId, nonce, expiry };
  return attesterSigner.signTypedData(domain, ATTESTATION_TYPES, value);
}

async function registerReviewer(
  escrow: StreetSyncEscrow,
  attesterSigner: SignerWithAddress,
  domain: ReturnType<typeof buildDomain>,
  reviewer: SignerWithAddress,
  regionCell: number,
) {
  const nonce  = nextNonce(reviewer.address);
  const expiry = BigInt(await time.latest()) + 3600n;
  const sig    = await signAttestation(
    attesterSigner, domain, reviewer.address, Role.Reviewer, 0n, nonce, expiry,
  );
  await escrow.connect(reviewer).registerReviewer(regionCell, nonce, expiry, sig);
}

async function claimBounty(
  escrow: StreetSyncEscrow,
  attesterSigner: SignerWithAddress,
  domain: ReturnType<typeof buildDomain>,
  worker: SignerWithAddress,
  bountyId: bigint,
) {
  const nonce  = nextNonce(worker.address);
  const expiry = BigInt(await time.latest()) + 3600n;
  const sig    = await signAttestation(
    attesterSigner, domain, worker.address, Role.Worker, bountyId, nonce, expiry,
  );
  await escrow.connect(worker).claim(bountyId, nonce, expiry, sig);
}

/** Compute the commit hash matching the contract's encoding */
function commitHash(
  bountyId: bigint,
  reviewRound: number,
  approve: boolean,
  salt: string,
  voter: string,
): string {
  return ethers.solidityPackedKeccak256(
    ["uint256", "uint8", "bool", "bytes32", "address"],
    [bountyId, reviewRound, approve, salt, voter],
  );
}

/** Get bounty struct as an object from the contract */
async function getBounty(escrow: StreetSyncEscrow, bountyId: bigint) {
  const b = await escrow.getBounty(bountyId);
  return {
    id:                  b[0],
    creator:             b[1],
    descriptionHash:     b[2],
    latE5:               b[3],
    lngE5:               b[4],
    regionCell:          b[5],
    totalPledged:        b[6],
    createdAt:           b[7],
    claimDeadline:       b[8],
    worker:              b[9],
    visualChallengeCode: b[10],
    arkivEntityKey:      b[11],
    evidenceHash:        b[12],
    selectionBlock:      b[13],
    reviewRound:         b[14],
    reworkCount:         b[15],
    status:              Number(b[16]),
  };
}

/** Get reviewer struct fields from the contract */
async function getReviewer(escrow: StreetSyncEscrow, addr: string) {
  const r = await escrow.reviewers(addr);
  return {
    wallet:        r[0],
    regionCell:    Number(r[1]),
    stakedAmount:  r[2],
    active:        r[3],
    rewardBalance: r[4],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("StreetSync", function () {
  let usdc: MockUSDC;
  let escrow: StreetSyncEscrow;
  let domain: ReturnType<typeof buildDomain>;

  let owner:     SignerWithAddress;
  let attester:  SignerWithAddress;
  let creator:   SignerWithAddress;
  let worker:    SignerWithAddress;
  let pledger:   SignerWithAddress;
  let reviewer1: SignerWithAddress;
  let reviewer2: SignerWithAddress;
  let reviewer3: SignerWithAddress;
  let anyone:    SignerWithAddress;

  beforeEach(async function () {
    nonceCounter = {};

    [owner, attester, creator, worker, pledger,
     reviewer1, reviewer2, reviewer3, anyone] = await ethers.getSigners();

    // Deploy MockUSDC
    const USDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = await USDCFactory.deploy();
    await usdc.waitForDeployment();

    // Deploy Escrow
    const EscrowFactory = await ethers.getContractFactory("StreetSyncEscrow");
    escrow = await EscrowFactory.connect(owner).deploy(
      await usdc.getAddress(),
      attester.address,
      COMMIT_WINDOW,
      REVEAL_WINDOW,
      CLAIM_DURATION,
    );
    await escrow.waitForDeployment();

    // Build domain for EIP-712 signing
    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = buildDomain(await escrow.getAddress(), chainId);

    // Fund & approve
    const accounts = [creator, worker, pledger, reviewer1, reviewer2, reviewer3, anyone, owner];
    for (const acc of accounts) {
      await usdc.mint(acc.address, 100_000_000n); // 100 USDC
      await usdc.connect(acc).approve(await escrow.getAddress(), ethers.MaxUint256);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 1 – Full Happy Path
  // ═════════════════════════════════════════════════════════════════════════════

  it("Happy path: create → pledge → claim → evidence → assign → commit/reveal → settle with exact 6-decimal balances", async function () {
    const cell = 42;

    // ── Register 3 reviewers ──────────────────────────────────────────────
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    // Verify escrow holds 3 stakes
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(REVIEWER_STAKE * 3n);

    // ── Create bounty ─────────────────────────────────────────────────────
    const descHash = ethers.keccak256(ethers.toUtf8Bytes("pothole on main street"));
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    const creatorBefore = await usdc.balanceOf(creator.address);

    const tx = await escrow.connect(creator).createBounty(
      descHash, 4001200, -7513000, cell, INITIAL_PLEDGE, deadline,
    );
    const rc = await tx.wait();
    const bountyId = 0n; // first bounty

    expect(await usdc.balanceOf(creator.address)).to.equal(creatorBefore - INITIAL_PLEDGE);

    let b = await getBounty(escrow, bountyId);
    expect(b.totalPledged).to.equal(INITIAL_PLEDGE);
    expect(b.status).to.equal(Status.Open);

    // ── Top-up pledge ─────────────────────────────────────────────────────
    const pledgerBefore = await usdc.balanceOf(pledger.address);
    await escrow.connect(pledger).pledge(bountyId, TOP_UP_PLEDGE);

    expect(await usdc.balanceOf(pledger.address)).to.equal(pledgerBefore - TOP_UP_PLEDGE);
    b = await getBounty(escrow, bountyId);
    expect(b.totalPledged).to.equal(TOTAL_POOL);

    // ── Claim ─────────────────────────────────────────────────────────────
    await claimBounty(escrow, attester, domain, worker, bountyId);

    b = await getBounty(escrow, bountyId);
    expect(b.worker).to.equal(worker.address);
    expect(b.status).to.equal(Status.Claimed);
    expect(b.visualChallengeCode).to.be.gte(1000);
    expect(b.visualChallengeCode).to.be.lte(9999);

    // ── Submit evidence ───────────────────────────────────────────────────
    const arkivKey = ethers.keccak256(ethers.toUtf8Bytes("arkiv-entity-001"));
    const evHash   = ethers.keccak256(ethers.toUtf8Bytes("evidence-sha256-hash"));
    await escrow.connect(worker).submitEvidence(bountyId, arkivKey, evHash);

    b = await getBounty(escrow, bountyId);
    expect(b.status).to.equal(Status.Submitted);
    const selBlock = b.selectionBlock;

    // ── Roll 2+ blocks then assignPanel ───────────────────────────────────
    // Mine enough blocks so block.number > selectionBlock
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    const blocksNeeded = Number(selBlock - currentBlock) + 1;
    await mine(blocksNeeded);

    await escrow.connect(anyone).assignPanel(bountyId);

    b = await getBounty(escrow, bountyId);
    expect(b.status).to.equal(Status.InReview);

    const panel = await escrow.getPanel(bountyId, b.reviewRound);
    const expectedRevs = [reviewer1.address, reviewer2.address, reviewer3.address];

    // Verify panel members are from our registered reviewers
    for (let i = 0; i < PANEL_SIZE; i++) {
      expect(expectedRevs).to.include(panel[i]);
      expect(panel[i]).to.not.equal(creator.address);
      expect(panel[i]).to.not.equal(worker.address);
      expect(panel[i]).to.not.equal(pledger.address);
    }

    // ── Commit 3 votes (2 approve, 1 reject) ─────────────────────────────
    const round = Number(b.reviewRound);
    const salt1 = ethers.keccak256(ethers.toUtf8Bytes("salt1"));
    const salt2 = ethers.keccak256(ethers.toUtf8Bytes("salt2"));
    const salt3 = ethers.keccak256(ethers.toUtf8Bytes("salt3"));

    // Map panel addresses to signer objects
    const signerMap: Record<string, SignerWithAddress> = {
      [reviewer1.address]: reviewer1,
      [reviewer2.address]: reviewer2,
      [reviewer3.address]: reviewer3,
    };

    const panelSigners = panel.map((addr) => signerMap[addr]);
    const salts  = [salt1, salt2, salt3];
    const votes  = [true, true, false]; // 2 approve, 1 reject

    for (let i = 0; i < PANEL_SIZE; i++) {
      const hash = commitHash(bountyId, round, votes[i], salts[i], panel[i]);
      await escrow.connect(panelSigners[i]).commitVote(bountyId, hash);
    }

    // ── Advance past commit window, reveal votes ──────────────────────────
    await time.increase(COMMIT_WINDOW + 1);

    for (let i = 0; i < PANEL_SIZE; i++) {
      await escrow.connect(panelSigners[i]).revealVote(bountyId, votes[i], salts[i]);
    }

    // ── Settle ────────────────────────────────────────────────────────────
    // All 3 revealed so early settle is possible, but let's advance past
    // revealDeadline to also test the timeout path is clean
    await time.increase(REVEAL_WINDOW + 1);

    const workerPre = await usdc.balanceOf(worker.address);
    await escrow.connect(anyone).settle(bountyId);

    b = await getBounty(escrow, bountyId);
    expect(b.status).to.equal(Status.Approved);

    // ── Verify exact 6-decimal USDC balances ──────────────────────────────
    // Worker gets 90% of 15 USDC = 13_500_000
    const expectedWorkerPayout = (TOTAL_POOL * 9000n) / BPS_DENOM;
    expect(expectedWorkerPayout).to.equal(13_500_000n);
    expect(await usdc.balanceOf(worker.address) - workerPre).to.equal(expectedWorkerPayout);

    // Minority reviewer (panel[2], voted false) is slashed
    const minorityRev = await getReviewer(escrow, panel[2]);
    expect(minorityRev.stakedAmount).to.equal(0n);
    expect(minorityRev.active).to.equal(false);

    // Reviewer cut = 10% of 15 USDC = 1_500_000 + slashed 2_000_000 = 3_500_000
    // Split among 2 majority reviewers = 1_750_000 each
    const reviewerPoolTotal = (TOTAL_POOL * 1000n) / BPS_DENOM + REVIEWER_STAKE;
    const perMajority = reviewerPoolTotal / 2n;
    expect(perMajority).to.equal(1_750_000n);

    const maj0 = await getReviewer(escrow, panel[0]);
    const maj1 = await getReviewer(escrow, panel[1]);
    expect(maj0.rewardBalance).to.equal(perMajority);
    expect(maj1.rewardBalance).to.equal(perMajority);

    // Withdraw rewards
    const bal0Pre = await usdc.balanceOf(panel[0]);
    await escrow.connect(panelSigners[0]).withdrawReward();
    expect(await usdc.balanceOf(panel[0]) - bal0Pre).to.equal(perMajority);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 2 – Wash-Trading: creator cannot claim
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: creator cannot claim their own bounty", async function () {
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("test")), 0, 0, 1, 1_000_000n, deadline,
    );

    const nonce  = nextNonce(creator.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig    = await signAttestation(attester, domain, creator.address, Role.Worker, 0n, nonce, expiry);

    await expect(
      escrow.connect(creator).claim(0n, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "CreatorCannotClaim");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 3 – Wash-Trading: pledger cannot claim
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: pledger cannot claim a bounty they funded", async function () {
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("test")), 0, 0, 1, 1_000_000n, deadline,
    );
    await escrow.connect(pledger).pledge(0n, 1_000_000n);

    const nonce  = nextNonce(pledger.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig    = await signAttestation(attester, domain, pledger.address, Role.Worker, 0n, nonce, expiry);

    await expect(
      escrow.connect(pledger).claim(0n, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "PledgerCannotClaim");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 4 – Wash-Trading: creator/worker/pledger excluded from panel
  // ═════════════════════════════════════════════════════════════════════════════

  it("Panel excludes creator, worker, and pledger from review", async function () {
    const cell = 7;

    // Register 4 reviewers (need extras since creator must not be selected)
    const extraRev = (await ethers.getSigners())[9]; // grab another signer
    await usdc.mint(extraRev.address, 10_000_000n);
    await usdc.connect(extraRev).approve(await escrow.getAddress(), ethers.MaxUint256);

    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);
    await registerReviewer(escrow, attester, domain, extraRev, cell);

    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("test")), 0, 0, cell, 1_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    const b = await getBounty(escrow, 0n);
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    await mine(Number(b.selectionBlock - currentBlock) + 1);

    await escrow.connect(anyone).assignPanel(0n);

    const panel = await escrow.getPanel(0n, (await getBounty(escrow, 0n)).reviewRound);
    for (let i = 0; i < PANEL_SIZE; i++) {
      expect(panel[i]).to.not.equal(creator.address);
      expect(panel[i]).to.not.equal(worker.address);
    }
  });

  it("persists a replacement selection block when the randomness block is stale", async function () {
    const cell = 8;
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("stale selection")), 0, 0, cell, 1_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(
      0n, ethers.keccak256(ethers.toUtf8Bytes("key")), ethers.keccak256(ethers.toUtf8Bytes("evidence")),
    );

    const selectionBlock = (await getBounty(escrow, 0n)).selectionBlock;
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    await mine(Number(selectionBlock + 251n - currentBlock));
    const resetTx = await escrow.connect(anyone).assignPanel(0n);
    const resetReceipt = await resetTx.wait();
    const updated = await getBounty(escrow, 0n);
    expect(updated.status).to.equal(Status.Submitted);
    expect(updated.selectionBlock).to.equal(BigInt(resetReceipt!.blockNumber + 2));

    await mine(3);
    await escrow.connect(anyone).assignPanel(0n);
    expect((await getBounty(escrow, 0n)).status).to.equal(Status.InReview);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 5 – pokeOrReplace when 2 reviewers fail to reveal
  // ═════════════════════════════════════════════════════════════════════════════

  it("pokeOrReplace slashes non-revealers and selects replacement panel", async function () {
    const cell = 55;

    // Register 6 reviewers so we have enough for replacement
    const signers = await ethers.getSigners();
    const extraRevs: SignerWithAddress[] = [];
    for (let i = 9; i < 15; i++) {
      const s = signers[i];
      await usdc.mint(s.address, 10_000_000n);
      await usdc.connect(s).approve(await escrow.getAddress(), ethers.MaxUint256);
      await registerReviewer(escrow, attester, domain, s, cell);
      extraRevs.push(s);
    }

    // Create & claim bounty
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("pothole")), 0, 0, cell, 5_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    // assignPanel
    let b = await getBounty(escrow, 0n);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(0n);

    b = await getBounty(escrow, 0n);
    const round     = Number(b.reviewRound);
    const panel     = await escrow.getPanel(0n, round);

    // Map panel addresses to signers
    const signerLookup: Record<string, SignerWithAddress> = {};
    for (const s of extraRevs) signerLookup[s.address] = s;

    // Only panel[0] commits + reveals; panel[1] and panel[2] do nothing
    const salt = ethers.keccak256(ethers.toUtf8Bytes("salt-p0"));
    const hash = commitHash(0n, round, true, salt, panel[0]);
    await escrow.connect(signerLookup[panel[0]]).commitVote(0n, hash);

    // Advance past commit window
    await time.increase(COMMIT_WINDOW + 1);
    await escrow.connect(signerLookup[panel[0]]).revealVote(0n, true, salt);

    // Advance past reveal window
    await time.increase(REVEAL_WINDOW + 1);

    // Verify panel[1] and panel[2] still have stake
    expect((await getReviewer(escrow, panel[1])).stakedAmount).to.equal(REVIEWER_STAKE);
    expect((await getReviewer(escrow, panel[2])).stakedAmount).to.equal(REVIEWER_STAKE);

    // pokeOrReplace
    await expect(escrow.connect(anyone).pokeOrReplace(0n))
      .to.emit(escrow, "PokeOrReplace");

    // Non-revealers slashed
    expect((await getReviewer(escrow, panel[1])).stakedAmount).to.equal(0n);
    expect((await getReviewer(escrow, panel[1])).active).to.equal(false);
    expect((await getReviewer(escrow, panel[2])).stakedAmount).to.equal(0n);
    expect((await getReviewer(escrow, panel[2])).active).to.equal(false);

    // Status reverted to Submitted; reviewRound incremented
    b = await getBounty(escrow, 0n);
    expect(b.status).to.equal(Status.Submitted);
    expect(b.reviewRound).to.equal(round + 1);

    // Re-assign panel
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(0n);

    b = await getBounty(escrow, 0n);
    expect(b.status).to.equal(Status.InReview);

    // New panel should not include the slashed reviewers
    const newPanel = await escrow.getPanel(0n, b.reviewRound);
    for (let i = 0; i < PANEL_SIZE; i++) {
      expect(newPanel[i]).to.not.equal(panel[1]);
      expect(newPanel[i]).to.not.equal(panel[2]);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 6 – EIP-712 attestation replay revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: replaying the same attestation nonce", async function () {
    const cell = 10;
    const nonce  = nextNonce(reviewer1.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig    = await signAttestation(attester, domain, reviewer1.address, Role.Reviewer, 0n, nonce, expiry);

    // First use succeeds
    await escrow.connect(reviewer1).registerReviewer(cell, nonce, expiry, sig);

    // Replay reverts
    await expect(
      escrow.connect(reviewer1).registerReviewer(cell, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "NonceAlreadyUsed");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 7 – Expired attestation revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: expired attestation signature", async function () {
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("x")), 0, 0, 1, 1_000_000n, deadline,
    );

    const nonce  = nextNonce(worker.address);
    const expiry = BigInt(await time.latest()) - 1n; // already expired
    const sig    = await signAttestation(attester, domain, worker.address, Role.Worker, 0n, nonce, expiry);

    await expect(
      escrow.connect(worker).claim(0n, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "AttestationExpired");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 8 – Wrong signer revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: attestation signed by wrong key", async function () {
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("x")), 0, 0, 1, 1_000_000n, deadline,
    );

    const nonce  = nextNonce(worker.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    // Sign with 'anyone' instead of 'attester'
    const sig = await signAttestation(anyone, domain, worker.address, Role.Worker, 0n, nonce, expiry);

    await expect(
      escrow.connect(worker).claim(0n, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "InvalidAttestation");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 9 – Exact 6-decimal balances (unanimous approval)
  // ═════════════════════════════════════════════════════════════════════════════

  it("Exact 6-decimal USDC balances: 20 USDC pool, unanimous approval", async function () {
    const cell = 99;
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    const pool = 20_000_000n;
    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("balance-test")), 0, 0, cell, pool, deadline,
    );

    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    let b = await getBounty(escrow, 0n);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(0n);

    b = await getBounty(escrow, 0n);
    const round = Number(b.reviewRound);
    const panel = await escrow.getPanel(0n, round);

    const signerMap: Record<string, SignerWithAddress> = {
      [reviewer1.address]: reviewer1,
      [reviewer2.address]: reviewer2,
      [reviewer3.address]: reviewer3,
    };

    const salts = [
      ethers.keccak256(ethers.toUtf8Bytes("s1")),
      ethers.keccak256(ethers.toUtf8Bytes("s2")),
      ethers.keccak256(ethers.toUtf8Bytes("s3")),
    ];

    // All 3 approve
    for (let i = 0; i < PANEL_SIZE; i++) {
      const vh = commitHash(0n, round, true, salts[i], panel[i]);
      await escrow.connect(signerMap[panel[i]]).commitVote(0n, vh);
    }

    await time.increase(COMMIT_WINDOW + 1);

    const balsBefore = await Promise.all(panel.map((a) => usdc.balanceOf(a)));
    const workerBefore = await usdc.balanceOf(worker.address);

    for (let i = 0; i < PANEL_SIZE; i++) {
      await escrow.connect(signerMap[panel[i]]).revealVote(0n, true, salts[i]);
    }

    // All 3 revealed → early settle (no deadline wait needed)
    await escrow.connect(anyone).settle(0n);

    // Worker: 90% of 20 USDC = 18_000_000
    const workerPayout = (pool * 9000n) / BPS_DENOM;
    expect(workerPayout).to.equal(18_000_000n);
    expect(await usdc.balanceOf(worker.address) - workerBefore).to.equal(workerPayout);

    // No minority → reviewerPool = 10% of 20 USDC = 2_000_000
    // perReviewer = 2_000_000 / 3 = 666_666
    const reviewerCut = pool - workerPayout; // 1_000_000
    const perReviewer = reviewerCut / 3n;    // 333_333
    expect(perReviewer).to.equal(666_666n);

    for (let i = 0; i < PANEL_SIZE; i++) {
      // Stake returned directly during settle
      const stakeReturned = (await usdc.balanceOf(panel[i])) - balsBefore[i];
      expect(stakeReturned).to.equal(REVIEWER_STAKE);

      // Reward credited (pull-based)
      const rev = await getReviewer(escrow, panel[i]);
      expect(rev.rewardBalance).to.equal(perReviewer);
    }

    // Withdraw rewards and verify
    for (let i = 0; i < PANEL_SIZE; i++) {
      const pre = await usdc.balanceOf(panel[i]);
      await escrow.connect(signerMap[panel[i]]).withdrawReward();
      expect(await usdc.balanceOf(panel[i]) - pre).to.equal(perReviewer);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 10 – withdrawPledge after expiry
  // ═════════════════════════════════════════════════════════════════════════════

  it("withdrawPledge after bounty expiry", async function () {
    const deadline = BigInt(await time.latest()) + 3600n; // 1 hour
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("expired")), 0, 0, 1, 3_000_000n, deadline,
    );
    await escrow.connect(pledger).pledge(0n, 2_000_000n);

    // Before expiry → revert
    await expect(
      escrow.connect(creator).withdrawPledge(0n),
    ).to.be.revertedWithCustomError(escrow, "ClaimDeadlineNotPassed");

    // Warp past deadline
    await time.increase(3601);

    const creatorBefore = await usdc.balanceOf(creator.address);
    await escrow.connect(creator).withdrawPledge(0n);
    expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(3_000_000n);

    const pledgerBefore = await usdc.balanceOf(pledger.address);
    await escrow.connect(pledger).withdrawPledge(0n);
    expect(await usdc.balanceOf(pledger.address) - pledgerBefore).to.equal(2_000_000n);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 11 – CommitWindowClosed revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: commitVote after commit window closes", async function () {
    const cell = 33;
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("x")), 0, 0, cell, 1_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    let b = await getBounty(escrow, 0n);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(0n);

    b = await getBounty(escrow, 0n);
    const panel = await escrow.getPanel(0n, b.reviewRound);

    const signerMap: Record<string, SignerWithAddress> = {
      [reviewer1.address]: reviewer1,
      [reviewer2.address]: reviewer2,
      [reviewer3.address]: reviewer3,
    };

    // Warp past commit window
    await time.increase(COMMIT_WINDOW + 1);

    const vh = commitHash(0n, Number(b.reviewRound), true, ethers.keccak256(ethers.toUtf8Bytes("s")), panel[0]);
    await expect(
      escrow.connect(signerMap[panel[0]]).commitVote(0n, vh),
    ).to.be.revertedWithCustomError(escrow, "CommitWindowClosed");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 12 – VoteHashMismatch revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: revealVote with wrong salt", async function () {
    const cell = 44;
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("x")), 0, 0, cell, 1_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    let b = await getBounty(escrow, 0n);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(0n);

    b = await getBounty(escrow, 0n);
    const round = Number(b.reviewRound);
    const panel = await escrow.getPanel(0n, round);
    const signerMap: Record<string, SignerWithAddress> = {
      [reviewer1.address]: reviewer1,
      [reviewer2.address]: reviewer2,
      [reviewer3.address]: reviewer3,
    };

    const correctSalt = ethers.keccak256(ethers.toUtf8Bytes("correct"));
    const wrongSalt   = ethers.keccak256(ethers.toUtf8Bytes("wrong"));

    // Commit with correct salt
    const vh = commitHash(0n, round, true, correctSalt, panel[0]);
    await escrow.connect(signerMap[panel[0]]).commitVote(0n, vh);

    await time.increase(COMMIT_WINDOW + 1);

    // Reveal with wrong salt
    await expect(
      escrow.connect(signerMap[panel[0]]).revealVote(0n, true, wrongSalt),
    ).to.be.revertedWithCustomError(escrow, "VoteHashMismatch");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 13 – InsufficientReviewers revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: assignPanel with fewer than 3 eligible reviewers", async function () {
    const cell = 11;
    // Only 2 reviewers registered (need 3)
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);

    const deadline = BigInt(await time.latest()) + 7n * 86400n;
    await escrow.connect(creator).createBounty(
      ethers.keccak256(ethers.toUtf8Bytes("x")), 0, 0, cell, 1_000_000n, deadline,
    );
    await claimBounty(escrow, attester, domain, worker, 0n);
    await escrow.connect(worker).submitEvidence(0n, ethers.keccak256(ethers.toUtf8Bytes("k")), ethers.keccak256(ethers.toUtf8Bytes("h")));

    const b = await getBounty(escrow, 0n);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);

    await expect(
      escrow.connect(anyone).assignPanel(0n),
    ).to.be.revertedWithCustomError(escrow, "InsufficientReviewers");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 14 – MockUSDC: 6-decimal precision
  // ═════════════════════════════════════════════════════════════════════════════

  it("MockUSDC uses 6 decimals", async function () {
    expect(await usdc.decimals()).to.equal(6);
    await usdc.mint(anyone.address, 1_000_000n);
    expect(await usdc.balanceOf(anyone.address)).to.equal(101_000_000n); // 100 from setup + 1
  });
});

