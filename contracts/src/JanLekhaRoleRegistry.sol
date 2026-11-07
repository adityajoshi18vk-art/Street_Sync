// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaRoleRegistry.sol
//  Port of JanLekha 2.0 RoleRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Single source of truth for JanLekha roles. Every other registry reads
//  roles from this contract. Only an ADMIN can grant or revoke a role.
//  Roles are bytes32 identifiers so the frontend and any future contract
//  can use the same names.
//
//  Least privilege notes:
//  - Citizens hold no role and therefore have no privileged write
//    permission anywhere. There is deliberately no CITIZEN_ROLE.
//  - Every grant and revoke emits an event, so privileged role changes
//    are visible on chain.
//  - The last ADMIN cannot be revoked, so the registry cannot be
//    orphaned or silently captured by removing every administrator.
//  - No role, including ADMIN, can rewrite history: the other registries
//    expose no edit path for original records, only append only events
//    and traceable correction records that reference the original.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaRoleRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");
    bytes32 public constant PROCUREMENT_ROLE = keccak256("PROCUREMENT_ROLE");
    bytes32 public constant CONTRACTOR_ROLE = keccak256("CONTRACTOR_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    mapping(bytes32 => mapping(address => bool)) private _roles;

    /// @notice Number of accounts currently holding ADMIN_ROLE.
    uint256 public adminCount;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed grantedBy);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed revokedBy);

    error NotAdmin(address caller);
    error ZeroAddress();
    error LastAdmin(address account);

    modifier onlyAdmin() {
        if (!_roles[ADMIN_ROLE][msg.sender]) revert NotAdmin(msg.sender);
        _;
    }

    /// @param admin The first administrator, normally the deploying government account.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _roles[ADMIN_ROLE][admin] = true;
        adminCount = 1;
        emit RoleGranted(ADMIN_ROLE, admin, msg.sender);
    }

    /// @notice Grant a role. Only an ADMIN can call this.
    function grantRole(bytes32 role, address account) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        if (role == ADMIN_ROLE && !_roles[ADMIN_ROLE][account]) {
            adminCount += 1;
        }
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    /// @notice Revoke a role. Only an ADMIN can call this.
    /// @dev Revoking the last ADMIN is rejected so the registry is never orphaned.
    function revokeRole(bytes32 role, address account) external onlyAdmin {
        if (role == ADMIN_ROLE && _roles[ADMIN_ROLE][account] && adminCount <= 1) {
            revert LastAdmin(account);
        }
        if (role == ADMIN_ROLE && _roles[ADMIN_ROLE][account]) {
            adminCount -= 1;
        }
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    /// @notice Read helper used by every other registry and by the frontend.
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    /// @notice Convenience check, true when the account holds at least one operational role.
    /// @dev Citizens hold no role, so this returns false for a citizen address.
    function hasAnyRole(address account) external view returns (bool) {
        return _roles[ADMIN_ROLE][account]
            || _roles[FINANCE_ROLE][account]
            || _roles[PROCUREMENT_ROLE][account]
            || _roles[CONTRACTOR_ROLE][account]
            || _roles[AUDITOR_ROLE][account];
    }
}
