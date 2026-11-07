// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./JanLekhaRoleRegistry.sol";
import "./JanLekhaTypes.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  JanLekhaProcurementRegistry.sol
//  Port of JanLekha 2.0 ProcurementRegistry (Foundry) to Hardhat / Solidity 0.8.24.
//
//  Public tenders and bids. Tender publication and award are Procurement
//  only, bid submission is Contractor only, and every step emits an event
//  so citizens can follow a tender from publication to award. One bid per
//  contractor per tender. An awarded tender closes and cannot be re-awarded.
// ─────────────────────────────────────────────────────────────────────────────

contract JanLekhaProcurementRegistry {
    JanLekhaRoleRegistry public immutable roles;

    struct Tender {
        bytes32 id;
        bytes32 projectId;
        string title;
        uint256 valueInr;
        uint256 deadline;
        bool open;
        address awardedTo;
        uint256 awardedAmountInr;
        uint256 publishedAt;
    }

    struct Bid {
        address contractor;
        uint256 amountInr;
        uint256 submittedAt;
    }

    mapping(bytes32 => Tender) private _tenders;
    mapping(bytes32 => Bid[]) private _bids;
    mapping(bytes32 => mapping(address => bool)) private _hasBid;

    event TenderPublished(
        bytes32 indexed id,
        bytes32 indexed projectId,
        string title,
        uint256 valueInr,
        uint256 deadline
    );
    event BidSubmitted(bytes32 indexed tenderId, address indexed contractor, uint256 amountInr);
    event BidSelected(bytes32 indexed tenderId, address indexed contractor, uint256 amountInr);

    error NotProcurement(address caller);
    error NotContractor(address caller);
    error TenderExists(bytes32 id);
    error TenderMissing(bytes32 id);
    error TenderClosed(bytes32 id);
    error TenderPastDeadline(bytes32 id);
    error DuplicateBid(bytes32 tenderId, address contractor);
    error ZeroAmount();
    error BidMissing(bytes32 tenderId, address contractor);

    modifier onlyProcurement() {
        if (!roles.hasRole(roles.PROCUREMENT_ROLE(), msg.sender)) revert NotProcurement(msg.sender);
        _;
    }

    modifier onlyContractor() {
        if (!roles.hasRole(roles.CONTRACTOR_ROLE(), msg.sender)) revert NotContractor(msg.sender);
        _;
    }

    constructor(address roleRegistry) {
        roles = JanLekhaRoleRegistry(roleRegistry);
    }

    /// @notice Publish a tender. Only Procurement can call this.
    function publishTender(
        bytes32 id,
        bytes32 projectId,
        string calldata title,
        uint256 valueInr,
        uint256 deadline
    ) external onlyProcurement {
        if (_tenders[id].publishedAt != 0) revert TenderExists(id);
        if (valueInr == 0) revert ZeroAmount();
        _tenders[id] = Tender({
            id: id,
            projectId: projectId,
            title: title,
            valueInr: valueInr,
            deadline: deadline,
            open: true,
            awardedTo: address(0),
            awardedAmountInr: 0,
            publishedAt: block.timestamp
        });
        emit TenderPublished(id, projectId, title, valueInr, deadline);
        emit JanLekhaLifecycleRecorded(
            id, projectId, bytes32(0), "TenderPublished", FundStage.Execution,
            valueInr, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    /// @notice Submit one bid per contractor per tender. Only a Contractor can call this.
    function submitBid(bytes32 tenderId, uint256 amountInr) external onlyContractor {
        Tender storage tender = _tenders[tenderId];
        if (tender.publishedAt == 0) revert TenderMissing(tenderId);
        if (!tender.open) revert TenderClosed(tenderId);
        if (block.timestamp > tender.deadline) revert TenderPastDeadline(tenderId);
        if (_hasBid[tenderId][msg.sender]) revert DuplicateBid(tenderId, msg.sender);
        if (amountInr == 0) revert ZeroAmount();
        _hasBid[tenderId][msg.sender] = true;
        _bids[tenderId].push(Bid({contractor: msg.sender, amountInr: amountInr, submittedAt: block.timestamp}));
        emit BidSubmitted(tenderId, msg.sender, amountInr);
        bytes32 bidRecordId = keccak256(
            abi.encodePacked(tenderId, msg.sender, amountInr, block.timestamp)
        );
        emit JanLekhaLifecycleRecorded(
            bidRecordId, tender.projectId, bytes32(0), "BidSubmitted", FundStage.Execution,
            amountInr, 0, msg.sender, bytes32(0), tenderId
        );
    }

    /// @notice Award a tender to a bidder and close it. Only Procurement can call this.
    function selectBid(bytes32 tenderId, address contractor) external onlyProcurement {
        Tender storage tender = _tenders[tenderId];
        if (tender.publishedAt == 0) revert TenderMissing(tenderId);
        if (!tender.open) revert TenderClosed(tenderId);
        if (!_hasBid[tenderId][contractor]) revert BidMissing(tenderId, contractor);
        uint256 amount = 0;
        Bid[] storage bids = _bids[tenderId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].contractor == contractor) {
                amount = bids[i].amountInr;
                break;
            }
        }
        tender.open = false;
        tender.awardedTo = contractor;
        tender.awardedAmountInr = amount;
        emit BidSelected(tenderId, contractor, amount);
        emit JanLekhaLifecycleRecorded(
            tenderId, tender.projectId, bytes32(0), "BidSelected", FundStage.Execution,
            amount, 0, msg.sender, bytes32(0), bytes32(0)
        );
    }

    function getTender(bytes32 tenderId) external view returns (Tender memory) {
        return _tenders[tenderId];
    }

    function getBids(bytes32 tenderId) external view returns (Bid[] memory) {
        return _bids[tenderId];
    }
}
