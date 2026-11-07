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
  type Log,
  parseAbiItem,
  parseEventLogs,
  defineChain,
} from "viem";
import { ESCROW_ABI } from "./abi.js";
import dbAccess from "./db.js";
import { setVerifyingContract } from "./signer.js";
import { bountyExists, bountyToRow, makeBountyReader, type BountyReader } from "./chain.js";
import fs from "node:fs";
import path from "node:path";

// ─── JanLekha registry event ABI ─────────────────────────────────────────────
// Events from the eight JanLekha registries in ~/workspace/janlekha/contracts/src
// (Foundry sources; the Hardhat port in contracts/src keeps the same events).
// There is no BudgetCreated event: a budget allocation is created by
// AllocationApproved, so that event is the creation record. Amounts: INR
// figures are whole rupees; USDC figures are ERC-20 base units (6 decimals).
// The indexer is a convenience cache only, never the source of truth; see
// docs/VERIFICATION.md for how a citizen checks each record on chain.

export const JANLEKHA_ABI = [
  parseAbiItem("event ProjectRegistered(bytes32 indexed id, bytes32 indexed departmentId, address indexed contractor, string name, uint256 budgetInr)"),
  parseAbiItem("event ProjectStatusUpdated(bytes32 indexed id, uint8 status, address updatedBy)"),
  parseAbiItem("event AllocationApproved(bytes32 indexed id, bytes32 indexed departmentId, bytes32 indexed projectId, uint256 amountInr, uint256 amountUsdcBaseUnits, address approvedBy)"),
  parseAbiItem("event AllocationReleased(bytes32 indexed id, bytes32 indexed projectId, address releasedBy)"),
  parseAbiItem("event TenderPublished(bytes32 indexed id, bytes32 indexed projectId, string title, uint256 valueInr, uint256 deadline)"),
  parseAbiItem("event BidSubmitted(bytes32 indexed tenderId, address indexed contractor, uint256 amountInr)"),
  parseAbiItem("event BidSelected(bytes32 indexed tenderId, address indexed contractor, uint256 amountInr)"),
  parseAbiItem("event MilestoneSubmitted(bytes32 indexed id, bytes32 indexed projectId, address indexed submitter, uint256 amountInr, uint256 amountUsdcBaseUnits, bytes32 evidenceHash)"),
  parseAbiItem("event MilestoneVerified(bytes32 indexed id, address indexed verifiedBy)"),
  parseAbiItem("event MilestonePaid(bytes32 indexed id, address indexed markedBy)"),
  parseAbiItem("event MilestoneRejected(bytes32 indexed id, address indexed rejectedBy)"),
  parseAbiItem("event PaymentRecorded(bytes32 indexed id, bytes32 indexed projectId, bytes32 indexed milestoneId, address payee, uint256 amountUsdcBaseUnits, bytes32 invoiceHash, address recordedBy)"),
  parseAbiItem("event DocumentRegistered(bytes32 indexed id, bytes32 indexed projectId, bytes32 indexed contentHash, string docType, address uploadedBy)"),
  parseAbiItem("event DocumentVerified(bytes32 indexed id, address indexed verifiedBy)"),
  parseAbiItem("event FlagRaised(bytes32 indexed id, bytes32 indexed projectId, string reason, uint8 risk, address raisedBy)"),
  parseAbiItem("event FlagResolved(bytes32 indexed id, address indexed resolvedBy, string resolutionNote)"),
  parseAbiItem("event ReportPublished(bytes32 indexed id, bytes32 indexed projectId, string title, uint256 findings, address auditor)"),
  parseAbiItem("event RoleGranted(bytes32 indexed role, address indexed account, address indexed grantedBy)"),
  parseAbiItem("event RoleRevoked(bytes32 indexed role, address indexed account, address indexed revokedBy)"),
] as const;

