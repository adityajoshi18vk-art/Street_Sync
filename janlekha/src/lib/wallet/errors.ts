import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
  formatUnits,
} from "viem";

const fmt = (paise: unknown) => {
  try {
    return `₹${formatUnits(BigInt(paise as bigint), 2)}`;
  } catch {
    return String(paise);
  }
};

const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  AccessControlUnauthorizedAccount: () => "Your account does not hold the role this action requires.",
  UnknownProject: () => "This project does not exist on the contract.",
  NotProjectDepartment: () => "Only the department that created this project can do this.",
  InvalidDocumentHash: () => "A required document hash is missing.",
  InvalidAllocation: () => "The allocation must be greater than zero.",
  InvalidDeadlines: () => "The bid deadline must be in the future and the reveal deadline after it.",
  TenderAlreadyPublished: () => "A tender has already been published for this project.",
  TenderNotPublished: () => "No tender has been published for this project.",
  BiddingClosed: () => "The bid deadline has passed; new commitments are no longer accepted.",
  InvalidCommitment: () => "The bid commitment is empty.",
  AlreadyCommitted: () => "This account has already committed a bid for this project.",
  RevealNotOpen: () => "Bids can only be revealed after the bid deadline.",
  RevealClosed: () => "The reveal deadline has passed.",
  NoCommitment: () => "This account has no sealed bid to reveal for this project.",
  AlreadyRevealed: () => "This bid has already been revealed.",
  InvalidAmount: () => "The amount must be greater than zero.",
  CommitmentMismatch: () =>
    "The amount, quotation document or salt do not match your sealed bid commitment. Use the original backup file.",
  AwardNotOpen: () => "The tender can only be awarded after the reveal deadline.",
  AlreadyAwarded: () => "This project has already been awarded.",
  NotAwarded: () => "This project has not been awarded yet.",
  BidNotRevealed: () => "The selected vendor did not reveal a bid.",
  VendorNotEligible: () => "The selected vendor no longer holds VENDOR_ROLE.",
  AwardExceedsAllocation: ([, amount, allocation]) =>
    `The award (${fmt(amount)}) would exceed the remaining allocation (${fmt(allocation)}).`,
  MilestoneExceedsAward: ([, total, award]) => `Milestones would total ${fmt(total)}, more than the award of ${fmt(award)}.`,
  UnknownMilestone: () => "This milestone does not exist.",
  NotAwardedVendor: () => "Only the awarded vendor can submit evidence for this project.",
  EvidenceAlreadySubmitted: () => "Evidence has already been submitted for this milestone.",
  EvidenceNotSubmitted: () => "Evidence must be submitted before the milestone can be approved.",
  MilestoneAlreadyApproved: () => "This milestone has already been approved.",
  MilestoneNotApproved: () => "The milestone must be approved by an inspector before payment can be attested.",
  PaymentAlreadyAttested: () => "A mock PFMS payment has already been attested for this milestone.",
  PaymentAmountMismatch: ([expected, attested]) =>
    `The attested amount (${fmt(attested)}) must equal the approved milestone amount (${fmt(expected)}).`,
  ConflictOfInterest: () => "This account cannot act on its own work (conflict of interest).",
};

export interface DescribedError {
  message: string;
  /** Custom error name when the contract rejected the call. */
  contractError?: string;
  rejectedByUser?: boolean;
}

export function describeTxError(error: unknown): DescribedError {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: "You rejected the request in your wallet.", rejectedByUser: true };
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) {
        const describe = MESSAGES[name];
        return { message: describe ? describe(reverted.data?.args ?? []) : `The contract rejected the call (${name}).`, contractError: name };
      }
      return { message: reverted.reason ? `The contract rejected the call: ${reverted.reason}` : "The contract rejected the call." };
    }
    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      return { message: "Your account does not have enough HBAR to pay the transaction fee." };
    }
    // Generic wrappers hide the useful part (e.g. a node's rejection reason) in `details`.
    const generic = /unknown|internal/i.test(error.shortMessage);
    return { message: generic && error.details ? `${error.shortMessage} ${error.details}` : error.shortMessage };
  }
  if (typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === 4001) {
    return { message: "You rejected the request in your wallet.", rejectedByUser: true };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
