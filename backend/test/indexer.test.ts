import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { zeroAddress, zeroHash } from "viem";

process.env.DB_PATH = "data/test-indexer.db";
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`data/test-indexer.db${suffix}`, { force: true });

const { default: dbAccess } = await import("../src/db.js");
const { processLogs, refreshBounty } = await import("../src/indexer.js");
const { bountyToRow, normalizeBounty, Status } = await import("../src/chain.js");
type OnChainBounty = import("../src/chain.js").OnChainBounty;
type DecodedLog = import("../src/indexer.js").DecodedLog;

const CREATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const WORKER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const VOTER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const R = ["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "0x976EA74026E726554dB657fA54763abd0C3a0aa9"] as const;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

function chainBounty(over: Partial<OnChainBounty> = {}): OnChainBounty {
  return {
    id: 1n, creator: CREATOR, descriptionHash: H(1), reportHash: H(2), latE5: 4001200, lngE5: -7513000, regionCell: 42,
    totalPledged: 5_000_000n, createdAt: 1_700_000_000, validationDeadline: 1_700_086_400, claimDeadline: 1_700_200_000,
    workDeadline: 0, worker: zeroAddress, visualChallengeCode: 0, arkivEntityKey: zeroHash, evidenceHash: zeroHash,
    selectionBlock: 0n, reviewRound: 0, reworkCount: 0, confirmations: 0, disputes: 0, status: Status.Proposed, ...over,
  };
}

/** Fake chain: a mutable bounty table plus a log of reads. */
function fakeChain(initial: OnChainBounty[]) {
  const table = new Map(initial.map((b) => [b.id, b]));
  const reads: bigint[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    table, reads,
    get maxInFlight() { return maxInFlight; },
    readBounty: async (id: bigint) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      reads.push(id);
      return table.get(id) ?? chainBounty({ id, creator: zeroAddress });
    },
  };
}

const log = (eventName: string, args: Record<string, unknown>, block = 10n, tx = "0xtx"): DecodedLog =>
  ({ eventName, args, blockNumber: block, transactionHash: tx });

describe("getBounty → row mapping", () => {
  it("maps every field, nulling zero worker/hashes", () => {
    const row = bountyToRow(chainBounty());
    assert.deepEqual(row, {
      bounty_id: "1", creator: CREATOR.toLowerCase(), description_hash: H(1), report_hash: H(2),
      lat_e5: 4001200, lng_e5: -7513000, region_cell: 42, total_pledged: "5000000", created_at: 1_700_000_000,
      validation_deadline: 1_700_086_400, claim_deadline: 1_700_200_000, work_deadline: 0,
      worker: null, visual_challenge_code: null, arkiv_entity_key: null, evidence_hash: null, selection_block: null,
      review_round: 0, rework_count: 0, confirmations: 0, disputes: 0, status: 7,
    });
  });

  it("keeps worker, code, evidence and counters when set", () => {
    const row = bountyToRow(chainBounty({
      status: Status.Submitted, worker: WORKER, visualChallengeCode: 4821, workDeadline: 1_700_300_000,
      arkivEntityKey: H(9), evidenceHash: H(10), selectionBlock: 105n, reviewRound: 2, reworkCount: 1, confirmations: 2, disputes: 1,
    }));
    assert.equal(row.worker, WORKER.toLowerCase());
    assert.equal(row.visual_challenge_code, 4821);
    assert.equal(row.arkiv_entity_key, H(9));
    assert.equal(row.evidence_hash, H(10));
    assert.equal(row.selection_block, "105");
    assert.equal(row.work_deadline, 1_700_300_000);
    assert.deepEqual([row.review_round, row.rework_count, row.confirmations, row.disputes], [2, 1, 2, 1]);
  });

  it("normalizes a viem getBounty result (bigints, small ints)", () => {
    const b = normalizeBounty({
      id: 3n, creator: CREATOR, descriptionHash: H(1), reportHash: H(2), latE5: 1, lngE5: -2, regionCell: 5, totalPledged: 7n,
      createdAt: 11n, validationDeadline: 12n, claimDeadline: 13n, workDeadline: 14n, worker: WORKER, visualChallengeCode: 99,
      arkivEntityKey: H(3), evidenceHash: H(4), selectionBlock: 15n, reviewRound: 1, reworkCount: 0, confirmations: 1, disputes: 0, status: 3,
    });
    assert.equal(b.createdAt, 11);
    assert.equal(b.totalPledged, 7n);
    assert.equal(b.selectionBlock, 15n);
    assert.equal(b.status, 3);
  });
});