/** Registry key, env var, and deployment artifact key for each JanLekha contract. */
export const JANLEKHA_REGISTRIES = [
  { key: "role",        envVar: "JANLEKHA_ROLE_REGISTRY_ADDRESS",        artifactKey: "JanLekhaRoleRegistry" },
  { key: "budget",      envVar: "JANLEKHA_BUDGET_REGISTRY_ADDRESS",      artifactKey: "JanLekhaBudgetRegistry" },
  { key: "project",     envVar: "JANLEKHA_PROJECT_REGISTRY_ADDRESS",     artifactKey: "JanLekhaProjectRegistry" },
  { key: "procurement", envVar: "JANLEKHA_PROCUREMENT_REGISTRY_ADDRESS", artifactKey: "JanLekhaProcurementRegistry" },
  { key: "milestone",   envVar: "JANLEKHA_MILESTONE_REGISTRY_ADDRESS",   artifactKey: "JanLekhaMilestoneRegistry" },
  { key: "payment",     envVar: "JANLEKHA_PAYMENT_REGISTRY_ADDRESS",     artifactKey: "JanLekhaPaymentRegistry" },
  { key: "document",    envVar: "JANLEKHA_DOCUMENT_REGISTRY_ADDRESS",    artifactKey: "JanLekhaDocumentRegistry" },
  { key: "audit",       envVar: "JANLEKHA_AUDIT_REGISTRY_ADDRESS",       artifactKey: "JanLekhaAuditRegistry" },
] as const;

export type JanlekhaRegistryKey = (typeof JANLEKHA_REGISTRIES)[number]["key"];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** JanLekha deployment artifact, written by the contract port deploy script. */
function janlekhaDeploymentArtifactPath(): string {
  return path.resolve(
    process.env.JANLEKHA_DEPLOYMENTS_PATH ?? "../contracts/deployments/arcTestnet-janlekha.json",
  );
}

