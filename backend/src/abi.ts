/**
 * abi.ts
 * StreetSyncEscrow ABI definition for viem event watching and contract reads.
 *
 * This is the human-readable ABI extracted from the Hardhat compilation artifacts.
 * It covers all events defined in StreetSyncTypes.sol plus the public view functions
 * needed by the indexer and REST endpoints.
 *
 * When the contracts are recompiled, this file can be regenerated from:
 *   contracts/artifacts/contracts/src/StreetSyncEscrow.sol/StreetSyncEscrow.json
 */

export const ESCROW_ABI = [
  // ═══════════════════════════════════════════════════════════════════
  //  Events (from StreetSyncTypes.sol)
  // ═══════════════════════════════════════════════════════════════════

  {
    type: "event",
    name: "BountyCreated",
    inputs: [
      { name: "bountyId",        type: "uint256", indexed: true  },
      { name: "creator",         type: "address", indexed: true  },
      { name: "descriptionHash", type: "bytes32", indexed: false },
      { name: "latE5",           type: "int32",   indexed: false },
      { name: "lngE5",           type: "int32",   indexed: false },
      { name: "regionCell",      type: "uint16",  indexed: false },
      { name: "initialAmount",   type: "uint256", indexed: false },
      { name: "claimDeadline",   type: "uint64",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "Pledged",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true  },
      { name: "pledger",  type: "address", indexed: true  },
      { name: "amount",   type: "uint256", indexed: false },
      { name: "newTotal", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountyClaimed",
    inputs: [
      { name: "bountyId",            type: "uint256", indexed: true  },
      { name: "worker",              type: "address", indexed: true  },
      { name: "visualChallengeCode", type: "uint16",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "EvidenceSubmitted",
    inputs: [
      { name: "bountyId",       type: "uint256", indexed: true  },
      { name: "worker",         type: "address", indexed: true  },
      { name: "arkivEntityKey", type: "bytes32", indexed: false },
      { name: "evidenceHash",   type: "bytes32", indexed: false },
      { name: "selectionBlock", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PanelAssigned",
    inputs: [
      { name: "bountyId",    type: "uint256",    indexed: true  },
      { name: "reviewRound", type: "uint8",      indexed: false },
      { name: "panel",       type: "address[3]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoteCommitted",
    inputs: [
      { name: "bountyId",   type: "uint256", indexed: true  },
      { name: "reviewer",   type: "address", indexed: true  },
      { name: "commitHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoteRevealed",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true  },
      { name: "reviewer", type: "address", indexed: true  },
      { name: "approve",  type: "bool",    indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountySettled",
    inputs: [
      { name: "bountyId",     type: "uint256", indexed: true  },
      { name: "approved",     type: "bool",    indexed: false },
      { name: "workerPayout", type: "uint256", indexed: false },
      { name: "reviewerCut",  type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ReviewerSlashed",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true  },
      { name: "reviewer", type: "address", indexed: true  },
      { name: "amount",   type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ReviewerRegistered",
    inputs: [
      { name: "reviewer",    type: "address", indexed: true  },
      { name: "regionCell",  type: "uint16",  indexed: false },
      { name: "stakeAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PledgeWithdrawn",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true  },
      { name: "pledger",  type: "address", indexed: true  },
      { name: "amount",   type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PokeOrReplace",
    inputs: [
      { name: "bountyId",       type: "uint256", indexed: true  },
      { name: "newReviewRound", type: "uint8",   indexed: false },
      { name: "totalSlashed",   type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountyReworked",
    inputs: [
      { name: "bountyId",    type: "uint256", indexed: true  },
      { name: "reworkCount",  type: "uint8",   indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  View Functions (used by indexer for on-demand reads)
  // ═══════════════════════════════════════════════════════════════════

  {
    type: "function",
    name: "getBounty",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id",                  type: "uint256" },
          { name: "creator",             type: "address" },
          { name: "descriptionHash",     type: "bytes32" },
          { name: "latE5",               type: "int32"   },
          { name: "lngE5",               type: "int32"   },
          { name: "regionCell",          type: "uint16"  },
          { name: "totalPledged",        type: "uint256" },
          { name: "createdAt",           type: "uint64"  },
          { name: "claimDeadline",       type: "uint64"  },
          { name: "worker",              type: "address" },
          { name: "visualChallengeCode", type: "uint16"  },
          { name: "arkivEntityKey",      type: "bytes32" },
          { name: "evidenceHash",        type: "bytes32" },
          { name: "selectionBlock",      type: "uint256" },
          { name: "reviewRound",         type: "uint8"   },
          { name: "reworkCount",         type: "uint8"   },
          { name: "status",              type: "uint8"   },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPanel",
    stateMutability: "view",
    inputs: [
      { name: "bountyId",    type: "uint256" },
      { name: "reviewRound", type: "uint8"   },
    ],
    outputs: [{ type: "address[3]" }],
  },
  {
    type: "function",
    name: "getTally",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [
      { name: "revealed",  type: "uint8" },
      { name: "approvals", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "attester",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "nextBountyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export default ESCROW_ABI;

