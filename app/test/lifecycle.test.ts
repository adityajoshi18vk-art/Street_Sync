import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, availableExpiryChoices, canFinalizeValidation, canPledge, canReleaseClaim, canRework,
  canVoteProblem, canWithdrawPledge, countdownLabel, isClaimable, isOpenExpired,
  willReopenAfterRejection, REVIEW_TIMEOUT_SECONDS, type LifecycleBounty
} from "../src/lib/lifecycle";
import { CONTRACT_ERROR_MESSAGES, friendlyError } from "../src/lib/errors";
import { normalizeBounty, statusLabel, statusName } from "../src/lib/types";

const NOW = 1_000_000;
const base: LifecycleBounty = {
  status: STATUS.Open, validationDeadline: NOW - 10, claimDeadline: NOW + 100, workDeadline: 0, reworkCount: 0
};
const b = (patch: Partial<LifecycleBounty>): LifecycleBounty => ({ ...base, ...patch });

test("expiry choices exclude windows not longer than validationWindow + 1h", () => {
  assert.deepEqual(availableExpiryChoices(86_400).map((c) => c.label), ["3 days", "7 days", "14 days", "30 days"]);
  assert.deepEqual(availableExpiryChoices(7 * 86_400).map((c) => c.label), ["14 days", "30 days"]);
  assert.deepEqual(availableExpiryChoices(3 * 86_400 - 3_600).map((c) => c.label), ["7 days", "14 days", "30 days"]);
  assert.deepEqual(availableExpiryChoices(3 * 86_400 - 3_601).map((c) => c.label), ["3 days", "7 days", "14 days", "30 days"]);
  assert.equal(availableExpiryChoices(30 * 86_400).length, 0);
  assert.equal(availableExpiryChoices(undefined).length, 4);
});

test("claimability and expiry only apply to Open bounties", () => {
  assert.equal(isClaimable(b({}), NOW), true);
  assert.equal(isClaimable(b({ claimDeadline: NOW }), NOW), true);
  assert.equal(isClaimable(b({ claimDeadline: NOW - 1 }), NOW), false);
  assert.equal(isOpenExpired(b({ claimDeadline: NOW - 1 }), NOW), true);
  assert.equal(isOpenExpired(b({ status: STATUS.Claimed, claimDeadline: NOW - 1 }), NOW), false);
});

test("pledging: Proposed before validationDeadline, Open before claimDeadline", () => {
  assert.equal(canPledge(b({ status: STATUS.Proposed, validationDeadline: NOW }), NOW), true);
  assert.equal(canPledge(b({ status: STATUS.Proposed, validationDeadline: NOW - 1 }), NOW), false);
  assert.equal(canPledge(b({}), NOW), true);
  assert.equal(canPledge(b({ claimDeadline: NOW - 1 }), NOW), false);
  for (const s of [STATUS.Claimed, STATUS.Submitted, STATUS.InReview, STATUS.Approved, STATUS.Rejected, STATUS.Refunded]) {
    assert.equal(canPledge(b({ status: s }), NOW), false);
  }
});

test("problem voting hides for creator, repeat voters, and closed windows", () => {
  const proposed = b({ status: STATUS.Proposed, validationDeadline: NOW + 5 });
  assert.equal(canVoteProblem({ bounty: proposed, now: NOW, isCreator: false, myVote: 0 }), true);
  assert.equal(canVoteProblem({ bounty: proposed, now: NOW, isCreator: true, myVote: 0 }), false);
  assert.equal(canVoteProblem({ bounty: proposed, now: NOW, isCreator: false, myVote: 1 }), false);
  assert.equal(canVoteProblem({ bounty: proposed, now: NOW, isCreator: false, myVote: 2 }), false);
  assert.equal(canVoteProblem({ bounty: { ...proposed, validationDeadline: NOW - 1 }, now: NOW, isCreator: false, myVote: 0 }), false);
  assert.equal(canVoteProblem({ bounty: b({}), now: NOW, isCreator: false, myVote: 0 }), false);
});

test("finalizeValidation only after the deadline while Proposed", () => {
  const p = b({ status: STATUS.Proposed, validationDeadline: NOW });
  assert.equal(canFinalizeValidation(p, NOW), false);
  assert.equal(canFinalizeValidation(p, NOW + 1), true);
  assert.equal(canFinalizeValidation(b({ validationDeadline: NOW - 100 }), NOW), false);
});