function readJanlekhaDeploymentArtifact(): Record<string, unknown> | null {
  const p = janlekhaDeploymentArtifactPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[indexer:janlekha] Failed to parse deployment artifact at ${p}:`, e);
    return null;
  }
}

/**
 * Resolve the deployed address of each JanLekha registry, from env vars
 * first, then the deployment artifact. Registries with no address are
 * omitted; when none resolve, JanLekha indexing stays disabled and the
 * backend serves only StreetSync data plus an explicit not-deployed
 * status (see GET /api/janlekha/status).
 */
export function resolveJanlekhaAddresses(): Map<string, Address> {
  const artifact = readJanlekhaDeploymentArtifact();
  const contracts = (artifact?.contracts ?? artifact ?? {}) as Record<string, { address?: string } | string>;
  const out = new Map<string, Address>();
  for (const reg of JANLEKHA_REGISTRIES) {
    const fromEnv = process.env[reg.envVar];
    let addr: string | undefined;
    if (fromEnv && fromEnv !== ZERO_ADDRESS) {
      addr = fromEnv;
    } else {
      const entry = contracts[reg.artifactKey];
      const fromArtifact = typeof entry === "string" ? entry : entry?.address;
      if (fromArtifact && fromArtifact !== ZERO_ADDRESS) addr = fromArtifact;
    }
    if (addr) {
      out.set(reg.key, addr as Address);
      console.log(`[indexer:janlekha] ${reg.key} registry at ${addr}`);
    }
  }
  return out;
}

function resolveJanlekhaDeploymentBlock(): bigint | null {
  if (process.env.JANLEKHA_DEPLOYMENT_BLOCK) return BigInt(process.env.JANLEKHA_DEPLOYMENT_BLOCK);
  const artifact = readJanlekhaDeploymentArtifact();
  const block = (artifact as { deploymentBlock?: number | string } | null)?.deploymentBlock;
  return block == null ? null : BigInt(block);
}

/** Deployment status for GET /api/janlekha/status. No chain calls. */
export function getJanlekhaDeploymentStatus(): {
  deployed: boolean;
  registries: Record<string, string | null>;
  deploymentBlock: string | null;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
} {
  const addresses = resolveJanlekhaAddresses();
  const registries: Record<string, string | null> = {};
  for (const reg of JANLEKHA_REGISTRIES) {
    registries[reg.key] = addresses.get(reg.key) ?? null;
  }
  const block = resolveJanlekhaDeploymentBlock();
  return {
    deployed: addresses.size === JANLEKHA_REGISTRIES.length,
    registries,
    deploymentBlock: block === null ? null : block.toString(),
    chainId: CHAIN_ID,
    rpcUrl: CHAIN_ID === 31337
      ? (process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545")
      : (process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io"),
    explorerUrl: "https://explorer.testnet.arc.io",
  };
}

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
// JanLekha poll stays a few blocks behind the head: public RPCs may report a
// block number whose logs are not queryable yet.
const CONFIRMATION_LAG = BigInt(process.env.INDEXER_CONFIRMATION_LAG ?? (CHAIN_ID === 31337 ? 0 : 5));
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

// ─── JanLekha event handlers ─────────────────────────────────────────────────
// Every handler first records the raw decoded event in janlekha_events
// (the audit timeline), then updates the projected record row. Timestamps
// come from the log's block time where available; handlers here use the
// indexer's wall clock as the recorded_at fallback because viem Log does
// not carry a timestamp, and the chain time is recoverable from the
// block number in the raw event row. Block numbers and tx hashes are
// always taken from the log itself, never invented.

type JanlekhaLog = Log & { args: Record<string, unknown> };

function jlBlock(log: JanlekhaLog): string {
  return log.blockNumber?.toString() ?? "0";
}

function jlTx(log: JanlekhaLog): string {
  return log.transactionHash ?? "";
}

function jlNow(): number {
  return Math.floor(Date.now() / 1000);
}

function recordJanlekhaEvent(registry: string, log: JanlekhaLog, eventName: string, recordId: string, projectId: string) {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(log.args ?? {})) {
    raw[k] = typeof v === "bigint" ? v.toString() : v;
  }
  dbAccess.insertJanlekhaEvent(
    registry, eventName, recordId, projectId,
    jlBlock(log), Number(log.logIndex ?? 0), jlTx(log), JSON.stringify(raw),
  );
}

function handleProjectRegistered(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; departmentId: string; contractor: Address; name: string; budgetInr: bigint };
  recordJanlekhaEvent(registry, log, "ProjectRegistered", a.id, a.id);
  dbAccess.upsertJanlekhaProject(a.id, a.name, a.departmentId, a.contractor.toLowerCase(), a.budgetInr.toString(), 0, jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] ProjectRegistered ${a.id} (${a.name})`);
}

function handleProjectStatusUpdated(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; status: number; updatedBy: Address };
  recordJanlekhaEvent(registry, log, "ProjectStatusUpdated", a.id, a.id);
  dbAccess.updateJanlekhaProjectStatus(a.id, Number(a.status), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] ProjectStatusUpdated ${a.id} -> ${a.status}`);
}

function handleAllocationApproved(registry: string, log: JanlekhaLog) {
  const a = log.args as {
    id: string; departmentId: string; projectId: string;
    amountInr: bigint; amountUsdcBaseUnits: bigint; approvedBy: Address;
  };
  recordJanlekhaEvent(registry, log, "AllocationApproved", a.id, a.projectId);
  dbAccess.upsertJanlekhaAllocation(
    a.id, a.departmentId, a.projectId, a.amountInr.toString(),
    a.amountUsdcBaseUnits.toString(), a.approvedBy.toLowerCase(), jlNow(), jlBlock(log), jlTx(log),
  );
  console.log(`[indexer:janlekha] AllocationApproved ${a.id} for project ${a.projectId}`);
}

function handleAllocationReleased(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; projectId: string; releasedBy: Address };
  recordJanlekhaEvent(registry, log, "AllocationReleased", a.id, a.projectId);
  dbAccess.markJanlekhaAllocationReleased(a.id, a.releasedBy.toLowerCase(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] AllocationReleased ${a.id}`);
}

