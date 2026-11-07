/**
 * worldid-janlekha.ts
 * World ID v4 citizen participation for JanLekha ONLY.
 *
 * What this does: let one verified human give feedback, file a complaint,
 * or join a community review of a milestone, once per human per item, so a
 * single person cannot flood a project with duplicate feedback or
 * complaints. It reuses the existing World ID v4 backend verification and
 * the EIP-712 attestation signer from signer.ts.
 *
 * What this does NOT do:
 *   - World ID proves uniqueness only. It does NOT grant any official
 *     role. Official roles (ADMIN, FINANCE, PROCUREMENT, CONTRACTOR,
 *     AUDITOR) come only from RoleRegistry grants by an Admin, and are
 *     indexed from RoleGranted events. A citizen attestation has role
 *     None (0) and bountyId 0, and no JanLekha contract verifies it; it
 *     is a backend record that one unique human participated.
 *   - No personal identity goes on chain. Only the nullifier hash is
 *     stored in SQLite, scoped per action, exactly like the StreetSync
 *     worker and reviewer flows. The nullifier cannot be reversed into
 *     a person, and the wallet is the only identifier recorded.
 *   - No World ID proof, nullifier, or attestation is ever fabricated.
 *     If the World ID app, RP ID, or attester signing key is not
 *     configured, verification fails closed with a 503 setup message.
 *
 * Nullifier scope: each action has its own action string, and the
 * reference (project id or milestone id) is part of that string, so one
 * proof cannot be reused across actions or across items:
 *   - feedback:         janlekha-feedback-<projectId>
 *   - complaint:        janlekha-complaint-<projectId>
 *   - community-review: janlekha-community-review-<milestoneId>
 * The project and milestone ids are the on-chain bytes32 ids (0x + 64
 * hex chars), the same ids used by the indexer and the verification doc.
 *
 * Dev bypass is deliberately NOT honored here. ALLOW_DEV_WORLD_ID_BYPASS
 * exists for StreetSync local development only; honoring it for citizen
 * participation would defeat the Sybil resistance this endpoint exists
 * to provide.
 */

import dbAccess from "./db.js";
import { signAttestation, RoleEnum, type AttestationResult } from "./signer.js";
import { randomBytes } from "node:crypto";
import { hashToField } from "@worldcoin/idkit-core/hashing";

// ─── Action definitions ──────────────────────────────────────────────────────

export const JANLEKHA_WORLD_ACTIONS = {
  feedback: "janlekha-feedback",
  complaint: "janlekha-complaint",
  "community-review": "janlekha-community-review",
} as const;

export type JanlekhaWorldAction = keyof typeof JANLEKHA_WORLD_ACTIONS;

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Derive the World ID action string for one citizen action on one item.
 * Returns null when the action is unknown or the reference is not a
 * bytes32 id, so the caller can reject the request before any proof is
 * checked.
 */
export function janlekhaWorldIdAction(
  action: string,
  refId: string,
): string | null {
  const prefix = (JANLEKHA_WORLD_ACTIONS as Record<string, string>)[action];
  if (!prefix) return null;
  if (!BYTES32_RE.test(refId)) return null;
  return `${prefix}-${refId.toLowerCase()}`;
}

// ─── Fail-closed configuration check ─────────────────────────────────────────

const HARDHAT_DEFAULT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export interface JanlekhaWorldIdConfig {
  configured: boolean;
  missing: string[];
  appId: string | null;
  rpId: string | null;
}

/**
 * JanLekha participation needs three things: a World ID app id, the
 * relying party id the v4 verify endpoint is called with, and the
 * backend attester key that signs the EIP-712 attestation. A separate
 * JANLEKHA_WORLD_APP_ID / JANLEKHA_WORLD_RP_ID may be set when JanLekha
 * uses its own World app; otherwise the shared StreetSync WORLD_APP_ID
 * and WORLD_RP_ID are used. Nothing is invented here: an unset or
 * placeholder value counts as missing.
 */
