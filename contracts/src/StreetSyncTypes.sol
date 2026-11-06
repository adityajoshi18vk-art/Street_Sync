// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  StreetSyncTypes.sol
//  Central type definitions: enums, structs, custom errors, and events.
//  All USDC amounts are expressed in 6-decimal precision (1 USDC = 1_000_000).
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
//  Enumerations
// ═══════════════════════════════════════════════════════════════════

/// @notice Lifecycle status of a bounty.
enum Status {
    Open,       // Created and accepting USDC pledges
    Claimed,    // Claimed by a World-ID-verified worker
    Submitted,  // Evidence uploaded to Arkiv; waiting for 2-block randomness
    InReview,   // 3 reviewers assigned; commit-reveal in progress
    Approved,   // Majority approved; worker & reviewers paid
    Rejected,   // Majority rejected; worker may rework once or bounty reopens
    Refunded,   // Expired/cancelled/dismissed; funders withdraw their pledges
    Proposed    // Awaiting neighbour validation before it can be claimed
}

/// @notice Role attached to a World-ID attestation.
enum Role {
    None,
    Worker,
    Reviewer,
    Neighbour
}

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════

uint8 constant PANEL_SIZE = 3;
uint8 constant QUORUM     = 2;
uint8 constant PROBLEM_VOTE_NONE = 0;
uint8 constant PROBLEM_VOTE_REAL = 1;
uint8 constant PROBLEM_VOTE_FAKE = 2;

// ═══════════════════════════════════════════════════════════════════
//  Structs
// ═══════════════════════════════════════════════════════════════════

/// @notice Primary bounty record stored in StreetSyncEscrow.
struct Bounty {
    uint256 id;
    address creator;
    bytes32 descriptionHash;    // keccak256(utf8 description)
    bytes32 reportHash;         // SHA-256 of the Arkiv problem-report bundle (photo + description)
    int32   latE5;              // Latitude  × 1e5 (integer encoding)
    int32   lngE5;              // Longitude × 1e5 (integer encoding)
    uint16  regionCell;         // H3-style cell index for reviewer routing
    uint256 totalPledged;       // 6-decimal USDC accumulated in escrow
    uint64  createdAt;
    uint64  validationDeadline; // End of the neighbour validation window
    uint64  claimDeadline;      // Unix timestamp after which the bounty can no longer be claimed
    uint64  workDeadline;       // Claimed: submit-by time. Rejected: rework-by time.
    address worker;
    uint16  visualChallengeCode; // 4-digit code 1000–9999 emitted on claim
    bytes32 arkivEntityKey;     // 32-byte Arkiv entity identifier
    bytes32 evidenceHash;       // SHA-256 hash of the binary evidence bundle
    uint256 selectionBlock;     // block.number + 2 set by submitEvidence
    uint8   reviewRound;        // Incremented on pokeOrReplace or rework
    uint8   reworkCount;        // Max 1 rework allowed per rejection
    uint8   confirmations;      // Neighbour votes: problem is real
    uint8   disputes;           // Neighbour votes: problem is not real
    Status  status;
}

/// @notice Per-reviewer record stored in ReviewerPool.
struct Reviewer {
    address wallet;
    uint16  regionCell;
    uint256 stakedAmount;   // 6-decimal USDC (nominally 2_000_000)
    bool    active;         // false after slashing or voluntary exit
    uint256 rewardBalance;  // Accumulated unclaimed rewards (6-decimal USDC)
}

/// @notice One reviewer's commit-reveal state for a given bounty panel.
struct VoteCommit {
    bytes32 commitHash;     // keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter))
    bool    revealed;
    bool    approve;
    bool    committed;
}

// ═══════════════════════════════════════════════════════════════════
//  Custom Errors
// ═══════════════════════════════════════════════════════════════════

// --- Access / role errors ---
error NotWorker();
error NotReviewer();
error NotPanelMember();
error Unauthorized();

// --- Status-flow errors ---
error WrongStatus(Status expected, Status actual);
error AlreadyClaimed();
error AlreadySubmitted();
error AlreadyRevealed();
error AlreadyCommitted();
error AlreadyRegistered();

// --- Wash-trading / self-dealing ---
error CreatorCannotClaim();
error PledgerCannotClaim();
error CreatorCannotReview();
error WorkerCannotReview();
error PledgerCannotReview();

