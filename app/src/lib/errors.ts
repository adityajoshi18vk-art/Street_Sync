import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Short human messages for the escrow's custom errors. */
export const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  AlreadyCommitted: "You already committed a vote for this review round.",
  AlreadyRegistered: "This wallet is already an active reviewer.",
  AlreadyRevealed: "You already revealed your vote.",
  AlreadyVoted: "This wallet already voted on this problem.",
  AttestationExpired: "Your World ID attestation expired. Verify again and retry.",
  ClaimDeadlineNotPassed: "This bounty has not expired yet, so pledges are still locked.",
  ClaimExpired: "The claim deadline for this bounty has passed.",
  CommitWindowClosed: "The commit window has closed.",
  CreatorCannotClaim: "The creator of a bounty cannot claim it.",
  CreatorCannotVote: "You created this report, so you can't vote on it.",
  InsufficientReviewers: "Not enough eligible reviewers are registered to form a panel.",
  InvalidAttestation: "World ID attestation was rejected. Verify again and retry.",
  InvalidDeadline: "The expiry must be later than the neighbour-validation window.",
  InvalidEvidence: "The evidence key or hash is missing.",
  InvalidQuorum: "Invalid quorum value.",
  InvalidReport: "The problem report is missing or invalid.",
  NonceAlreadyUsed: "That attestation was already used. Verify again to get a new one.",
  NotPanelMember: "You are not on this review panel.",
  NotReleasable: "This bounty can't be reopened yet.",
  NotWorker: "Only the worker who claimed this bounty can do that.",
  NothingToWithdraw: "You have nothing to withdraw here.",
  OwnableInvalidOwner: "Invalid owner address.",
  OwnableUnauthorizedAccount: "Only the contract owner can do that.",
  PledgeLocked: "Pledges can't be withdrawn while the bounty is still active.",
  PledgerCannotClaim: "You pledged to this bounty, so you can't claim it.",
  QuorumNotReached: "Not enough reveals yet to settle.",
  RevealWindowNotOpen: "The reveal window isn't open yet.",
  RevealWindowOpen: "The reveal window is still open.",
  ReworkLimitReached: "The one allowed rework was already used.",
  ReworkWindowClosed: "The rework window has closed. The bounty will reopen for other workers.",
  SafeERC20FailedOperation: "USDC transfer failed. Check your balance and allowance.",
  SelectionBlockNotReached: "Randomness isn't ready yet. Wait a couple more blocks.",
  Unauthorized: "This wallet isn't allowed to do that.",
  ValidationClosed: "Neighbour validation for this report has ended.",
  ValidationOpen: "Neighbour validation is still running. Wait until the deadline.",
  VoteHashMismatch: "Your reveal doesn't match your committed vote.",
  VoterCannotClaim: "You voted on this problem, so you can't claim the work.",
  WorkerBlocked: "You were removed from this bounty and can't claim it again.",
  WrongStatus: "This bounty isn't in the right state for that action.",
  ZeroAmount: "Enter an amount greater than zero."
};

/** Walks a viem error chain to the revert and returns the custom error name, if any. */
export function contractErrorName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? null;
  }
  return null;
}

export function friendlyError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Transaction cancelled in your wallet.";
    }
    const name = contractErrorName(error);
    if (name) return CONTRACT_ERROR_MESSAGES[name] ?? `Contract rejected the action (${name}).`;
    return error.shortMessage || error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
