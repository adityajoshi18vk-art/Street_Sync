/**
 * indexer.ts
 * Arc Testnet event indexer using viem.
 *
 * Watches all StreetSyncEscrow contract events and indexes them into SQLite.
 * Uses a resumable block cursor to avoid reprocessing on restart.
 *
 * Supports:
 *   - Arc Testnet (Chain ID 5042002) as primary chain
 *   - Hardhat local node (Chain ID 31337) as fallback for dev
 *   - Hardhat artifact loading for ABI and contract address
 */

import {
  createPublicClient,
  http,
  type Address,
  type Log,
  parseAbiItem,
  defineChain,
} from "viem";
import { ESCROW_ABI } from "./abi.js";
import dbAccess from "./db.js";
import { setVerifyingContract } from "./signer.js";
import fs from "node:fs";
import path from "node:path";

// ─── Chain Definitions ───────────────────────────────────────────────────────

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
});

const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

// ─── Configuration ───────────────────────────────────────────────────────────

const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const POLL_INTERVAL_MS = 3_000; // 3 seconds between polls

// ─── Resolve contract address from deployment artifacts or env ────────────────

function resolveContractAddress(): Address {
  // 1. Try env var first
  if (process.env.ESCROW_CONTRACT_ADDRESS && process.env.ESCROW_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    return process.env.ESCROW_CONTRACT_ADDRESS as Address;
  }

  // 2. Try Hardhat deployment artifact (dynamic for chainId)
  const networkName = CHAIN_ID === 31337 ? "localhost" : "arcTestnet";
  const deploymentsPath = process.env.DEPLOYMENTS_PATH ?? `../contracts/deployments/${networkName}.json`;
  const absPath = path.resolve(deploymentsPath);

  if (fs.existsSync(absPath)) {
    try {
      const raw = fs.readFileSync(absPath, "utf-8");
      const deployment = JSON.parse(raw);
      const addr = deployment.contracts?.StreetSyncEscrow?.address ??
                   deployment.StreetSyncEscrow?.address ??
                   deployment.address;
      if (addr && addr !== "0x0000000000000000000000000000000000000000") {
        console.log(`[indexer] Loaded contract address from ${absPath}: ${addr}`);
        return addr as Address;
      }
    } catch (e) {
      console.warn(`[indexer] Failed to parse deployment artifact at ${absPath}:`, e);
    }
  }

  // 3. Try reading from Hardhat artifacts directly
  const artifactPath = path.resolve("../contracts/artifacts/contracts/src/StreetSyncEscrow.sol/StreetSyncEscrow.json");
  if (fs.existsSync(artifactPath)) {
    console.log("[indexer] Found Hardhat artifact, but no deployment address. Set ESCROW_CONTRACT_ADDRESS in .env");
  }

  throw new Error(
    "Cannot resolve StreetSyncEscrow address. Set ESCROW_CONTRACT_ADDRESS in .env or provide a deployment artifact at DEPLOYMENTS_PATH",
  );
}

// ─── Create viem public client ────────────────────────────────────────────────

function createClient() {
  const chain = CHAIN_ID === 31337 ? hardhatLocal : arcTestnet;
  const rpcUrl = CHAIN_ID === 31337
    ? (process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545")
    : (process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io");

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
    batch: { multicall: true },
  });
}

// ─── Event Handler Dispatch ──────────────────────────────────────────────────

function handleBountyCreated(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    creator: Address;
    descriptionHash: `0x${string}`;
    latE5: number;
    lngE5: number;
    regionCell: number;
    initialAmount: bigint;
    claimDeadline: bigint;
  };

  dbAccess.upsertBounty(
    args.bountyId.toString(),
    args.creator.toLowerCase(),
    args.descriptionHash,
    Number(args.latE5),
    Number(args.lngE5),
    Number(args.regionCell),
    args.initialAmount.toString(),
    Math.floor(Date.now() / 1000),
    Number(args.claimDeadline),
  );

  // Also record as an initial pledge
  dbAccess.insertPledge(
    args.bountyId.toString(),
    args.creator.toLowerCase(),
    args.initialAmount.toString(),
    args.initialAmount.toString(),
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );

  console.log(`[indexer] BountyCreated #${args.bountyId} by ${args.creator}`);
}

function handlePledged(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    pledger: Address;
    amount: bigint;
    newTotal: bigint;
  };

  dbAccess.insertPledge(
    args.bountyId.toString(),
    args.pledger.toLowerCase(),
    args.amount.toString(),
    args.newTotal.toString(),
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );
  dbAccess.updateBountyPledge(args.bountyId.toString(), args.newTotal.toString());

  console.log(`[indexer] Pledged ${args.amount} to #${args.bountyId} by ${args.pledger}`);
}

