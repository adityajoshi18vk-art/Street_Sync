// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  VotingModule.sol
//  Commit-reveal voting logic for the StreetSync reviewer panel.
//
//  Commit phase:
//    voteHash = keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter))
//
//  Reveal phase:
//    Verify preimage, store vote, count approvals/rejections.
//
//  Quorum: 2 of 3 revealed votes required.
//  Majority: >= 2 approvals → Approved; otherwise → Rejected.
//
//  pokeOrReplace (Rule 3):
//    After revealDeadline, if revealedCount < QUORUM, any caller may invoke
//    pokeOrReplace to slash non-revealers, increment reviewRound, and trigger
//    a new panel selection (without re-uploading evidence).
// ─────────────────────────────────────────────────────────────────────────────

import "./StreetSyncTypes.sol";

abstract contract VotingModule {

    // ─── Per-bounty voting state ──────────────────────────────────────────────

    /// @dev Assigned panel for each bounty (by review round).
    ///      panel[bountyId][reviewRound] → address[3]
    mapping(uint256 => mapping(uint8 => address[3])) internal _panel;

    /// @dev Vote commit/reveal state per bounty × reviewRound × reviewer.
    mapping(uint256 => mapping(uint8 => mapping(address => VoteCommit))) internal _votes;

    /// @dev Number of commits recorded for a given bounty × reviewRound.
    mapping(uint256 => mapping(uint8 => uint8)) internal _commitCount;

    /// @dev Number of reveals recorded for a given bounty × reviewRound.
    mapping(uint256 => mapping(uint8 => uint8)) internal _revealCount;

    /// @dev Number of approvals revealed for a given bounty × reviewRound.
    mapping(uint256 => mapping(uint8 => uint8)) internal _approveCount;

    /// @dev Commit phase deadline (unix timestamp).
    mapping(uint256 => uint64) public commitDeadline;

    /// @dev Reveal phase deadline (unix timestamp).
    mapping(uint256 => uint64) public revealDeadline;

    // ─── Configurable windows (set in StreetSyncEscrow constructor) ───────────

    uint256 public commitWindow; // seconds
    uint256 public revealWindow; // seconds

    // ─── Internal: set panel + timers ─────────────────────────────────────────

    /// @dev Records a newly selected panel and resets deadlines.
    function _setPanelAndTimers(
        uint256   bountyId,
        uint8     reviewRound,
        address[3] memory panel
    ) internal {
        _panel[bountyId][reviewRound] = panel;
        commitDeadline[bountyId] = uint64(block.timestamp + commitWindow);
        revealDeadline[bountyId] = uint64(block.timestamp + commitWindow + revealWindow);
    }

    // ─── Commit ───────────────────────────────────────────────────────────────

    /// @dev Records a vote commitment from a panel member.
    ///      Reverts if: not a panel member, commit window closed, already committed.
    function _commitVote(
        uint256 bountyId,
        uint8   reviewRound,
        address voter,
        bytes32 voteHash
    ) internal {
        // Must be within commit window
        if (block.timestamp > commitDeadline[bountyId]) revert CommitWindowClosed();

        // Must be a panel member
        if (!_isPanelMember(bountyId, reviewRound, voter)) revert NotPanelMember();

        VoteCommit storage vc = _votes[bountyId][reviewRound][voter];
        if (vc.committed) revert AlreadyCommitted();

        vc.commitHash = voteHash;
        vc.committed  = true;
        _commitCount[bountyId][reviewRound]++;

        emit VoteCommitted(bountyId, voter, voteHash);
    }

    // ─── Reveal ───────────────────────────────────────────────────────────────

    /// @dev Verifies the preimage and records the revealed vote.
    ///      Reverts if: not panel member, in commit window still (too early to reveal),
    ///      already revealed, or hash mismatch.
    function _revealVote(
        uint256 bountyId,
        uint8   reviewRound,
        address voter,
        bool    approve,
        bytes32 salt
    ) internal {
        // Reveal window: after commit deadline, before reveal deadline
        if (block.timestamp <= commitDeadline[bountyId]) revert RevealWindowNotOpen();
        if (block.timestamp > revealDeadline[bountyId])  revert CommitWindowClosed(); // reuse "closed" for expired

        if (!_isPanelMember(bountyId, reviewRound, voter)) revert NotPanelMember();

        VoteCommit storage vc = _votes[bountyId][reviewRound][voter];
        if (!vc.committed)  revert NotPanelMember(); // committed but not found is an error too
        if (vc.revealed)    revert AlreadyRevealed();

        // Verify preimage
        bytes32 expected = keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter));
        if (vc.commitHash != expected) revert VoteHashMismatch();

        vc.revealed = true;
        vc.approve  = approve;
        _revealCount[bountyId][reviewRound]++;
        if (approve) _approveCount[bountyId][reviewRound]++;

        emit VoteRevealed(bountyId, voter, approve);
    }

    // ─── Tally helpers ────────────────────────────────────────────────────────

    /// @dev Returns (revealedCount, approveCount) for a bounty × reviewRound.
    function _tally(uint256 bountyId, uint8 reviewRound)
        internal view returns (uint8 revealed, uint8 approvals)
    {
        revealed  = _revealCount[bountyId][reviewRound];
        approvals = _approveCount[bountyId][reviewRound];
    }

    /// @dev Returns true if quorum was reached AND majority approved.
    function _isApproved(uint256 bountyId, uint8 reviewRound) internal view returns (bool) {
        (uint8 revealed, uint8 approvals) = _tally(bountyId, reviewRound);
        return revealed >= QUORUM && approvals >= QUORUM;
    }

    /// @dev Returns true if quorum was reached AND majority rejected.
    function _isRejected(uint256 bountyId, uint8 reviewRound) internal view returns (bool) {
        (uint8 revealed, uint8 approvals) = _tally(bountyId, reviewRound);
        return revealed >= QUORUM && (revealed - approvals) >= QUORUM;
    }

    /// @dev Returns true if quorum is met (approved OR rejected).
    function _quorumMet(uint256 bountyId, uint8 reviewRound) internal view returns (bool) {
        return _revealCount[bountyId][reviewRound] >= QUORUM;
    }

    // ─── Panel-member helpers ─────────────────────────────────────────────────

    function _isPanelMember(uint256 bountyId, uint8 reviewRound, address addr)
        internal view returns (bool)
    {
        address[3] storage p = _panel[bountyId][reviewRound];
        return addr == p[0] || addr == p[1] || addr == p[2];
    }

    /// @dev Returns the full panel for a given bounty × reviewRound.
    function getPanel(uint256 bountyId, uint8 reviewRound)
        external view returns (address[3] memory)
    {
        return _panel[bountyId][reviewRound];
    }

    /// @dev Returns the VoteCommit state for a reviewer.
    function getVote(uint256 bountyId, uint8 reviewRound, address reviewer)
        external view returns (VoteCommit memory)
    {
        return _votes[bountyId][reviewRound][reviewer];
    }

    // ─── Non-revealer enumeration (for pokeOrReplace and settle) ─────────────

    /// @dev Returns addresses of panel members who did NOT reveal their vote.
    function _nonRevealers(uint256 bountyId, uint8 reviewRound)
        internal view returns (address[] memory nonRevealerList, uint256 count)
    {
        address[3] storage p = _panel[bountyId][reviewRound];
        nonRevealerList = new address[](PANEL_SIZE);
        for (uint8 i = 0; i < PANEL_SIZE; ) {
            if (!_votes[bountyId][reviewRound][p[i]].revealed) {
                nonRevealerList[count] = p[i];
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
    }

    /// @dev Returns addresses of panel members who revealed their vote.
    function _revealers(uint256 bountyId, uint8 reviewRound)
        internal view returns (address[] memory revealerList, uint256 count)
    {
        address[3] storage p = _panel[bountyId][reviewRound];
        revealerList = new address[](PANEL_SIZE);
        for (uint8 i = 0; i < PANEL_SIZE; ) {
            if (_votes[bountyId][reviewRound][p[i]].revealed) {
                revealerList[count] = p[i];
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }
    }

    /// @dev Returns lists of majority and minority voters based on revealed approvals.
    ///      majority = those whose vote matches the plurality outcome.
    function _splitMajorityMinority(uint256 bountyId, uint8 reviewRound, bool approved)
        internal view
        returns (
            address[] memory majority,
            uint256          majorityCount,
            address[] memory minority,
            uint256          minorityCount
        )
    {
        address[3] storage p = _panel[bountyId][reviewRound];
        majority = new address[](PANEL_SIZE);
        minority = new address[](PANEL_SIZE);
        for (uint8 i = 0; i < PANEL_SIZE; ) {
            VoteCommit storage vc = _votes[bountyId][reviewRound][p[i]];
            if (vc.revealed) {
                if (vc.approve == approved) {
                    majority[majorityCount] = p[i];
                    unchecked { ++majorityCount; }
                } else {
                    minority[minorityCount] = p[i];
                    unchecked { ++minorityCount; }
                }
            }
            unchecked { ++i; }
        }
    }
}
