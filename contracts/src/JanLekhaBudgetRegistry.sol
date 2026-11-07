// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaBudgetRegistry.sol
//  Port of JanLekha 2.0 BudgetRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Records department and project budget allocations approved by Finance.
//  INR budget figures and USDC settlement figures are separate concepts.
//  INR amounts are whole rupees for reporting. USDC amounts are ERC-20 base
//  units with 6 decimals, so 1 USDC equals 1,000,000 base units. The native
//  gas token on Arc is also USDC, but with 18 decimals, and must never be
//  confused with the 6 decimal settlement token. No function accepts
//  msg.value.
//
//  Corrections: an approved allocation is never edited in place. Use
//  correctAllocation to record a new allocation that references the
//  original; the authorised limit moves by the difference only, and the
//  original record stays readable forever.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaBudgetRegistry {
    JanLekhaRoleRegistry public immutable roles;

    struct Allocation {
        bytes32 id;
        bytes32 departmentId;
        bytes32 projectId;
        uint256 amountInr;
        uint256 amountUsdcBaseUnits;
        address approvedBy;
        uint256 approvedAt;
        bool released;
    }

    mapping(bytes32 => Allocation) private _allocations;
    mapping(bytes32 => uint256) private _authorizedLimitUsdc;
    mapping(bytes32 => uint256) private _totalAllocatedUsdc;

    event AllocationApproved(
        bytes32 indexed id,
        bytes32 indexed departmentId,
        bytes32 indexed projectId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits,
        address approvedBy
    );
    event AllocationReleased(bytes32 indexed id, bytes32 indexed projectId, address releasedBy);
    event AllocationCorrected(
        bytes32 indexed newId,
        bytes32 indexed originalId,
        bytes32 indexed projectId,
        bytes32 departmentId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits,
        address approvedBy
    );

    error NotFinance(address caller);
    error AllocationExists(bytes32 id);
    error AllocationMissing(bytes32 id);
    error ZeroAmount();
    error AlreadyReleased(bytes32 id);
    error CorrectionProjectMismatch(bytes32 originalId, bytes32 projectId);

    modifier onlyFinance() {
        if (!roles.hasRole(roles.FINANCE_ROLE(), msg.sender)) revert NotFinance(msg.sender);
        _;
    }

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Approve a budget allocation. Only Finance can call this.
    /// @param amountUsdcBaseUnits Settlement amount in ERC-20 USDC base units (6 decimals).
    function approveAllocation(
        bytes32 id,
        bytes32 departmentId,
        bytes32 projectId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits
    ) external onlyFinance {
        if (_allocations[id].approvedAt != 0) revert AllocationExists(id);
        if (amountUsdcBaseUnits == 0) revert ZeroAmount();
        _allocations[id] = Allocation({
            id: id,
            departmentId: departmentId,
            projectId: projectId,
            amountInr: amountInr,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            approvedBy: msg.sender,
            approvedAt: block.timestamp,
            released: false
        });
        _authorizedLimitUsdc[projectId] += amountUsdcBaseUnits;
        _totalAllocatedUsdc[projectId] += amountUsdcBaseUnits;
        emit AllocationApproved(id, departmentId, projectId, amountInr, amountUsdcBaseUnits, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, projectId, departmentId, "AllocationApproved", FundStage.Allocation,
            amountInr, amountUsdcBaseUnits, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Mark an approved allocation as released for payment. Only Finance.
    function releaseAllocation(bytes32 id) external onlyFinance {
        Allocation storage allocation = _allocations[id];
        if (allocation.approvedAt == 0) revert AllocationMissing(id);
        if (allocation.released) revert AlreadyReleased(id);
        allocation.released = true;
        emit AllocationReleased(id, allocation.projectId, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, allocation.projectId, allocation.departmentId, "AllocationReleased", FundStage.Release,
            allocation.amountInr, allocation.amountUsdcBaseUnits, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Record a corrected allocation as a new traceable record.
    /// Only Finance. The original allocation is left untouched; the
    /// authorised limit and total allocated move by the difference only.
    /// @param newId Id of the correction record, must be fresh.
    /// @param originalId Id of the allocation being corrected.
    function correctAllocation(
        bytes32 newId,
        bytes32 originalId,
        bytes32 departmentId,
        bytes32 projectId,
        uint256 amountInr,
        uint256 amountUsdcBaseUnits
    ) external onlyFinance {
        Allocation storage original = _allocations[originalId];
        if (original.approvedAt == 0) revert AllocationMissing(originalId);
        if (_allocations[newId].approvedAt != 0) revert AllocationExists(newId);
        if (amountUsdcBaseUnits == 0) revert ZeroAmount();
        if (original.projectId != projectId) revert CorrectionProjectMismatch(originalId, projectId);
        _allocations[newId] = Allocation({
            id: newId,
            departmentId: departmentId,
            projectId: projectId,
            amountInr: amountInr,
            amountUsdcBaseUnits: amountUsdcBaseUnits,
            approvedBy: msg.sender,
            approvedAt: block.timestamp,
            released: false
        });
        if (amountUsdcBaseUnits >= original.amountUsdcBaseUnits) {
            uint256 delta = amountUsdcBaseUnits - original.amountUsdcBaseUnits;
            _authorizedLimitUsdc[projectId] += delta;
            _totalAllocatedUsdc[projectId] += delta;
        } else {
            uint256 delta = original.amountUsdcBaseUnits - amountUsdcBaseUnits;
            _authorizedLimitUsdc[projectId] -= delta;
            _totalAllocatedUsdc[projectId] -= delta;
        }
        emit AllocationCorrected(
            newId, originalId, projectId, departmentId, amountInr, amountUsdcBaseUnits, msg.sender
        );
        emit JanLekhaLifecycleRecorded(
            newId, projectId, departmentId, "AllocationCorrected", FundStage.Allocation,
            amountInr, amountUsdcBaseUnits, msg.sender, bytes32(0), originalId
        );
    }

    /// @notice Total USDC a project is authorised to pay out, in 6 decimal base units.
    function authorizedLimitUsdc(bytes32 projectId) external view returns (uint256) {
        return _authorizedLimitUsdc[projectId];
    }

    /// @notice Total USDC allocated to a project, in 6 decimal base units.
    function totalAllocatedUsdc(bytes32 projectId) external view returns (uint256) {
        return _totalAllocatedUsdc[projectId];
    }

    function getAllocation(bytes32 id) external view returns (Allocation memory) {
        return _allocations[id];
    }
}
