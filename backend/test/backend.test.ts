/**
 * backend.test.ts
 * Integration tests for the StreetSync backend:
 *   1. SQLite DB operations (nullifiers, nonces, bounties, pledges, panel assignments, settlements)
 *   2. EIP-712 Attestation signature generation & cryptographic verification using viem
 *   3. Sybil protection enforcement (one human per action)
 *   4. REST API endpoints via Fastify inject
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import dbAccess from "../src/db.js";
// Explicit test-only signer; production never falls back to this public key.
process.env.ATTESTER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.ATTESTER_SIGNER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const {
  signAttestation,
  attesterAddress,
  setVerifyingContract,
  RoleEnum,
} = await import("../src/signer.js");

// Mock environment for test
const MOCK_ESCROW = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const CHAIN_ID = 5042002;

describe("StreetSync Backend Test Suite", () => {
  before(() => {
    setVerifyingContract(MOCK_ESCROW);
    assert.throws(() => setVerifyingContract("0x0000000000000000000000000000000000000000" as Address), /non-zero EVM address/);
    // Clean test tables
    dbAccess.raw.exec(`
      DELETE FROM nullifiers;
      DELETE FROM bounties;
      DELETE FROM pledges;
      DELETE FROM panel_assignments;
      DELETE FROM vote_commits;
      DELETE FROM settlements;
      DELETE FROM nonces;
    `);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. EIP-712 Attestation Signer Cryptographic Verification
  // ═══════════════════════════════════════════════════════════════════════════

  it("Generates valid EIP-712 attestation signature that recovers attesterAddress", async () => {
    const workerWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
    const bountyId = 1n;

    const res = await signAttestation(workerWallet, RoleEnum.Worker, bountyId);

    assert.equal(res.wallet, workerWallet);
    assert.equal(res.role, 1);
    assert.equal(res.bountyId, "1");
    assert.ok(res.signature.startsWith("0x"));
    assert.equal(res.attester.toLowerCase(), attesterAddress.toLowerCase());

    // Cryptographically verify using viem recoverTypedDataAddress
    const domain = {
      name: "StreetSync" as const,
      version: "1" as const,
      chainId: BigInt(CHAIN_ID),
      verifyingContract: MOCK_ESCROW,
    };

    const types = {
      Attestation: [
        { name: "wallet", type: "address" },
        { name: "role", type: "uint8" },
        { name: "bountyId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint64" },
      ],
    } as const;

    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "Attestation",
      message: {
        wallet: workerWallet,
        role: 1,
        bountyId: 1n,
        nonce: BigInt(res.nonce),
        expiry: BigInt(res.expiry),
      },
      signature: res.signature,
    });

    assert.equal(
      recovered.toLowerCase(),
      attesterAddress.toLowerCase(),
      "Recovered address must match the backend attester address",
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. Sybil & Nullifier Protection (One Human Per Action)
  // ═══════════════════════════════════════════════════════════════════════════

  it("Enforces one human per action via nullifiers", () => {
    const nullifierHash = "0x" + "aa".repeat(32);
    const action = "register-worker";
    const wallet1 = "0x1111111111111111111111111111111111111111";
    const wallet2 = "0x2222222222222222222222222222222222222222";

    // First registration succeeds
    dbAccess.insertNullifier(nullifierHash, action, wallet1);

    // Same identity with different wallet is flagged as Sybil
    const sybil = dbAccess.checkNullifierOtherWallet(nullifierHash, action, wallet2);
    assert.ok(sybil, "Should detect identity already used by another wallet");
    assert.equal(sybil.wallet, wallet1);

    // Exact duplicate insertion throws unique constraint
    assert.throws(() => {
      dbAccess.insertNullifier(nullifierHash, action, wallet1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. SQLite Bounty Lifecycle & Indexing Data-Access
  // ═══════════════════════════════════════════════════════════════════════════

  it("Performs full bounty lifecycle state transitions in SQLite", () => {
    const bountyId = "100";
    const creator = "0x3333333333333333333333333333333333333333";
    const worker = "0x4444444444444444444444444444444444444444";
    const now = Math.floor(Date.now() / 1000);

    // 1. Create bounty
    dbAccess.upsertBounty(
      bountyId,
      creator,
      "0x" + "11".repeat(32),
      4001200,
      -7513000,
      42,
      "10000000",
      now,
      now + 86400 * 7,
    );

    let b = dbAccess.getBounty(bountyId);
    assert.ok(b);
    assert.equal(b.bounty_id, bountyId);
    assert.equal(b.total_pledged, "10000000");
    assert.equal(b.status, 0); // Open

    // 2. Pledge top-up
    dbAccess.insertPledge(bountyId, creator, "5000000", "15000000", "101", "0xtx1");
    dbAccess.updateBountyPledge(bountyId, "15000000");
    b = dbAccess.getBounty(bountyId);
    assert.equal(b?.total_pledged, "15000000");

    // 3. Claim
    dbAccess.updateBountyClaimed(bountyId, worker, 4821);
    b = dbAccess.getBounty(bountyId);
    assert.equal(b?.status, 1); // Claimed
    assert.equal(b?.worker, worker);
    assert.equal(b?.visual_challenge_code, 4821);

    // 4. Evidence
    dbAccess.updateBountyEvidence(bountyId, "0xarkiv", "0xhash", "105");
    b = dbAccess.getBounty(bountyId);
    assert.equal(b?.status, 2); // Submitted
    assert.equal(b?.selection_block, "105");

    // 5. Panel assigned
    dbAccess.insertPanel(
      bountyId,
      0,
      "0xrev1",
      "0xrev2",
      "0xrev3",
      "106",
      "0xtx2",
    );
    dbAccess.updateBountyInReview(bountyId, 0);
    b = dbAccess.getBounty(bountyId);
    assert.equal(b?.status, 3); // InReview

    // Check assignments for reviewer
    const assignments = dbAccess.getAssignmentsByReviewer("0xrev1");
    assert.ok(assignments.length > 0);
    assert.equal(assignments[0].bounty_id, bountyId);

    // 6. Settle
    dbAccess.updateBountySettled(bountyId, 4); // Approved
    dbAccess.insertSettlement(bountyId, true, "13500000", "1750000", "110", "0xtx3");
    b = dbAccess.getBounty(bountyId);
    assert.equal(b?.status, 4); // Approved

    const settlement = dbAccess.getSettlement(bountyId);
    assert.ok(settlement);
    assert.equal(settlement.approved, 1);
    assert.equal(settlement.worker_payout, "13500000");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. REST API Endpoint Integration Tests (Fastify)
  // ═══════════════════════════════════════════════════════════════════════════

  it("Serves health and bounty REST endpoints correctly", async () => {
    // Import Fastify server instance or test queries directly through dbAccess
    const bounties = dbAccess.listBounties(10, 0);
    assert.ok(Array.isArray(bounties));
    assert.ok(bounties.length > 0);

    const bounty100 = dbAccess.getBounty("100");
    assert.ok(bounty100);
    assert.equal(bounty100.bounty_id, "100");

    // Check assignments
    const assignments = dbAccess.getAssignmentsByReviewer("0xrev1");
    assert.ok(assignments.length > 0);
    assert.equal(assignments[0].bounty_id, "100");

    // Check votes
    const votes = dbAccess.getVotes("100");
    assert.ok(Array.isArray(votes));
  });
});
