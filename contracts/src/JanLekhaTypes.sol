// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaTypes.sol
//  Shared types for the JanLekha registries ported into StreetSync.
//
//  Fund lifecycle (single order, every financial action maps to one stage):
//    Budget -> Approval -> Allocation -> Release -> Execution
//    -> Expenditure -> Verification -> Audit -> Completion
//
//  All USDC amounts are ERC-20 base units with 6 decimals
//  (1 USDC = 1,000,000). INR amounts are whole rupees for reporting.
//  Never mix the two, and never confuse either with the native gas token
//  on Arc, which is also USDC but with 18 decimals. No function here
//  accepts msg.value.
// ─────────────────────────────────────────────────────────────────────────────

/// @notice Stage of a public fund in its lifecycle.
enum FundStage {
    Budget,       // Budget head created for a department or project
    Approval,     // Finance approval of a figure
    Allocation,   // Approved allocation against a project
    Release,      // Allocation released for payment
    Execution,    // Work tendered, awarded, or executed (milestone submitted)
    Expenditure,  // Money recorded as spent (payment recorded)
    Verification, // Independent check of work, document, or milestone
    Audit,        // Audit flag, resolution, or report
    Completion    // Project or audit closed as complete
}

/// @notice One append only lifecycle record, emitted by every financial
/// action in every JanLekha registry. The triple of recordId, projectId
/// and departmentId plus actionType, amounts, actor, timestamp (via the
/// block), evidence hash and previous record reference is what makes the
/// trail verifiable off chain. Corrections always emit a new record whose
/// previousRecordId points at the original; no registry rewrites history.
event JanLekhaLifecycleRecorded(
    bytes32 indexed recordId,
    bytes32 indexed projectId,
    bytes32 indexed departmentId,
    string actionType,
    FundStage stage,
    uint256 amountInr,
    uint256 amountUsdcBaseUnits,
    address actor,
    bytes32 evidenceHash,
    bytes32 previousRecordId
);