function handleBountyClaimed(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    worker: Address;
    visualChallengeCode: number;
  };

  dbAccess.updateBountyClaimed(
    args.bountyId.toString(),
    args.worker.toLowerCase(),
    Number(args.visualChallengeCode),
  );

  console.log(`[indexer] BountyClaimed #${args.bountyId} by ${args.worker}, code: ${args.visualChallengeCode}`);
}

function handleEvidenceSubmitted(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    worker: Address;
    arkivEntityKey: `0x${string}`;
    evidenceHash: `0x${string}`;
    selectionBlock: bigint;
  };

  dbAccess.updateBountyEvidence(
    args.bountyId.toString(),
    args.arkivEntityKey,
    args.evidenceHash,
    args.selectionBlock.toString(),
  );

  console.log(`[indexer] EvidenceSubmitted #${args.bountyId}, selectionBlock: ${args.selectionBlock}`);
}

function handlePanelAssigned(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    reviewRound: number;
    panel: readonly [Address, Address, Address];
  };

  dbAccess.insertPanel(
    args.bountyId.toString(),
    Number(args.reviewRound),
    args.panel[0].toLowerCase(),
    args.panel[1].toLowerCase(),
    args.panel[2].toLowerCase(),
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );
  dbAccess.updateBountyInReview(args.bountyId.toString(), Number(args.reviewRound));

  console.log(`[indexer] PanelAssigned #${args.bountyId} round ${args.reviewRound}: [${args.panel.join(", ")}]`);
}

function handleVoteCommitted(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    reviewer: Address;
    commitHash: `0x${string}`;
  };

  // Determine current review round from cached bounty
  const bounty = dbAccess.getBounty(args.bountyId.toString());
  const round = bounty ? Number(bounty.review_round ?? 0) : 0;

  dbAccess.insertVoteCommit(
    args.bountyId.toString(),
    round,
    args.reviewer.toLowerCase(),
    args.commitHash,
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );

  console.log(`[indexer] VoteCommitted #${args.bountyId} by ${args.reviewer}`);
}

function handleVoteRevealed(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    reviewer: Address;
    approve: boolean;
  };

  dbAccess.updateVoteReveal(
    args.bountyId.toString(),
    args.reviewer.toLowerCase(),
    args.approve,
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );

  console.log(`[indexer] VoteRevealed #${args.bountyId} by ${args.reviewer}: ${args.approve ? "APPROVE" : "REJECT"}`);
}

function handleBountySettled(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    approved: boolean;
    workerPayout: bigint;
    reviewerCut: bigint;
  };

  const status = args.approved ? 4 : 5; // Approved = 4, Rejected = 5
  dbAccess.updateBountySettled(args.bountyId.toString(), status);
  dbAccess.insertSettlement(
    args.bountyId.toString(),
    args.approved,
    args.workerPayout.toString(),
    args.reviewerCut.toString(),
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );

  console.log(`[indexer] BountySettled #${args.bountyId}: ${args.approved ? "APPROVED" : "REJECTED"}`);
}

function handleReviewerSlashed(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    reviewer: Address;
    amount: bigint;
  };

  dbAccess.insertSlash(
    args.bountyId.toString(),
    args.reviewer.toLowerCase(),
    args.amount.toString(),
    log.blockNumber?.toString() ?? "0",
    log.transactionHash ?? "",
  );

  console.log(`[indexer] ReviewerSlashed #${args.bountyId}: ${args.reviewer} for ${args.amount}`);
}

function handlePokeOrReplace(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    newReviewRound: number;
    totalSlashed: bigint;
  };

  // After poke, bounty goes back to Submitted (status = 2) with new round and selectionBlock
  // selectionBlock is set to block.number + 2 in the contract but we just approximate here
  const selBlock = log.blockNumber ? (log.blockNumber + 2n).toString() : "0";
  dbAccess.updateBountyPoke(
    args.bountyId.toString(),
    Number(args.newReviewRound),
    selBlock,
  );

  console.log(`[indexer] PokeOrReplace #${args.bountyId}, newRound: ${args.newReviewRound}, slashed: ${args.totalSlashed}`);
}

function handleBountyReworked(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    reworkCount: number;
  };

  const bounty = dbAccess.getBounty(args.bountyId.toString());
  const newRound = bounty ? Number(bounty.review_round ?? 0) + 1 : 1;
  dbAccess.updateBountyRework(
    args.bountyId.toString(),
    newRound,
    Number(args.reworkCount),
  );

  console.log(`[indexer] BountyReworked #${args.bountyId}, reworkCount: ${args.reworkCount}`);
}

