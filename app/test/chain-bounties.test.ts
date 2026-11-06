import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBackendError, filterRows, onChainToRow, recentBountyIds } from "../src/lib/chain-bounties";
import { normalizeBounty, type OnChainBounty } from "../src/lib/types";

const struct: OnChainBounty = {
  id: 0n, creator: "0xAf1f2f642a44095Fb29eFF70760D0a5df3d8e354", descriptionHash: "0x" + "1".repeat(64),
  reportHash: "0x" + "2".repeat(64), latE5: 1304797, lngE5: 8028456, regionCell: 9000, totalPledged: 100000n,
  createdAt: 1n, validationDeadline: 10n, claimDeadline: 20n, workDeadline: 0n,
  worker: "0x0000000000000000000000000000000000000000", visualChallengeCode: 0, arkivEntityKey: "0x",
  evidenceHash: "0x", selectionBlock: 0n, reviewRound: 0, reworkCount: 0, confirmations: 1, disputes: 0, status: 7
};

test("an on-chain bounty normalises like a backend row", () => {
  const b = normalizeBounty(onChainToRow(struct));
  assert.equal(b.bountyId, "0");
  assert.equal(b.lat, 13.04797);
  assert.equal(b.lng, 80.28456);
  assert.equal(b.totalPledged, 0.1);
  assert.equal(b.status, 7);
  assert.equal(b.worker, null);
  assert.equal(b.hasReport, true);
  assert.equal(b.validationDeadline, 10);
  assert.equal(b.confirmations, 1);
});

test("fallback rows honour status and worker filters", () => {
  const w = "0x00000000000000000000000000000000000000aa";
  const rows = [onChainToRow(struct), onChainToRow({ ...struct, id: 1n, status: 1, worker: w.toUpperCase().replace("0X", "0x") })];
  assert.deepEqual(filterRows(rows, { status: 1 }).map((r) => r.bounty_id), ["1"]);
  assert.deepEqual(filterRows(rows, { worker: w }).map((r) => r.bounty_id), ["1"]);
  assert.equal(filterRows(rows).length, 2);
});

test("recent ids are newest first and capped", () => {
  assert.deepEqual(recentBountyIds(0n, 5), []);
  assert.deepEqual(recentBountyIds(3n, 5), [2n, 1n, 0n]);
  assert.deepEqual(recentBountyIds(10n, 2), [9n, 8n]);
});

test("network failures get a readable message", () => {
  assert.equal(describeBackendError(new TypeError("Failed to fetch")), "the StreetSync server can't be reached");
  assert.equal(describeBackendError(new Error("HTTP 500")), "HTTP 500");
});