test("withdrawPledge needs a pledge and Refunded / expired Open / expired Proposed", () => {
  assert.equal(canWithdrawPledge(b({ status: STATUS.Refunded }), 1n, NOW), true);
  assert.equal(canWithdrawPledge(b({ status: STATUS.Refunded }), 0n, NOW), false);
  assert.equal(canWithdrawPledge(b({ claimDeadline: NOW - 1 }), 1n, NOW), true);
  assert.equal(canWithdrawPledge(b({}), 1n, NOW), false);
  assert.equal(canWithdrawPledge(b({ status: STATUS.Proposed, validationDeadline: NOW - 1 }), 1n, NOW), true);
  assert.equal(canWithdrawPledge(b({ status: STATUS.Proposed, validationDeadline: NOW }), 1n, NOW), false);
  assert.equal(canWithdrawPledge(b({ status: STATUS.Claimed, claimDeadline: NOW - 1 }), 1n, NOW), false);
});

test("releaseClaim rules for Claimed, Rejected and stalled Submitted", () => {
  assert.equal(canReleaseClaim(b({ status: STATUS.Claimed, workDeadline: NOW }), NOW, 0), false);
  assert.equal(canReleaseClaim(b({ status: STATUS.Claimed, workDeadline: NOW - 1 }), NOW, 5), true);
  assert.equal(canReleaseClaim(b({ status: STATUS.Rejected, workDeadline: NOW - 1 }), NOW, 5), true);
  const submitted = b({ status: STATUS.Submitted, workDeadline: NOW - REVIEW_TIMEOUT_SECONDS });
  assert.equal(canReleaseClaim(submitted, NOW, 2), false);
  assert.equal(canReleaseClaim({ ...submitted, workDeadline: submitted.workDeadline - 1 }, NOW, 2), true);
  assert.equal(canReleaseClaim({ ...submitted, workDeadline: submitted.workDeadline - 1 }, NOW, 3), false);
  assert.equal(canReleaseClaim(b({ status: STATUS.InReview, workDeadline: 1 }), NOW, 0), false);
});

test("rework is for the worker once, inside the window", () => {
  const rejected = b({ status: STATUS.Rejected, workDeadline: NOW + 10, reworkCount: 0 });
  assert.equal(canRework(rejected, NOW, true), true);
  assert.equal(canRework(rejected, NOW, false), false);
  assert.equal(canRework({ ...rejected, workDeadline: NOW - 1 }, NOW, true), false);
  assert.equal(canRework({ ...rejected, reworkCount: 1 }, NOW, true), false);
  assert.equal(willReopenAfterRejection({ ...rejected, reworkCount: 1 }, NOW), true);
  assert.equal(willReopenAfterRejection({ ...rejected, workDeadline: NOW - 1 }, NOW), true);
  assert.equal(willReopenAfterRejection(rejected, NOW), false);
});

test("countdown labels", () => {
  assert.equal(countdownLabel(NOW + 3 * 3600 + 600, NOW), "ends in 3h 10m");
  assert.equal(countdownLabel(NOW - 2 * 86_400 - 3600, NOW), "ended 2d 1h ago");
});

test("Proposed status naming and backend normalisation", () => {
  assert.equal(statusName(7), "Proposed");
  assert.equal(statusLabel(7), "Awaiting neighbours");
  const n = normalizeBounty({
    bounty_id: 4, lat_e5: 4071280, lng_e5: -7400600, total_pledged: "2500000", status: 7,
    description: "Broken light", has_report: 1, report_hash: "0xab", validation_deadline: 50,
    work_deadline: 0, claim_deadline: 99, confirmations: 1, disputes: "0"
  });
  assert.equal(n.status, 7);
  assert.equal(n.totalPledged, 2.5);
  assert.equal(n.hasReport, true);
  assert.equal(n.validationDeadline, 50);
  assert.equal(n.claimDeadline, 99);
  assert.equal(n.confirmations, 1);
  assert.equal(normalizeBounty({ id: 1 }).hasReport, false);
});

test("friendly errors map every escrow custom error name and fall back for others", () => {
  assert.match(CONTRACT_ERROR_MESSAGES.CreatorCannotVote, /can't vote/);
  assert.equal(friendlyError(new Error("boom")), "boom");
  assert.equal(friendlyError("plain"), "plain");
});
