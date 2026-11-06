// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title JanLekha — public audit trail for budgets and procurement
/// @notice Records hashes, deadlines and approvals only. No token, HBAR or INR moves
///         through this contract; all monetary values are unsigned integer paise.
/// @dev Stage 1: roles, projects, one tender per project, sealed-bid commit/reveal.
///      Phase windows (half-open intervals on block.timestamp):
///        commit: [publishedAt, bidDeadline)
///        reveal: [bidDeadline, revealDeadline)
contract JanLekha is AccessControl {
    bytes32 public constant DEPARTMENT_ROLE = keccak256("DEPARTMENT_ROLE");
    bytes32 public constant VENDOR_ROLE = keccak256("VENDOR_ROLE");
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");
    bytes32 public constant PAO_ROLE = keccak256("PAO_ROLE");

    struct Project {
        uint256 id;
        address department;
        bytes32 sanctionDocumentHash; // SHA-256
        uint256 allocationPaise;
        uint64 createdAt;
    }

    struct Tender {
        bytes32 tenderDocumentHash; // SHA-256
        uint64 bidDeadline;
        uint64 revealDeadline;
        uint64 publishedAt;
        uint32 commitCount;
        uint32 revealCount;
    }

    struct Bid {
        bytes32 commitment; // keccak256(abi.encode(projectId, vendor, amountPaise, quotationDocumentHash, salt))
        uint64 committedAt;
        bool revealed;
        uint64 revealedAt;
        uint256 amountPaise;
        bytes32 quotationDocumentHash; // SHA-256
    }

    uint256 public projectCount;

    mapping(uint256 projectId => Project) private _projects;
    mapping(uint256 projectId => Tender) private _tenders;
    mapping(uint256 projectId => mapping(address vendor => Bid)) private _bids;
    mapping(uint256 projectId => address[]) private _bidders;

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed department,
        bytes32 sanctionDocumentHash,
        uint256 allocationPaise
    );
    event TenderPublished(
        uint256 indexed projectId,
        bytes32 tenderDocumentHash,
        uint64 bidDeadline,
        uint64 revealDeadline
    );
    event BidCommitted(uint256 indexed projectId, address indexed vendor, bytes32 commitment);
    event BidRevealed(
        uint256 indexed projectId,
        address indexed vendor,
        uint256 amountPaise,
        bytes32 quotationDocumentHash
    );

    error ZeroAddress();
    error UnknownProject(uint256 projectId);
    error NotProjectDepartment(uint256 projectId, address caller);
    error InvalidDocumentHash();
    error InvalidAllocation();
    error InvalidDeadlines();
    error TenderAlreadyPublished(uint256 projectId);
    error TenderNotPublished(uint256 projectId);
    error BiddingClosed(uint256 projectId);
    error InvalidCommitment();
    error AlreadyCommitted(uint256 projectId, address vendor);
    error RevealNotOpen(uint256 projectId);
    error RevealClosed(uint256 projectId);
    error NoCommitment(uint256 projectId, address vendor);
    error AlreadyRevealed(uint256 projectId, address vendor);
    error InvalidAmount();
    error CommitmentMismatch();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Department actions ─────────────────────────────────────────────────

    function createProject(bytes32 sanctionDocumentHash, uint256 allocationPaise)
        external
        onlyRole(DEPARTMENT_ROLE)
        returns (uint256 projectId)
    {
        if (sanctionDocumentHash == bytes32(0)) revert InvalidDocumentHash();
        if (allocationPaise == 0) revert InvalidAllocation();

        projectId = ++projectCount;
        _projects[projectId] = Project({
            id: projectId,
            department: msg.sender,
            sanctionDocumentHash: sanctionDocumentHash,
            allocationPaise: allocationPaise,
            createdAt: uint64(block.timestamp)
        });

        emit ProjectCreated(projectId, msg.sender, sanctionDocumentHash, allocationPaise);
    }

    /// @notice Only the department that created the project may publish its tender.
    function publishTender(
        uint256 projectId,
        bytes32 tenderDocumentHash,
        uint64 bidDeadline,
        uint64 revealDeadline
    ) external onlyRole(DEPARTMENT_ROLE) {
        Project storage project = _existingProject(projectId);
        if (project.department != msg.sender) revert NotProjectDepartment(projectId, msg.sender);
        if (_tenders[projectId].publishedAt != 0) revert TenderAlreadyPublished(projectId);
        if (tenderDocumentHash == bytes32(0)) revert InvalidDocumentHash();
        if (bidDeadline <= block.timestamp || revealDeadline <= bidDeadline) revert InvalidDeadlines();

        _tenders[projectId] = Tender({
            tenderDocumentHash: tenderDocumentHash,
            bidDeadline: bidDeadline,
            revealDeadline: revealDeadline,
            publishedAt: uint64(block.timestamp),
            commitCount: 0,
            revealCount: 0
        });

        emit TenderPublished(projectId, tenderDocumentHash, bidDeadline, revealDeadline);
    }

    // ─── Vendor actions ─────────────────────────────────────────────────────

    /// @dev Compute the commitment off-chain; never send the salt to an RPC node before reveal.
    function commitBid(uint256 projectId, bytes32 commitment) external onlyRole(VENDOR_ROLE) {
        Tender storage tender = _publishedTender(projectId);
        if (block.timestamp >= tender.bidDeadline) revert BiddingClosed(projectId);
        if (commitment == bytes32(0)) revert InvalidCommitment();

        Bid storage bid = _bids[projectId][msg.sender];
        if (bid.committedAt != 0) revert AlreadyCommitted(projectId, msg.sender);

        bid.commitment = commitment;
        bid.committedAt = uint64(block.timestamp);
        _bidders[projectId].push(msg.sender);
        tender.commitCount += 1;

        emit BidCommitted(projectId, msg.sender, commitment);
    }

    function revealBid(
        uint256 projectId,
        uint256 amountPaise,
        bytes32 quotationDocumentHash,
        bytes32 salt
    ) external onlyRole(VENDOR_ROLE) {
        Tender storage tender = _publishedTender(projectId);
        if (block.timestamp < tender.bidDeadline) revert RevealNotOpen(projectId);
        if (block.timestamp >= tender.revealDeadline) revert RevealClosed(projectId);

        Bid storage bid = _bids[projectId][msg.sender];
        if (bid.committedAt == 0) revert NoCommitment(projectId, msg.sender);
        if (bid.revealed) revert AlreadyRevealed(projectId, msg.sender);
        if (amountPaise == 0) revert InvalidAmount();
        if (quotationDocumentHash == bytes32(0)) revert InvalidDocumentHash();

        bytes32 expected = keccak256(
            abi.encode(projectId, msg.sender, amountPaise, quotationDocumentHash, salt)
        );
        if (expected != bid.commitment) revert CommitmentMismatch();

        bid.revealed = true;
        bid.revealedAt = uint64(block.timestamp);
        bid.amountPaise = amountPaise;
        bid.quotationDocumentHash = quotationDocumentHash;
        tender.revealCount += 1;

        emit BidRevealed(projectId, msg.sender, amountPaise, quotationDocumentHash);
    }

    // ─── Public getters ─────────────────────────────────────────────────────

    function getProject(uint256 projectId) external view returns (Project memory) {
        return _existingProject(projectId);
    }

    /// @dev Returns a zeroed struct (publishedAt == 0) when no tender is published yet.
    function getTender(uint256 projectId) external view returns (Tender memory) {
        _existingProject(projectId);
        return _tenders[projectId];
    }

    function getBid(uint256 projectId, address vendor) external view returns (Bid memory) {
        _existingProject(projectId);
        return _bids[projectId][vendor];
    }

    function getBidders(uint256 projectId) external view returns (address[] memory) {
        _existingProject(projectId);
        return _bidders[projectId];
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _existingProject(uint256 projectId) private view returns (Project storage project) {
        project = _projects[projectId];
        if (project.id == 0) revert UnknownProject(projectId);
    }

    function _publishedTender(uint256 projectId) private view returns (Tender storage tender) {
        _existingProject(projectId);
        tender = _tenders[projectId];
        if (tender.publishedAt == 0) revert TenderNotPublished(projectId);
    }
}
