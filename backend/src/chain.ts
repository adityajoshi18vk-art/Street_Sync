/**
 * chain.ts
 * Settlement-chain reads shared by the indexer, report relay and World ID routes:
 * the getBounty tuple type, its mapping to a DB row, and a lazily created RPC reader.
 */

import { createPublicClient, defineChain, http, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { ESCROW_ABI } from "./abi.js";
import type { BountyRow } from "./db.js";
import { getVerifyingContract } from "./signer.js";

export const Status = {
  Open: 0,
  Claimed: 1,
  Submitted: 2,
  InReview: 3,
  Approved: 4,
  Rejected: 5,
  Refunded: 6,
  Proposed: 7,
} as const;

/** getBounty() result with every numeric field normalised to a JS number (bigints stay bigint). */
export interface OnChainBounty {
  id: bigint;
  creator: Address;
  descriptionHash: Hex;
  reportHash: Hex;
  latE5: number;
  lngE5: number;
  regionCell: number;
  totalPledged: bigint;
  createdAt: number;
  validationDeadline: number;
  claimDeadline: number;
  workDeadline: number;
  worker: Address;
  visualChallengeCode: number;
  arkivEntityKey: Hex;
  evidenceHash: Hex;
  selectionBlock: bigint;
  reviewRound: number;
  reworkCount: number;
  confirmations: number;
  disputes: number;
  status: number;
}

export type BountyReader = (bountyId: bigint) => Promise<OnChainBounty>;

export function normalizeBounty(raw: Record<string, unknown>): OnChainBounty {
  return {
    id: BigInt(raw.id as bigint | number),
    creator: raw.creator as Address,
    descriptionHash: raw.descriptionHash as Hex,
    reportHash: raw.reportHash as Hex,
    latE5: Number(raw.latE5),
    lngE5: Number(raw.lngE5),
    regionCell: Number(raw.regionCell),
    totalPledged: BigInt(raw.totalPledged as bigint | number),
    createdAt: Number(raw.createdAt),
    validationDeadline: Number(raw.validationDeadline),
    claimDeadline: Number(raw.claimDeadline),
    workDeadline: Number(raw.workDeadline),
    worker: raw.worker as Address,
    visualChallengeCode: Number(raw.visualChallengeCode),
    arkivEntityKey: raw.arkivEntityKey as Hex,
    evidenceHash: raw.evidenceHash as Hex,
    selectionBlock: BigInt(raw.selectionBlock as bigint | number),
    reviewRound: Number(raw.reviewRound),
    reworkCount: Number(raw.reworkCount),
    confirmations: Number(raw.confirmations),
    disputes: Number(raw.disputes),
    status: Number(raw.status),
  };
}

export function bountyExists(b: Pick<OnChainBounty, "creator">): boolean {
  return b.creator.toLowerCase() !== zeroAddress;
}

/** Maps the canonical on-chain struct to the bounties row. Zero values become NULL. */
export function bountyToRow(b: OnChainBounty): BountyRow {
  const hasWorker = b.worker.toLowerCase() !== zeroAddress;
  return {
    bounty_id: b.id.toString(),
    creator: b.creator.toLowerCase(),
    description_hash: b.descriptionHash,
    report_hash: b.reportHash === zeroHash ? null : b.reportHash,
    lat_e5: b.latE5,
    lng_e5: b.lngE5,
    region_cell: b.regionCell,
    total_pledged: b.totalPledged.toString(),
    created_at: b.createdAt,
    validation_deadline: b.validationDeadline,
    claim_deadline: b.claimDeadline,
    work_deadline: b.workDeadline,
    worker: hasWorker ? b.worker.toLowerCase() : null,
    visual_challenge_code: hasWorker ? b.visualChallengeCode : null,
    arkiv_entity_key: b.arkivEntityKey === zeroHash ? null : b.arkivEntityKey,
    evidence_hash: b.evidenceHash === zeroHash ? null : b.evidenceHash,
    selection_block: b.selectionBlock === 0n ? null : b.selectionBlock.toString(),
    review_round: b.reviewRound,
    rework_count: b.reworkCount,
    confirmations: b.confirmations,
    disputes: b.disputes,
    status: b.status,
  };
}

export function settlementRpcUrl(chainId = Number(process.env.CHAIN_ID ?? "5042002")): string {
  return chainId === 31337
    ? process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"
    : process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
}

/** Reader bound to an explicit viem client + escrow address (used by the indexer and tests). */
export function makeBountyReader(
  client: { readContract: (args: any) => Promise<unknown> },
  escrow: () => Address,
): BountyReader {
  return async (bountyId) => {
    const raw = await client.readContract({
      address: escrow(),
      abi: ESCROW_ABI,
      functionName: "getBounty",
      args: [bountyId],
    });
    return normalizeBounty(raw as Record<string, unknown>);
  };
}

let defaultReader: BountyReader | null = null;

/** Reads getBounty from the configured settlement chain and escrow. */
export function readBountyOnChain(bountyId: bigint): Promise<OnChainBounty> {
  if (!defaultReader) {
    const chainId = Number(process.env.CHAIN_ID ?? "5042002");
    const rpc = settlementRpcUrl(chainId);
    const client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: "settlement",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      }),
      transport: http(rpc),
    });
    defaultReader = makeBountyReader(client, getVerifyingContract);
  }
  return defaultReader(bountyId);
}
