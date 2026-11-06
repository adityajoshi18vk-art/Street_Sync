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
  type Hex,
  parseEventLogs,
  defineChain,
} from "viem";
import { ESCROW_ABI } from "./abi.js";
import dbAccess from "./db.js";
import { setVerifyingContract } from "./signer.js";
import { bountyExists, bountyToRow, makeBountyReader, type BountyReader } from "./chain.js";
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
const CATCH_UP_DELAY_MS = 1_000;
// Arc's public RPC rejects eth_getLogs spans of 1000+ blocks ("requested range too large").
const INITIAL_BATCH_BLOCKS = BigInt(process.env.INDEXER_BATCH_BLOCKS ?? "500");
const MIN_BATCH_BLOCKS = 10n;

/** Shrinks the log window on range errors and backs off on rate limits. */
export function nextIndexerStep(message: string, batchSize: bigint): { batchSize: bigint; delayMs: number } {
  const lower = message.toLowerCase();
  if (lower.includes("range too large") || lower.includes("block range") || lower.includes("too many results")) {
    const halved = batchSize / 2n;
    return { batchSize: halved < MIN_BATCH_BLOCKS ? MIN_BATCH_BLOCKS : halved, delayMs: CATCH_UP_DELAY_MS };
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return { batchSize, delayMs: POLL_INTERVAL_MS * 3 };
  }
  return { batchSize, delayMs: POLL_INTERVAL_MS };
}

// ─── Resolve contract address from deployment artifacts or env ────────────────

function readDeployBlock(): bigint | null {
  const networkName = CHAIN_ID === 31337 ? "localhost" : "arcTestnet";
  const artifactPath = process.env.DEPLOYMENTS_PATH ?? `../contracts/deployments/${networkName}.json`;
  try {
    const deployment = JSON.parse(fs.readFileSync(path.resolve(artifactPath), "utf8"));
    return typeof deployment.deployBlock === "number" ? BigInt(deployment.deployBlock) : null;
  } catch {
    return null;
  }
}

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

// ─── Event handling ──────────────────────────────────────────────────────────
//
// Event handlers only write the rows that exist solely in events (pledges, panels, votes,
// slashes, problem votes, settlements). The bounty row itself is never patched from events:
// after each batch every touched bounty is re-read with getBounty and upserted, so all state
// transitions (reopen, refund, rework, deadlines, counts...) stay correct by construction.

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber?: bigint | null;
  transactionHash?: string | null;
}

const where = (log: DecodedLog) => [log.blockNumber?.toString() ?? "0", log.transactionHash ?? ""] as const;
const lower = (a: unknown) => String(a).toLowerCase();

function currentRound(bountyId: string): number {
  const panel = dbAccess.getPanel(bountyId);
  if (panel) return Number(panel.review_round ?? 0);
  return Number(dbAccess.getBounty(bountyId)?.review_round ?? 0);
}

type Handler = (log: DecodedLog, bountyId: string) => void;

const EVENT_HANDLERS: Record<string, Handler> = {
  BountyCreated(log, id) {
    const a = log.args as { creator: Address; initialAmount: bigint };
    dbAccess.insertPledge(id, lower(a.creator), a.initialAmount.toString(), a.initialAmount.toString(), ...where(log));
  },
  Pledged(log, id) {
    const a = log.args as { pledger: Address; amount: bigint; newTotal: bigint };
    dbAccess.insertPledge(id, lower(a.pledger), a.amount.toString(), a.newTotal.toString(), ...where(log));
  },
  PledgeWithdrawn(log, id) {
    dbAccess.markPledgeWithdrawn(id, lower((log.args as { pledger: Address }).pledger));
  },
  PanelAssigned(log, id) {
    const a = log.args as { reviewRound: number; panel: readonly [Address, Address, Address] };
    dbAccess.insertPanel(id, Number(a.reviewRound), lower(a.panel[0]), lower(a.panel[1]), lower(a.panel[2]), ...where(log));
  },
  VoteCommitted(log, id) {
    const a = log.args as { reviewer: Address; commitHash: Hex };
    dbAccess.insertVoteCommit(id, currentRound(id), lower(a.reviewer), a.commitHash, ...where(log));
  },
  VoteRevealed(log, id) {
    const a = log.args as { reviewer: Address; approve: boolean };
    dbAccess.updateVoteReveal(id, lower(a.reviewer), a.approve, ...where(log), currentRound(id));
  },
  ReviewerSlashed(log, id) {
    const a = log.args as { reviewer: Address; amount: bigint };
    dbAccess.insertSlash(id, lower(a.reviewer), a.amount.toString(), ...where(log));
  },
  ProblemVoteCast(log, id) {
    const a = log.args as { voter: Address; isReal: boolean };
    dbAccess.insertProblemVote(id, lower(a.voter), a.isReal, ...where(log));
  },
  BountySettled(log, id) {
    const a = log.args as { approved: boolean; workerPayout: bigint; reviewerCut: bigint };
    dbAccess.insertSettlement(id, a.approved, a.workerPayout.toString(), a.reviewerCut.toString(), ...where(log));
  },
  // State-only events: the canonical refresh below captures their effect.
  BountyClaimed() {},
  EvidenceSubmitted() {},
  PokeOrReplace() {},
  BountyReworked() {},
  ClaimReleased() {},
  ProblemValidated() {},
  ProblemDismissed() {},
};

