// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title JanLekha — public audit trail for budgets and procurement
/// @notice Records hashes, deadlines and approvals only. No token, HBAR or INR moves
///         through this contract; all monetary values are unsigned integer paise.
/// @dev Phase windows (half-open intervals on block.timestamp):
///        commit: [publishedAt, bidDeadline)
///        reveal: [bidDeadline, revealDeadline)
///        award:  [revealDeadline, ∞), once
///      Milestone lifecycle: Defined → EvidenceSubmitted → Approved → Paid.
///      Budget invariant: reserved + paid <= allocation, and reserved + paid == award amount
///      once awarded (payment attestation moves paise from reserved to paid).
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

    enum MilestoneStatus {
        None,
        Defined,
        EvidenceSubmitted,
        Approved,
        Paid
    }

    struct Award {
        address vendor;
        uint256 amountPaise; // copied from the vendor's revealed bid, never caller-supplied
        bytes32 evaluationDocumentHash; // SHA-256
        bytes32 contractDocumentHash; // SHA-256
        uint64 awardedAt;
        uint32 milestoneCount;
        uint256 milestoneTotalPaise;
    }

    struct Budget {
        uint256 allocationPaise;
        uint256 reservedPaise; // awarded, not yet attested as paid
        uint256 paidPaise; // sum of mock PFMS payment attestations
    }

    struct Milestone {
        uint256 amountPaise;
        bytes32 specificationDocumentHash; // SHA-256
        MilestoneStatus status;
        uint64 definedAt;
        bytes32 evidenceDocumentHash; // SHA-256
        uint64 evidenceSubmittedAt;
        address inspector;
        bytes32 inspectionReportHash; // SHA-256
        uint64 approvedAt;
        address pao;
        bytes32 paymentReferenceHash; // SHA-256 of the mock PFMS payment advice
        uint64 paidAt;
    }

    uint256 public projectCount;

    mapping(uint256 projectId => Project) private _projects;
    mapping(uint256 projectId => Tender) private _tenders;
    mapping(uint256 projectId => mapping(address vendor => Bid)) private _bids;
    mapping(uint256 projectId => address[]) private _bidders;
    mapping(uint256 projectId => Award) private _awards;
    mapping(uint256 projectId => mapping(uint256 milestoneId => Milestone)) private _milestones;
    mapping(uint256 projectId => uint256) private _reservedPaise;
    mapping(uint256 projectId => uint256) private _paidPaise;

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
    event ContractAwarded(
        uint256 indexed projectId,
        address indexed vendor,
        uint256 amountPaise,
        bytes32 evaluationDocumentHash,
        bytes32 contractDocumentHash
    );
    event MilestoneDefined(
        uint256 indexed projectId,
        uint256 indexed milestoneId,
        uint256 amountPaise,
        bytes32 specificationDocumentHash
    );
    event MilestoneEvidenceSubmitted(
        uint256 indexed projectId,
        uint256 indexed milestoneId,
        address indexed vendor,
        bytes32 evidenceDocumentHash
    );
    event MilestoneApproved(
        uint256 indexed projectId,
        uint256 indexed milestoneId,
        address indexed inspector,
        bytes32 inspectionReportHash
    );
    /// @notice A mock PFMS payment attestation. No funds move on-chain.
    event MockPaymentAttested(
        uint256 indexed projectId,
        uint256 indexed milestoneId,
        address indexed pao,
        address vendor,
        uint256 amountPaise,
        bytes32 paymentReferenceHash
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
    error AwardNotOpen(uint256 projectId);
    error AlreadyAwarded(uint256 projectId);
    error NotAwarded(uint256 projectId);
    error BidNotRevealed(uint256 projectId, address vendor);
    error VendorNotEligible(address vendor);
    error AwardExceedsAllocation(uint256 projectId, uint256 amountPaise, uint256 allocationPaise);
    error MilestoneExceedsAward(uint256 projectId, uint256 milestoneTotalPaise, uint256 awardPaise);
    error UnknownMilestone(uint256 projectId, uint256 milestoneId);
    error NotAwardedVendor(uint256 projectId, address caller);
    error EvidenceAlreadySubmitted(uint256 projectId, uint256 milestoneId);
    error EvidenceNotSubmitted(uint256 projectId, uint256 milestoneId);
    error MilestoneAlreadyApproved(uint256 projectId, uint256 milestoneId);
    error MilestoneNotApproved(uint256 projectId, uint256 milestoneId);
    error PaymentAlreadyAttested(uint256 projectId, uint256 milestoneId);
    error PaymentAmountMismatch(uint256 expectedPaise, uint256 attestedPaise);
    /// @dev An account holding several roles may not act on its own work (e.g. inspect its own milestone).
    error ConflictOfInterest(address account);

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

    // ─── Award and delivery ─────────────────────────────────────────────────

    /// @notice Awards the tender to a vendor whose bid was revealed. The award amount is
    ///         taken from that revealed bid and reserved against the project allocation.
    function awardContract(
        uint256 projectId,
        address vendor,
        bytes32 evaluationDocumentHash,
        bytes32 contractDocumentHash
    ) external onlyRole(DEPARTMENT_ROLE) {
        Project storage project = _ownedProject(projectId);
        Tender storage tender = _publishedTender(projectId);
        if (block.timestamp < tender.revealDeadline) revert AwardNotOpen(projectId);

        Award storage award = _awards[projectId];
        if (award.awardedAt != 0) revert AlreadyAwarded(projectId);
        if (evaluationDocumentHash == bytes32(0) || contractDocumentHash == bytes32(0)) {
            revert InvalidDocumentHash();
        }

        Bid storage bid = _bids[projectId][vendor];
        if (!bid.revealed) revert BidNotRevealed(projectId, vendor);
        // A vendor de-registered after revealing must not receive an award.
        if (!hasRole(VENDOR_ROLE, vendor)) revert VendorNotEligible(vendor);

        uint256 amountPaise = bid.amountPaise;
        if (_reservedPaise[projectId] + _paidPaise[projectId] + amountPaise > project.allocationPaise) {
            revert AwardExceedsAllocation(projectId, amountPaise, project.allocationPaise);
        }

        award.vendor = vendor;
        award.amountPaise = amountPaise;
        award.evaluationDocumentHash = evaluationDocumentHash;
        award.contractDocumentHash = contractDocumentHash;
        award.awardedAt = uint64(block.timestamp);
        _reservedPaise[projectId] += amountPaise;

        emit ContractAwarded(projectId, vendor, amountPaise, evaluationDocumentHash, contractDocumentHash);
    }

    function defineMilestone(uint256 projectId, uint256 amountPaise, bytes32 specificationDocumentHash)
        external
        onlyRole(DEPARTMENT_ROLE)
        returns (uint256 milestoneId)
    {
        _ownedProject(projectId);
        Award storage award = _existingAward(projectId);
        if (amountPaise == 0) revert InvalidAmount();
        if (specificationDocumentHash == bytes32(0)) revert InvalidDocumentHash();

        uint256 newTotal = award.milestoneTotalPaise + amountPaise;
        if (newTotal > award.amountPaise) {
            revert MilestoneExceedsAward(projectId, newTotal, award.amountPaise);
        }
        award.milestoneTotalPaise = newTotal;
        milestoneId = ++award.milestoneCount;

        Milestone storage milestone = _milestones[projectId][milestoneId];
        milestone.amountPaise = amountPaise;
        milestone.specificationDocumentHash = specificationDocumentHash;
        milestone.status = MilestoneStatus.Defined;
        milestone.definedAt = uint64(block.timestamp);

        emit MilestoneDefined(projectId, milestoneId, amountPaise, specificationDocumentHash);
    }

    /// @notice Only the awarded vendor may submit evidence, once per milestone.
    function submitMilestoneEvidence(uint256 projectId, uint256 milestoneId, bytes32 evidenceDocumentHash)
        external
        onlyRole(VENDOR_ROLE)
    {
        Award storage award = _existingAward(projectId);
        if (msg.sender != award.vendor) revert NotAwardedVendor(projectId, msg.sender);
        Milestone storage milestone = _existingMilestone(projectId, milestoneId);
        if (milestone.status != MilestoneStatus.Defined) {
            revert EvidenceAlreadySubmitted(projectId, milestoneId);
        }
        if (evidenceDocumentHash == bytes32(0)) revert InvalidDocumentHash();

        milestone.evidenceDocumentHash = evidenceDocumentHash;
        milestone.evidenceSubmittedAt = uint64(block.timestamp);
        milestone.status = MilestoneStatus.EvidenceSubmitted;

        emit MilestoneEvidenceSubmitted(projectId, milestoneId, msg.sender, evidenceDocumentHash);
    }

    function approveMilestone(uint256 projectId, uint256 milestoneId, bytes32 inspectionReportHash)
        external
        onlyRole(INSPECTOR_ROLE)
    {
        Award storage award = _existingAward(projectId);
        if (msg.sender == award.vendor) revert ConflictOfInterest(msg.sender);
        Milestone storage milestone = _existingMilestone(projectId, milestoneId);
        if (milestone.status == MilestoneStatus.Defined) revert EvidenceNotSubmitted(projectId, milestoneId);
        if (milestone.status != MilestoneStatus.EvidenceSubmitted) {
            revert MilestoneAlreadyApproved(projectId, milestoneId);
        }
        if (inspectionReportHash == bytes32(0)) revert InvalidDocumentHash();

        milestone.inspector = msg.sender;
        milestone.inspectionReportHash = inspectionReportHash;
        milestone.approvedAt = uint64(block.timestamp);
        milestone.status = MilestoneStatus.Approved;

        emit MilestoneApproved(projectId, milestoneId, msg.sender, inspectionReportHash);
    }

    /// @notice Records that a mock PFMS payment for an approved milestone was made off-chain.
    /// @dev `amountPaise` is a cross-check: it must equal the approved milestone amount.
    function attestMockPayment(
        uint256 projectId,
        uint256 milestoneId,
        uint256 amountPaise,
        bytes32 paymentReferenceHash
    ) external onlyRole(PAO_ROLE) {
        Award storage award = _existingAward(projectId);
        Milestone storage milestone = _existingMilestone(projectId, milestoneId);
        if (msg.sender == award.vendor || msg.sender == milestone.inspector) {
            revert ConflictOfInterest(msg.sender);
        }
        if (milestone.status == MilestoneStatus.Paid) revert PaymentAlreadyAttested(projectId, milestoneId);
        if (milestone.status != MilestoneStatus.Approved) revert MilestoneNotApproved(projectId, milestoneId);
        if (amountPaise != milestone.amountPaise) revert PaymentAmountMismatch(milestone.amountPaise, amountPaise);
        if (paymentReferenceHash == bytes32(0)) revert InvalidDocumentHash();

        // Cannot underflow: milestone totals are capped at the award amount, which was reserved.
        _reservedPaise[projectId] -= amountPaise;
        _paidPaise[projectId] += amountPaise;

        milestone.pao = msg.sender;
        milestone.paymentReferenceHash = paymentReferenceHash;
        milestone.paidAt = uint64(block.timestamp);
        milestone.status = MilestoneStatus.Paid;

        emit MockPaymentAttested(projectId, milestoneId, msg.sender, award.vendor, amountPaise, paymentReferenceHash);
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

    /// @dev Returns a zeroed struct (awardedAt == 0) when the project is not yet awarded.
    function getAward(uint256 projectId) external view returns (Award memory) {
        _existingProject(projectId);
        return _awards[projectId];
    }

    function getMilestone(uint256 projectId, uint256 milestoneId) external view returns (Milestone memory) {
        _existingAward(projectId);
        return _existingMilestone(projectId, milestoneId);
    }

    function getBudget(uint256 projectId) external view returns (Budget memory) {
        Project storage project = _existingProject(projectId);
        return Budget({
            allocationPaise: project.allocationPaise,
            reservedPaise: _reservedPaise[projectId],
            paidPaise: _paidPaise[projectId]
        });
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _ownedProject(uint256 projectId) private view returns (Project storage project) {
        project = _existingProject(projectId);
        if (project.department != msg.sender) revert NotProjectDepartment(projectId, msg.sender);
    }

    function _existingAward(uint256 projectId) private view returns (Award storage award) {
        _existingProject(projectId);
        award = _awards[projectId];
        if (award.awardedAt == 0) revert NotAwarded(projectId);
    }

    /// @dev Milestone ids are 1-based and sequential per project.
    function _existingMilestone(uint256 projectId, uint256 milestoneId)
        private
        view
        returns (Milestone storage)
    {
        if (milestoneId == 0 || milestoneId > _awards[projectId].milestoneCount) {
            revert UnknownMilestone(projectId, milestoneId);
        }
        return _milestones[projectId][milestoneId];
    }

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
