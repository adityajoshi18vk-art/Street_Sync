// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaMilestoneRegistry.sol
//  Port of JanLekha 2.0 MilestoneRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Milestone lifecycle: Contractor submits, Auditor verifies, Finance (or
//  the PaymentRegistry) marks paid. Separation of duties is enforced on
//  chain. A contractor can never verify their own milestone, and a
//  milestone can only move forward through the states Submitted, Verified,
//  Paid, or be Rejected by an auditor.
//
//  Corrections: a rejected milestone is never edited in place. The
//  contractor records a new milestone with resubmitMilestone, which
//  references the rejected original; both records stay readable.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaMilestoneRegistry {
    JanLekhaRoleRegistry public immutable roles;

    enum MilestoneStatus {
        Submitted,
        Verified,
        Paid,
        Rejected
    }

    struct Milestone {
        bytes32 id;
        bytes32 projectId;
        address submitter;
        uint256 amountInr;
        uint256 amountUsdcBaseUnits;
        bytes32 evidenceHash;
        MilestoneStatus status;
        address verifiedBy;
        uint256 submittedAt;
        uint256 verifiedAt;
    }

    mapping(bytes32 => Milestone) private _milestones;

    /// @notice Address of the PaymentRegistry, set once by an ADMIN so that a
    /// recorded payment can mark its milestone Paid without a Finance signature.
    address public paymentRegistry;

    event MilestoneSubmitted(
        bytes32 indexed id,
        bytes32 indexed projectId,
        address indexed submitter,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits,
        bytes32 evidenceHash
    );
    event MilestoneVerified(bytes32 indexed id, address indexed verifiedBy);
    event MilestonePaid(bytes32 indexed id, address indexed markedBy);
    event MilestoneRejected(bytes32 indexed id, address indexed rejectedBy);
    event MilestoneResubmitted(
        bytes32 indexed newId,
        bytes32 indexed originalId,
        bytes32 indexed projectId,
        address submitter
    );
    event PaymentRegistrySet(address indexed paymentRegistry);

    error NotContractor(address caller);
    error NotAuditor(address caller);
    error NotFinanceOrPaymentRegistry(address caller);
    error NotAdmin(address caller);
    error MilestoneExists(bytes32 id);
    error MilestoneMissing(bytes32 id);
    error SelfVerification(address submitter);
    error WrongStatus(bytes32 id, MilestoneStatus status);
    error PaymentRegistryAlreadySet(address existing);
    error NotOriginalSubmitter(address caller);

    modifier onlyContractor() {
        if (!roles.hasRole(roles.CONTRACTOR_ROLE(), msg.sender)) revert NotContractor(msg.sender);
        _;
    }

    modifier onlyAuditor() {
        if (!roles.hasRole(roles.AUDITOR_ROLE(), msg.sender)) revert NotAuditor(msg.sender);
        _;
    }

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Point this registry at the deployed PaymentRegistry. ADMIN only, once.
    function setPaymentRegistry(address registry) external {
        if (!roles.hasRole(roles.ADMIN_ROLE(), msg.sender)) revert NotAdmin(msg.sender);
        if (paymentRegistry != address(0)) revert PaymentRegistryAlreadySet(paymentRegistry);
        paymentRegistry = registry;
        emit PaymentRegistrySet(registry);
    }

    /// @notice Submit a milestone with its evidence hash. Only a Contractor can call this.
    function submitMilestone(
        bytes32 id,
        bytes32 projectId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits,
        bytes32 evidenceHash
    ) external onlyContractor {
        if (_milestones[id].submittedAt != 0) revert MilestoneExists(id);
        _milestones[id] = Milestone({
            id: id,
            projectId: projectId,
            submitter: msg.sender,
            amountInr: amountInr,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            evidenceHash: evidenceHash,
            status: MilestoneStatus.Submitted,
            verifiedBy: address(0),
            submittedAt: block.timestamp,
            verifiedAt: 0
        });
        emit MilestoneSubmitted(id, projectId, msg.sender, amountInr, amountUsdcBaseUnits, evidenceHash);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "MilestoneSubmitted", FundStage.Execution,
            amountInr, amountUsdcBaseUnits, msg.sender, evidenceHash, bytes32(0)
        );
    }

    /// @notice Resubmit a rejected milestone as a new traceable record.
    /// Only the original submitting Contractor. The rejected original is
    /// left untouched and the new record references it.
    function resubmitMilestone(
        bytes32 newId,
        bytes32 originalId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits,
        bytes32 evidenceHash
    ) external onlyContractor {
        Milestone storage original = _milestones[originalId];
        if (original.submittedAt == 0) revert MilestoneMissing(originalId);
        if (original.status != MilestoneStatus.Rejected) revert WrongStatus(originalId, original.status);
        if (original.submitter != msg.sender) revert NotOriginalSubmitter(msg.sender);
        if (_milestones[newId].submittedAt != 0) revert MilestoneExists(newId);
        _milestones[newId] = Milestone({
            id: newId,
            projectId: original.projectId,
            submitter: msg.sender,
            amountInr: amountInr,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            evidenceHash: evidenceHash,
            status: MilestoneStatus.Submitted,
            verifiedBy: address(0),
            submittedAt: block.timestamp,
            verifiedAt: 0
        });
        emit MilestoneSubmitted(newId, original.projectId, msg.sender, amountInr, amountUsdcBaseUnits, evidenceHash);
        emit MilestoneResubmitted(newId, originalId, original.projectId, msg.sender);
        emit JanLekhaLifecycleRecorded(
            newId, original.projectId, bytes32(0), "MilestoneResubmitted", FundStage.Execution,
            amountInr, amountUsdcBaseUnits, msg.sender, evidenceHash, originalId
        );
    }

    /// @notice Verify a submitted milestone. Only an Auditor, and never the submitter.
    function verifyMilestone(bytes32 id) external onlyAuditor {
        Milestone storage milestone = _milestones[id];
        if (milestone.submittedAt == 0) revert MilestoneMissing(id);
        if (milestone.status != MilestoneStatus.Submitted) revert WrongStatus(id, milestone.status);
        if (milestone.submitter == msg.sender) revert SelfVerification(msg.sender);
        milestone.status = MilestoneStatus.Verified;
        milestone.verifiedBy = msg.sender;
        milestone.verifiedAt = block.timestamp;
        emit MilestoneVerified(id, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, milestone.projectId, bytes32(0), "MilestoneVerified", FundStage.Verification,
            milestone.amountInr, milestone.amountUsdcBaseUnits, msg.sender, milestone.evidenceHash, bytes32(0)
        );
    }

    /// @notice Reject a submitted milestone. Only an Auditor, and never the submitter.
    function rejectMilestone(bytes32 id) external onlyAuditor {
        Milestone storage milestone = _milestones[id];
        if (milestone.submittedAt == 0) revert MilestoneMissing(id);
        if (milestone.status != MilestoneStatus.Submitted) revert WrongStatus(id, milestone.status);
        if (milestone.submitter == msg.sender) revert SelfVerification(msg.sender);
        milestone.status = MilestoneStatus.Rejected;
        emit MilestoneRejected(id, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, milestone.projectId, bytes32(0), "MilestoneRejected", FundStage.Verification,
            milestone.amountInr, milestone.amountUsdcBaseUnits, msg.sender, milestone.evidenceHash, bytes32(0)
        );
    }

    /// @notice Mark a verified milestone Paid. Finance, or the PaymentRegistry after it records a payment.
    function markPaid(bytes32 id) external {
        bool isFinance = roles.hasRole(roles.FINANCE_ROLE(), msg.sender);
        if (!isFinance && msg.sender != paymentRegistry) {
            revert NotFinanceOrPaymentRegistry(msg.sender);
        }
        Milestone storage milestone = _milestones[id];
        if (milestone.submittedAt == 0) revert MilestoneMissing(id);
        if (milestone.status != MilestoneStatus.Verified) revert WrongStatus(id, milestone.status);
        milestone.status = MilestoneStatus.Paid;
        emit MilestonePaid(id, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, milestone.projectId, bytes32(0), "MilestonePaid", FundStage.Expenditure,
            milestone.amountInr, milestone.amountUsdcBaseUnits, msg.sender, milestone.evidenceHash, bytes32(0)
        );
    }

    function getMilestone(bytes32 id) external view returns (Milestone memory) {
        return _milestones[id];
    }
}
