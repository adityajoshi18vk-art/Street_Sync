/**
 * worldid-v4.ts
 * World ID 4.0 flow (IDKit 4.x):
 *   1. POST /api/worldid/rp-context — backend signs the proof request (RP signature).
 *   2. POST /api/worldid/verify     — forwards the IDKit result to the Developer Portal
 *      v4 verify API, enforces wallet binding + one-human-per-wallet, then issues the
 *      EIP-712 attestation consumed by claim() / registerReviewer().
 *   3. POST /api/worldid/attest     — re-issues an attestation for a wallet that already
 *      verified for the role's action. Actions allow one verification per human, so a
 *      worker needs this to claim a second bounty. Attestations are bound to the wallet
 *      on-chain (msg.sender), so they are useless to anyone else.
 */

import type { FastifyInstance } from "fastify";
import { isAddress, type Address } from "viem";
import { signRequest } from "@worldcoin/idkit-server";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import dbAccess from "./db.js";
import { RoleEnum, signAttestation, isAttestationSignerReady } from "./signer.js";
import { isAllowedWorldIdAction, isLocalWorldIdBypassEnabled, recordWorldIdNullifier, type WorldIdRole } from "./worldid.js";

const VERIFY_BASE_URL = process.env.WORLD_VERIFY_BASE_URL ?? "https://developer.world.org";

export function worldIdConfig() {
  return {
    appId: process.env.WORLD_APP_ID ?? "",
    rpId: process.env.WORLD_RP_ID ?? "",
    signingKey: process.env.WORLD_RP_SIGNING_KEY ?? "",
    environment: (process.env.WORLD_ID_ENVIRONMENT ?? "production") as "production" | "staging",
  };
}

export function isWorldIdConfigured(): boolean {
  const { appId, rpId, signingKey } = worldIdConfig();
  return /^app_[A-Za-z0-9_]+$/.test(appId) && /^rp_[A-Za-z0-9]+$/.test(rpId) &&
    /^(0x)?[0-9a-fA-F]{64}$/.test(signingKey);
}

export function actionForRole(role: WorldIdRole): string {
  return role === "worker"
    ? process.env.WORLD_ACTION_WORKER ?? "claim-bounty"
    : process.env.WORLD_ACTION_REVIEWER ?? "register-reviewer";
}

interface IdkitResponseItem {
  identifier?: string;
  signal_hash?: string;
  nullifier?: string;
}

export interface IdkitResult {
  protocol_version: string;
  nonce: string;
  action?: string;
  environment: string;
  responses: IdkitResponseItem[];
  [key: string]: unknown;
}

export class WorldIdRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// IDKit's default signal_hash when no signal is supplied; never acceptable here.
const EMPTY_SIGNAL_HASH = hashSignal("");

/**
 * Checks everything we can before contacting the Developer Portal: the action matches
 * the role, the environment matches, and every proof commits to the requesting wallet
 * as its signal (so a proof cannot be replayed for a different wallet).
 */
export function validateIdkitResult(
  result: unknown,
  wallet: string,
  role: WorldIdRole,
  expectedEnvironment: string,
): { result: IdkitResult; nullifier: string } {
  if (!result || typeof result !== "object") throw new WorldIdRequestError("Missing IDKit result");
  const r = result as IdkitResult;
  if (r.protocol_version !== "4.0" && r.protocol_version !== "3.0") {
    throw new WorldIdRequestError("Unsupported World ID protocol version");
  }
  if (r.action !== actionForRole(role)) throw new WorldIdRequestError("Proof is for a different action");
  if (r.environment !== expectedEnvironment) throw new WorldIdRequestError("Proof is from the wrong World ID environment");
  if (!Array.isArray(r.responses) || r.responses.length === 0) throw new WorldIdRequestError("Proof has no responses");

  const expectedSignal = hashSignal(wallet.toLowerCase()).toLowerCase();
  for (const item of r.responses) {
    const signalHash = (item.signal_hash ?? EMPTY_SIGNAL_HASH).toLowerCase();
    if (signalHash !== expectedSignal) throw new WorldIdRequestError("Proof is not bound to this wallet");
  }
  const nullifier = r.responses[0]?.nullifier;
  if (typeof nullifier !== "string" || !nullifier) throw new WorldIdRequestError("Proof has no nullifier");
  return { result: r, nullifier };
}

function parseRoleRequest(body: unknown): { wallet: Address; role: WorldIdRole; bountyId: bigint } {
  const b = (body ?? {}) as { wallet?: unknown; role?: unknown; bountyId?: unknown };
  if (typeof b.wallet !== "string" || !isAddress(b.wallet)) throw new WorldIdRequestError("Invalid wallet");
  if (b.role !== "worker" && b.role !== "reviewer") throw new WorldIdRequestError("Invalid role");
  if (typeof b.bountyId !== "string" || !/^\d+$/.test(b.bountyId)) throw new WorldIdRequestError("Invalid bountyId");
  if (b.role === "reviewer" && b.bountyId !== "0") throw new WorldIdRequestError("Reviewer attestations use bountyId 0");
  return { wallet: b.wallet as Address, role: b.role, bountyId: BigInt(b.bountyId) };
}

