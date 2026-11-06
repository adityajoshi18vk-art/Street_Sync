/**
 * Pure bounty-lifecycle eligibility rules mirroring StreetSyncEscrow v2.
 * All timestamps are unix seconds; `now` is injected so the rules are testable.
 */

export const STATUS = {
  Open: 0,
  Claimed: 1,
  Submitted: 2,
  InReview: 3,
  Approved: 4,
  Rejected: 5,
  Refunded: 6,
  Proposed: 7
} as const;

export const REVIEW_TIMEOUT_SECONDS = 3 * 86_400;
export const MIN_PANEL_REVIEWERS = 3;
export const MAX_REWORK = 1;
export const EXPIRY_BUFFER_SECONDS = 3_600;

export const EXPIRY_CHOICES = [
  { label: "3 days", seconds: 3 * 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "14 days", seconds: 14 * 86_400 },
  { label: "30 days", seconds: 30 * 86_400 }
] as const;

export interface LifecycleBounty {
  status: number;
  validationDeadline: number;
  claimDeadline: number;
  workDeadline: number;
  reworkCount: number;
}

/** Expiry choices that stay valid against the on-chain validationWindow (+1 hour of slack). */
export function availableExpiryChoices(validationWindowSeconds: number | null | undefined) {
  const min = (validationWindowSeconds ?? 0) + EXPIRY_BUFFER_SECONDS;
  return EXPIRY_CHOICES.filter((c) => c.seconds > min);
}

/** Open bounty whose claim window has closed (nobody can claim or pledge any more). */
export function isOpenExpired(b: Pick<LifecycleBounty, "status" | "claimDeadline">, now: number): boolean {
  return b.status === STATUS.Open && now > b.claimDeadline;
}

export function isClaimable(b: LifecycleBounty, now: number): boolean {
  return b.status === STATUS.Open && now <= b.claimDeadline;
}

export function canPledge(b: LifecycleBounty, now: number): boolean {
  if (b.status === STATUS.Proposed) return now <= b.validationDeadline;
  if (b.status === STATUS.Open) return now <= b.claimDeadline;
  return false;
}

export function canVoteProblem(params: {
  bounty: LifecycleBounty;
  now: number;
  isCreator: boolean;
  /** problemVote(bountyId, wallet): 0 none, 1 real, 2 fake. */
  myVote: number;
}): boolean {
  const { bounty, now, isCreator, myVote } = params;
  return bounty.status === STATUS.Proposed && now <= bounty.validationDeadline && !isCreator && myVote === 0;
}

export function canFinalizeValidation(b: LifecycleBounty, now: number): boolean {
  return b.status === STATUS.Proposed && now > b.validationDeadline;
}

/** True when the contract would refund pledges (possibly after its own auto-transition). */
export function canWithdrawPledge(b: LifecycleBounty, myPledge: bigint, now: number): boolean {
  if (myPledge <= 0n) return false;
  return (
    b.status === STATUS.Refunded ||
    (b.status === STATUS.Open && now > b.claimDeadline) ||
    (b.status === STATUS.Proposed && now > b.validationDeadline)
  );
}

export function canReleaseClaim(b: LifecycleBounty, now: number, eligibleReviewerCount: number): boolean {
  if (b.status === STATUS.Claimed || b.status === STATUS.Rejected) return now > b.workDeadline;
  if (b.status === STATUS.Submitted) {
    return now > b.workDeadline + REVIEW_TIMEOUT_SECONDS && eligibleReviewerCount < MIN_PANEL_REVIEWERS;
  }
  return false;
}

/** After a rejection the worker may rework once, inside the rework window. */
export function canRework(b: LifecycleBounty, now: number, isWorker: boolean): boolean {
  return isWorker && b.status === STATUS.Rejected && b.reworkCount < MAX_REWORK && now <= b.workDeadline;
}

/** Rejected bounty where the rework chance is gone, so it will reopen for other workers. */
export function willReopenAfterRejection(b: LifecycleBounty, now: number): boolean {
  return b.status === STATUS.Rejected && (b.reworkCount >= MAX_REWORK || now > b.workDeadline);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** "ends in 3h 10m" / "ended 2h 5m ago". */
export function countdownLabel(deadline: number, now: number): string {
  return deadline >= now
    ? `ends in ${formatDuration(deadline - now)}`
    : `ended ${formatDuration(now - deadline)} ago`;
}

/** Normalizes viem's decoded getBounty() struct into plain numbers for the rules above. */
export function toLifecycleBounty(raw: {
  status: number | bigint;
  validationDeadline: number | bigint;
  claimDeadline: number | bigint;
  workDeadline: number | bigint;
  reworkCount: number | bigint;
}): LifecycleBounty {
  return {
    status: Number(raw.status),
    validationDeadline: Number(raw.validationDeadline),
    claimDeadline: Number(raw.claimDeadline),
    workDeadline: Number(raw.workDeadline),
    reworkCount: Number(raw.reworkCount)
  };
}
