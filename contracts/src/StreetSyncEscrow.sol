// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  StreetSyncEscrow.sol
//  Main entry point integrating AttestationVerifier, ReviewerPool, VotingModule.
//
//  Lifecycle:
//    createBounty (Proposed) → voteProblem × quorum (Open) → pledge → claim
//    → submitEvidence → (2 blocks) → assignPanel → commitVote × 3
//    → revealVote × 3 → settle
//  Recovery: finalizeValidation, releaseClaim, rework, pokeOrReplace,
//    withdrawPledge — no state can lock funds permanently.
//
//  Security rules enforced:
//    Rule 1 – All USDC via SafeERC20, never msg.value.
//    Rule 2 – Anti-wash-trading: creator/pledger cannot claim or review.
//    Rule 3 – pokeOrReplace deadlock recovery.
//    Rule 4 – Two-step future-block randomness.
//    Rule 5 – EIP-712 replay-proof attestations.
//    Rule 6 – 4-digit visual challenge code on claim.
//    (Rule 7 – enforced off-chain by the client bundle pipeline.)
// ─────────────────────────────────────────────────────────────────────────────

import "./StreetSyncTypes.sol";
import "./AttestationVerifier.sol";
import "./ReviewerPool.sol";
import "./VotingModule.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract StreetSyncEscrow is AttestationVerifier, ReviewerPool, VotingModule, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant REVIEWER_CUT_BPS  = 1000;  // 10% in bps
    uint256 public constant BPS_DENOMINATOR   = 10_000;
    uint8   public constant MAX_REWORK        = 1;
    uint256 public constant STALE_BLOCK_LIMIT = 250;    // Rule 4: re-roll if > 250 blocks stale

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 public nextBountyId;

    /// @notice Primary bounty storage.
    mapping(uint256 => Bounty) public bounties;

    /// @notice Per-bounty pledge amounts per pledger address (6-decimal USDC).
    mapping(uint256 => mapping(address => uint256)) public pledges;

    /// @notice Ordered list of pledger addresses per bounty (for exclusion in assignPanel).
    mapping(uint256 => address[]) internal _pledgers;

    /// @notice Configurable claim duration (how long after claim() the worker has to submit).
    uint256 public claimDuration;

    /// @notice Seconds neighbours have to validate a new problem report.
    uint256 public validationWindow;

    /// @notice Matching neighbour votes needed to open (or dismiss) a bounty. 0 skips validation.
    uint8 public validationQuorum;

    /// @notice Grace period after the work deadline before an unreviewable submission can be released.
    uint256 public constant REVIEW_TIMEOUT = 3 days;

    /// @notice bountyId → neighbour → PROBLEM_VOTE_* value.
    mapping(uint256 => mapping(address => uint8)) public problemVote;

    /// @notice bountyId → worker who abandoned or failed the bounty and may not claim it again.
    mapping(uint256 => mapping(address => bool)) public blockedWorker;

    /// @notice Stakes slashed by pokeOrReplace, held for the bounty's eventual settlement.
    mapping(uint256 => uint256) public slashedPool;

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param usdcToken         ERC-20 USDC address (6 decimals).
    /// @param _attester         Backend EIP-712 signer address.
    /// @param _commitWindow     Commit phase window in seconds.
    /// @param _revealWindow     Reveal phase window in seconds.
    /// @param _claimDuration    Seconds a worker has to submit evidence (and to rework).
    /// @param _validationWindow Seconds neighbours have to validate a report.
    /// @param _validationQuorum Matching neighbour votes required (0 disables validation).
    constructor(
        address usdcToken,
        address _attester,
        uint256 _commitWindow,
        uint256 _revealWindow,
        uint256 _claimDuration,
        uint256 _validationWindow,
        uint8   _validationQuorum
    )
        AttestationVerifier(_attester)
        ReviewerPool(usdcToken)
        Ownable(msg.sender)
    {
        if (_validationQuorum > 10) revert InvalidQuorum();
        commitWindow     = _commitWindow;
        revealWindow     = _revealWindow;
        claimDuration    = _claimDuration;
        validationWindow = _validationWindow;
        validationQuorum = _validationQuorum;
    }

    // ─── Owner admin ──────────────────────────────────────────────────────────

    function setAttester(address newAttester) external onlyOwner {
        _setAttester(newAttester);
    }

    function setCommitWindow(uint256 secs) external onlyOwner {
        commitWindow = secs;
        emit CommitWindowSet(secs);
    }

    function setRevealWindow(uint256 secs) external onlyOwner {
        revealWindow = secs;
        emit RevealWindowSet(secs);
    }

    function setClaimDuration(uint256 secs) external onlyOwner {
        claimDuration = secs;
        emit ClaimDurationSet(secs);
    }

    function setValidationWindow(uint256 secs) external onlyOwner {
        validationWindow = secs;
        emit ValidationWindowSet(secs);
    }

    function setValidationQuorum(uint8 quorum) external onlyOwner {
        if (quorum > 10) revert InvalidQuorum();
        validationQuorum = quorum;
        emit ValidationQuorumSet(quorum);
    }

    // ─── 1. createBounty ──────────────────────────────────────────────────────

    /// @notice Reports a problem and deposits `initialAmount` USDC into escrow.
    ///         The bounty starts as Proposed until neighbours validate it.
    /// @param descHash       keccak256 of the UTF-8 description.
    /// @param reportHash     SHA-256 of the problem-report bundle stored on Arkiv.
    /// @param latE5          Latitude × 1e5 (integer).
    /// @param lngE5          Longitude × 1e5 (integer).
    /// @param regionCell     Region cell index for reviewer routing.
    /// @param initialAmount  Initial pledge in 6-decimal USDC (must be > 0).
    /// @param _claimDeadline Unix timestamp after which the bounty can no longer be claimed.
    /// @return bountyId      Assigned bounty ID.
    function createBounty(
        bytes32 descHash,
        bytes32 reportHash,
        int32   latE5,
        int32   lngE5,
        uint16  regionCell,
        uint256 initialAmount,
        uint64  _claimDeadline
    ) external returns (uint256 bountyId) {
        if (initialAmount == 0) revert ZeroAmount();
        if (reportHash == bytes32(0) || descHash == bytes32(0)) revert InvalidReport();

        bool needsValidation = validationQuorum > 0;
        uint64 validationEnd = needsValidation
            ? uint64(block.timestamp + validationWindow)
            : uint64(block.timestamp);
        if (_claimDeadline <= validationEnd) revert InvalidDeadline();

        bountyId = nextBountyId++;
        Bounty storage b = bounties[bountyId];
        b.id                 = bountyId;
        b.creator            = msg.sender;
        b.descriptionHash    = descHash;
        b.reportHash         = reportHash;
        b.latE5              = latE5;
        b.lngE5              = lngE5;
        b.regionCell         = regionCell;
        b.totalPledged       = initialAmount;
        b.createdAt          = uint64(block.timestamp);
        b.validationDeadline = validationEnd;
        b.claimDeadline      = _claimDeadline;
        b.status             = needsValidation ? Status.Proposed : Status.Open;

        // The creator counts as a pledger, so is excluded from claiming and review (Rule 2).
        _recordPledge(bountyId, msg.sender, initialAmount);

        USDC.safeTransferFrom(msg.sender, address(this), initialAmount);

        emit BountyCreated(
            bountyId, msg.sender, descHash, reportHash, latE5, lngE5, regionCell,
            initialAmount, _claimDeadline, validationEnd, b.status
        );
    }

    // ─── 1b. Neighbour validation ─────────────────────────────────────────────

    /// @notice A World-ID-verified neighbour confirms or disputes a reported problem.
    ///         The first side to reach `validationQuorum` votes decides the outcome.
    function voteProblem(
        uint256        bountyId,
        bool           isReal,
        uint256        nonce,
        uint64         expiry,
        bytes calldata attestationSig
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Proposed) revert WrongStatus(Status.Proposed, b.status);
        if (block.timestamp > b.validationDeadline) revert ValidationClosed();
        if (msg.sender == b.creator) revert CreatorCannotVote();
        if (problemVote[bountyId][msg.sender] != PROBLEM_VOTE_NONE) revert AlreadyVoted();

        _verifyAttestation(msg.sender, Role.Neighbour, bountyId, nonce, expiry, attestationSig);

        if (isReal) {
            problemVote[bountyId][msg.sender] = PROBLEM_VOTE_REAL;
            b.confirmations++;
        } else {
            problemVote[bountyId][msg.sender] = PROBLEM_VOTE_FAKE;
            b.disputes++;
        }
        emit ProblemVoteCast(bountyId, msg.sender, isReal, b.confirmations, b.disputes);

        uint8 quorum = validationQuorum == 0 ? 1 : validationQuorum;
        if (b.confirmations >= quorum) {
            b.status = Status.Open;
            emit ProblemValidated(bountyId);
        } else if (b.disputes >= quorum) {
            b.status = Status.Refunded;
            emit ProblemDismissed(bountyId);
        }
    }

    /// @notice Dismisses a report whose validation window ended without enough confirmations.
    function finalizeValidation(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Proposed) revert WrongStatus(Status.Proposed, b.status);
        if (block.timestamp <= b.validationDeadline) revert ValidationOpen();
        b.status = Status.Refunded;
        emit ProblemDismissed(bountyId);
    }

    // ─── 2. pledge ────────────────────────────────────────────────────────────

    /// @notice Add USDC to a proposed or open bounty's escrow.
    function pledge(uint256 bountyId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Bounty storage b = bounties[bountyId];
        if (b.status == Status.Proposed) {
            if (block.timestamp > b.validationDeadline) revert ValidationClosed();
        } else if (b.status != Status.Open) {
            revert WrongStatus(Status.Open, b.status);
        }
        if (block.timestamp > b.claimDeadline) revert ClaimExpired();

        _recordPledge(bountyId, msg.sender, amount);
        b.totalPledged += amount;

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Pledged(bountyId, msg.sender, amount, b.totalPledged);
    }

    // ─── 3. claim ─────────────────────────────────────────────────────────────

    /// @notice World-ID-verified worker claims the bounty.
    ///         Emits a 4-digit visual challenge code (Rule 6).
    ///         The creator, pledgers and validating neighbours cannot claim (Rule 2).
    function claim(
        uint256        bountyId,
        uint256        nonce,
        uint64         expiry,
        bytes calldata attestationSig
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert WrongStatus(Status.Open, b.status);
        if (block.timestamp > b.claimDeadline) revert ClaimExpired();

        if (msg.sender == b.creator) revert CreatorCannotClaim();
        if (pledges[bountyId][msg.sender] > 0) revert PledgerCannotClaim();
        if (problemVote[bountyId][msg.sender] != PROBLEM_VOTE_NONE) revert VoterCannotClaim();
        if (blockedWorker[bountyId][msg.sender]) revert WorkerBlocked();

        _verifyAttestation(msg.sender, Role.Worker, bountyId, nonce, expiry, attestationSig);

        // Rule 6: 4-digit visual challenge code (1000–9999)
        uint16 code = uint16(
            uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), bountyId, msg.sender)))
            % 9000 + 1000
        );

        b.worker              = msg.sender;
        b.visualChallengeCode = code;
        b.status              = Status.Claimed;
        b.workDeadline        = uint64(block.timestamp + claimDuration);

        emit BountyClaimed(bountyId, msg.sender, code, b.workDeadline);
    }

    // ─── 4. submitEvidence ────────────────────────────────────────────────────

    /// @notice Worker submits Arkiv evidence after completing the fix.
    ///         Sets selectionBlock = block.number + 2 (Rule 4).
    function submitEvidence(
        uint256 bountyId,
        bytes32 arkivEntityKey,
        bytes32 evidenceHash_
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Claimed) revert WrongStatus(Status.Claimed, b.status);
        if (msg.sender != b.worker) revert NotWorker();
        if (arkivEntityKey == bytes32(0) || evidenceHash_ == bytes32(0)) revert InvalidEvidence();

        b.arkivEntityKey  = arkivEntityKey;
        b.evidenceHash    = evidenceHash_;
        b.selectionBlock  = block.number + 2;  // Rule 4
        b.status          = Status.Submitted;

        emit EvidenceSubmitted(bountyId, msg.sender, arkivEntityKey, evidenceHash_, b.selectionBlock);
    }

    // ─── 5. registerReviewer ──────────────────────────────────────────────────

    /// @notice World-ID-verified reviewer registers and stakes 2.00 USDC.
    function registerReviewer(
        uint16         regionCell,
        uint256        nonce,
        uint64         expiry,
        bytes calldata attestationSig
    ) external {
        // Rule 5: verify Reviewer attestation (bountyId = 0 for registration)
        _verifyAttestation(msg.sender, Role.Reviewer, 0, nonce, expiry, attestationSig);
        _registerReviewer(msg.sender, regionCell);
    }

    // ─── 6. assignPanel ───────────────────────────────────────────────────────

    /// @notice Selects the 3-reviewer panel after selectionBlock is reached (Rule 4).
    ///         Anyone can call this once conditions are met.
    function assignPanel(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Submitted) revert WrongStatus(Status.Submitted, b.status);

        uint256 selBlock = b.selectionBlock;

        // Rule 4: staleness recovery – if too many blocks have passed, re-roll
        if (block.number > selBlock + STALE_BLOCK_LIMIT) {
            b.selectionBlock = block.number + 2;
            // Persist the replacement future block; a revert would roll this back.
            return;
        }

        if (block.number <= selBlock) revert SelectionBlockNotReached();

        // Derive deterministic seed from future block hash (Rule 4)
        bytes32 seed = keccak256(
            abi.encodePacked(blockhash(selBlock), bountyId, b.reviewRound)
        );

        // Build pledger exclusion list (Rule 2)
        address[] memory pledgerList = _pledgers[bountyId];

        address[3] memory panel = _selectPanel(
            b.regionCell,
            seed,
            b.creator,
            b.worker,
            pledgerList
        );

        b.status = Status.InReview;

        _setPanelAndTimers(bountyId, b.reviewRound, panel);

        emit PanelAssigned(bountyId, b.reviewRound, panel);
    }

    // ─── 7. commitVote ───────────────────────────────────────────────────────

    /// @notice Panel member commits their hashed vote.
    ///         voteHash = keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter))
    function commitVote(uint256 bountyId, bytes32 voteHash) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.InReview) revert WrongStatus(Status.InReview, b.status);
        _commitVote(bountyId, b.reviewRound, msg.sender, voteHash);
    }

    // ─── 8. revealVote ───────────────────────────────────────────────────────

    /// @notice Panel member reveals their vote after the commit window closes.
    function revealVote(uint256 bountyId, bool approve, bytes32 salt) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.InReview) revert WrongStatus(Status.InReview, b.status);
        _revealVote(bountyId, b.reviewRound, msg.sender, approve, salt);

        // Early settlement: if quorum is reached before revealDeadline, allow immediate settle
        // (caller still needs to call settle() separately)
    }

    // ─── 9. settle ───────────────────────────────────────────────────────────

    /// @notice Tallies votes and distributes USDC.
    ///         Can be called after revealDeadline OR immediately once all 3 have revealed.
    ///         Approved: 90% → worker, 10% + slashed minority stakes → majority reviewers.
    ///         Rejected: escrow stays; rework() available once, then the bounty reopens.
    function settle(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.InReview) revert WrongStatus(Status.InReview, b.status);

        uint8 round = b.reviewRound;
        (uint8 revealed, uint8 approvals) = _tally(bountyId, round);

        // Allow early settle only if all 3 have revealed; otherwise require deadline to pass
        bool allRevealed = revealed == PANEL_SIZE;
        if (!allRevealed && block.timestamp <= revealDeadline[bountyId]) {
            revert RevealWindowOpen();
        }

        // Require quorum
        if (revealed < QUORUM) revert QuorumNotReached();

        bool approved = approvals >= QUORUM;
        uint256 pool  = b.totalPledged;

        // Split majority vs minority
        (
            address[] memory majority, uint256 majorityCount,
            address[] memory minority, uint256 minorityCount
        ) = _splitMajorityMinority(bountyId, round, approved);

        // Slash minority stake (non-revealers already slashed by pokeOrReplace if applicable)
        uint256 slashedFromMinority = 0;
        for (uint256 i = 0; i < minorityCount; ) {
            slashedFromMinority += _slashReviewerForBounty(minority[i], bountyId);
            unchecked { ++i; }
        }

        // Also slash non-revealers (who were not already slashed by pokeOrReplace)
        {
            (address[] memory nonRevList, uint256 nrCount) = _nonRevealers(bountyId, round);
            for (uint256 i = 0; i < nrCount; ) {
                address nr = nonRevList[i];
                if (reviewers[nr].stakedAmount > 0) {
                    // Not yet slashed
                    slashedFromMinority += _slashReviewerForBounty(nr, bountyId);
                }
                unchecked { ++i; }
            }
        }

        // Stakes slashed by earlier pokeOrReplace rounds are paid out with this settlement.
        slashedFromMinority += slashedPool[bountyId];
        slashedPool[bountyId] = 0;

        if (approved) {
            // 90% → worker
            uint256 workerPayout = (pool * (BPS_DENOMINATOR - REVIEWER_CUT_BPS)) / BPS_DENOMINATOR;
            // 10% → majority reviewers (split equally) + slashed minority stakes
            uint256 reviewerPool_ = pool - workerPayout + slashedFromMinority;
            uint256 perReviewer   = majorityCount > 0 ? reviewerPool_ / majorityCount : 0;

            b.status = Status.Approved;

            // Pay worker
            USDC.safeTransfer(b.worker, workerPayout);

            // Credit majority reviewers (pull-based) + return their stakes
            for (uint256 i = 0; i < majorityCount; ) {
                address rev = majority[i];
                _creditReward(rev, perReviewer);
                uint256 stakeToReturn;
                // Transfer stake back directly (reviewer may have been slashed already, guard)
                stakeToReturn = _releaseStake(rev);
                if (stakeToReturn > 0) USDC.safeTransfer(rev, stakeToReturn);
                unchecked { ++i; }
            }

            emit BountySettled(bountyId, true, workerPayout, perReviewer);
        } else {
            // Rejected — distribute slashed minority stakes to majority + return majority stakes
            uint256 perReviewer = majorityCount > 0 ? slashedFromMinority / majorityCount : 0;

            if (b.reworkCount >= MAX_REWORK) {
                // No rework left: the bounty reopens for another worker.
                _reopen(bountyId, b, true);
            } else {
                b.status       = Status.Rejected;
                b.workDeadline = uint64(block.timestamp + claimDuration); // rework window
            }

            // Credit majority reviewers with slashed portion
            for (uint256 i = 0; i < majorityCount; ) {
                address rev = majority[i];
                _creditReward(rev, perReviewer);
                uint256 stake = _releaseStake(rev);
                if (stake > 0) USDC.safeTransfer(rev, stake);
                unchecked { ++i; }
            }

            emit BountySettled(bountyId, false, 0, perReviewer);
        }
    }

    // ─── 10. rework ──────────────────────────────────────────────────────────

    /// @notice Worker re-attempts after a rejection (max 1), within the rework window.
    function rework(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Rejected) revert WrongStatus(Status.Rejected, b.status);
        if (msg.sender != b.worker) revert NotWorker();
        if (b.reworkCount >= MAX_REWORK) revert ReworkLimitReached();
        if (block.timestamp > b.workDeadline) revert ReworkWindowClosed();

        b.reworkCount++;
        b.status         = Status.Claimed; // Worker can now re-submitEvidence
        b.selectionBlock = 0;
        b.reviewRound++;                   // New round prevents vote replay
        b.arkivEntityKey = bytes32(0);
        b.evidenceHash   = bytes32(0);
        b.workDeadline   = uint64(block.timestamp + claimDuration);

        emit BountyReworked(bountyId, b.reworkCount, b.workDeadline);
    }

    // ─── 11. pokeOrReplace ───────────────────────────────────────────────────

    /// @notice Deadlock recovery: if revealDeadline passes with < QUORUM revealed votes,
    ///         slashes non-revealers, increments reviewRound, draws a new panel (Rule 3).
    ///         Anyone can call this.
    function pokeOrReplace(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.InReview) revert WrongStatus(Status.InReview, b.status);
        if (block.timestamp <= revealDeadline[bountyId]) revert RevealWindowOpen();

        (uint8 revealed,) = _tally(bountyId, b.reviewRound);
        if (revealed >= QUORUM) revert QuorumNotReached(); // quorum met → use settle()

        // Slash non-revealers
        (address[] memory nonRevList, uint256 nrCount) = _nonRevealers(bountyId, b.reviewRound);
        uint256 totalSlashed = 0;
        for (uint256 i = 0; i < nrCount; ) {
            totalSlashed += _slashReviewerForBounty(nonRevList[i], bountyId);
            unchecked { ++i; }
        }
        slashedPool[bountyId] += totalSlashed; // distributed by settle()

        // Increment round and select new panel (Rule 3)
        b.reviewRound++;
        b.selectionBlock = block.number + 2;
        b.status         = Status.Submitted; // Reverts to Submitted so assignPanel can be called

        emit PokeOrReplace(bountyId, b.reviewRound, totalSlashed);
    }

    // ─── 12. releaseClaim ────────────────────────────────────────────────────

    /// @notice Reopens a bounty whose worker stalled. Anyone can call this:
    ///         - Claimed past the work deadline (worker blocked from re-claiming),
    ///         - Rejected past the rework window (worker blocked),
    ///         - Submitted with no possible review panel after REVIEW_TIMEOUT.
    function releaseClaim(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status == Status.Claimed || b.status == Status.Rejected) {
            if (block.timestamp <= b.workDeadline) revert NotReleasable();
            _reopen(bountyId, b, true);
        } else if (b.status == Status.Submitted) {
            if (block.timestamp <= uint256(b.workDeadline) + REVIEW_TIMEOUT) revert NotReleasable();
            (, uint256 eligible) = _eligibleReviewers(b.regionCell, b.creator, b.worker, _pledgers[bountyId]);
            if (eligible >= PANEL_SIZE) revert NotReleasable(); // assignPanel can still proceed
            _reopen(bountyId, b, false);
        } else {
            revert NotReleasable();
        }
    }

    // ─── 13. withdrawPledge ──────────────────────────────────────────────────

    /// @notice Pull-based pledge refund for dismissed, refunded or expired bounties.
    function withdrawPledge(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];

        if (b.status == Status.Proposed && block.timestamp > b.validationDeadline) {
            b.status = Status.Refunded;
            emit ProblemDismissed(bountyId);
        } else if (b.status == Status.Open && block.timestamp > b.claimDeadline) {
            b.status = Status.Refunded;
        }

        if (b.status != Status.Refunded) {
            if (b.status == Status.Open) revert ClaimDeadlineNotPassed();
            revert PledgeLocked();
        }

        uint256 amount = pledges[bountyId][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pledges[bountyId][msg.sender] = 0;
        b.totalPledged -= amount;

        USDC.safeTransfer(msg.sender, amount);
        emit PledgeWithdrawn(bountyId, msg.sender, amount);
    }

    // ─── 14. withdrawReward ──────────────────────────────────────────────────

    /// @notice Reviewer pulls their accrued rewards.
    function withdrawReward() external {
        _withdrawReward(msg.sender);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Records a pledge and tracks the pledger address for panel exclusion.
    function _recordPledge(uint256 bountyId, address pledger, uint256 amount) private {
        if (pledges[bountyId][pledger] == 0) {
            _pledgers[bountyId].push(pledger);
        }
        pledges[bountyId][pledger] += amount;
    }

    /// @dev Clears the worker and evidence so another worker can claim the bounty.
    function _reopen(uint256 bountyId, Bounty storage b, bool blockWorker) private {
        address previous = b.worker;
        if (blockWorker && previous != address(0)) blockedWorker[bountyId][previous] = true;

        b.worker              = address(0);
        b.visualChallengeCode = 0;
        b.arkivEntityKey      = bytes32(0);
        b.evidenceHash        = bytes32(0);
        b.selectionBlock      = 0;
        b.workDeadline        = 0;
        b.reworkCount         = 0;
        b.reviewRound++;      // invalidates any panel or votes from the previous attempt
        b.status              = Status.Open;

        emit ClaimReleased(bountyId, previous, blockWorker);
    }

    /// @dev Returns a reviewer's stake after settlement; they must re-register to review again.
    function _releaseStake(address rev) private returns (uint256 stake) {
        stake = reviewers[rev].stakedAmount;
        reviewers[rev].stakedAmount = 0;
        reviewers[rev].active = false;
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function getPledgers(uint256 bountyId) external view returns (address[] memory) {
        return _pledgers[bountyId];
    }

    function getTally(uint256 bountyId) external view returns (uint8 revealed, uint8 approvals) {
        return _tally(bountyId, bounties[bountyId].reviewRound);
    }

    /// @notice Number of reviewers that could currently be drawn for this bounty's panel.
    function eligibleReviewerCount(uint256 bountyId) external view returns (uint256 count) {
        Bounty storage b = bounties[bountyId];
        (, count) = _eligibleReviewers(b.regionCell, b.creator, b.worker, _pledgers[bountyId]);
    }
}