describe("indexer event handling", () => {
  before(() => { dbAccess.ensureDeploymentScope(31337, "0x3Fd53ce0728BfBDbc5559C4a573f54294FfEa356"); });

  it("creates the canonical row and initial pledge from BountyCreated", async () => {
    const chain = fakeChain([chainBounty()]);
    await processLogs([log("BountyCreated", { bountyId: 1n, creator: CREATOR, initialAmount: 5_000_000n })], chain.readBounty);
    const b = dbAccess.getBounty("1")!;
    assert.equal(b.status, 7);
    assert.equal(b.report_hash, H(2));
    assert.equal(b.validation_deadline, 1_700_086_400);
    assert.equal(b.has_report, 0);
    assert.equal(b.description, null);
    assert.equal(dbAccess.getPledges("1").length, 1);
  });

  it("records problem votes and picks up Open status + counts from the chain, not from events", async () => {
    const chain = fakeChain([chainBounty({ confirmations: 2, status: Status.Open })]);
    const logs = [
      log("ProblemVoteCast", { bountyId: 1n, voter: VOTER, isReal: true, confirmations: 1, disputes: 0 }, 11n, "0xv1"),
      log("ProblemVoteCast", { bountyId: 1n, voter: WORKER, isReal: true, confirmations: 2, disputes: 0 }, 12n, "0xv2"),
      log("ProblemValidated", { bountyId: 1n }, 12n, "0xv2"),
      log("Pledged", { bountyId: 1n, pledger: VOTER, amount: 1_000_000n, newTotal: 6_000_000n }, 13n, "0xp1"),
    ];
    await processLogs(logs, chain.readBounty);
    await processLogs(logs, chain.readBounty); // replay after a failed poll must not duplicate
    const votes = dbAccess.getProblemVotes("1");
    assert.deepEqual(votes.map((v) => [v.voter, v.is_real]), [[VOTER.toLowerCase(), 1], [WORKER.toLowerCase(), 1]]);
    const b = dbAccess.getBounty("1")!;
    assert.equal(b.status, Status.Open);
    assert.equal(b.confirmations, 2);
    assert.equal(dbAccess.getPledges("1").length, 2);
    assert.deepEqual(chain.reads, [1n, 1n], "one read per touched bounty per batch");
  });

  it("refreshes each touched bounty once, sequentially", async () => {
    const chain = fakeChain([chainBounty({ id: 1n }), chainBounty({ id: 2n }), chainBounty({ id: 3n })]);
    const logs = [1n, 2n, 3n, 1n, 2n].map((id) => log("ProblemValidated", { bountyId: id }));
    const result = await processLogs(logs, chain.readBounty);
    assert.deepEqual(result, { events: 5, refreshed: 3 });
    assert.deepEqual(chain.reads, [1n, 2n, 3n]);
    assert.equal(chain.maxInFlight, 1);
  });

  it("tracks claim → evidence → release: reopen clears the worker via the canonical read", async () => {
    const chain = fakeChain([chainBounty({ status: Status.Claimed, worker: WORKER, visualChallengeCode: 4821, workDeadline: 1_700_300_000 })]);
    await processLogs([log("BountyClaimed", { bountyId: 1n, worker: WORKER, visualChallengeCode: 4821, workDeadline: 1_700_300_000n })], chain.readBounty);
    let b = dbAccess.getBounty("1")!;
    assert.deepEqual([b.status, b.worker, b.work_deadline], [1, WORKER.toLowerCase(), 1_700_300_000]);

    chain.table.set(1n, chainBounty({ status: Status.Submitted, worker: WORKER, visualChallengeCode: 4821, arkivEntityKey: H(9), evidenceHash: H(10), selectionBlock: 50n }));
    await processLogs([log("EvidenceSubmitted", { bountyId: 1n, worker: WORKER })], chain.readBounty);
    b = dbAccess.getBounty("1")!;
    assert.deepEqual([b.status, b.evidence_hash, b.selection_block], [2, H(10), "50"]);

    chain.table.set(1n, chainBounty({ status: Status.Open, reviewRound: 1 }));
    await processLogs([log("ClaimReleased", { bountyId: 1n, worker: WORKER, workerBlocked: true })], chain.readBounty);
    b = dbAccess.getBounty("1")!;
    assert.deepEqual([b.status, b.worker, b.evidence_hash, b.arkiv_entity_key, b.review_round], [0, null, null, null, 1]);
  });

  it("records panels, votes per round, slashes and settlements", async () => {
    const chain = fakeChain([chainBounty({ status: Status.InReview })]);
    await processLogs([
      log("PanelAssigned", { bountyId: 1n, reviewRound: 0, panel: R }, 20n, "0xa0"),
      log("VoteCommitted", { bountyId: 1n, reviewer: R[0], commitHash: H(100) }, 21n, "0xc0"),
      log("VoteRevealed", { bountyId: 1n, reviewer: R[0], approve: true }, 22n, "0xr0"),
      log("ReviewerSlashed", { bountyId: 1n, reviewer: R[1], amount: 20_000_000n }, 23n, "0xs0"),
      log("PokeOrReplace", { bountyId: 1n, newReviewRound: 1, totalSlashed: 20_000_000n }, 23n, "0xs0"),
      log("PanelAssigned", { bountyId: 1n, reviewRound: 1, panel: R }, 30n, "0xa1"),
      log("VoteCommitted", { bountyId: 1n, reviewer: R[0], commitHash: H(101) }, 31n, "0xc1"),
      log("VoteRevealed", { bountyId: 1n, reviewer: R[0], approve: false }, 32n, "0xr1"),
      log("BountySettled", { bountyId: 1n, approved: false, workerPayout: 0n, reviewerCut: 0n }, 33n, "0xz"),
    ], chain.readBounty);

    const votes = dbAccess.getVotes("1");
    assert.equal(votes.length, 2, "same reviewer, two rounds");
    const byRound = Object.fromEntries(votes.map((v) => [v.review_round as number, v]));
    assert.deepEqual([byRound[0].approve, byRound[0].commit_hash], [1, H(100)]);
    assert.deepEqual([byRound[1].approve, byRound[1].commit_hash], [0, H(101)]);
    assert.equal(dbAccess.getPanel("1")!.review_round, 1);
    assert.equal(dbAccess.raw.prepare("SELECT COUNT(*) AS c FROM reviewer_slashes WHERE bounty_id = '1'").get()!.c, 1);
    assert.equal(dbAccess.getSettlement("1")!.approved, 0);
  });

  it("marks withdrawn pledges", async () => {
    const chain = fakeChain([chainBounty({ status: Status.Refunded })]);
    await processLogs([log("PledgeWithdrawn", { bountyId: 1n, pledger: VOTER, amount: 1_000_000n })], chain.readBounty);
    const pledge = dbAccess.getPledges("1").find((p) => p.pledger === VOTER.toLowerCase())!;
    assert.equal(pledge.withdrawn, 1);
    assert.equal(dbAccess.getBounty("1")!.status, Status.Refunded);
  });

  it("ignores unknown events and skips non-existent bounties; propagates RPC failures", async () => {
    const chain = fakeChain([]);
    const before = dbAccess.getBounty("99");
    assert.equal(before, undefined);
    await processLogs([log("OwnershipTransferred", { previousOwner: CREATOR })], chain.readBounty);
    assert.equal(chain.reads.length, 0);
    await refreshBounty(99n, chain.readBounty);
    assert.equal(dbAccess.getBounty("99"), undefined);

    const failing = async () => { throw new Error("429 rate limit"); };
    await assert.rejects(processLogs([log("ProblemValidated", { bountyId: 1n })], failing), /rate limit/);
  });

  it("joins the cached report into list and detail rows", () => {
    dbAccess.upsertReport({
      bounty_id: "1", entity_key: H(7), report_hash: H(2), creator: CREATOR, description: "Broken streetlight on 5th",
      lat_e5: 4001200, lng_e5: -7513000, captured_at_ms: 1_700_000_000_000, photo: new Uint8Array([1, 2, 3]),
    });
    for (const row of [dbAccess.getBounty("1")!, dbAccess.listBounties(10, 0).find((b) => b.bounty_id === "1")!,
      dbAccess.listBountiesByStatus(Status.Refunded).find((b) => b.bounty_id === "1")!]) {
      assert.equal(row.has_report, 1);
      assert.equal(row.description, "Broken streetlight on 5th");
      assert.equal("photo" in row, false, "list rows never carry the photo blob");
    }
    assert.deepEqual([...dbAccess.getReport("1")!.photo], [1, 2, 3]);
  });

  it("keeps prepared statements working after a deployment-scope reset", () => {
    assert.equal(dbAccess.ensureDeploymentScope(31337, "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"), true);
    assert.equal(dbAccess.getBounty("1"), undefined);
    assert.equal(dbAccess.getCursor(31337), 0n);
    dbAccess.upsertBountyRow(bountyToRow(chainBounty({ id: 5n })));
    dbAccess.setCursor(31337, 42n);
    assert.equal(dbAccess.getBounty("5")!.status, 7);
    assert.equal(dbAccess.getCursor(31337), 42n);
  });
});
