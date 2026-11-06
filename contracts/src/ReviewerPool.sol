// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  ReviewerPool.sol
//  Manages reviewer registration, staking (2.00 USDC, 6-decimal), active-pool
//  storage by regionCell, stake slashing, reward crediting, and deterministic
//  pseudo-random panel selection.
//
//  Panel selection rules (Rule 2 + Rule 4):
//   • Excludes bounty.creator, bounty.worker, and any pledger.
//   • Deterministic seed: keccak256(blockhash(selectionBlock) || bountyId || reviewRound)
//   • Fisher-Yates partial shuffle over the region-filtered active list.
// ─────────────────────────────────────────────────────────────────────────────

import "./StreetSyncTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract ReviewerPool {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant REVIEWER_STAKE   = 2_000_000; // 2.00 USDC (6 decimals)

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable USDC;

    /// @notice All registered reviewers by their wallet address.
    mapping(address => Reviewer) public reviewers;

    /// @notice Ordered list of reviewer addresses per regionCell.
    ///         Elements are never removed; `active` flag gates eligibility.
    mapping(uint16 => address[]) internal _poolByRegion;

    /// @notice Index of a reviewer inside _poolByRegion[regionCell] (1-based; 0 = not present).
    mapping(uint16 => mapping(address => uint256)) internal _poolIndex;

    /// @notice Every reviewer ever registered; used when a region has too few eligible reviewers.
    address[] internal _allReviewers;
    mapping(address => bool) internal _inAllReviewers;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address usdcToken) {
        if (usdcToken == address(0)) revert Unauthorized();
        USDC = IERC20(usdcToken);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /// @dev Called by StreetSyncEscrow.registerReviewer after attestation is verified.
    function _registerReviewer(address wallet, uint16 regionCell) internal {
        if (reviewers[wallet].active) revert AlreadyRegistered();

        USDC.safeTransferFrom(wallet, address(this), REVIEWER_STAKE);

        Reviewer storage r = reviewers[wallet];
        // Re-registration keeps any unclaimed rewards.
        r.wallet       = wallet;
        r.regionCell   = regionCell;
        r.stakedAmount = REVIEWER_STAKE;
        r.active       = true;

        if (_poolIndex[regionCell][wallet] == 0) {
            _poolByRegion[regionCell].push(wallet);
            _poolIndex[regionCell][wallet] = _poolByRegion[regionCell].length; // 1-based
        }
        if (!_inAllReviewers[wallet]) {
            _inAllReviewers[wallet] = true;
            _allReviewers.push(wallet);
        }

        emit ReviewerRegistered(wallet, regionCell, REVIEWER_STAKE);
    }

    // ─── Panel Selection ──────────────────────────────────────────────────────

    /// @dev Selects exactly PANEL_SIZE reviewers from the active pool for `regionCell`,
    ///      excluding `creator`, `worker`, and any address in `excludePledgers`.
    ///      Uses a Fisher-Yates partial shuffle seeded with `seed`.
    ///
    ///      Reverts with {InsufficientReviewers} if fewer than PANEL_SIZE eligible
    ///      reviewers exist after exclusions.
    function _selectPanel(
        uint16   regionCell,
        bytes32  seed,
        address  creator,
        address  worker,
        address[] memory excludePledgers
    ) internal view returns (address[3] memory panel) {
        (address[] memory arr, uint256 eligibleCount) =
            _eligibleReviewers(regionCell, creator, worker, excludePledgers);
        if (eligibleCount < PANEL_SIZE) revert InsufficientReviewers();

        // Fisher-Yates partial shuffle for PANEL_SIZE picks
        for (uint256 i = 0; i < PANEL_SIZE; ) {
            uint256 j = i + uint256(keccak256(abi.encodePacked(seed, i))) % (eligibleCount - i);
            address tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
            panel[i] = arr[i];
            unchecked { ++i; }
        }
    }

    /// @dev Eligible reviewers from the bounty's region, or from every registered
    ///      reviewer when the region alone cannot fill a panel.
    function _eligibleReviewers(
        uint16   regionCell,
        address  creator,
        address  worker,
        address[] memory excludePledgers
    ) internal view returns (address[] memory eligible, uint256 count) {
        (eligible, count) = _filterEligible(_poolByRegion[regionCell], creator, worker, excludePledgers);
        if (count < PANEL_SIZE) {
            (eligible, count) = _filterEligible(_allReviewers, creator, worker, excludePledgers);
        }
    }

    function _filterEligible(
        address[] storage pool,
        address  creator,
        address  worker,
        address[] memory excludePledgers
    ) private view returns (address[] memory eligible, uint256 count) {
        uint256 poolLen = pool.length;
        eligible = new address[](poolLen);
        for (uint256 i = 0; i < poolLen; ) {
            address candidate = pool[i];
            if (
                reviewers[candidate].active &&
                candidate != creator &&
                candidate != worker &&
                !_isPledger(candidate, excludePledgers)
            ) {
                eligible[count] = candidate;
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
    }

    /// @dev Returns true if `addr` appears in the `pledgers` array.
    function _isPledger(address addr, address[] memory pledgers) private pure returns (bool) {
        for (uint256 i = 0; i < pledgers.length; ) {
            if (pledgers[i] == addr) return true;
            unchecked { ++i; }
        }
        return false;
    }

    // ─── Stake Management ─────────────────────────────────────────────────────

    /// @dev Slashes the full stake of a reviewer who failed to reveal.
    ///      Marks them inactive and returns the slashed amount.
    function _slashReviewer(address wallet) internal returns (uint256 slashed) {
        Reviewer storage r = reviewers[wallet];
        slashed = r.stakedAmount;
        r.stakedAmount  = 0;
        r.active        = false;
        emit ReviewerSlashed(0, wallet, slashed); // bountyId threaded in by caller
    }

    /// @dev Slashes a reviewer for a specific bounty, emitting the bounty ID.
    function _slashReviewerForBounty(address wallet, uint256 bountyId) internal returns (uint256 slashed) {
        Reviewer storage r = reviewers[wallet];
        slashed = r.stakedAmount;
        r.stakedAmount  = 0;
        r.active        = false;
        emit ReviewerSlashed(bountyId, wallet, slashed);
    }

    /// @dev Credits a reward to a reviewer's on-chain balance (pull-based payout).
    function _creditReward(address wallet, uint256 amount) internal {
        reviewers[wallet].rewardBalance += amount;
        emit ReviewerRewardCredited(wallet, amount);
    }

    /// @dev Returns the stake to a majority reviewer after successful settlement.
    ///      Does NOT transfer USDC here — transfer is batched in settle().
    function _returnStake(address wallet) internal {
        // Stake already tracked; caller (settle) issues the transfer.
        // Reset stakedAmount so the reviewer can re-register cleanly.
        reviewers[wallet].stakedAmount = 0;
    }

    // ─── Reward Withdrawal ────────────────────────────────────────────────────

    /// @dev Sends accrued rewards to the caller. Called from StreetSyncEscrow.
    function _withdrawReward(address wallet) internal {
        uint256 amount = reviewers[wallet].rewardBalance;
        if (amount == 0) revert NothingToWithdraw();
        reviewers[wallet].rewardBalance = 0;
        USDC.safeTransfer(wallet, amount);
        emit RewardWithdrawn(wallet, amount);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Returns the number of addresses registered in a region pool (active or not).
    function poolSize(uint16 regionCell) external view returns (uint256) {
        return _poolByRegion[regionCell].length;
    }

    /// @notice Total number of reviewers ever registered (active or not).
    function totalReviewers() external view returns (uint256) {
        return _allReviewers.length;
    }

    /// @notice Returns all addresses registered in a region pool.
    function poolAddresses(uint16 regionCell) external view returns (address[] memory) {
        return _poolByRegion[regionCell];
    }
}
