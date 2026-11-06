import { BACKEND_API_URL } from "@/config/contracts";
import type { BackendBounty, ReviewerAssignment } from "./types";

export interface WorldIdSuccessResult {
  nullifier_hash: string;
  merkle_root: string;
  proof: string;
  verification_level: string;
}

export interface Attestation {
  wallet: string;
  role: number;
  bountyId: string;
  nonce: string;
  expiry: number;
  signature: `0x${string}`;
  attester: string;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    return body.error ?? body.detail ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status} ${res.statusText}`;
  }
}

/**
 * POST /api/worldid/verify — verifies the IDKit proof against the World ID v4
 * API and returns the backend's EIP-712 attestation for claim()/registerReviewer().
 */
export async function requestAttestation(params: {
  wallet: string;
  role: "worker" | "reviewer";
  bountyId: string;
  action: string;
  worldIdProof: WorldIdSuccessResult;
}): Promise<Attestation> {
  const res = await fetch(`${BACKEND_API_URL}/api/worldid/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof: params.worldIdProof.proof,
      merkle_root: params.worldIdProof.merkle_root,
      nullifier_hash: params.worldIdProof.nullifier_hash,
      verification_level: params.worldIdProof.verification_level,
      action: params.action,
      wallet: params.wallet,
      role: params.role,
      bountyId: params.bountyId
    })
  });

  if (!res.ok) {
    throw new Error(`World ID verification failed: ${await parseError(res)}`);
  }

  const data = (await res.json()) as { success: boolean; attestation: Attestation };
  if (!data.success || !data.attestation?.signature) {
    throw new Error("Backend did not return a valid attestation");
  }
  return data.attestation;
}

export async function listBounties(params?: {
  status?: number;
  limit?: number;
  worker?: string;
  reviewer?: string;
}): Promise<BackendBounty[]> {
  const qs = new URLSearchParams();
  if (params?.status !== undefined) qs.set("status", String(params.status));
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.worker) qs.set("worker", params.worker);
  if (params?.reviewer) qs.set("reviewer", params.reviewer);

  const res = await fetch(`${BACKEND_API_URL}/api/bounties?${qs.toString()}`, {
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Backend bounties unavailable: ${await parseError(res)}`);
  }
  const data = (await res.json()) as { bounties: BackendBounty[]; count: number };
  return data.bounties ?? [];
}

export async function getBackendBounty(bountyId: string): Promise<BackendBounty | null> {
  try {
    const res = await fetch(`${BACKEND_API_URL}/api/bounties/${bountyId}`, {
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { bounty: BackendBounty };
    return data.bounty ?? null;
  } catch {
    return null;
  }
}

export async function getReviewerAssignments(
  address: string
): Promise<ReviewerAssignment[]> {
  const res = await fetch(
    `${BACKEND_API_URL}/api/reviewers/${address.toLowerCase()}/assignments`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Assignments unavailable: ${await parseError(res)}`);
  }
  const data = (await res.json()) as { assignments: ReviewerAssignment[] };
  return data.assignments ?? [];
}

export interface BackendHealth {
  status: string;
  chainId: number;
  attester: string;
  worldAppId: string;
}

export interface StickerStatus {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tier: "bronze" | "silver" | "gold";
  xp: number;
  target: number;
  progress: number;
  earned: boolean;
  awardedAt: number | null;
}

export interface StickerProfile {
  address: string;
  stats: {
    bountiesCreated: number;
    pledgedBounties: number;
    pledgedTotal: string;
    bountiesClaimed: number;
    approvedFixes: number;
    evidenceSubmitted: number;
    votesRevealed: number;
    slashes: number;
  };
  xp: number;
  level: { index: number; title: string; minXp: number; nextXp: number | null };
  earnedCount: number;
  totalCount: number;
  stickers: StickerStatus[];
}

/**
 * GET /api/stickers/:address — gamification sticker collection, XP, and level.
 */
export async function getStickerProfile(address: string): Promise<StickerProfile> {
  const res = await fetch(`${BACKEND_API_URL}/api/stickers/${address.toLowerCase()}`, {
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Sticker profile unavailable: ${await parseError(res)}`);
  }
  return (await res.json()) as StickerProfile;
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const res = await fetch(`${BACKEND_API_URL}/api/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Backend unhealthy: HTTP ${res.status}`);
  return (await res.json()) as BackendHealth;
}
