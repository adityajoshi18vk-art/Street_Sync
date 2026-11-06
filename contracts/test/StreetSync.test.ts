import { expect } from "chai";
import { ethers } from "hardhat";
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
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
const VALIDATION_WINDOW = 86_400;       // 24 h
const VALIDATION_QUORUM = 2;
const REVIEW_TIMEOUT    = 3 * 86_400;   // 3 days (contract constant)
const DAY               = 86_400n;

// Status enum values
const Status = {
  Open: 0, Claimed: 1, Submitted: 2, InReview: 3,
  Approved: 4, Rejected: 5, Refunded: 6, Proposed: 7,
} as const;

// Role enum values
const Role = { None: 0, Worker: 1, Reviewer: 2, Neighbour: 3 } as const;

// problemVote() values
const Vote = { None: 0, Real: 1, Fake: 2 } as const;

const KEY  = ethers.keccak256(ethers.toUtf8Bytes("arkiv-entity-001"));
const EVH  = ethers.keccak256(ethers.toUtf8Bytes("evidence-sha256-hash"));

const descHashOf   = (text: string) => ethers.keccak256(ethers.toUtf8Bytes(text));
const reportHashOf = (text: string) => ethers.sha256(ethers.toUtf8Bytes(`report:${text}`));

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
    id:                  b.id,
    creator:             b.creator,
    descriptionHash:     b.descriptionHash,
    reportHash:          b.reportHash,
    latE5:               b.latE5,
    lngE5:               b.lngE5,
    regionCell:          b.regionCell,
    totalPledged:        b.totalPledged,
    createdAt:           b.createdAt,
    validationDeadline:  b.validationDeadline,
    claimDeadline:       b.claimDeadline,
    workDeadline:        b.workDeadline,
    worker:              b.worker,
    visualChallengeCode: b.visualChallengeCode,
    arkivEntityKey:      b.arkivEntityKey,
    evidenceHash:        b.evidenceHash,
    selectionBlock:      b.selectionBlock,
    reviewRound:         b.reviewRound,
    reworkCount:         b.reworkCount,
    confirmations:       b.confirmations,
    disputes:            b.disputes,
    status:              Number(b.status),
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
  let extraRevs: SignerWithAddress[];   // signers 9..14, funded reviewers
  let neighbour1: SignerWithAddress;
  let neighbour2: SignerWithAddress;
  let neighbour3: SignerWithAddress;
  let worker2:   SignerWithAddress;
  let signerMap: Record<string, SignerWithAddress>;

  // ─── Scenario helpers (close over the per-test fixtures) ──────────────────

  const escrowAddr = () => escrow.getAddress();
  const getB = (id: bigint) => getBounty(escrow, id);
  const getR = (addr: string) => getReviewer(escrow, addr);

  /** Neighbour attestation vote. Role/bounty overridable to craft bad attestations. */
  async function voteProblem(
    id: bigint, voter: SignerWithAddress, isReal: boolean,
    opts: { role?: number; attestedBounty?: bigint } = {},
  ) {
    const nonce  = nextNonce(voter.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig = await signAttestation(
      attester, domain, voter.address, opts.role ?? Role.Neighbour,
      opts.attestedBounty ?? id, nonce, expiry,
    );
    return escrow.connect(voter).voteProblem(id, isReal, nonce, expiry, sig);
  }

  /** Reporter creates a bounty; it starts Proposed when validationQuorum > 0. */
  async function createProposed(
    opts: { amount?: bigint; cell?: number; claimIn?: bigint; text?: string } = {},
  ): Promise<bigint> {
    const id = await escrow.nextBountyId();
    const text = opts.text ?? `pothole on main street #${id}`;
    const claimDeadline = BigInt(await time.latest()) + (opts.claimIn ?? 7n * DAY);
    await escrow.connect(creator).createBounty(
      descHashOf(text), reportHashOf(text), 4001200, -7513000,
      opts.cell ?? 1, opts.amount ?? 1_000_000n, claimDeadline,
    );
    return id;
  }

  /** Two Neighbour attestations validate a Proposed bounty. */
  async function validate(id: bigint) {
    await voteProblem(id, neighbour1, true);
    await voteProblem(id, neighbour2, true);
  }

  /** createBounty + (when validationQuorum > 0) validation → status Open. */
  async function createOpenBounty(
    opts: { amount?: bigint; cell?: number; claimIn?: bigint; text?: string } = {},
  ): Promise<bigint> {
    const id = await createProposed(opts);
    if ((await escrow.validationQuorum()) > 0n) await validate(id);
    return id;
  }

  async function ensureReviewers(cell: number, revs: SignerWithAddress[]) {
    for (const r of revs) {
      if (!(await getR(r.address)).active) {
        await registerReviewer(escrow, attester, domain, r, cell);
      }
    }
  }

  /** submitEvidence → wait for the selection block → assignPanel. */
  async function submitAndAssign(id: bigint, w: SignerWithAddress = worker) {
    await escrow.connect(w).submitEvidence(id, KEY, EVH);
    const b = await getB(id);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(id);
    const nb = await getB(id);
    const round = Number(nb.reviewRound);
    const panel = [...(await escrow.getPanel(id, round))];
    return { round, panel };
  }

  /** Commit then reveal votes (null = abstain); stays inside the reveal window. */
  async function commitAndReveal(
    id: bigint, round: number, panel: string[], votes: (boolean | null)[],
  ) {
    const salts = panel.map((_, i) => ethers.keccak256(ethers.toUtf8Bytes(`salt-${id}-${round}-${i}`)));
    for (let i = 0; i < PANEL_SIZE; i++) {
      if (votes[i] === null) continue;
      await escrow.connect(signerMap[panel[i]]).commitVote(
        id, commitHash(id, round, votes[i]!, salts[i], panel[i]),
      );
    }
    await time.increase(COMMIT_WINDOW + 1);
    for (let i = 0; i < PANEL_SIZE; i++) {
      if (votes[i] === null) continue;
      await escrow.connect(signerMap[panel[i]]).revealVote(id, votes[i]!, salts[i]);
    }
  }

  /** Full review of a Claimed bounty: evidence → panel → votes → settle. */
  async function reviewAndSettle(id: bigint, votes: boolean[], w: SignerWithAddress = worker) {
    const { round, panel } = await submitAndAssign(id, w);
    await commitAndReveal(id, round, panel, votes);
    await escrow.connect(anyone).settle(id);
    return panel;
  }

  /** Sum of everything the escrow still owes: live pools, slashed pools, stakes and rewards. */
  async function obligations(ids: bigint[], addrs: string[]) {
    let sum = 0n;
    for (const id of ids) {
      const b = await getB(id);
      if (b.status !== Status.Approved) sum += b.totalPledged;
      sum += await escrow.slashedPool(id);
    }
    for (const a of addrs) {
      const r = await getR(a);
      sum += r.stakedAmount + r.rewardBalance;
    }
    return sum;
  }

  async function expectSolvent(ids: bigint[], addrs: string[]) {
    expect(await usdc.balanceOf(await escrowAddr())).to.equal(await obligations(ids, addrs));
  }

  const everyone = () => [
    reviewer1, reviewer2, reviewer3, ...extraRevs,
  ].map((s) => s.address);

  beforeEach(async function () {
    nonceCounter = {};

    const signers = await ethers.getSigners();
    [owner, attester, creator, worker, pledger,
     reviewer1, reviewer2, reviewer3, anyone] = signers;
    extraRevs  = signers.slice(9, 15);
    neighbour1 = signers[15];
    neighbour2 = signers[16];
    neighbour3 = signers[17];
    worker2    = signers[18];
    signerMap  = Object.fromEntries(signers.map((s) => [s.address, s]));

    // Deploy MockUSDC
    const USDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = await USDCFactory.deploy();
    await usdc.waitForDeployment();

    // Deploy Escrow (v2: 7 constructor args)
    const EscrowFactory = await ethers.getContractFactory("StreetSyncEscrow");
    escrow = await EscrowFactory.connect(owner).deploy(
      await usdc.getAddress(),
      attester.address,
      COMMIT_WINDOW,
      REVEAL_WINDOW,
      CLAIM_DURATION,
      VALIDATION_WINDOW,
      VALIDATION_QUORUM,
    );
    await escrow.waitForDeployment();

    // Build domain for EIP-712 signing
    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = buildDomain(await escrow.getAddress(), chainId);

    // Fund & approve
    const accounts = [creator, worker, pledger, reviewer1, reviewer2, reviewer3, anyone, owner, ...extraRevs];
    for (const acc of accounts) {
      await usdc.mint(acc.address, 100_000_000n); // 100 USDC
      await usdc.connect(acc).approve(await escrow.getAddress(), ethers.MaxUint256);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 1 – Full Happy Path
  // ═════════════════════════════════════════════════════════════════════════════

  it("Happy path: create → validate → pledge → claim → evidence → assign → commit/reveal → settle with exact 6-decimal balances", async function () {
    const cell = 42;

    // ── Register 3 reviewers ──────────────────────────────────────────────
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    // Verify escrow holds 3 stakes
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(REVIEWER_STAKE * 3n);

    // ── Create bounty (v2: starts Proposed, neighbours validate) ──────────
    const creatorBefore = await usdc.balanceOf(creator.address);
    const bountyId = await createProposed({ amount: INITIAL_PLEDGE, cell, text: "pothole on main street" });

    expect(await usdc.balanceOf(creator.address)).to.equal(creatorBefore - INITIAL_PLEDGE);

    let b = await getB(bountyId);
    expect(b.totalPledged).to.equal(INITIAL_PLEDGE);
    expect(b.status).to.equal(Status.Proposed); // v2: was Open before validation existed

    await validate(bountyId);
    b = await getB(bountyId);
    expect(b.status).to.equal(Status.Open);

    // ── Top-up pledge ─────────────────────────────────────────────────────
    const pledgerBefore = await usdc.balanceOf(pledger.address);
    await escrow.connect(pledger).pledge(bountyId, TOP_UP_PLEDGE);

    expect(await usdc.balanceOf(pledger.address)).to.equal(pledgerBefore - TOP_UP_PLEDGE);
    b = await getB(bountyId);
    expect(b.totalPledged).to.equal(TOTAL_POOL);

    // ── Claim ─────────────────────────────────────────────────────────────
    await claimBounty(escrow, attester, domain, worker, bountyId);

    b = await getB(bountyId);
    expect(b.worker).to.equal(worker.address);
    expect(b.status).to.equal(Status.Claimed);
    expect(b.visualChallengeCode).to.be.gte(1000);
    expect(b.visualChallengeCode).to.be.lte(9999);

    // ── Submit evidence ───────────────────────────────────────────────────
    await escrow.connect(worker).submitEvidence(bountyId, KEY, EVH);

    b = await getB(bountyId);
    expect(b.status).to.equal(Status.Submitted);
    const selBlock = b.selectionBlock;

    // ── Roll 2+ blocks then assignPanel ───────────────────────────────────
    // Mine enough blocks so block.number > selectionBlock
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    const blocksNeeded = Number(selBlock - currentBlock) + 1;
    await mine(blocksNeeded);

    await escrow.connect(anyone).assignPanel(bountyId);

    b = await getB(bountyId);
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
    const salts  = ["salt1", "salt2", "salt3"].map((s) => ethers.keccak256(ethers.toUtf8Bytes(s)));
    const panelSigners = panel.map((addr) => signerMap[addr]);
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

    b = await getB(bountyId);
    expect(b.status).to.equal(Status.Approved);

    // ── Verify exact 6-decimal USDC balances ──────────────────────────────
    // Worker gets 90% of 15 USDC = 13_500_000
    const expectedWorkerPayout = (TOTAL_POOL * 9000n) / BPS_DENOM;
    expect(expectedWorkerPayout).to.equal(13_500_000n);
    expect(await usdc.balanceOf(worker.address) - workerPre).to.equal(expectedWorkerPayout);

    // Minority reviewer (panel[2], voted false) is slashed
    const minorityRev = await getR(panel[2]);
    expect(minorityRev.stakedAmount).to.equal(0n);
    expect(minorityRev.active).to.equal(false);

    // Reviewer cut = 10% of 15 USDC = 1_500_000 + slashed 2_000_000 = 3_500_000
    // Split among 2 majority reviewers = 1_750_000 each
    const reviewerPoolTotal = (TOTAL_POOL * 1000n) / BPS_DENOM + REVIEWER_STAKE;
    const perMajority = reviewerPoolTotal / 2n;
    expect(perMajority).to.equal(1_750_000n);

    const maj0 = await getR(panel[0]);
    const maj1 = await getR(panel[1]);
    expect(maj0.rewardBalance).to.equal(perMajority);
    expect(maj1.rewardBalance).to.equal(perMajority);

    // Withdraw rewards
    const bal0Pre = await usdc.balanceOf(panel[0]);
    await escrow.connect(panelSigners[0]).withdrawReward();
    expect(await usdc.balanceOf(panel[0]) - bal0Pre).to.equal(perMajority);

    // Escrow only keeps panel[1]'s unwithdrawn reward (all stakes were returned or paid out)
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(perMajority);
    await expectSolvent([bountyId], expectedRevs);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 2 – Wash-Trading: creator cannot claim
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: creator cannot claim their own bounty", async function () {
    const id = await createOpenBounty();

    const nonce  = nextNonce(creator.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig    = await signAttestation(attester, domain, creator.address, Role.Worker, id, nonce, expiry);

    await expect(
      escrow.connect(creator).claim(id, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "CreatorCannotClaim");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 3 – Wash-Trading: pledger cannot claim
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: pledger cannot claim a bounty they funded", async function () {
    const id = await createOpenBounty();
    await escrow.connect(pledger).pledge(id, 1_000_000n);

    const nonce  = nextNonce(pledger.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    const sig    = await signAttestation(attester, domain, pledger.address, Role.Worker, id, nonce, expiry);

    await expect(
      escrow.connect(pledger).claim(id, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "PledgerCannotClaim");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 4 – Wash-Trading: creator/worker/pledger excluded from panel
  // ═════════════════════════════════════════════════════════════════════════════

  it("Panel excludes creator, worker, and pledger from review", async function () {
    const cell = 7;

    // Register 4 reviewers (need extras since creator must not be selected)
    const extraRev = extraRevs[0];

    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);
    await registerReviewer(escrow, attester, domain, extraRev, cell);

    const id = await createOpenBounty({ cell });
    await claimBounty(escrow, attester, domain, worker, id);
    await escrow.connect(worker).submitEvidence(id, KEY, EVH);

    const b = await getB(id);
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    await mine(Number(b.selectionBlock - currentBlock) + 1);

    await escrow.connect(anyone).assignPanel(id);

    const panel = await escrow.getPanel(id, (await getB(id)).reviewRound);
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

    const id = await createOpenBounty({ cell, text: "stale selection" });
    await claimBounty(escrow, attester, domain, worker, id);
    await escrow.connect(worker).submitEvidence(id, KEY, EVH);

    const selectionBlock = (await getB(id)).selectionBlock;
    const currentBlock = BigInt(await ethers.provider.getBlockNumber());
    await mine(Number(selectionBlock + 251n - currentBlock));
    const resetTx = await escrow.connect(anyone).assignPanel(id);
    const resetReceipt = await resetTx.wait();
    const updated = await getB(id);
    expect(updated.status).to.equal(Status.Submitted);
    expect(updated.selectionBlock).to.equal(BigInt(resetReceipt!.blockNumber + 2));

    await mine(3);
    await escrow.connect(anyone).assignPanel(id);
    expect((await getB(id)).status).to.equal(Status.InReview);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 5 – pokeOrReplace when 2 reviewers fail to reveal
  // ═════════════════════════════════════════════════════════════════════════════

  it("pokeOrReplace slashes non-revealers and selects replacement panel", async function () {
    const cell = 55;

    // Register 6 reviewers so we have enough for replacement
    for (const s of extraRevs) await registerReviewer(escrow, attester, domain, s, cell);

    // Create & claim bounty
    const id = await createOpenBounty({ cell, amount: 5_000_000n, text: "pothole" });
    await claimBounty(escrow, attester, domain, worker, id);
    const { round, panel } = await submitAndAssign(id);

    // Only panel[0] commits + reveals; panel[1] and panel[2] do nothing
    const salt = ethers.keccak256(ethers.toUtf8Bytes("salt-p0"));
    const hash = commitHash(id, round, true, salt, panel[0]);
    await escrow.connect(signerMap[panel[0]]).commitVote(id, hash);

    // Advance past commit window
    await time.increase(COMMIT_WINDOW + 1);
    await escrow.connect(signerMap[panel[0]]).revealVote(id, true, salt);

    // Advance past reveal window
    await time.increase(REVEAL_WINDOW + 1);

    // Verify panel[1] and panel[2] still have stake
    expect((await getR(panel[1])).stakedAmount).to.equal(REVIEWER_STAKE);
    expect((await getR(panel[2])).stakedAmount).to.equal(REVIEWER_STAKE);

    // pokeOrReplace
    await expect(escrow.connect(anyone).pokeOrReplace(id))
      .to.emit(escrow, "PokeOrReplace");

    // Non-revealers slashed
    expect((await getR(panel[1])).stakedAmount).to.equal(0n);
    expect((await getR(panel[1])).active).to.equal(false);
    expect((await getR(panel[2])).stakedAmount).to.equal(0n);
    expect((await getR(panel[2])).active).to.equal(false);

    // Status reverted to Submitted; reviewRound incremented
    let b = await getB(id);
    expect(b.status).to.equal(Status.Submitted);
    expect(b.reviewRound).to.equal(round + 1);

    // Re-assign panel
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
    await escrow.connect(anyone).assignPanel(id);

    b = await getB(id);
    expect(b.status).to.equal(Status.InReview);

    // New panel should not include the slashed reviewers
    const newPanel = await escrow.getPanel(id, b.reviewRound);
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
    const id = await createOpenBounty({ text: "x" });

    const nonce  = nextNonce(worker.address);
    const expiry = BigInt(await time.latest()) - 1n; // already expired
    const sig    = await signAttestation(attester, domain, worker.address, Role.Worker, id, nonce, expiry);

    await expect(
      escrow.connect(worker).claim(id, nonce, expiry, sig),
    ).to.be.revertedWithCustomError(escrow, "AttestationExpired");
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 8 – Wrong signer revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: attestation signed by wrong key", async function () {
    const id = await createOpenBounty({ text: "x" });

    const nonce  = nextNonce(worker.address);
    const expiry = BigInt(await time.latest()) + 3600n;
    // Sign with 'anyone' instead of 'attester'
    const sig = await signAttestation(anyone, domain, worker.address, Role.Worker, id, nonce, expiry);

    await expect(
      escrow.connect(worker).claim(id, nonce, expiry, sig),
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
    const id = await createOpenBounty({ cell, amount: pool, text: "balance-test" });

    await claimBounty(escrow, attester, domain, worker, id);
    const { round, panel } = await submitAndAssign(id);

    const salts = ["s1", "s2", "s3"].map((s) => ethers.keccak256(ethers.toUtf8Bytes(s)));

    // All 3 approve
    for (let i = 0; i < PANEL_SIZE; i++) {
      const vh = commitHash(id, round, true, salts[i], panel[i]);
      await escrow.connect(signerMap[panel[i]]).commitVote(id, vh);
    }

    await time.increase(COMMIT_WINDOW + 1);

    const balsBefore = await Promise.all(panel.map((a) => usdc.balanceOf(a)));
    const workerBefore = await usdc.balanceOf(worker.address);

    for (let i = 0; i < PANEL_SIZE; i++) {
      await escrow.connect(signerMap[panel[i]]).revealVote(id, true, salts[i]);
    }

    // All 3 revealed → early settle (no deadline wait needed)
    await escrow.connect(anyone).settle(id);

    // Worker: 90% of 20 USDC = 18_000_000
    const workerPayout = (pool * 9000n) / BPS_DENOM;
    expect(workerPayout).to.equal(18_000_000n);
    expect(await usdc.balanceOf(worker.address) - workerBefore).to.equal(workerPayout);

    // No minority → reviewerPool = 10% of 20 USDC = 2_000_000
    // perReviewer = 2_000_000 / 3 = 666_666
    const reviewerCut = pool - workerPayout; // 2_000_000
    const perReviewer = reviewerCut / 3n;    // 666_666
    expect(perReviewer).to.equal(666_666n);

    for (let i = 0; i < PANEL_SIZE; i++) {
      // Stake returned directly during settle
      const stakeReturned = (await usdc.balanceOf(panel[i])) - balsBefore[i];
      expect(stakeReturned).to.equal(REVIEWER_STAKE);

      // Reward credited (pull-based)
      const rev = await getR(panel[i]);
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
    // v2: claimDeadline must exceed the 24 h validation window, so use 2 days instead of 1 hour.
    const id = await createOpenBounty({ claimIn: 2n * DAY, amount: 3_000_000n, text: "expired" });
    await escrow.connect(pledger).pledge(id, 2_000_000n);

    // Before expiry → revert
    await expect(
      escrow.connect(creator).withdrawPledge(id),
    ).to.be.revertedWithCustomError(escrow, "ClaimDeadlineNotPassed");

    // Warp past deadline
    await time.increase(2 * 86_400 + 1);

    const creatorBefore = await usdc.balanceOf(creator.address);
    await escrow.connect(creator).withdrawPledge(id);
    expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(3_000_000n);

    const pledgerBefore = await usdc.balanceOf(pledger.address);
    await escrow.connect(pledger).withdrawPledge(id);
    expect(await usdc.balanceOf(pledger.address) - pledgerBefore).to.equal(2_000_000n);

    expect((await getB(id)).status).to.equal(Status.Refunded);
    await expectSolvent([id], []);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  TEST 11 – CommitWindowClosed revert
  // ═════════════════════════════════════════════════════════════════════════════

  it("Revert: commitVote after commit window closes", async function () {
    const cell = 33;
    await registerReviewer(escrow, attester, domain, reviewer1, cell);
    await registerReviewer(escrow, attester, domain, reviewer2, cell);
    await registerReviewer(escrow, attester, domain, reviewer3, cell);

    const id = await createOpenBounty({ cell, text: "x" });
    await claimBounty(escrow, attester, domain, worker, id);
    const { round, panel } = await submitAndAssign(id);

    // Warp past commit window
    await time.increase(COMMIT_WINDOW + 1);

    const vh = commitHash(id, round, true, ethers.keccak256(ethers.toUtf8Bytes("s")), panel[0]);
    await expect(
      escrow.connect(signerMap[panel[0]]).commitVote(id, vh),
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

    const id = await createOpenBounty({ cell, text: "x" });
    await claimBounty(escrow, attester, domain, worker, id);
    const { round, panel } = await submitAndAssign(id);

    const correctSalt = ethers.keccak256(ethers.toUtf8Bytes("correct"));
    const wrongSalt   = ethers.keccak256(ethers.toUtf8Bytes("wrong"));

    // Commit with correct salt
    const vh = commitHash(id, round, true, correctSalt, panel[0]);
    await escrow.connect(signerMap[panel[0]]).commitVote(id, vh);

    await time.increase(COMMIT_WINDOW + 1);

    // Reveal with wrong salt
    await expect(
      escrow.connect(signerMap[panel[0]]).revealVote(id, true, wrongSalt),
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

    const id = await createOpenBounty({ cell, text: "x" });
    await claimBounty(escrow, attester, domain, worker, id);
    await escrow.connect(worker).submitEvidence(id, KEY, EVH);

    const b = await getB(id);
    await mine(Number(b.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);

    await expect(
      escrow.connect(anyone).assignPanel(id),
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

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – constructor / owner config
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 configuration", function () {
    it("stores the validation parameters and rejects quorum > 10", async function () {
      expect(await escrow.validationWindow()).to.equal(VALIDATION_WINDOW);
      expect(await escrow.validationQuorum()).to.equal(VALIDATION_QUORUM);

      const Factory = await ethers.getContractFactory("StreetSyncEscrow");
      await expect(
        Factory.deploy(await usdc.getAddress(), attester.address, 300, 300, 3600, 86400, 11),
      ).to.be.revertedWithCustomError(Factory, "InvalidQuorum");

      await expect(escrow.connect(owner).setValidationQuorum(11))
        .to.be.revertedWithCustomError(escrow, "InvalidQuorum");
      await expect(escrow.connect(owner).setValidationQuorum(3))
        .to.emit(escrow, "ValidationQuorumSet").withArgs(3);
      await expect(escrow.connect(owner).setValidationWindow(7200))
        .to.emit(escrow, "ValidationWindowSet").withArgs(7200);
      await expect(escrow.connect(anyone).setValidationWindow(1))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – createBounty
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 createBounty", function () {
    it("starts Proposed with validationDeadline = createdAt + validationWindow", async function () {
      const text = "broken streetlight";
      const claimDeadline = BigInt(await time.latest()) + 7n * DAY;
      await expect(
        escrow.connect(creator).createBounty(
          descHashOf(text), reportHashOf(text), 4001200, -7513000, 5, 2_000_000n, claimDeadline,
        ),
      ).to.emit(escrow, "BountyCreated");

      const b = await getB(0n);
      expect(b.status).to.equal(Status.Proposed);
      expect(b.validationDeadline).to.equal(b.createdAt + BigInt(VALIDATION_WINDOW));
      expect(b.claimDeadline).to.equal(claimDeadline);
      expect(b.descriptionHash).to.equal(descHashOf(text));
      expect(b.reportHash).to.equal(reportHashOf(text));
      expect(b.confirmations).to.equal(0);
      expect(b.disputes).to.equal(0);
      expect(await escrow.pledges(0n, creator.address)).to.equal(2_000_000n);
      expect(await escrow.getPledgers(0n)).to.deep.equal([creator.address]);
    });

    it("starts Open (validationDeadline = createdAt) when validationQuorum is 0", async function () {
      await escrow.connect(owner).setValidationQuorum(0);
      const id = await createOpenBounty();
      const b = await getB(id);
      expect(b.status).to.equal(Status.Open);
      expect(b.validationDeadline).to.equal(b.createdAt);

      // Claimable straight away
      await claimBounty(escrow, attester, domain, worker, id);
      expect((await getB(id)).status).to.equal(Status.Claimed);
    });

    it("Revert: zero reportHash or zero descHash → InvalidReport", async function () {
      const claimDeadline = BigInt(await time.latest()) + 7n * DAY;
      await expect(
        escrow.connect(creator).createBounty(
          descHashOf("x"), ethers.ZeroHash, 0, 0, 1, 1_000_000n, claimDeadline,
        ),
      ).to.be.revertedWithCustomError(escrow, "InvalidReport");
      await expect(
        escrow.connect(creator).createBounty(
          ethers.ZeroHash, reportHashOf("x"), 0, 0, 1, 1_000_000n, claimDeadline,
        ),
      ).to.be.revertedWithCustomError(escrow, "InvalidReport");
    });

    it("Revert: claimDeadline <= validationDeadline → InvalidDeadline", async function () {
      const now = BigInt(await time.latest());
      // Validation ends later than this deadline.
      await expect(
        escrow.connect(creator).createBounty(
          descHashOf("x"), reportHashOf("x"), 0, 0, 1, 1_000_000n, now + BigInt(VALIDATION_WINDOW),
        ),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");

      // Exactly equal to validationDeadline is also rejected.
      const t = now + 100n;
      await time.setNextBlockTimestamp(t);
      await expect(
        escrow.connect(creator).createBounty(
          descHashOf("x"), reportHashOf("x"), 0, 0, 1, 1_000_000n, t + BigInt(VALIDATION_WINDOW),
        ),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");

      // With validation disabled the deadline must still be in the future.
      await escrow.connect(owner).setValidationQuorum(0);
      await expect(
        escrow.connect(creator).createBounty(
          descHashOf("x"), reportHashOf("x"), 0, 0, 1, 1_000_000n, now,
        ),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – voteProblem
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 voteProblem", function () {
    it("validates at quorum: ProblemValidated, status Open", async function () {
      const id = await createProposed();

      await expect(voteProblem(id, neighbour1, true))
        .to.emit(escrow, "ProblemVoteCast").withArgs(id, neighbour1.address, true, 1, 0);
      let b = await getB(id);
      expect(b.status).to.equal(Status.Proposed);
      expect(b.confirmations).to.equal(1);
      expect(await escrow.problemVote(id, neighbour1.address)).to.equal(Vote.Real);

      await expect(voteProblem(id, neighbour2, true))
        .to.emit(escrow, "ProblemValidated").withArgs(id);
      b = await getB(id);
      expect(b.status).to.equal(Status.Open);
      expect(b.confirmations).to.equal(2);

      // Voting is closed once the bounty is Open
      await expect(voteProblem(id, neighbour3, true))
        .to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("dismisses at quorum disputes: Refunded and pledgers can withdraw", async function () {
      const id = await createProposed({ amount: 4_000_000n });
      await escrow.connect(pledger).pledge(id, 1_000_000n); // pledge while Proposed

      await voteProblem(id, neighbour1, false);
      expect(await escrow.problemVote(id, neighbour1.address)).to.equal(Vote.Fake);
      await expect(voteProblem(id, neighbour2, false))
        .to.emit(escrow, "ProblemDismissed").withArgs(id);

      const b = await getB(id);
      expect(b.status).to.equal(Status.Refunded);
      expect(b.disputes).to.equal(2);

      // Dismissed bounties accept no more pledges
      await expect(escrow.connect(anyone).pledge(id, 1_000_000n))
        .to.be.revertedWithCustomError(escrow, "WrongStatus");

      const creatorBefore = await usdc.balanceOf(creator.address);
      const pledgerBefore = await usdc.balanceOf(pledger.address);
      await escrow.connect(creator).withdrawPledge(id);
      await escrow.connect(pledger).withdrawPledge(id);
      expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(4_000_000n);
      expect(await usdc.balanceOf(pledger.address) - pledgerBefore).to.equal(1_000_000n);
      expect(await usdc.balanceOf(await escrowAddr())).to.equal(0n);
    });

    it("a split vote below quorum on both sides leaves the bounty Proposed", async function () {
      const id = await createProposed();
      await voteProblem(id, neighbour1, true);
      await voteProblem(id, neighbour2, false);
      const b = await getB(id);
      expect(b.status).to.equal(Status.Proposed);
      expect(b.confirmations).to.equal(1);
      expect(b.disputes).to.equal(1);
      await expect(voteProblem(id, neighbour3, false)).to.emit(escrow, "ProblemDismissed");
    });

    it("Revert: creator cannot vote → CreatorCannotVote", async function () {
      const id = await createProposed();
      await expect(voteProblem(id, creator, true))
        .to.be.revertedWithCustomError(escrow, "CreatorCannotVote");
    });

    it("Revert: second vote from the same wallet → AlreadyVoted", async function () {
      const id = await createProposed();
      await voteProblem(id, neighbour1, true);
      await expect(voteProblem(id, neighbour1, false))
        .to.be.revertedWithCustomError(escrow, "AlreadyVoted");
    });

    it("Revert: vote after validationDeadline → ValidationClosed", async function () {
      const id = await createProposed();
      await time.increase(VALIDATION_WINDOW + 1);
      await expect(voteProblem(id, neighbour1, true))
        .to.be.revertedWithCustomError(escrow, "ValidationClosed");
    });

    it("Revert: attestation of the wrong role or for another bounty → InvalidAttestation", async function () {
      const id = await createProposed();
      const other = await createProposed({ text: "second report" });

      // Worker-role signature used for a neighbour vote
      await expect(voteProblem(id, neighbour1, true, { role: Role.Worker }))
        .to.be.revertedWithCustomError(escrow, "InvalidAttestation");
      // Neighbour attestation bound to a different bounty
      await expect(voteProblem(id, neighbour1, true, { attestedBounty: other }))
        .to.be.revertedWithCustomError(escrow, "InvalidAttestation");
    });

    it("Revert: a neighbour who voted cannot claim → VoterCannotClaim", async function () {
      const id = await createOpenBounty();
      expect(await escrow.problemVote(id, neighbour1.address)).to.equal(Vote.Real);

      const nonce  = nextNonce(neighbour1.address);
      const expiry = BigInt(await time.latest()) + 3600n;
      const sig    = await signAttestation(attester, domain, neighbour1.address, Role.Worker, id, nonce, expiry);
      await expect(escrow.connect(neighbour1).claim(id, nonce, expiry, sig))
        .to.be.revertedWithCustomError(escrow, "VoterCannotClaim");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – finalizeValidation / withdrawPledge on Proposed
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 finalizeValidation", function () {
    it("Revert: finalizeValidation before the deadline → ValidationOpen", async function () {
      const id = await createProposed();
      await expect(escrow.connect(anyone).finalizeValidation(id))
        .to.be.revertedWithCustomError(escrow, "ValidationOpen");
    });

    it("after the deadline: Refunded, pledgers withdraw, cannot be finalized twice", async function () {
      const id = await createProposed({ amount: 3_000_000n });
      await escrow.connect(pledger).pledge(id, 2_000_000n);
      await voteProblem(id, neighbour1, true); // 1 of 2: not enough

      await time.increase(VALIDATION_WINDOW + 1);
      await expect(escrow.connect(anyone).finalizeValidation(id))
        .to.emit(escrow, "ProblemDismissed").withArgs(id);
      expect((await getB(id)).status).to.equal(Status.Refunded);

      await expect(escrow.connect(anyone).finalizeValidation(id))
        .to.be.revertedWithCustomError(escrow, "WrongStatus");

      const creatorBefore = await usdc.balanceOf(creator.address);
      const pledgerBefore = await usdc.balanceOf(pledger.address);
      await escrow.connect(creator).withdrawPledge(id);
      await escrow.connect(pledger).withdrawPledge(id);
      expect(await usdc.balanceOf(creator.address) - creatorBefore).to.equal(3_000_000n);
      expect(await usdc.balanceOf(pledger.address) - pledgerBefore).to.equal(2_000_000n);
      expect(await usdc.balanceOf(await escrowAddr())).to.equal(0n);
    });

    it("withdrawPledge: PledgeLocked while Proposed, auto-dismisses once past validationDeadline", async function () {
      const id = await createProposed({ amount: 3_000_000n });

      await expect(escrow.connect(creator).withdrawPledge(id))
        .to.be.revertedWithCustomError(escrow, "PledgeLocked");

      await time.increase(VALIDATION_WINDOW + 1);
      const before = await usdc.balanceOf(creator.address);
      await expect(escrow.connect(creator).withdrawPledge(id))
        .to.emit(escrow, "ProblemDismissed").withArgs(id);
      expect((await getB(id)).status).to.equal(Status.Refunded);
      expect(await usdc.balanceOf(creator.address) - before).to.equal(3_000_000n);

      await expect(escrow.connect(creator).withdrawPledge(id))
        .to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      await expect(escrow.connect(pledger).withdrawPledge(id))
        .to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – pledge
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 pledge", function () {
    it("is allowed while Proposed and rejected once the validation window closes", async function () {
      const id = await createProposed({ amount: 1_000_000n });
      await expect(escrow.connect(pledger).pledge(id, 2_000_000n))
        .to.emit(escrow, "Pledged").withArgs(id, pledger.address, 2_000_000n, 3_000_000n);
      expect(await escrow.pledges(id, pledger.address)).to.equal(2_000_000n);
      expect((await getB(id)).status).to.equal(Status.Proposed);

      await time.increase(VALIDATION_WINDOW + 1);
      await expect(escrow.connect(pledger).pledge(id, 1_000_000n))
        .to.be.revertedWithCustomError(escrow, "ValidationClosed");
    });

    it("Revert: pledge after claimDeadline → ClaimExpired (as does claim)", async function () {
      const id = await createOpenBounty({ claimIn: 2n * DAY });
      await time.increase(2 * 86_400 + 1);

      await expect(escrow.connect(pledger).pledge(id, 1_000_000n))
        .to.be.revertedWithCustomError(escrow, "ClaimExpired");
      await expect(claimBounty(escrow, attester, domain, worker, id))
        .to.be.revertedWithCustomError(escrow, "ClaimExpired");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – claim / submitEvidence
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 claim", function () {
    it("keeps claimDeadline and sets workDeadline = now + claimDuration", async function () {
      const id = await createOpenBounty();
      const before = await getB(id);

      const tx = await (async () => {
        const nonce  = nextNonce(worker.address);
        const expiry = BigInt(await time.latest()) + 3600n;
        const sig = await signAttestation(attester, domain, worker.address, Role.Worker, id, nonce, expiry);
        return escrow.connect(worker).claim(id, nonce, expiry, sig);
      })();
      const rc = await tx.wait();
      const ts = BigInt((await ethers.provider.getBlock(rc!.blockNumber))!.timestamp);

      const after = await getB(id);
      expect(after.claimDeadline).to.equal(before.claimDeadline);
      expect(after.workDeadline).to.equal(ts + BigInt(CLAIM_DURATION));
      await expect(tx).to.emit(escrow, "BountyClaimed")
        .withArgs(id, worker.address, anyValue, ts + BigInt(CLAIM_DURATION));
    });

    it("Revert: submitEvidence with zero key or zero hash → InvalidEvidence", async function () {
      const id = await createOpenBounty();
      await claimBounty(escrow, attester, domain, worker, id);

      await expect(escrow.connect(worker).submitEvidence(id, ethers.ZeroHash, EVH))
        .to.be.revertedWithCustomError(escrow, "InvalidEvidence");
      await expect(escrow.connect(worker).submitEvidence(id, KEY, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "InvalidEvidence");
      // A valid submission still works afterwards.
      await escrow.connect(worker).submitEvidence(id, KEY, EVH);
      expect((await getB(id)).status).to.equal(Status.Submitted);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – releaseClaim
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 releaseClaim", function () {
    it("Claimed past workDeadline reopens, blocks the worker; another worker can claim", async function () {
      const id = await createOpenBounty();
      await claimBounty(escrow, attester, domain, worker, id);
      const claimed = await getB(id);

      await expect(escrow.connect(anyone).releaseClaim(id))
        .to.be.revertedWithCustomError(escrow, "NotReleasable");

      await time.increase(CLAIM_DURATION + 1);
      await expect(escrow.connect(anyone).releaseClaim(id))
        .to.emit(escrow, "ClaimReleased").withArgs(id, worker.address, true);

      const b = await getB(id);
      expect(b.status).to.equal(Status.Open);
      expect(b.worker).to.equal(ethers.ZeroAddress);
      expect(b.workDeadline).to.equal(0);
      expect(b.visualChallengeCode).to.equal(0);
      expect(b.reviewRound).to.equal(claimed.reviewRound + 1n);
      expect(await escrow.blockedWorker(id, worker.address)).to.equal(true);

      await expect(claimBounty(escrow, attester, domain, worker, id))
        .to.be.revertedWithCustomError(escrow, "WorkerBlocked");

      await claimBounty(escrow, attester, domain, worker2, id);
      const reclaimed = await getB(id);
      expect(reclaimed.status).to.equal(Status.Claimed);
      expect(reclaimed.worker).to.equal(worker2.address);
    });

    it("Revert: releaseClaim on an Open bounty → NotReleasable", async function () {
      const id = await createOpenBounty();
      await expect(escrow.connect(anyone).releaseClaim(id))
        .to.be.revertedWithCustomError(escrow, "NotReleasable");
    });

    describe("after a rejection", function () {
      const cell = 21;
      let id: bigint;

      beforeEach(async function () {
        await ensureReviewers(cell, [reviewer1, reviewer2, reviewer3]);
        id = await createOpenBounty({ cell, amount: 12_000_000n });
        await claimBounty(escrow, attester, domain, worker, id);
        await reviewAndSettle(id, [false, false, false]);
      });

      it("opens a rework window that releaseClaim cannot cut short, then reopens past it", async function () {
        const b = await getB(id);
        expect(b.status).to.equal(Status.Rejected);
        expect(b.reworkCount).to.equal(0);
        expect(b.workDeadline).to.be.gt(BigInt(await time.latest()));

        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.be.revertedWithCustomError(escrow, "NotReleasable");

        await time.increase(CLAIM_DURATION + 1);
        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.emit(escrow, "ClaimReleased").withArgs(id, worker.address, true);

        expect((await getB(id)).status).to.equal(Status.Open);
        expect(await escrow.blockedWorker(id, worker.address)).to.equal(true);
      });

      it("Revert: rework after the rework window → ReworkWindowClosed", async function () {
        await time.increase(CLAIM_DURATION + 1);
        await expect(escrow.connect(worker).rework(id))
          .to.be.revertedWithCustomError(escrow, "ReworkWindowClosed");
      });

      it("rework inside the window moves back to Claimed with a fresh workDeadline", async function () {
        await expect(escrow.connect(worker).rework(id)).to.emit(escrow, "BountyReworked");
        const b = await getB(id);
        expect(b.status).to.equal(Status.Claimed);
        expect(b.reworkCount).to.equal(1);
        expect(b.workDeadline).to.be.gt(BigInt(await time.latest()));
      });
    });

    describe("Submitted with no reviewable panel", function () {
      it("reopens after workDeadline + REVIEW_TIMEOUT when < 3 eligible reviewers; worker not blocked", async function () {
        const cell = 22;
        await ensureReviewers(cell, [reviewer1, reviewer2]);
        const id = await createOpenBounty({ cell });
        await claimBounty(escrow, attester, domain, worker, id);
        await escrow.connect(worker).submitEvidence(id, KEY, EVH);
        expect(await escrow.eligibleReviewerCount(id)).to.equal(2);

        // Before workDeadline + REVIEW_TIMEOUT
        await time.increase(CLAIM_DURATION + 1);
        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.be.revertedWithCustomError(escrow, "NotReleasable");

        await time.increase(REVIEW_TIMEOUT + 1);
        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.emit(escrow, "ClaimReleased").withArgs(id, worker.address, false);

        const b = await getB(id);
        expect(b.status).to.equal(Status.Open);
        expect(b.worker).to.equal(ethers.ZeroAddress);
        expect(b.evidenceHash).to.equal(ethers.ZeroHash);
        expect(b.arkivEntityKey).to.equal(ethers.ZeroHash);
        expect(await escrow.blockedWorker(id, worker.address)).to.equal(false);

        // The same worker may claim again (not blocked)
        await claimBounty(escrow, attester, domain, worker, id);
        expect((await getB(id)).status).to.equal(Status.Claimed);
      });

      it("Revert: NotReleasable after the timeout when ≥ 3 eligible reviewers exist", async function () {
        const cell = 23;
        await ensureReviewers(cell, [reviewer1, reviewer2, reviewer3]);
        const id = await createOpenBounty({ cell });
        await claimBounty(escrow, attester, domain, worker, id);
        await escrow.connect(worker).submitEvidence(id, KEY, EVH);
        expect(await escrow.eligibleReviewerCount(id)).to.equal(3);

        await time.increase(CLAIM_DURATION + REVIEW_TIMEOUT + 1);
        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.be.revertedWithCustomError(escrow, "NotReleasable");

        // assignPanel can still proceed, after which releaseClaim stays blocked (InReview)
        await mine(3);
        await escrow.connect(anyone).assignPanel(id);
        expect((await getB(id)).status).to.equal(Status.InReview);
        await expect(escrow.connect(anyone).releaseClaim(id))
          .to.be.revertedWithCustomError(escrow, "NotReleasable");
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – rejection after rework reopens the bounty
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 rejection after rework", function () {
    it("reopens (Open, worker blocked) instead of Refunded; new worker can finish and get paid", async function () {
      const cell = 24;
      const pool = 12_000_000n;
      const revs = [reviewer1, reviewer2, reviewer3];
      await ensureReviewers(cell, revs);
      const id = await createOpenBounty({ cell, amount: pool });
      await claimBounty(escrow, attester, domain, worker, id);

      // First rejection → rework window
      await reviewAndSettle(id, [false, false, false]);
      expect((await getB(id)).status).to.equal(Status.Rejected);
      await escrow.connect(worker).rework(id);

      // Settled reviewers were deactivated and must re-register.
      for (const r of revs) expect((await getR(r.address)).active).to.equal(false);
      await ensureReviewers(cell, revs);

      // Second rejection → no rework left → reopens
      const second = await submitAndAssign(id);
      await commitAndReveal(id, second.round, second.panel, [false, false, false]);
      await expect(escrow.connect(anyone).settle(id))
        .to.emit(escrow, "ClaimReleased").withArgs(id, worker.address, true);

      const b = await getB(id);
      expect(b.status).to.equal(Status.Open);       // NOT Refunded
      expect(b.worker).to.equal(ethers.ZeroAddress);
      expect(b.reworkCount).to.equal(0);
      expect(b.totalPledged).to.equal(pool);
      expect(await escrow.blockedWorker(id, worker.address)).to.equal(true);

      // Funds remain locked in escrow: pledgers cannot pull them while Open and unexpired
      await expect(escrow.connect(creator).withdrawPledge(id))
        .to.be.revertedWithCustomError(escrow, "ClaimDeadlineNotPassed");

      await expect(claimBounty(escrow, attester, domain, worker, id))
        .to.be.revertedWithCustomError(escrow, "WorkerBlocked");

      // A different worker takes over and is paid on approval
      await claimBounty(escrow, attester, domain, worker2, id);
      await ensureReviewers(cell, revs);
      const w2Before = await usdc.balanceOf(worker2.address);
      await reviewAndSettle(id, [true, true, true], worker2);

      expect((await getB(id)).status).to.equal(Status.Approved);
      expect(await usdc.balanceOf(worker2.address) - w2Before).to.equal(10_800_000n);
      // 10% of 12 USDC = 1_200_000, split 3 ways = 400_000 each
      for (const r of revs) expect((await getR(r.address)).rewardBalance).to.equal(400_000n);
      await expectSolvent([id], revs.map((r) => r.address));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – reviewer stake lifecycle
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 reviewer stake", function () {
    it("settle deactivates majority reviewers and returns stake; re-register keeps rewards", async function () {
      const cell = 25;
      const revs = [reviewer1, reviewer2, reviewer3];
      await ensureReviewers(cell, revs);
      const id = await createOpenBounty({ cell, amount: INITIAL_PLEDGE });
      await claimBounty(escrow, attester, domain, worker, id);

      const balsBefore: Record<string, bigint> = {};
      for (const r of revs) balsBefore[r.address] = await usdc.balanceOf(r.address);

      const panel = await reviewAndSettle(id, [true, true, false]);
      const [maj0, maj1, min] = panel;

      // Majority: stake returned to wallet, inactive; minority: slashed, inactive
      for (const m of [maj0, maj1]) {
        const r = await getR(m);
        expect(r.active).to.equal(false);
        expect(r.stakedAmount).to.equal(0n);
        expect(await usdc.balanceOf(m)).to.equal(balsBefore[m] + REVIEWER_STAKE);
      }
      const slashed = await getR(min);
      expect(slashed.active).to.equal(false);
      expect(slashed.stakedAmount).to.equal(0n);
      expect(await usdc.balanceOf(min)).to.equal(balsBefore[min]);

      // 10% of 10 USDC = 1_000_000 + 2_000_000 slashed = 3_000_000 → 1_500_000 each
      const credited = 1_500_000n;
      expect((await getR(maj0)).rewardBalance).to.equal(credited);
      expect((await getR(maj1)).rewardBalance).to.equal(credited);
      await expectSolvent([id], revs.map((r) => r.address));

      // Re-register: unclaimed reward survives, no duplicate pool entries
      const poolBefore = await escrow.poolSize(cell);
      const totalBefore = await escrow.totalReviewers();
      await registerReviewer(escrow, attester, domain, signerMap[maj0], cell);
      const again = await getR(maj0);
      expect(again.active).to.equal(true);
      expect(again.stakedAmount).to.equal(REVIEWER_STAKE);
      expect(again.rewardBalance).to.equal(credited);
      expect(await escrow.poolSize(cell)).to.equal(poolBefore);
      expect(await escrow.totalReviewers()).to.equal(totalBefore);
      await expectSolvent([id], revs.map((r) => r.address));

      // Withdraw pays exactly the credited amount and leaves the stake untouched
      const pre = await usdc.balanceOf(maj0);
      await expect(escrow.connect(signerMap[maj0]).withdrawReward())
        .to.emit(escrow, "RewardWithdrawn").withArgs(maj0, credited);
      expect(await usdc.balanceOf(maj0) - pre).to.equal(credited);
      expect((await getR(maj0)).rewardBalance).to.equal(0n);
      expect((await getR(maj0)).stakedAmount).to.equal(REVIEWER_STAKE);
      await expect(escrow.connect(signerMap[maj0]).withdrawReward())
        .to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
      await expectSolvent([id], revs.map((r) => r.address));
    });

    it("Revert: registering while already active → AlreadyRegistered", async function () {
      await registerReviewer(escrow, attester, domain, reviewer1, 3);
      await expect(registerReviewer(escrow, attester, domain, reviewer1, 3))
        .to.be.revertedWithCustomError(escrow, "AlreadyRegistered");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – panel fallback across regions
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 panel fallback", function () {
    it("draws reviewers from other regionCells when the bounty's region has < 3", async function () {
      const bountyCell = 31;
      const otherCell  = 32;
      await ensureReviewers(otherCell, [reviewer1, reviewer2, reviewer3]);
      expect(await escrow.poolSize(bountyCell)).to.equal(0);

      const id = await createOpenBounty({ cell: bountyCell });
      await claimBounty(escrow, attester, domain, worker, id);
      await escrow.connect(worker).submitEvidence(id, KEY, EVH);
      expect(await escrow.eligibleReviewerCount(id)).to.equal(3);

      await mine(3);
      await escrow.connect(anyone).assignPanel(id);
      const b = await getB(id);
      expect(b.status).to.equal(Status.InReview);
      const panel = await escrow.getPanel(id, b.reviewRound);
      expect([...panel].sort()).to.deep.equal(
        [reviewer1.address, reviewer2.address, reviewer3.address].sort(),
      );
    });

    it("mixes in-region and out-of-region reviewers when the region alone is short", async function () {
      const bountyCell = 33;
      await ensureReviewers(bountyCell, [reviewer1]);
      await ensureReviewers(34, [reviewer2, reviewer3]);

      const id = await createOpenBounty({ cell: bountyCell });
      await claimBounty(escrow, attester, domain, worker, id);
      await escrow.connect(worker).submitEvidence(id, KEY, EVH);
      expect(await escrow.eligibleReviewerCount(id)).to.equal(3);
    });

    it("Revert: InsufficientReviewers when < 3 reviewers exist globally", async function () {
      await ensureReviewers(35, [reviewer1, reviewer2]);

      const id = await createOpenBounty({ cell: 36 });
      await claimBounty(escrow, attester, domain, worker, id);
      await escrow.connect(worker).submitEvidence(id, KEY, EVH);
      expect(await escrow.eligibleReviewerCount(id)).to.equal(2);

      await mine(3);
      await expect(escrow.connect(anyone).assignPanel(id))
        .to.be.revertedWithCustomError(escrow, "InsufficientReviewers");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  v2 – slashed stakes from pokeOrReplace are paid out at settle
  // ═════════════════════════════════════════════════════════════════════════════

  describe("v2 slashedPool", function () {
    it("holds poke-slashed stakes and pays them to the settle majority; escrow stays solvent", async function () {
      const cell = 56;
      const pool = 10_000_000n;
      for (const s of extraRevs) await registerReviewer(escrow, attester, domain, s, cell);
      const revAddrs = extraRevs.map((s) => s.address);
      const escrowAddress = await escrowAddr();
      expect(await usdc.balanceOf(escrowAddress)).to.equal(6n * REVIEWER_STAKE);

      const id = await createOpenBounty({ cell, amount: pool });
      await claimBounty(escrow, attester, domain, worker, id);

      // Round 0: only panel[0] reveals → poke slashes the other two
      const r0 = await submitAndAssign(id);
      await commitAndReveal(id, r0.round, r0.panel, [true, null, null]);
      await time.increase(REVEAL_WINDOW + 1);
      await expect(escrow.connect(anyone).pokeOrReplace(id))
        .to.emit(escrow, "PokeOrReplace").withArgs(id, r0.round + 1, 2n * REVIEWER_STAKE);

      expect(await escrow.slashedPool(id)).to.equal(2n * REVIEWER_STAKE);
      // Slashed stakes stay in the escrow
      expect(await usdc.balanceOf(escrowAddress)).to.equal(pool + 6n * REVIEWER_STAKE);
      await expectSolvent([id], revAddrs);

      // Round 1: 2 approve, 1 reject → minority slashed at settle
      const b1 = await getB(id);
      await mine(Number(b1.selectionBlock - BigInt(await ethers.provider.getBlockNumber())) + 1);
      await escrow.connect(anyone).assignPanel(id);
      const round = Number((await getB(id)).reviewRound);
      const panel = [...(await escrow.getPanel(id, round))];
      for (const slashed of r0.panel.slice(1)) expect(panel).to.not.include(slashed);
      await commitAndReveal(id, round, panel, [true, true, false]);

      const workerBefore = await usdc.balanceOf(worker.address);
      await expect(escrow.connect(anyone).settle(id))
        .to.emit(escrow, "BountySettled").withArgs(id, true, 9_000_000n, 3_500_000n);

      // worker gets 90% of 10 USDC
      expect(await usdc.balanceOf(worker.address) - workerBefore).to.equal(9_000_000n);
      expect(await escrow.slashedPool(id)).to.equal(0n);

      // 1_000_000 cut + 2_000_000 minority stake + 4_000_000 poke-slashed pool = 7_000_000 → 3_500_000 each
      let rewards = 0n;
      for (const m of panel.slice(0, 2)) {
        const r = await getR(m);
        expect(r.rewardBalance).to.equal(3_500_000n);
        rewards += r.rewardBalance;
      }
      expect(rewards).to.equal(7_000_000n);
      expect((await getR(panel[2])).stakedAmount).to.equal(0n);

      // Remaining escrow = 7_000_000 rewards + stakes of reviewers outside both panels
      const idle = revAddrs.filter((a) => !panel.includes(a) && !r0.panel.slice(1).includes(a));
      expect(idle.length).to.equal(1);
      expect(await usdc.balanceOf(escrowAddress)).to.equal(7_000_000n + REVIEWER_STAKE);
      await expectSolvent([id], revAddrs);

      // Everyone can cash out and the escrow ends with exactly the idle reviewer's stake
      for (const m of panel.slice(0, 2)) await escrow.connect(signerMap[m]).withdrawReward();
      expect(await usdc.balanceOf(escrowAddress)).to.equal(REVIEWER_STAKE);
      await expectSolvent([id], revAddrs);
    });
  });
});