function handleTenderPublished(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; projectId: string; title: string; valueInr: bigint; deadline: bigint };
  recordJanlekhaEvent(registry, log, "TenderPublished", a.id, a.projectId);
  dbAccess.upsertJanlekhaTender(a.id, a.projectId, a.title, a.valueInr.toString(), Number(a.deadline), jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] TenderPublished ${a.id} (${a.title})`);
}

function handleBidSubmitted(registry: string, log: JanlekhaLog) {
  const a = log.args as { tenderId: string; contractor: Address; amountInr: bigint };
  recordJanlekhaEvent(registry, log, "BidSubmitted", a.tenderId, "");
  dbAccess.insertJanlekhaBid(a.tenderId, a.contractor.toLowerCase(), a.amountInr.toString(), jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] BidSubmitted tender ${a.tenderId} by ${a.contractor}`);
}

function handleBidSelected(registry: string, log: JanlekhaLog) {
  const a = log.args as { tenderId: string; contractor: Address; amountInr: bigint };
  recordJanlekhaEvent(registry, log, "BidSelected", a.tenderId, "");
  dbAccess.updateJanlekhaTenderAward(a.tenderId, a.contractor.toLowerCase(), a.amountInr.toString(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] BidSelected tender ${a.tenderId} -> ${a.contractor}`);
}

function handleMilestoneSubmitted(registry: string, log: JanlekhaLog) {
  const a = log.args as {
    id: string; projectId: string; submitter: Address;
    amountInr: bigint; amountUsdcBaseUnits: bigint; evidenceHash: string;
  };
  recordJanlekhaEvent(registry, log, "MilestoneSubmitted", a.id, a.projectId);
  dbAccess.upsertJanlekhaMilestone(
    a.id, a.projectId, a.submitter.toLowerCase(), a.amountInr.toString(),
    a.amountUsdcBaseUnits.toString(), a.evidenceHash, jlNow(), jlBlock(log), jlTx(log),
  );
  console.log(`[indexer:janlekha] MilestoneSubmitted ${a.id} for project ${a.projectId}`);
}

function handleMilestoneStatusEvent(registry: string, log: JanlekhaLog, eventName: string, status: number) {
  const a = log.args as { id: string; verifiedBy?: Address; markedBy?: Address; rejectedBy?: Address };
  const actor = (a.verifiedBy ?? a.markedBy ?? a.rejectedBy)?.toLowerCase() ?? null;
  recordJanlekhaEvent(registry, log, eventName, a.id, "");
  dbAccess.updateJanlekhaMilestoneStatus(a.id, status, actor, jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] ${eventName} ${a.id}`);
}

function handlePaymentRecorded(registry: string, log: JanlekhaLog) {
  const a = log.args as {
    id: string; projectId: string; milestoneId: string; payee: Address;
    amountUsdcBaseUnits: bigint; invoiceHash: string; recordedBy: Address;
  };
  recordJanlekhaEvent(registry, log, "PaymentRecorded", a.id, a.projectId);
  dbAccess.insertJanlekhaPayment(
    a.id, a.projectId, a.milestoneId, a.payee.toLowerCase(),
    a.amountUsdcBaseUnits.toString(), a.invoiceHash, a.recordedBy.toLowerCase(),
    jlNow(), jlBlock(log), jlTx(log),
  );
  console.log(`[indexer:janlekha] PaymentRecorded ${a.id} ${a.amountUsdcBaseUnits} base units to ${a.payee}`);
}

function handleDocumentRegistered(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; projectId: string; contentHash: string; docType: string; uploadedBy: Address };
  recordJanlekhaEvent(registry, log, "DocumentRegistered", a.id, a.projectId);
  dbAccess.upsertJanlekhaDocument(
    a.id, a.projectId, a.contentHash, a.docType, a.uploadedBy.toLowerCase(), jlNow(), jlBlock(log), jlTx(log),
  );
  console.log(`[indexer:janlekha] DocumentRegistered ${a.id} hash ${a.contentHash}`);
}

