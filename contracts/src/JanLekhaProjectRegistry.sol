// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaProjectRegistry.sol
//  Port of JanLekha 2.0 ProjectRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Canonical registry of public works projects. Project records are created
//  by an ADMIN and their status can only move through ADMIN controlled
//  transitions, each emitting an event. There is no edit function for a
//  registered project, so a name, department, contractor, or budget figure
//  cannot be silently rewritten. Financial figures live in
//  JanLekhaBudgetRegistry, milestones in JanLekhaMilestoneRegistry, so this
//  contract stays the single place a project identity is defined.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaProjectRegistry {
    JanLekhaRoleRegistry public immutable roles;

    enum ProjectStatus {
        Registered,
        Active,
        Delayed,
        Completed,
        Cancelled
    }

    struct Project {
        bytes32 id;
        string name;
        bytes32 departmentId;
        address contractor;
        uint256 budgetInr;
        ProjectStatus status;
        uint256 registeredAt;
    }

    mapping(bytes32 => Project) private _projects;
    bytes32[] private _projectIds;

    event ProjectRegistered(
        bytes32 indexed id,
        bytes32 indexed departmentId,
        address indexed contractor,
        string name,
        uint256 budgetInr
    );
    event ProjectStatusUpdated(bytes32 indexed id, ProjectStatus status, address updatedBy);

    error NotAdmin(address caller);
    error ProjectExists(bytes32 id);
    error ProjectMissing(bytes32 id);
    error ZeroAddress();

    modifier onlyAdmin() {
        if (!roles.hasRole(roles.ADMIN_ROLE(), msg.sender)) revert NotAdmin(msg.sender);
        _;
    }

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Register a project. Only an ADMIN can call this.
    function registerProject(
        bytes32 id,
        string calldata name,
        bytes32 departmentId,
        address contractor,
        uint256 budgetInr
    ) external onlyAdmin {
        if (_projects[id].registeredAt != 0) revert ProjectExists(id);
        if (contractor == address(0)) revert ZeroAddress();
        _projects[id] = Project({
            id: id,
            name: name,
            departmentId: departmentId,
            contractor: contractor,
            budgetInr: budgetInr,
            status: ProjectStatus.Registered,
            registeredAt: block.timestamp
        });
        _projectIds.push(id);
        emit ProjectRegistered(id, departmentId, contractor, name, budgetInr);
        emit JanLekhaLifecycleRecorded(
            id, id, departmentId, "ProjectRegistered", FundStage.Budget,
            budgetInr, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Move a project to a new status. Only an ADMIN can call this.
    function updateStatus(bytes32 id, ProjectStatus status) external onlyAdmin {
        if (_projects[id].registeredAt == 0) revert ProjectMissing(id);
        _projects[id].status = status;
        emit ProjectStatusUpdated(id, status, msg.sender);
        FundStage stage = FundStage.Execution;
        if (status == ProjectStatus.Registered) stage = FundStage.Budget;
        if (status == ProjectStatus.Completed) stage = FundStage.Completion;
        if (status == ProjectStatus.Cancelled) stage = FundStage.Audit;
        emit JanLekhaLifecycleRecorded(
            id, id, _projects[id].departmentId, "ProjectStatusUpdated", stage,
            0, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    function getProject(bytes32 id) external view returns (Project memory) {
        return _projects[id];
    }

    function projectExists(bytes32 id) external view returns (bool) {
        return _projects[id].registeredAt != 0;
    }

    function projectCount() external view returns (uint256) {
        return _projectIds.length;
    }

    function projectIdAt(uint256 index) external view returns (bytes32) {
        return _projectIds[index];
    }
}