function handlePledgeWithdrawn(log: Log & { args: Record<string, unknown> }) {
  const args = log.args as {
    bountyId: bigint;
    pledger: Address;
    amount: bigint;
  };

  // Update the bounty's total pledged (we need to re-query or compute)
  const bounty = dbAccess.getBounty(args.bountyId.toString());
  if (bounty) {
    const currentTotal = BigInt(bounty.total_pledged as string);
    const newTotal = currentTotal - args.amount;
    dbAccess.updateBountyPledge(args.bountyId.toString(), newTotal.toString());
  }

  console.log(`[indexer] PledgeWithdrawn #${args.bountyId}: ${args.pledger} withdrew ${args.amount}`);
}

// ─── Event Name → Handler mapping ────────────────────────────────────────────

const EVENT_HANDLERS: Record<string, (log: Log & { args: Record<string, unknown> }) => void> = {
  BountyCreated:      handleBountyCreated,
  Pledged:            handlePledged,
  BountyClaimed:      handleBountyClaimed,
  EvidenceSubmitted:  handleEvidenceSubmitted,
  PanelAssigned:      handlePanelAssigned,
  VoteCommitted:      handleVoteCommitted,
  VoteRevealed:       handleVoteRevealed,
  BountySettled:      handleBountySettled,
  ReviewerSlashed:    handleReviewerSlashed,
  PokeOrReplace:      handlePokeOrReplace,
  BountyReworked:     handleBountyReworked,
  PledgeWithdrawn:    handlePledgeWithdrawn,
};

// ─── Polling-based indexer ───────────────────────────────────────────────────

let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

export async function startIndexer(): Promise<void> {
  let escrowAddress: Address;
  try {
    escrowAddress = resolveContractAddress();
  } catch (e) {
    console.warn("[indexer] Cannot start indexer:", (e as Error).message);
    console.warn("[indexer] Indexer will be disabled. Set ESCROW_CONTRACT_ADDRESS to enable.");
    return;
  }

  setVerifyingContract(escrowAddress);

  const client = createClient();
  const chainId = CHAIN_ID;

  // Verify connectivity
  try {
    const blockNumber = await client.getBlockNumber();
    console.log(`[indexer] Connected to chain ${chainId}, current block: ${blockNumber}`);
  } catch (e) {
    console.warn(`[indexer] Cannot connect to RPC for chain ${chainId}:`, (e as Error).message);
    console.warn("[indexer] Indexer disabled – API will serve cached data only.");
    return;
  }

  isRunning = true;
  console.log(`[indexer] Watching StreetSyncEscrow at ${escrowAddress} on chain ${chainId}`);

  // Resume from last cursor
  let lastBlock = dbAccess.getCursor(chainId);
  if (lastBlock === 0n) {
    // Start from a recent block (avoid scanning from genesis on testnet)
    try {
      const currentBlock = await client.getBlockNumber();
      lastBlock = currentBlock > 1000n ? currentBlock - 1000n : 0n;
      console.log(`[indexer] No cursor found, starting from block ${lastBlock}`);
    } catch {
      lastBlock = 0n;
    }
  } else {
    console.log(`[indexer] Resuming from block ${lastBlock}`);
  }

  async function poll() {
    if (!isRunning) return;

    try {
      const currentBlock = await client.getBlockNumber();

      if (currentBlock <= lastBlock) {
        // No new blocks
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      // Fetch logs in batches of up to 2000 blocks
      const batchSize = 2000n;
      const fromBlock = lastBlock + 1n;
      const toBlock = currentBlock - fromBlock > batchSize
        ? fromBlock + batchSize
        : currentBlock;

      const logs = await client.getLogs({
        address: escrowAddress,
        fromBlock,
        toBlock,
        events: ESCROW_ABI.filter((item) => item.type === "event") as any,
      });

      // Process each log
      for (const log of logs) {
        const eventName = (log as any).eventName as string;
        const handler = EVENT_HANDLERS[eventName];
        if (handler) {
          try {
            handler(log as any);
          } catch (e) {
            console.error(`[indexer] Error processing ${eventName}:`, e);
          }
        }
      }

      // Update cursor
      lastBlock = toBlock;
      dbAccess.setCursor(chainId, lastBlock);

      if (logs.length > 0) {
        console.log(`[indexer] Processed ${logs.length} events up to block ${toBlock}`);
      }
    } catch (e) {
      console.error("[indexer] Poll error:", (e as Error).message);
    }

    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  // Start polling
  await poll();
}

export function stopIndexer(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[indexer] Stopped.");
}

export default { startIndexer, stopIndexer };