async function issueAttestation(wallet: Address, role: WorldIdRole, bountyId: bigint) {
  return signAttestation(wallet, role === "worker" ? RoleEnum.Worker : RoleEnum.Reviewer, bountyId);
}

export function registerWorldIdRoutes(app: FastifyInstance): void {
  const chainId = Number(process.env.CHAIN_ID ?? "5042002");
  const devBypassConfigured = process.env.ALLOW_DEV_WORLD_ID_BYPASS === "true";

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorldIdRequestError) return reply.status(error.status).send({ error: error.message });
    request.log.error(error);
    return reply.status(error.statusCode ?? 500).send({ error: error.statusCode ? error.message : "Internal server error" });
  });

  app.post<{ Body: { action?: unknown } }>("/api/worldid/rp-context", async (request, reply) => {
    if (!isWorldIdConfigured()) return reply.status(503).send({ error: "World ID is not configured on the backend" });
    const action = request.body?.action;
    if (action !== actionForRole("worker") && action !== actionForRole("reviewer")) {
      throw new WorldIdRequestError("Unknown World ID action");
    }
    const { rpId, signingKey, appId, environment } = worldIdConfig();
    const sig = signRequest({ signingKeyHex: signingKey, action, ttl: 300 });
    return reply.send({
      app_id: appId,
      environment,
      rp_context: {
        rp_id: rpId,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
      },
    });
  });

  app.post("/api/worldid/attest", async (request, reply) => {
    const { wallet, role, bountyId } = parseRoleRequest(request.body);
    if (!isAttestationSignerReady()) return reply.status(503).send({ error: "Attestation signing is not configured" });
    if (!dbAccess.findVerifiedWallet(actionForRole(role), wallet)) {
      return reply.status(404).send({ error: "Wallet has not verified with World ID for this role", needsProof: true });
    }
    return reply.send({ success: true, attestation: await issueAttestation(wallet, role, bountyId) });
  });

  app.post("/api/worldid/verify", async (request, reply) => {
    const { wallet, role, bountyId } = parseRoleRequest(request.body);
    const body = request.body as { idkitResponse?: unknown; dev_bypass?: boolean };
    const action = actionForRole(role);
    if (!isAllowedWorldIdAction(role, action)) throw new WorldIdRequestError("Action is not configured for this role");

    const useLocalBypass = isLocalWorldIdBypassEnabled(chainId, devBypassConfigured, body.dev_bypass);
    if (!isWorldIdConfigured() && !useLocalBypass) {
      return reply.status(503).send({ error: "World ID is not configured on the backend" });
    }
    if (!isAttestationSignerReady()) return reply.status(503).send({ error: "Attestation signing is not configured" });

    const { environment, rpId } = worldIdConfig();
    const { result, nullifier } = validateIdkitResult(body.idkitResponse, wallet, role, useLocalBypass ? localBypassEnvironment(body) : environment);

    // One human per wallet per action, checked before spending a verification.
    if (dbAccess.checkNullifierOtherWallet(nullifier, action, wallet.toLowerCase())) {
      return reply.status(409).send({ error: "This World ID is already linked to a different wallet" });
    }

    if (!useLocalBypass) {
      const res = await fetch(`${VERIFY_BASE_URL}/api/v4/verify/${rpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...result, environment }),
      }).catch((e: Error) => {
        throw new WorldIdRequestError(`Cannot reach World ID verification API: ${e.message}`, 502);
      });
      const verification = (await res.json().catch(() => ({}))) as {
        success?: boolean; environment?: string; code?: string; detail?: string;
      };
      if (!res.ok || verification.success !== true || (verification.environment && verification.environment !== environment)) {
        request.log.warn({ status: res.status, code: verification.code, detail: verification.detail }, "World ID verification rejected");
        return reply.status(401).send({ error: "World ID verification failed", code: verification.code, detail: verification.detail });
      }
    }

    if (recordWorldIdNullifier(nullifier, action, wallet) === "conflict") {
      return reply.status(409).send({ error: "This World ID is already linked to a different wallet" });
    }
    return reply.send({ success: true, attestation: await issueAttestation(wallet, role, bountyId) });
  });
}

function localBypassEnvironment(body: { idkitResponse?: unknown }): string {
  const env = (body.idkitResponse as { environment?: unknown } | undefined)?.environment;
  return typeof env === "string" ? env : "staging";
}
