import "server-only";
import type { Address, Hex } from "viem";
import { janLekhaAbi } from "./abi";
import { chainConfig, publicClient, ReadError, revertErrorName, toReadFailure, type ChainConfig, type ReadFailure } from "./chain";
import { getProjectTimeline, type TimelineEvent } from "./events";

import type { ActionState, MilestoneStatusName } from "./action-state";

export const MilestoneStatus = ["None", "Defined", "EvidenceSubmitted", "Approved", "Paid"] as const satisfies readonly MilestoneStatusName[];
export type { MilestoneStatusName };

export type Stage =
  | "Tender not published"
  | "Bidding open"
  | "Reveal period"
  | "Awaiting award"
  | "In delivery"
  | "Completed";

export interface BudgetView {
  allocationPaise: bigint;
  reservedPaise: bigint;
  paidPaise: bigint;
}

export interface TenderView {
  tenderDocumentHash: Hex;
  bidDeadline: bigint;
  revealDeadline: bigint;
  publishedAt: bigint;
  commitCount: number;
  revealCount: number;
}

export interface AwardView {
  vendor: Address;
  amountPaise: bigint;
  evaluationDocumentHash: Hex;
  contractDocumentHash: Hex;
  awardedAt: bigint;
  milestoneCount: number;
  milestoneTotalPaise: bigint;
}

export interface BidView {
  vendor: Address;
  commitment: Hex;
  committedAt: bigint;
  revealed: boolean;
  revealedAt: bigint;
  amountPaise: bigint;
  quotationDocumentHash: Hex;
}

export interface MilestoneView {
  id: number;
  amountPaise: bigint;
  specificationDocumentHash: Hex;
  status: MilestoneStatusName;
  definedAt: bigint;
  evidenceDocumentHash: Hex;
  evidenceSubmittedAt: bigint;
  inspector: Address;
  inspectionReportHash: Hex;
  approvedAt: bigint;
  pao: Address;
  paymentReferenceHash: Hex;
  paidAt: bigint;
}

export interface ProjectSummary {
  id: bigint;
  department: Address;
  sanctionDocumentHash: Hex;
  createdAt: bigint;
  budget: BudgetView;
  tender: TenderView | null;
  award: AwardView | null;
  stage: Stage;
}

export interface ProjectDetail extends ProjectSummary {
  bids: BidView[];
  milestones: MilestoneView[];
  timeline: { ok: true; events: TimelineEvent[] } | { ok: false; failure: ReadFailure };
}

export interface ChainContext {
  cfg: ChainConfig;
  contractAddress: Address;
  /** Latest block timestamp. Deadlines are compared against chain time, not the server clock. */
  chainTime: bigint;
  blockNumber: bigint;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; failure: ReadFailure };

