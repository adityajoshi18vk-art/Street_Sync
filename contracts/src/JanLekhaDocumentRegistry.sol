// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaDocumentRegistry.sol
//  Port of JanLekha 2.0 DocumentRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Append only registry of document content hashes. A document record is
//  immutable once registered. There is deliberately no edit function.
//  Verification only flips a verified flag and records who verified it, it
//  never changes the hash, the uploader, or the upload time. That is how the
//  rule "an auditor cannot edit original records" is enforced: the code
//  simply has no path that edits them. A content hash can only be registered
//  once, so a duplicate document is rejected.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaDocumentRegistry {
    JanLekhaRoleRegistry public immutable roles;

    struct Document {
        bytes32 id;
        bytes32 projectId;
        bytes32 contentHash;
        string docType;
        address uploadedBy;
        uint256 uploadedAt;
        bool verified;
        address verifiedBy;
    }

    mapping(bytes32 => Document) private _documents;
    mapping(bytes32 => bool) private _hashRegistered;

    event DocumentRegistered(
        bytes32 indexed id,
        bytes32 indexed projectId,
        bytes32 indexed contentHash,
        string docType,
        address uploadedBy
    );
    event DocumentVerified(bytes32 indexed id, address indexed verifiedBy);

    error NoRole(address caller);
    error DocumentExists(bytes32 id);
    error DocumentMissing(bytes32 id);
    error DuplicateContentHash(bytes32 contentHash);
    error NotAuditor(address caller);
    error AlreadyVerified(bytes32 id);

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Register a document hash. Any role holder can upload, citizens cannot.
    function registerDocument(
        bytes32 id,
        bytes32 projectId,
        bytes32 contentHash,
        string calldata docType
    ) external {
        if (!roles.hasAnyRole(msg.sender)) revert NoRole(msg.sender);
        if (_documents[id].uploadedAt != 0) revert DocumentExists(id);
        if (_hashRegistered[contentHash]) revert DuplicateContentHash(contentHash);
        _documents[id] = Document({
            id: id,
            projectId: projectId,
            contentHash: contentHash,
            docType: docType,
            uploadedBy: msg.sender,
            uploadedAt: block.timestamp,
            verified: false,
            verifiedBy: address(0)
        });
        _hashRegistered[contentHash] = true;
        emit DocumentRegistered(id, projectId, contentHash, docType, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "DocumentRegistered", FundStage.Verification,
            0, 0, msg.sender, contentHash, bytes32(0)
        );
    }

    /// @notice Verify a document. Only an Auditor. This changes only the
    /// verified flag and verifiedBy, never the original record.
    function verifyDocument(bytes32 id) external {
        if (!roles.hasRole(roles.AUDITOR_ROLE(), msg.sender)) revert NotAuditor(msg.sender);
        Document storage document = _documents[id];
        if (document.uploadedAt == 0) revert DocumentMissing(id);
        if (document.verified) revert AlreadyVerified(id);
        document.verified = true;
        document.verifiedBy = msg.sender;
        emit DocumentVerified(id, msg.sender);
        emit JanLekhaLifecycleRecorded(
            id, document.projectId, bytes32(0), "DocumentVerified", FundStage.Verification,
            0, 0, msg.sender, document.contentHash, bytes32(0)
        );
    }

    function getDocument(bytes32 id) external view returns (Document memory) {
        return _documents[id];
    }

    function hashRegistered(bytes32 contentHash) external view returns (bool) {
        return _hashRegistered[contentHash];
    }
}