function handleDocumentVerified(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; verifiedBy: Address };
  recordJanlekhaEvent(registry, log, "DocumentVerified", a.id, "");
  dbAccess.markJanlekhaDocumentVerified(a.id, a.verifiedBy.toLowerCase(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] DocumentVerified ${a.id}`);
}

function handleFlagRaised(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; projectId: string; reason: string; risk: number; raisedBy: Address };
  recordJanlekhaEvent(registry, log, "FlagRaised", a.id, a.projectId);
  dbAccess.upsertJanlekhaFlag(a.id, a.projectId, a.reason, Number(a.risk), a.raisedBy.toLowerCase(), jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] FlagRaised ${a.id} on project ${a.projectId} (risk ${a.risk})`);
}

function handleFlagResolved(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; resolvedBy: Address; resolutionNote: string };
  recordJanlekhaEvent(registry, log, "FlagResolved", a.id, "");
  dbAccess.resolveJanlekhaFlag(a.id, a.resolvedBy.toLowerCase(), jlNow(), a.resolutionNote, jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] FlagResolved ${a.id}`);
}

function handleReportPublished(registry: string, log: JanlekhaLog) {
  const a = log.args as { id: string; projectId: string; title: string; findings: bigint; auditor: Address };
  recordJanlekhaEvent(registry, log, "ReportPublished", a.id, a.projectId);
  dbAccess.insertJanlekhaReport(a.id, a.projectId, a.title, Number(a.findings), jlNow(), a.auditor.toLowerCase(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] ReportPublished ${a.id} (${a.title})`);
}

