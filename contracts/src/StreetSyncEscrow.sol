// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  StreetSyncEscrow.sol
//  Main entry point integrating AttestationVerifier, ReviewerPool, VotingModule.
//
//  Lifecycle:
//    createBounty → pledge → claim → submitEvidence → (2 blocks) → assignPanel
//    → commitVote × 3 → revealVote × 3 → settle
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

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param usdcToken    ERC-20 USDC address (6 decimals).
    /// @param _attester    Backend EIP-712 signer address.
    /// @param _commitWindow Commit phase window in seconds (default 300).
    /// @param _revealWindow Reveal phase window in seconds (default 300).
    /// @param _claimDuration Seconds after claim() before evidence deadline (default 3600).
    constructor(
        address usdcToken,
        address _attester,
        uint256 _commitWindow,
        uint256 _revealWindow,
        uint256 _claimDuration
    )
        AttestationVerifier(_attester)
        ReviewerPool(usdcToken)
        Ownable(msg.sender)
    {
        commitWindow  = _commitWindow;
        revealWindow  = _revealWindow;
        claimDuration = _claimDuration;
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

    // ─── 1. createBounty ──────────────────────────────────────────────────────

    /// @notice Creates a bounty and deposits `initialAmount` USDC into escrow.
    /// @param descHash      keccak256 of the off-chain description string.
    /// @param latE5         Latitude × 1e5 (integer).
    /// @param lngE5         Longitude × 1e5 (integer).
    /// @param regionCell    H3 cell index for reviewer routing.
    /// @param initialAmount Initial pledge in 6-decimal USDC (must be > 0).
    /// @param _claimDeadline Unix timestamp by which a worker must have completed the fix.
    /// @return bountyId     Assigned bounty ID.
    function createBounty(
        bytes32 descHash,
        int32   latE5,
        int32   lngE5,
        uint16  regionCell,
        uint256 initialAmount,
        uint64  _claimDeadline
    ) external returns (uint256 bountyId) {
        if (initialAmount == 0) revert ZeroAmount();
        if (_claimDeadline <= block.timestamp) revert InvalidDeadline();

        bountyId = nextBountyId++;

        bounties[bountyId] = Bounty({
            id:                 bountyId,
            creator:            msg.sender,
            descriptionHash:    descHash,
            latE5:              latE5,
            lngE5:              lngE5,
            regionCell:         regionCell,
            totalPledged:       initialAmount,
            createdAt:          uint64(block.timestamp),
            claimDeadline:      _claimDeadline,
            worker:             address(0),
            visualChallengeCode: 0,
            arkivEntityKey:     bytes32(0),
            evidenceHash:       bytes32(0),
            selectionBlock:     0,
            reviewRound:        0,
            reworkCount:        0,
            status:             Status.Open
        });

        // Record the creator as a pledger so they're excluded from panel selection (Rule 2)
        _recordPledge(bountyId, msg.sender, initialAmount);

        USDC.safeTransferFrom(msg.sender, address(this), initialAmount);

        emit BountyCreated(
            bountyId, msg.sender, descHash, latE5, lngE5, regionCell, initialAmount, _claimDeadline
        );
    }

    // ─── 2. pledge ────────────────────────────────────────────────────────────

    /// @notice Add USDC to an open bounty's escrow.
    function pledge(uint256 bountyId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert WrongStatus(Status.Open, b.status);

        _recordPledge(bountyId, msg.sender, amount);
        b.totalPledged += amount;

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Pledged(bountyId, msg.sender, amount, b.totalPledged);
    }

    // ─── 3. claim ─────────────────────────────────────────────────────────────

    /// @notice World-ID-verified worker claims the bounty.
    ///         Emits a 4-digit visual challenge code (Rule 6).
    ///         Anti-wash-trading: creator and any pledger cannot claim (Rule 2).
    function claim(
        uint256        bountyId,
        uint256        nonce,
        uint64         expiry,
        bytes calldata attestationSig
    ) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Open) revert WrongStatus(Status.Open, b.status);
        if (block.timestamp > b.claimDeadline) revert ClaimExpired();

        // Rule 2: anti-wash-trading
        if (msg.sender == b.creator) revert CreatorCannotClaim();
        if (pledges[bountyId][msg.sender] > 0) revert PledgerCannotClaim();

        // Rule 5: verify Worker attestation for this bounty
        _verifyAttestation(msg.sender, Role.Worker, bountyId, nonce, expiry, attestationSig);

        // Rule 6: 4-digit visual challenge code (1000–9999)
        uint16 code = uint16(
            uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), bountyId, msg.sender)))
            % 9000 + 1000
        );

        b.worker             = msg.sender;
        b.visualChallengeCode = code;
        b.status             = Status.Claimed;
        // Reset claim deadline to now + claimDuration so worker has time to do the work
        b.claimDeadline      = uint64(block.timestamp + claimDuration);

        emit BountyClaimed(bountyId, msg.sender, code);
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
            selBlock = b.selectionBlock;
            // Still return; caller must wait 2 more blocks
            revert SelectionBlockNotReached();
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
    ///         Rejected: escrow stays; rework() available once.
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

        if (approved) {
            // 90% → worker
            uint256 workerPayout = (pool * 9000) / BPS_DENOMINATOR;
            // 10% → majority reviewers (split equally) + slashed minority stakes
            uint256 reviewerPool_ = pool - workerPayout + slashedFromMinority;
            uint256 perReviewer   = majorityCount > 0 ? reviewerPool_ / majorityCount : 0;

            b.status = Status.Approved;

            // Pay worker
            USDC.safeTransfer(b.worker, workerPayout);

            // Credit majority reviewers (pull-based) + return their stakes
            for (uint256 i = 0; i < majorityCount; ) {
                address rev = majority[i];
                uint256 stakeToReturn = REVIEWER_STAKE; // return original stake
                _creditReward(rev, perReviewer);
                // Transfer stake back directly (reviewer may have been slashed already, guard)
                if (reviewers[rev].stakedAmount > 0) {
                    uint256 stake = reviewers[rev].stakedAmount;
                    reviewers[rev].stakedAmount = 0;
                    USDC.safeTransfer(rev, stake);
                } else {
                    // Stake was already zeroed; still return the nominal REVIEWER_STAKE from pool
                    // This handles the case where majority reviewer's stake counter was used
                    stakeToReturn = 0;
                }
                unchecked { ++i; }
            }

            emit BountySettled(bountyId, true, workerPayout, perReviewer);
        } else {
            // Rejected — distribute slashed minority stakes to majority + return majority stakes
            uint256 perReviewer = majorityCount > 0 ? slashedFromMinority / majorityCount : 0;

            if (b.reworkCount >= MAX_REWORK) {
                // No rework left → Refunded so pledgers can withdraw
                b.status = Status.Refunded;
            } else {
                b.status = Status.Rejected;
            }

            // Credit majority reviewers with slashed portion
            for (uint256 i = 0; i < majorityCount; ) {
                address rev = majority[i];
                _creditReward(rev, perReviewer);
                // Return majority stake
                if (reviewers[rev].stakedAmount > 0) {
                    uint256 stake = reviewers[rev].stakedAmount;
                    reviewers[rev].stakedAmount = 0;
                    USDC.safeTransfer(rev, stake);
                }
                unchecked { ++i; }
            }

            emit BountySettled(bountyId, false, 0, perReviewer);
        }
    }

    // ─── 10. rework ──────────────────────────────────────────────────────────

    /// @notice Worker requests a rework after rejection (max 1 rework).
    ///         Reopens the bounty to Claimed status so they can re-submit evidence.
    function rework(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (b.status != Status.Rejected) revert WrongStatus(Status.Rejected, b.status);
        if (msg.sender != b.worker) revert NotWorker();
        if (b.reworkCount >= MAX_REWORK) revert ReworkLimitReached();

        b.reworkCount++;
        b.status       = Status.Claimed; // Worker can now re-submitEvidence
        b.selectionBlock = 0;
        b.reviewRound++;                 // New round prevents vote replay

        emit BountyReworked(bountyId, b.reworkCount);
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
        // Slashed stakes stay in escrow to be distributed in settle()

        // Increment round and select new panel (Rule 3)
        b.reviewRound++;
        b.selectionBlock = block.number + 2;
        b.status         = Status.Submitted; // Reverts to Submitted so assignPanel can be called

        emit PokeOrReplace(bountyId, b.reviewRound, totalSlashed);
    }

    // ─── 12. withdrawPledge ──────────────────────────────────────────────────

    /// @notice Pull-based pledge refund when bounty expires without completion
    ///         or is in Rejected/Refunded state past deadline.
    function withdrawPledge(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];

        bool canWithdraw = (b.status == Status.Open || b.status == Status.Refunded) ||
                           (b.status == Status.Rejected && b.reworkCount >= MAX_REWORK);

        if (!canWithdraw) {
            // Also allow if claim deadline passed and bounty is still Open
            if (!(b.status == Status.Open && block.timestamp > b.claimDeadline)) {
                revert ClaimDeadlineNotPassed();
            }
        }

        if (b.status == Status.Open && block.timestamp <= b.claimDeadline) {
            revert ClaimDeadlineNotPassed();
        }

        uint256 amount = pledges[bountyId][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pledges[bountyId][msg.sender] = 0;
        b.totalPledged -= amount;

        USDC.safeTransfer(msg.sender, amount);
        emit PledgeWithdrawn(bountyId, msg.sender, amount);
    }

    // ─── 13. withdrawReward ──────────────────────────────────────────────────

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
}