/** Re-reads one bounty from the chain and upserts its canonical row. */
export async function refreshBounty(bountyId: bigint, readBounty: BountyReader): Promise<void> {
  const bounty = await readBounty(bountyId);
  if (!bountyExists(bounty)) return;
  dbAccess.upsertBountyRow(bountyToRow(bounty));
}

/**
 * Applies a decoded log batch in order, then refreshes every touched bounty sequentially
 * (Arc's RPC rate-limits parallel reads). A readBounty failure rejects so the caller retries
 * the same block range; the event writes above are idempotent.
 */
export async function processLogs(logs: DecodedLog[], readBounty: BountyReader): Promise<{ events: number; refreshed: number }> {
  const touched = new Set<string>();
  let events = 0;
  for (const log of logs) {
    const handler = EVENT_HANDLERS[log.eventName];
    if (!handler) continue;
    const rawId = log.args?.bountyId;
    if (typeof rawId !== "bigint") continue;
    const id = rawId.toString();
    touched.add(id);
    try {
      handler(log, id);
      events++;
    } catch (e) {
      console.error(`[indexer] Error processing ${log.eventName}:`, e);
    }
  }
  for (const id of touched) await refreshBounty(BigInt(id), readBounty);
  return { events, refreshed: touched.size };
}

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
  const readBounty = makeBountyReader(client, () => escrowAddress);

  // Must precede the cursor lookup: a new deployment starts from an empty derived state.
  if (dbAccess.ensureDeploymentScope(chainId, escrowAddress)) {
    console.log(`[indexer] Deployment scope changed (chain ${chainId}, escrow ${escrowAddress}); derived tables reset`);
  }

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
      const deployBlock = readDeployBlock();
      const currentBlock = await client.getBlockNumber();
      // Index from the escrow deployment block so no early events are skipped.
      lastBlock = deployBlock !== null && deployBlock > 0n
        ? deployBlock - 1n
        : currentBlock > 1000n ? currentBlock - 1000n : 0n;
      console.log(`[indexer] No cursor found, starting from block ${lastBlock}`);
    } catch {
      lastBlock = 0n;
    }
  } else {
    console.log(`[indexer] Resuming from block ${lastBlock}`);
  }

  let batchSize = INITIAL_BATCH_BLOCKS;
  let delayMs = POLL_INTERVAL_MS;

  async function poll() {
    if (!isRunning) return;

    try {
      const currentBlock = await client.getBlockNumber();

      if (currentBlock <= lastBlock) {
        // No new blocks
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      const fromBlock = lastBlock + 1n;
      const toBlock = currentBlock - fromBlock + 1n > batchSize
        ? fromBlock + batchSize - 1n
        : currentBlock;

      // Arc rejects multi-event topic filters ("requested range too large"),
      // so fetch by address and decode locally; unknown events are dropped.
      const rawLogs = await client.getLogs({ address: escrowAddress, fromBlock, toBlock });
      const logs = parseEventLogs({ abi: ESCROW_ABI, logs: rawLogs });

      const { events, refreshed } = await processLogs(logs as unknown as DecodedLog[], readBounty);

      // Update cursor
      lastBlock = toBlock;
      dbAccess.setCursor(chainId, lastBlock);

      if (events > 0) {
        console.log(`[indexer] Processed ${events} events (${refreshed} bounties refreshed) up to block ${toBlock}`);
      }
      // Keep catching up without waiting while behind the chain head.
      delayMs = toBlock < currentBlock ? CATCH_UP_DELAY_MS : POLL_INTERVAL_MS;
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      const next = nextIndexerStep(message, batchSize);
      batchSize = next.batchSize;
      delayMs = next.delayMs;
      console.error(`[indexer] Poll error (batch ${batchSize} blocks, retry in ${delayMs}ms):`, message.split("\n").find((l) => l.startsWith("Details:")) ?? message.split("\n")[0]);
    }

    pollTimer = setTimeout(poll, delayMs);
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