function handleRoleGranted(registry: string, log: JanlekhaLog) {
  const a = log.args as { role: string; account: Address; grantedBy: Address };
  recordJanlekhaEvent(registry, log, "RoleGranted", a.account.toLowerCase(), "");
  dbAccess.upsertJanlekhaRoleGrant(a.role, a.account.toLowerCase(), a.grantedBy.toLowerCase(), jlNow(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] RoleGranted ${a.role} to ${a.account}`);
}

function handleRoleRevoked(registry: string, log: JanlekhaLog) {
  const a = log.args as { role: string; account: Address; revokedBy: Address };
  recordJanlekhaEvent(registry, log, "RoleRevoked", a.account.toLowerCase(), "");
  dbAccess.revokeJanlekhaRoleGrant(a.role, a.account.toLowerCase(), a.revokedBy.toLowerCase(), jlBlock(log), jlTx(log));
  console.log(`[indexer:janlekha] RoleRevoked ${a.role} from ${a.account}`);
}

const JANLEKHA_EVENT_HANDLERS: Record<string, (registry: string, log: JanlekhaLog) => void> = {
  ProjectRegistered:   handleProjectRegistered,
  ProjectStatusUpdated: handleProjectStatusUpdated,
  AllocationApproved:  handleAllocationApproved,
  AllocationReleased:  handleAllocationReleased,
  TenderPublished:     handleTenderPublished,
  BidSubmitted:        handleBidSubmitted,
  BidSelected:         handleBidSelected,
  MilestoneSubmitted:  handleMilestoneSubmitted,
  MilestoneVerified:   (r, l) => handleMilestoneStatusEvent(r, l, "MilestoneVerified", 1),
  MilestonePaid:       (r, l) => handleMilestoneStatusEvent(r, l, "MilestonePaid", 2),
  MilestoneRejected:   (r, l) => handleMilestoneStatusEvent(r, l, "MilestoneRejected", 3),
  PaymentRecorded:     handlePaymentRecorded,
  DocumentRegistered:  handleDocumentRegistered,
  DocumentVerified:    handleDocumentVerified,
  FlagRaised:          handleFlagRaised,
  FlagResolved:        handleFlagResolved,
  ReportPublished:     handleReportPublished,
  RoleGranted:         handleRoleGranted,
  RoleRevoked:         handleRoleRevoked,
};

// ─── Polling-based indexer ───────────────────────────────────────────────────

let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let janlekhaPollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll one JanLekha registry at a time. Each registry keeps its own
 * block cursor in janlekha_cursor, so a restart resumes per contract.
 * A registry with no configured address is skipped, never polled with a
 * zero address. Runs independently of the StreetSync escrow poll: if the
 * escrow is unconfigured, JanLekha indexing still starts, and vice versa.
 */
async function startJanlekhaIndexer(client: ReturnType<typeof createClient>): Promise<void> {
  const addresses = resolveJanlekhaAddresses();
  if (addresses.size === 0) {
    console.warn("[indexer:janlekha] No JanLekha registry addresses configured. JanLekha indexing disabled.");
    console.warn("[indexer:janlekha] Set JANLEKHA_*_REGISTRY_ADDRESS in .env or provide contracts/deployments/arcTestnet-janlekha.json.");
    return;
  }

  const deploymentBlock = resolveJanlekhaDeploymentBlock();
  const cursors = new Map<string, bigint>();
  try {
    const currentBlock = await client.getBlockNumber();
    for (const [key] of addresses) {
      let from = dbAccess.getJanlekhaCursor(key);
      if (from === 0n) {
        from = deploymentBlock !== null && deploymentBlock > 0n
          ? deploymentBlock - 1n
          : currentBlock > 1000n ? currentBlock - 1000n : 0n;
        console.log(`[indexer:janlekha] No cursor for ${key}, starting from block ${from}`);
      } else {
        console.log(`[indexer:janlekha] Resuming ${key} from block ${from}`);
      }
      cursors.set(key, from);
    }
  } catch (e) {
    console.error("[indexer:janlekha] Cannot read chain head, JanLekha indexing disabled:", (e as Error).message);
    return;
  }

  async function pollJanlekha() {
    if (!isRunning) return;
    try {
      const currentBlock = (await client.getBlockNumber()) - CONFIRMATION_LAG;
      const batchSize = 2000n;
      for (const [key, address] of addresses) {
        const lastBlock = cursors.get(key) ?? 0n;
        if (currentBlock <= lastBlock) continue;
        const fromBlock = lastBlock + 1n;
        const toBlock = currentBlock - fromBlock > batchSize ? fromBlock + batchSize : currentBlock;
        // Address-only filter, decode locally: same Arc RPC restriction as the escrow poll.
        const rawLogs = await client.getLogs({ address, fromBlock, toBlock });
        const logs = parseEventLogs({ abi: JANLEKHA_ABI as any, logs: rawLogs });
        for (const log of logs) {
          const eventName = (log as any).eventName as string;
          const handler = JANLEKHA_EVENT_HANDLERS[eventName];
          if (handler) {
            try {
              handler(key, log as any);
            } catch (e) {
              console.error(`[indexer:janlekha] Error processing ${eventName} on ${key}:`, e);
            }
          }
        }
        cursors.set(key, toBlock);
        dbAccess.setJanlekhaCursor(key, toBlock);
        if (logs.length > 0) {
          console.log(`[indexer:janlekha] ${key}: processed ${logs.length} events up to block ${toBlock}`);
        }
      }
    } catch (e) {
      console.error("[indexer:janlekha] Poll error:", (e as Error).message);
      janlekhaPollTimer = setTimeout(pollJanlekha, POLL_INTERVAL_MS * 2);
      return;
    }
    janlekhaPollTimer = setTimeout(pollJanlekha, POLL_INTERVAL_MS);
  }

  await pollJanlekha();
}

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

  // Verify connectivity first: without an RPC neither indexer can run.
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

  // ── JanLekha registries (independent of the escrow) ───────────────────────
  await startJanlekhaIndexer(client);
}

export function stopIndexer(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (janlekhaPollTimer) {
    clearTimeout(janlekhaPollTimer);
    janlekhaPollTimer = null;
  }
  console.log("[indexer] Stopped.");
}

export default { startIndexer, stopIndexer };

