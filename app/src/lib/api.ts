import { BACKEND_API_URL } from "@/config/contracts";
import type { BackendBounty, ReviewerAssignment } from "./types";

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

export type WorldIdRole = "worker" | "reviewer" | "neighbour";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface WorldIdRequestContext {
  app_id: `app_${string}`;
  environment: "production" | "staging";
  rp_context: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
}

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; ok: boolean; data: T | null; error: string | null }> {
  const res = await fetch(`${BACKEND_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { status: res.status, ok: false, data: null, error: await parseError(res) };
  return { status: res.status, ok: true, data: (await res.json()) as T, error: null };
}

function requireAttestation(data: { success?: boolean; attestation?: Attestation } | null): Attestation {
  if (!data?.success || !data.attestation?.signature) throw new Error("Backend did not return a valid attestation");
  return data.attestation;
}

/** POST /api/worldid/rp-context — backend-signed World ID 4.0 request context. */
export async function requestWorldIdContext(action: string): Promise<WorldIdRequestContext> {
  const res = await postJson<WorldIdRequestContext>("/api/worldid/rp-context", { action });
  if (!res.ok || !res.data) throw new Error(`World ID is unavailable: ${res.error}`);
  return res.data;
}

/**
 * POST /api/worldid/attest — returns an attestation when this wallet already verified
 * for the role, or null when a fresh World ID proof is required.
 */
export async function reuseWorldIdAttestation(params: {
  wallet: string; role: WorldIdRole; bountyId: string; location?: GeoPoint;
}): Promise<Attestation | null> {
  const res = await postJson<{ success: boolean; attestation: Attestation }>("/api/worldid/attest", params);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not get attestation: ${res.error}`);
  return requireAttestation(res.data);
}

/** POST /api/worldid/verify — verifies the IDKit 4 result and returns the EIP-712 attestation. */
export async function verifyWorldIdProof(params: {
  wallet: string; role: WorldIdRole; bountyId: string; idkitResponse: unknown; location?: GeoPoint;
}): Promise<Attestation> {
  const res = await postJson<{ success: boolean; attestation: Attestation }>("/api/worldid/verify", params);
  if (!res.ok) throw new Error(`World ID verification failed: ${res.error}`);
  return requireAttestation(res.data);
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

export async function getBackendHealth(): Promise<BackendHealth> {
  const res = await fetch(`${BACKEND_API_URL}/api/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Backend unhealthy: HTTP ${res.status}`);
  return (await res.json()) as BackendHealth;
}

export interface BountyReport {
  bountyId: string;
  entityKey: string;
  reportHash: string;
  description: string;
  creator: string;
  latE5: number;
  lngE5: number;
  capturedAtMs: number;
  photoBase64: string;
  photoMime: string;
}

/** GET /api/bounties/:id/report — null when the reporter's photo is not uploaded yet (404). */
export async function getBountyReport(bountyId: string): Promise<BountyReport | null> {
  const res = await fetch(`${BACKEND_API_URL}/api/bounties/${bountyId}/report`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Problem report unavailable: ${await parseError(res)}`);
  return (await res.json()) as BountyReport;
}

export interface UploadReportResult {
  entityKey: string;
  txHash: string | null;
  reportHash: string;
  alreadyStored: boolean;
}

/** POST /api/arkiv/reports — stores the reporter's bundle (idempotent per bounty). */
export async function uploadBountyReport(bountyId: string, bundle: Uint8Array): Promise<UploadReportResult> {
  const res = await postJson<UploadReportResult>("/api/arkiv/reports", {
    bountyId, payload: bytesToBase64(bundle)
  });
  if (!res.ok || !res.data) throw new Error(`Photo upload failed: ${res.error}`);
  return res.data;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