export function janlekhaWorldIdConfig(): JanlekhaWorldIdConfig {
  const appId =
    process.env.JANLEKHA_WORLD_APP_ID ?? process.env.WORLD_APP_ID ?? null;
  const rpId =
    process.env.JANLEKHA_WORLD_RP_ID ?? process.env.WORLD_RP_ID ?? null;
  const attesterKey = process.env.ATTESTER_PRIVATE_KEY ?? null;
  const chainId = Number(process.env.CHAIN_ID ?? "5042002");

  const missing: string[] = [];
  if (!appId || appId === "app_streetsync_dev" || appId === "") {
    missing.push("WORLD_APP_ID (or JANLEKHA_WORLD_APP_ID)");
  }
  if (!rpId || rpId === "") {
    missing.push("WORLD_RP_ID (or JANLEKHA_WORLD_RP_ID)");
  }
  if (!attesterKey || attesterKey === "") {
    missing.push("ATTESTER_PRIVATE_KEY");
  } else if (chainId !== 31337 && attesterKey.toLowerCase() === HARDHAT_DEFAULT_KEY) {
    missing.push("ATTESTER_PRIVATE_KEY (Hardhat public test key is not allowed on a non-local chain)");
  }

  return { configured: missing.length === 0, missing, appId, rpId };
}

export function janlekhaWorldIdSetupMessage(missing: string[]): string {
  return (
    "JanLekha World ID citizen participation is not configured. " +
    "Set these environment variables and restart the backend: " +
    missing.join(", ") +
    ". No proof was verified and no attestation was issued. " +
    "See backend/.env.example for the JanLekha World ID section."
  );
}

// ─── World ID v4 proof verification (same API shape as server.ts) ────────────

interface WorldVerifyResult {
  success: boolean;
  code?: string;
  detail?: string;
}

