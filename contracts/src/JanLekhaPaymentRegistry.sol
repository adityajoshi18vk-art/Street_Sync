// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaBudgetRegistry.sol";
import "./JanLekhaMilestoneRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaPaymentRegistry.sol
//  Port of JanLekha 2.0 PaymentRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Records USDC settlement of verified milestones, with hard financial
//  invariants enforced on chain. This registry is a settlement record, not
//  a token vault: it records that Finance settled a verified milestone and
//  marks the milestone Paid. It holds no USDC and moves no tokens, so no
//  new payment rule is invented here; the actual USDC transfer happens
//  through the Finance controlled settlement process off chain and is
//  attested by the record and its invoice hash.
//
//  Three invariants are checked before any payment is recorded:
//  1. The milestone must be Verified.
//  2. The payment must not push a project past its Finance approved
//     authorised limit, so a payment can never exceed the authorised limit.
//  3. An invoice hash can only be used once, so a duplicate invoice hash is
//     rejected.
//  Amounts are ERC-20 USDC base units with 6 decimals. 1 USDC is 1,000,000
//  base units. This is different from the native gas token on Arc, which is
//  also USDC but with 18 decimals. Never mix the two.
//
//  Corrections: a recorded payment is never edited in place. Use
//  correctPayment to record a new payment that references the original;
//  the project total paid moves by the difference only, and the original
//  record stays readable forever.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaPaymentRegistry {
    JanLekhaRoleRegistry public immutable roles;
    JanLekhaBudgetRegistry public immutable budgets;
    JanLekhaMilestoneRegistry public immutable milestones;

    uint8 public constant USDC_DECIMALS = 6;
    uint256 public constant USDC_BASE_UNIT = 1_000_000;

    struct Payment {
        bytes32 id;
        bytes32 projectId;
        bytes32 milestoneId;
        address payee;
        uint256 amountUsdcBaseUnits;
        bytes32 invoiceHash;
        address recordedBy;
        uint256 recordedAt;
    }

    mapping(bytes32 => Payment) private _payments;
    mapping(bytes32 => bool) private _invoiceUsed;
    mapping(bytes32 => uint256) private _totalPaidUsdc;
    mapping(bytes32 => bytes32) private _supersededBy;

    event PaymentRecorded(
        bytes32 indexed id,
        bytes32 indexed projectId,
        bytes32 indexed milestoneId,
        address payee,
        uint256 amountUsdcBaseUnits,
        bytes32 invoiceHash,
        address recordedBy
    );
    event PaymentCorrected(
        bytes32 indexed newId,
        bytes32 indexed originalId,
        bytes32 indexed projectId,
        bytes32 milestoneId,
        address payee,
        uint256 amountUsdcBaseUnits,
        bytes32 invoiceHash,
        address recordedBy
    );

    error NotFinance(address caller);
    error PaymentExists(bytes32 id);
    error PaymentMissing(bytes32 id);
    error ZeroAmount();
    error MilestoneNotVerified(bytes32 milestoneId);
    error ExceedsAuthorisedLimit(bytes32 projectId, uint256 requested, uint256 remaining);
    error DuplicateInvoiceHash(bytes32 invoiceHash);
    error MilestoneProjectMismatch(bytes32 milestoneId, bytes32 projectId);
    error MilestoneNotPaid(bytes32 milestoneId);

    modifier onlyFinance() {
        if (!roles.hasRole(roles.FINANCE_ROLE(), msg.sender)) revert NotFinance(msg.sender);
        _;
    }

    constructor(address roleRegistry, address budgetRegistry, address milestoneRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
        budgets = JanLekhaBudgetRegistry(budgetRegistry);
        milestones = JanLekhaMilestoneRegistry(milestoneRegistry);
    }

    /// @notice Convert whole USDC to ERC-20 base units (6 decimals). 1 USDC is 1,000,000.
    function usdcToBaseUnits(uint256 wholeUsdc) external pure returns (uint256) {
        return wholeUsdc * USDC_BASE_UNIT;
    }

    /// @notice Record a settlement for a verified milestone. Only Finance can call this.
    function recordPayment(
        bytes32 id,
        bytes32 projectId,
        bytes32 milestoneId,
        address payee,
        uint256 amountUsdcBaseUnits,
        bytes32 invoiceHash
    ) external onlyFinance {
        if (_payments[id].recordedAt != 0) revert PaymentExists(id);
        if (amountUsdcBaseUnits == 0) revert ZeroAmount();
        if (_invoiceUsed[invoiceHash]) revert DuplicateInvoiceHash(invoiceHash);

        JanLekhaMilestoneRegistry.Milestone memory milestone = milestones.getMilestone(milestoneId);
        if (milestone.submittedAt == 0 || milestone.status != JanLekhaMilestoneRegistry.MilestoneStatus.Verified) {
            revert MilestoneNotVerified(milestoneId);
        }
        if (milestone.projectId != projectId) {
            revert MilestoneProjectMismatch(milestoneId, projectId);
        }

        uint256 limit = budgets.authorizedLimitUsdc(projectId);
        uint256 paid = _totalPaidUsdc[projectId];
        if (amountUsdcBaseUnits > limit - paid) {
            revert ExceedsAuthorisedLimit(projectId, amountUsdcBaseUnits, limit - paid);
        }

        _invoiceUsed[invoiceHash] = true;
        _totalPaidUsdc[projectId] = paid + amountUsdcBaseUnits;
        _payments[id] = Payment({
            id: id,
            projectId: projectId,
            milestoneId: milestoneId,
            payee: payee,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            invoiceHash: invoiceHash,
            recordedBy: msg.sender,
            recordedAt: block.timestamp
        });
        milestones.markPaid(milestoneId);
        emit PaymentRecorded(id, projectId, milestoneId, payee, amountUsdcBaseUnits, invoiceHash, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "PaymentRecorded", FundStage.Expenditure,
            0, amountUsdcBaseUnits, msg.sender, invoiceHash, bytes32(0)
        );
    }

    /// @notice Record a corrected payment as a new traceable record.
    /// Only Finance. The original payment is left untouched and the
    /// corrected record points at it. The project total paid moves by the
    /// difference only. The milestone must already be Paid, which is the
    /// state the original payment left it in.
    /// @param newId Id of the correction record, must be fresh.
    /// @param originalId Id of the payment being corrected.
    function correctPayment(
        bytes32 newId,
        bytes32 originalId,
        uint256 amountUsdcBaseUnits,
        bytes32 invoiceHash
    ) external onlyFinance {
        Payment storage original = _payments[originalId];
        if (original.recordedAt == 0) revert PaymentMissing(originalId);
        if (_payments[newId].recordedAt != 0) revert PaymentExists(newId);
        if (amountUsdcBaseUnits == 0) revert ZeroAmount();
        if (_invoiceUsed[invoiceHash]) revert DuplicateInvoiceHash(invoiceHash);

        JanLekhaMilestoneRegistry.Milestone memory milestone =
            milestones.getMilestone(original.milestoneId);
        if (milestone.status != JanLekhaMilestoneRegistry.MilestoneStatus.Paid) {
            revert MilestoneNotPaid(original.milestoneId);
        }

        bytes32 projectId = original.projectId;
        uint256 limit = budgets.authorizedLimitUsdc(projectId);
        uint256 paid = _totalPaidUsdc[projectId];
        uint256 remainingAfterReversal = limit - paid + original.amountUsdcBaseUnits;
        if (amountUsdcBaseUnits > remainingAfterReversal) {
            revert ExceedsAuthorisedLimit(projectId, amountUsdcBaseUnits, remainingAfterReversal);
        }

        _invoiceUsed[invoiceHash] = true;
        _supersededBy[originalId] = newId;
        if (amountUsdcBaseUnits >= original.amountUsdcBaseUnits) {
            _totalPaidUsdc[projectId] = paid + (amountUsdcBaseUnits - original.amountUsdcBaseUnits);
        } else {
            _totalPaidUsdc[projectId] = paid - (original.amountUsdcBaseUnits - amountUsdcBaseUnits);
        }
        _payments[newId] = Payment({
            id: newId,
            projectId: projectId,
            milestoneId: original.milestoneId,
            payee: original.payee,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            invoiceHash: invoiceHash,
            recordedBy: msg.sender,
            recordedAt: block.timestamp
        });
        emit PaymentCorrected(
            newId, originalId, projectId, original.milestoneId, original.payee,
            amountUsdcBaseUnits, invoiceHash, msg.sender
        );
        emit JanLekhaLifecycleRecorded(
            newId, projectId, bytes32(0), "PaymentCorrected", FundStage.Expenditure,
            0, amountUsdcBaseUnits, msg.sender, invoiceHash, originalId
        );
    }

    /// @notice Total USDC settled for a project, in 6 decimal base units.
    function totalPaidUsdc(bytes32 projectId) external view returns (uint256) {
        return _totalPaidUsdc[projectId];
    }

    /// @notice Remaining authorised USDC for a project, in 6 decimal base units.
    function remainingLimitUsdc(bytes32 projectId) external view returns (uint256) {
        return budgets.authorizedLimitUsdc(projectId) - _totalPaidUsdc[projectId];
    }

    function invoiceUsed(bytes32 invoiceHash) external view returns (bool) {
        return _invoiceUsed[invoiceHash];
    }

    /// @notice Id of the correction record for a payment, or bytes32(0) if never corrected.
    function supersededBy(bytes32 paymentId) external view returns (bytes32) {
        return _supersededBy[paymentId];
    }

    function getPayment(bytes32 id) external view returns (Payment memory) {
        return _payments[id];
    }
}