async function connect(cfg: ChainConfig): Promise<ChainContext> {
  const address = cfg.contractAddress;
  if (!address) {
    throw new ReadError({
      kind: "not-configured",
      title: "No JanLekha contract is configured",
      detail: "Set NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS to a deployed JanLekha contract to show public records.",
    });
  }
  const client = publicClient(cfg);
  const [chainId, code, block] = await Promise.all([
    client.getChainId(),
    client.getCode({ address }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  if (chainId !== cfg.chainId) {
    throw new ReadError({
      kind: "wrong-chain",
      title: "The RPC endpoint is on a different chain",
      detail: `Expected chain ${cfg.chainId} but ${cfg.rpcUrl} reports chain ${chainId}. Records are not shown to avoid displaying another network's data.`,
    });
  }
  if (!code || code === "0x") {
    throw new ReadError({
      kind: "no-contract",
      title: "No contract found at the configured address",
      detail: `${address} has no deployed code on chain ${chainId}. The deployment may be on another network or the address is wrong.`,
    });
  }
  return { cfg, contractAddress: address, chainTime: block.timestamp, blockNumber: block.number };
}

function stageOf(tender: TenderView | null, award: AwardView | null, budget: BudgetView, now: bigint): Stage {
  if (!tender) return "Tender not published";
  if (now < tender.bidDeadline) return "Bidding open";
  if (now < tender.revealDeadline) return "Reveal period";
  if (!award) return "Awaiting award";
  return budget.paidPaise === award.amountPaise ? "Completed" : "In delivery";
}

async function readSummary(ctx: ChainContext, id: bigint): Promise<ProjectSummary> {
  const client = publicClient(ctx.cfg);
  const read = { address: ctx.contractAddress, abi: janLekhaAbi } as const;
  const [project, tender, award, budget] = await Promise.all([
    client.readContract({ ...read, functionName: "getProject", args: [id] }),
    client.readContract({ ...read, functionName: "getTender", args: [id] }),
    client.readContract({ ...read, functionName: "getAward", args: [id] }),
    client.readContract({ ...read, functionName: "getBudget", args: [id] }),
  ]);
  const tenderView = tender.publishedAt === 0n ? null : { ...tender };
  const awardView = award.awardedAt === 0n ? null : { ...award };
  const budgetView = { ...budget };
  return {
    id,
    department: project.department,
    sanctionDocumentHash: project.sanctionDocumentHash,
    createdAt: project.createdAt,
    budget: budgetView,
    tender: tenderView,
    award: awardView,
    stage: stageOf(tenderView, awardView, budgetView, ctx.chainTime),
  };
}

const LIST_LIMIT = 50n;

export async function listProjects(): Promise<Result<{ ctx: ChainContext; projects: ProjectSummary[]; total: bigint }>> {
  const cfg = chainConfig();
  try {
    const ctx = await connect(cfg);
    const total = await publicClient(cfg).readContract({
      address: ctx.contractAddress,
      abi: janLekhaAbi,
      functionName: "projectCount",
    });
    const ids: bigint[] = [];
    for (let id = total; id >= 1n && id > total - LIST_LIMIT; id--) ids.push(id);
    const projects = await Promise.all(ids.map((id) => readSummary(ctx, id)));
    return { ok: true, ctx, projects, total };
  } catch (error) {
    return { ok: false, failure: toReadFailure(error, cfg) };
  }
}

export type ProjectResult =
  | { status: "ok"; ctx: ChainContext; project: ProjectDetail }
  | { status: "not-found"; reason: string }
  | { status: "error"; failure: ReadFailure };

/** Accepts the raw route segment; anything but a positive integer is "not found", not an error. */
export function parseProjectId(raw: string): bigint | null {
  return /^[1-9][0-9]{0,30}$/.test(raw) ? BigInt(raw) : null;
}

export async function getProject(rawId: string): Promise<ProjectResult> {
  const id = parseProjectId(rawId);
  if (id === null) {
    return { status: "not-found", reason: `"${rawId.slice(0, 40)}" is not a valid project id. Project ids are positive whole numbers.` };
  }
  const cfg = chainConfig();
  try {
    const ctx = await connect(cfg);
    const client = publicClient(cfg);
    const read = { address: ctx.contractAddress, abi: janLekhaAbi } as const;

    let summary: ProjectSummary;
    try {
      summary = await readSummary(ctx, id);
    } catch (error) {
      if (revertErrorName(error) === "UnknownProject") {
        return { status: "not-found", reason: `Project #${id} does not exist on this contract.` };
      }
      throw error;
    }

    const bidders = await client.readContract({ ...read, functionName: "getBidders", args: [id] });
    const milestoneIds = Array.from({ length: summary.award?.milestoneCount ?? 0 }, (_, i) => BigInt(i + 1));
    const [bids, milestones, timeline] = await Promise.all([
      Promise.all(
        bidders.map(async (vendor) => ({
          vendor,
          ...(await client.readContract({ ...read, functionName: "getBid", args: [id, vendor] })),
        })),
      ),
      Promise.all(
        milestoneIds.map(async (mid) => {
          const m = await client.readContract({ ...read, functionName: "getMilestone", args: [id, mid] });
          return { ...m, id: Number(mid), status: MilestoneStatus[m.status] ?? "None" };
        }),
      ),
      // A timeline failure (e.g. mirror node down) should not hide the verified contract state.
      getProjectTimeline(cfg, ctx.contractAddress, id).then(
        (events) => ({ ok: true as const, events }),
        (error: unknown) => {
          console.error("[janlekha] timeline read failed:", error);
          return {
            ok: false as const,
            failure: {
              kind: "rpc-unavailable" as const,
              title: "Event timeline unavailable",
              detail: cfg.isHedera
                ? `The Hedera mirror node (${cfg.mirrorNodeUrl}) could not be read. Contract state above is unaffected.`
                : `Event logs could not be read from ${cfg.rpcUrl}. Contract state above is unaffected.`,
            },
          };
        },
      ),
    ]);

    return { status: "ok", ctx, project: { ...summary, bids, milestones, timeline } };
  } catch (error) {
    return { status: "error", failure: toReadFailure(error, cfg) };
  }
}

export interface VerifiableDocument {
  key: string;
  label: string;
  hash: Hex;
  recordedAt: bigint;
}

/** Every SHA-256 document hash anchored on-chain for a project, in lifecycle order. */
export function verifiableDocuments(p: ProjectDetail): VerifiableDocument[] {
  const docs: VerifiableDocument[] = [
    { key: "sanction", label: "Sanction order", hash: p.sanctionDocumentHash, recordedAt: p.createdAt },
  ];
  if (p.tender) docs.push({ key: "tender", label: "Tender document", hash: p.tender.tenderDocumentHash, recordedAt: p.tender.publishedAt });
  for (const bid of p.bids) {
    if (bid.revealed) {
      docs.push({ key: `quotation-${bid.vendor.toLowerCase()}`, label: `Quotation from ${bid.vendor.slice(0, 10)}…`, hash: bid.quotationDocumentHash, recordedAt: bid.revealedAt });
    }
  }
  if (p.award) {
    docs.push({ key: "evaluation", label: "Bid evaluation report", hash: p.award.evaluationDocumentHash, recordedAt: p.award.awardedAt });
    docs.push({ key: "contract", label: "Contract agreement", hash: p.award.contractDocumentHash, recordedAt: p.award.awardedAt });
  }
  for (const m of p.milestones) {
    docs.push({ key: `m${m.id}-spec`, label: `Milestone ${m.id} specification`, hash: m.specificationDocumentHash, recordedAt: m.definedAt });
    if (m.evidenceSubmittedAt > 0n) docs.push({ key: `m${m.id}-evidence`, label: `Milestone ${m.id} evidence`, hash: m.evidenceDocumentHash, recordedAt: m.evidenceSubmittedAt });
    if (m.approvedAt > 0n) docs.push({ key: `m${m.id}-inspection`, label: `Milestone ${m.id} inspection report`, hash: m.inspectionReportHash, recordedAt: m.approvedAt });
    if (m.paidAt > 0n) docs.push({ key: `m${m.id}-payment`, label: `Milestone ${m.id} mock PFMS payment advice`, hash: m.paymentReferenceHash, recordedAt: m.paidAt });
  }
  return docs;
}

export function toActionState(p: ProjectDetail, ctx: ChainContext): ActionState {
  return {
    projectId: p.id.toString(),
    department: p.department,
    allocationPaise: p.budget.allocationPaise.toString(),
    reservedPaise: p.budget.reservedPaise.toString(),
    paidPaise: p.budget.paidPaise.toString(),
    chainTime: ctx.chainTime.toString(),
    tender: p.tender && {
      bidDeadline: p.tender.bidDeadline.toString(),
      revealDeadline: p.tender.revealDeadline.toString(),
      commitCount: p.tender.commitCount,
      revealCount: p.tender.revealCount,
    },
    bids: p.bids.map((b) => ({ vendor: b.vendor, commitment: b.commitment, revealed: b.revealed, amountPaise: b.amountPaise.toString() })),
    award: p.award && {
      vendor: p.award.vendor,
      amountPaise: p.award.amountPaise.toString(),
      milestoneTotalPaise: p.award.milestoneTotalPaise.toString(),
      milestoneCount: p.award.milestoneCount,
    },
    milestones: p.milestones.map((m) => ({ id: m.id, amountPaise: m.amountPaise.toString(), status: m.status, inspector: m.inspector })),
  };
}