async function verifyWorldIdProof(p: {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  action: string;
  signal: string;
  rpId: string;
}): Promise<WorldVerifyResult> {
  const url =
    process.env.WORLD_VERIFY_URL ??
    `https://developer.world.org/api/v4/verify/${p.rpId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocol_version: "3.0",
      nonce: `0x${randomBytes(16).toString("hex")}`,
      action: p.action,
      responses: [
        {
          identifier: p.verification_level,
          proof: p.proof,
          merkle_root: p.merkle_root,
          nullifier: p.nullifier_hash,
          signal_hash: hashToField(p.signal).digest,
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    code?: string;
    detail?: string;
    results?: { success?: boolean; code?: string; detail?: string }[];
  };
  if (res.ok && body.success) return { success: true };
  const failed = body.results?.find((r) => r.success === false);
  return {
    success: false,
    code: failed?.code ?? body.code ?? `http_${res.status}`,
    detail: failed?.detail ?? body.detail ?? `HTTP ${res.status}`,
  };
}

// ─── Request handler ─────────────────────────────────────────────────────────

export interface JanlekhaWorldIdVerifyBody {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  action: string;
  wallet: string;
  ref_id: string;
  dev_bypass?: boolean;
}

export interface JanlekhaWorldIdVerifyResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Verify a JanLekha citizen participation proof and issue a backend
 * EIP-712 attestation with role None (0) and bountyId 0. The attestation
 * is NOT verified by any JanLekha contract; it is the backend's record
 * that one unique human participated, and the frontend uses it to gate
 * one feedback, complaint, or community review per human per item.
 * Returns an HTTP status plus JSON body so the Fastify route stays thin.
 */
export async function handleJanlekhaWorldIdVerify(
  input: JanlekhaWorldIdVerifyBody,
): Promise<JanlekhaWorldIdVerifyResult> {
  // Step 0: fail closed when World ID is not configured. No proof is
  // checked and no attestation is issued in that state.
  const config = janlekhaWorldIdConfig();
  if (!config.configured) {
    return {
      status: 503,
      body: {
        error: janlekhaWorldIdSetupMessage(config.missing),
        missing: config.missing,
      },
    };
  }

  const {
    proof,
    merkle_root,
    nullifier_hash,
    verification_level,
    action,
    wallet,
    ref_id,
  } = input;

  if (!proof || !merkle_root || !nullifier_hash || !verification_level || !action || !wallet || !ref_id) {
    return {
      status: 400,
      body: {
        error: "Missing required fields: proof, merkle_root, nullifier_hash, verification_level, action, wallet, ref_id",
      },
    };
  }

  // The action is derived here, never trusted from the client: otherwise
  // one human could mint unlimited attestations by verifying against
  // fresh action names.
  const actionId = janlekhaWorldIdAction(action, ref_id);
  if (!actionId) {
    return {
      status: 400,
      body: {
        error: `Invalid JanLekha World ID action or reference: action must be one of ${Object.keys(JANLEKHA_WORLD_ACTIONS).join(", ")} and ref_id must be a bytes32 id (0x plus 64 hex chars)`,
      },
    };
  }

  // Step 1: nullifier checks, scoped to this exact action string.
  const existingOtherWallet = dbAccess.checkNullifierOtherWallet(
    nullifier_hash,
    actionId,
    wallet.toLowerCase(),
  );
  if (existingOtherWallet) {
    return {
      status: 409,
      body: {
        error: "Sybil detected: this World ID identity already used a different wallet for this action",
        action: actionId,
      },
    };
  }
  if (dbAccess.checkNullifier(nullifier_hash, actionId)) {
    return {
      status: 409,
      body: {
        error: "This World ID identity has already participated for this action",
        action: actionId,
      },
    };
  }
  if (dbAccess.getJanlekhaParticipation(actionId, wallet.toLowerCase(), ref_id.toLowerCase())) {
    return {
      status: 409,
      body: {
        error: "This wallet has already participated for this action",
        action: actionId,
      },
    };
  }

  // Step 2: verify the proof with the World ID cloud API.
  let verified: WorldVerifyResult;
  try {
    verified = await verifyWorldIdProof({
      proof,
      merkle_root,
      nullifier_hash,
      verification_level,
      action: actionId,
      signal: wallet,
      rpId: config.rpId as string,
    });
  } catch (e) {
    return {
      status: 502,
      body: { error: `Cannot reach World ID verification API: ${(e as Error).message}` },
    };
  }

  if (!verified.success) {
    const alreadyUsed = /max_verifications|already_verified|exceeded/i.test(verified.code ?? "");
    return {
      status: alreadyUsed ? 409 : 401,
      body: {
        error: alreadyUsed
          ? "This World ID has already been used for this action"
          : `World ID verification failed: ${verified.detail ?? verified.code ?? "invalid proof"}`,
        code: verified.code,
      },
    };
  }

  // Step 3: record the nullifier and the participation, then sign.
  try {
    dbAccess.insertNullifier(nullifier_hash, actionId, wallet.toLowerCase());
  } catch {
    return { status: 409, body: { error: "Nullifier already recorded for this action" } };
  }
  dbAccess.insertJanlekhaParticipation(actionId, wallet.toLowerCase(), ref_id.toLowerCase());

  // Role None (0), bountyId 0: World ID proves uniqueness only, never an
  // official role, and no JanLekha contract checks this attestation.
  let attestation: AttestationResult;
  try {
    attestation = await signAttestation(wallet as `0x${string}`, RoleEnum.None, 0n);
  } catch (e) {
    return {
      status: 500,
      body: { error: `Attestation signing failed: ${(e as Error).message}` },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      action: actionId,
      ref_id: ref_id.toLowerCase(),
      attestation,
      note: "World ID proves uniqueness only. It grants no official role; official roles come from RoleRegistry grants only.",
    },
  };
}

export default {
  JANLEKHA_WORLD_ACTIONS,
  janlekhaWorldIdAction,
  janlekhaWorldIdConfig,
  janlekhaWorldIdSetupMessage,
  handleJanlekhaWorldIdVerify,
};
