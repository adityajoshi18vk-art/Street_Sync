export const STATUS_NAMES = [
  "Open",
  "Claimed",
  "Submitted",
  "InReview",
  "Approved",
  "Rejected",
  "Refunded"
] as const;

export type BountyStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type StatusName = (typeof STATUS_NAMES)[number];

export const STATUS_COLORS: Record<StatusName, string> = {
  Open: "#22c55e",
  Claimed: "#eab308",
  Submitted: "#8b5cf6",
  InReview: "#f97316",
  Approved: "#3b82f6",
  Rejected: "#ef4444",
  Refunded: "#6b7280"
};

export const STATUS_TEXT_CLASSES: Record<StatusName, string> = {
  Open: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/30",
  Claimed: "text-amber-300 bg-amber-400/10 ring-amber-400/30",
  Submitted: "text-violet-300 bg-violet-400/10 ring-violet-400/30",
  InReview: "text-orange-300 bg-orange-400/10 ring-orange-400/30",
  Approved: "text-blue-300 bg-blue-400/10 ring-blue-400/30",
  Rejected: "text-red-300 bg-red-400/10 ring-red-400/30",
  Refunded: "text-slate-300 bg-slate-400/10 ring-slate-400/30"
};

export function statusName(status: number): StatusName {
  return STATUS_NAMES[status] ?? "Open";
}

/** Normalized bounty shape shared by map, detail, review, and audit views. */
export interface BountyMapItem {
  bountyId: string;
  lat: number;
  lng: number;
  totalPledged: number; // human USDC
  status: number;
  worker: string | null;
  creator: string | null;
  descriptionHash: string | null;
  description?: string | null;
}

/** Shape returned by GET /api/bounties (Fastify indexer cache). */
export interface BackendBounty {
  bounty_id?: string | number;
  bountyId?: string | number;
  id?: string | number;
  lat?: number;
  lng?: number;
  lat_e5?: number;
  lng_e5?: number;
  total_pledged?: string | number;
  totalPledged?: string | number;
  totalPledgedUsdc?: string;
  status?: number;
  worker?: string | null;
  creator?: string | null;
  description_hash?: string;
  descriptionHash?: string;
  description?: string | null;
  [key: string]: unknown;
}

export function normalizeBounty(raw: BackendBounty): BountyMapItem {
  const latE5 = raw.lat_e5;
  const lngE5 = raw.lng_e5;
  const id = String(raw.bounty_id ?? raw.bountyId ?? raw.id ?? "");
  const pledgedRaw = raw.total_pledged ?? raw.totalPledged;
  const totalPledged =
    raw.totalPledgedUsdc !== undefined
      ? Number(raw.totalPledgedUsdc)
      : pledgedRaw !== undefined
        ? Number(pledgedRaw) / 1e6
        : 0;
  const lat = raw.lat ?? (latE5 !== undefined ? latE5 / 1e5 : 0);
  const lng = raw.lng ?? (lngE5 !== undefined ? lngE5 / 1e5 : 0);

  return {
    bountyId: id,
    lat,
    lng,
    totalPledged,
    status: Number(raw.status ?? 0),
    worker: raw.worker ?? null,
    creator: raw.creator ?? null,
    descriptionHash: raw.description_hash ?? raw.descriptionHash ?? null,
    description: raw.description ?? null
  };
}

/** Full on-chain Bounty struct decoded by viem from getBounty(). */
export interface OnChainBounty {
  id: bigint;
  creator: string;
  descriptionHash: string;
  latE5: number;
  lngE5: number;
  regionCell: number;
  totalPledged: bigint;
  createdAt: bigint;
  claimDeadline: bigint;
  worker: string;
  visualChallengeCode: number;
  arkivEntityKey: string;
  evidenceHash: string;
  selectionBlock: bigint;
  reviewRound: number;
  reworkCount: number;
  status: number;
}

export interface ReviewerInfo {
  wallet: string;
  regionCell: number;
  stakedAmount: bigint;
  active: boolean;
  rewardBalance: bigint;
}

export interface ReviewerAssignment {
  bountyId: string;
  reviewRound: number;
  panelPosition: number;
  bountyStatus: number | null;
  totalPledged: string;
  worker: string | null;
  myVote: { committed: boolean; revealed: boolean; approve: boolean | null } | null;
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return "—";
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export function shortHash(hash: string | null | undefined, size = 6): string {
  if (!hash || hash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return "—";
  }
  return `${hash.slice(0, 2 + size)}…${hash.slice(-size)}`;
}

export function isZeroHash(hash: string | null | undefined): boolean {
  return !hash || /^0x0+$/.test(hash);
}

/** Formats an already-human (not base-unit) USDC number for display. */
export function formatUsdcDisplaySafe(amount: number): string {
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatUtc(tsSeconds: bigint | number): string {
  const n = typeof tsSeconds === "bigint" ? Number(tsSeconds) : tsSeconds;
  return new Date(n * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