// --- Timing errors ---
error CommitWindowClosed();
error RevealWindowOpen();    // settle called before reveal deadline
error RevealWindowNotOpen();
error SelectionBlockNotReached();
error SelectionBlockStale();
error ClaimDeadlineNotPassed();
error ClaimExpired();

// --- Attestation errors ---
error NonceAlreadyUsed();
error AttestationExpired();
error InvalidAttestation();
error WrongRole();

// --- Pool / panel errors ---
error InsufficientReviewers();
error NotEnoughRevealed();
error StakeTransferFailed();

// --- Voting errors ---
error QuorumNotReached();
error VoteHashMismatch();
error ReworkLimitReached();
error NothingToWithdraw();

// --- Neighbour validation ---
error CreatorCannotVote();
error AlreadyVoted();
error ValidationClosed();
error ValidationOpen();
error VoterCannotClaim();
error InvalidQuorum();

// --- Lifecycle recovery ---
error WorkerBlocked();
error NotReleasable();
error ReworkWindowClosed();
error PledgeLocked();

// --- Generic ---
error ZeroAmount();
error InvalidDeadline();
error InvalidReport();
error InvalidEvidence();

// ═══════════════════════════════════════════════════════════════════
//  Events
// ═══════════════════════════════════════════════════════════════════

event BountyCreated(
    uint256 indexed bountyId,
    address indexed creator,
    bytes32 descriptionHash,
    bytes32 reportHash,
    int32   latE5,
    int32   lngE5,
    uint16  regionCell,
    uint256 initialAmount,
    uint64  claimDeadline,
    uint64  validationDeadline,
    Status  status
);

event ProblemVoteCast(
    uint256 indexed bountyId,
    address indexed voter,
    bool    isReal,
    uint8   confirmations,
    uint8   disputes
);

event ProblemValidated(uint256 indexed bountyId);

event ProblemDismissed(uint256 indexed bountyId);

event ClaimReleased(
    uint256 indexed bountyId,
    address indexed worker,
    bool    workerBlocked
);

event Pledged(
    uint256 indexed bountyId,
    address indexed pledger,
    uint256 amount,
    uint256 newTotal
);

event BountyClaimed(
    uint256 indexed bountyId,
    address indexed worker,
    uint16  visualChallengeCode,
    uint64  workDeadline
);

event EvidenceSubmitted(
    uint256 indexed bountyId,
    address indexed worker,
    bytes32 arkivEntityKey,
    bytes32 evidenceHash,
    uint256 selectionBlock
);

event PanelAssigned(
    uint256 indexed bountyId,
    uint8   reviewRound,
    address[3] panel
);

event VoteCommitted(
    uint256 indexed bountyId,
    address indexed reviewer,
    bytes32 commitHash
);

event VoteRevealed(
    uint256 indexed bountyId,
    address indexed reviewer,
    bool    approve
);

event BountySettled(
    uint256 indexed bountyId,
    bool    approved,
    uint256 workerPayout,   // 6-decimal USDC (90% if approved, else 0)
    uint256 reviewerCut     // 6-decimal USDC per majority reviewer
);

event ReviewerSlashed(
    uint256 indexed bountyId,
    address indexed reviewer,
    uint256 amount
);

event ReviewerRegistered(
    address indexed reviewer,
    uint16  regionCell,
    uint256 stakeAmount
);

event ReviewerRewardCredited(
    address indexed reviewer,
    uint256 amount
);

event RewardWithdrawn(
    address indexed reviewer,
    uint256 amount
);

event PledgeWithdrawn(
    uint256 indexed bountyId,
    address indexed pledger,
    uint256 amount
);

event PokeOrReplace(
    uint256 indexed bountyId,
    uint8   newReviewRound,
    uint256 totalSlashed
);

event BountyReworked(
    uint256 indexed bountyId,
    uint8   reworkCount,
    uint64  workDeadline
);

event CommitWindowSet(uint256 newWindow);
event RevealWindowSet(uint256 newWindow);
event ClaimDurationSet(uint256 newDuration);
event ValidationWindowSet(uint256 newWindow);
event ValidationQuorumSet(uint8 newQuorum);
event AttesterUpdated(address newAttester);
