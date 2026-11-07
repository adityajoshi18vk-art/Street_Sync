// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaAuditRegistry.sol
//  Port of JanLekha 2.0 AuditRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Audit flags and published audit reports. Flags are raised and resolved
//  by Auditors only. Resolving a flag appends a resolution note and flips
//  the resolved flag, it never rewrites the original reason, risk, or
//  raiser. That keeps the audit trail append only, so an auditor cannot edit
//  the original record of what was flagged.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaAuditRegistry {
    JanLekhaRoleRegistry public immutable roles;

    struct Flag {
        bytes32 id;
        bytes32 projectId;
        string reason;
        uint8 risk;
        bool resolved;
        address raisedBy;
        address resolvedBy;
        uint256 raisedAt;
        uint256 resolvedAt;
        string resolutionNote;
    }

    struct Report {
        bytes32 id;
        bytes32 projectId;
        string title;
        uint256 findings;
        uint256 publishedAt;
        address auditor;
    }

    mapping(bytes32 => Flag) private _flags;
    mapping(bytes32 => Report) private _reports;

    event FlagRaised(
        bytes32 indexed id,
        bytes32 indexed projectId,
        string reason,
        uint8 risk,
        address raisedBy
    );
    event FlagResolved(bytes32 indexed id, address indexed resolvedBy, string resolutionNote);
    event ReportPublished(
        bytes32 indexed id,
        bytes32 indexed projectId,
        string title,
        uint256 findings,
        address auditor
    );

    error NotAuditor(address caller);
    error FlagExists(bytes32 id);
    error FlagMissing(bytes32 id);
    error FlagAlreadyResolved(bytes32 id);
    error ReportExists(bytes32 id);

    modifier onlyAuditor() {
        if (!roles.hasRole(roles.AUDITOR_ROLE(), msg.sender)) revert NotAuditor(msg.sender);
        _;
    }

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Raise an audit flag on a project. Only an Auditor can call this.
    function raiseFlag(bytes32 id, bytes32 projectId, string calldata reason, uint8 risk) external onlyAuditor {
        if (_flags[id].raisedAt != 0) revert FlagExists(id);
        _flags[id] = Flag({
            id: id,
            projectId: projectId,
            reason: reason,
            risk: risk,
            resolved: false,
            raisedBy: msg.sender,
            resolvedBy: address(0),
            raisedAt: block.timestamp,
            resolvedAt: 0,
            resolutionNote: ""
        });
        emit FlagRaised(id, projectId, reason, risk, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "FlagRaised", FundStage.Audit,
            0, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Resolve a flag with a note. Only an Auditor. The original
    /// reason, risk, and raiser are never changed.
    function resolveFlag(bytes32 id, string calldata resolutionNote) external onlyAuditor {
        Flag storage flag = _flags[id];
        if (flag.raisedAt == 0) revert FlagMissing(id);
        if (flag.resolved) revert FlagAlreadyResolved(id);
        flag.resolved = true;
        flag.resolvedBy = msg.sender;
        flag.resolvedAt = block.timestamp;
        flag.resolutionNote = resolutionNote;
        emit FlagResolved(id, msg.sender, resolutionNote);
        emit JanLekhaLifecycleRecorded(
            id, flag.projectId, bytes32(0), "FlagResolved", FundStage.Audit,
            0, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Publish an audit report summary. Only an Auditor can call this.
    function publishReport(bytes32 id, bytes32 projectId, string calldata title, uint256 findings)
        external
        onlyAuditor
    {
        if (_reports[id].publishedAt != 0) revert ReportExists(id);
        _reports[id] = Report({
            id: id,
            projectId: projectId,
            title: title,
            findings: findings,
            publishedAt: block.timestamp,
            auditor: msg.sender
        });
        emit ReportPublished(id, projectId, title, findings, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "ReportPublished", FundStage.Audit,
            0, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    function getFlag(bytes32 id) external view returns (Flag memory) {
        return _flags[id];
    }

    function getReport(bytes32 id) external view returns (Report memory) {
        return _reports[id];
    }
}
