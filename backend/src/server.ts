/**
 * server.ts
 * Fastify API server for StreetSync backend.
 *
 * Endpoints:
 *   POST /api/worldid/verify     – World ID v4 proof verification + EIP-712 attestation
 *   GET  /api/bounties            – List bounties (filterable by status, bbox, worker)
 *   GET  /api/bounties/:id        – Full bounty detail with pledges, panel, votes
 *   GET  /api/reviewers/:address/assignments – Bounties assigned to a reviewer
 *   GET  /api/health              – Health check
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import dbAccess from "./db.js";
import { signAttestation, getAttesterAddress, getVerifyingContract, isAttestationSignerReady, RoleEnum, setVerifyingContract } from "./signer.js";
import { startIndexer, stopIndexer } from "./indexer.js";
import { isAddress, type Address } from "viem";
import { isAllowedWorldIdAction, isLocalWorldIdBypassEnabled } from "./worldid.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const WORLD_APP_ID = process.env.WORLD_APP_ID ?? "";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");

// ─── Fastify Setup ───────────────────────────────────────────────────────────

const app = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  },
});

// CORS for Next.js frontend
await app.register(cors, {
  origin: true, // Allow all origins in dev; restrict in production
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/worldid/verify
//  World ID v4 proof verification + EIP-712 attestation issuance
// ═══════════════════════════════════════════════════════════════════════════════

interface WorldIdVerifyBody {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  action: string;
  wallet: string;
  role: "worker" | "reviewer";
  bountyId: string;
  dev_bypass?: boolean;
}

// Dev bypass is only honored when the server is explicitly configured for it
// AND the request carries an explicit dev_bypass flag. Never enabled by default.
const DEV_BYPASS_ENABLED = process.env.ALLOW_DEV_WORLD_ID_BYPASS === "true";

app.post<{ Body: WorldIdVerifyBody }>("/api/worldid/verify", async (request, reply) => {
  if (!request.body || typeof request.body !== "object") {
    return reply.status(400).send({ error: "Invalid request body" });
  }
  const {
    proof,
    merkle_root,
    nullifier_hash,
    verification_level,
    action,
    wallet,
    role,
    bountyId,
  } = request.body;

  // Validate required fields
  if (
    typeof proof !== "string" || !proof.trim() ||
    typeof merkle_root !== "string" || !merkle_root.trim() ||
    typeof nullifier_hash !== "string" || !nullifier_hash.trim() ||
    typeof verification_level !== "string" || !verification_level.trim() ||
    typeof action !== "string" || !action.trim() ||
    typeof wallet !== "string" || !isAddress(wallet) ||
    (role !== "worker" && role !== "reviewer") ||
    typeof bountyId !== "string" || !/^\d+$/.test(bountyId)
  ) {
    return reply.status(400).send({
      error: "Invalid request: expected a World ID proof, action, wallet, role, and decimal bountyId",
    });
  }

  const useLocalBypass = isLocalWorldIdBypassEnabled(CHAIN_ID, DEV_BYPASS_ENABLED, request.body.dev_bypass);
  if (!isAllowedWorldIdAction(role, action)) {
    return reply.status(400).send({ error: "Action is not configured for the requested World ID role" });
  }
  if ((!WORLD_APP_ID || WORLD_APP_ID.includes("YOUR_")) && !useLocalBypass) {
    return reply.status(503).send({ error: "World ID application is not configured" });
  }
  if (!isAttestationSignerReady()) {
    return reply.status(503).send({ error: "Attestation signing is unavailable until StreetSyncEscrow is deployed and configured" });
  }

  // Derive the action ID for sybil tracking
  // Actions: "register-worker", "register-reviewer", "review-bounty-<id>"
  const actionId = action;

  // ── Step 1: Check nullifier hasn't been used by a DIFFERENT wallet for this action ──
  const existingNullifier = dbAccess.checkNullifierOtherWallet(
    nullifier_hash, actionId, wallet.toLowerCase(),
  );
  if (existingNullifier) {
    return reply.status(409).send({
      error: "Sybil detected: this World ID identity already used a different wallet for this action",
      action: actionId,
    });
  }

  // Re-attestation for the same wallet is allowed; another wallet is not.

  // ── Step 2: Verify proof against World ID v4 API ────────────────────────────
  if (!useLocalBypass) try {
    const verifyResponse = await fetch(
      `https://developer.worldcoin.org/api/v2/verify/${WORLD_APP_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merkle_root,
          nullifier_hash,
          proof,
          verification_level,
          action: actionId,
          signal: wallet,
        }),
      },
    );

    if (!verifyResponse.ok) {
      const errBody = await verifyResponse.text();
      request.log.error(`World ID verification failed: ${verifyResponse.status} ${errBody}`);
      return reply.status(401).send({
        error: "World ID verification failed",
        detail: errBody,
      });
    }

    const verifyData = await verifyResponse.json() as { success: boolean };
    if (!verifyData.success) {
      return reply.status(401).send({
        error: "World ID proof is invalid",
      });
    }
  } catch (e) {
    request.log.error(`World ID API error: ${(e as Error).message}`);
    // Hard failure unless the operator explicitly enabled the dev bypass
    // (ALLOW_DEV_WORLD_ID_BYPASS=true) AND the client opted in per-request.
    if (!useLocalBypass) {
      return reply.status(502).send({
        error: "Cannot reach World ID verification API",
      });
    }
    request.log.warn("World ID API unreachable – proceeding via ALLOW_DEV_WORLD_ID_BYPASS");
  }

  // ── Step 3: Record nullifier in DB ──────────────────────────────────────────
  if (!dbAccess.checkNullifier(nullifier_hash, actionId)) {
    try {
      dbAccess.insertNullifier(nullifier_hash, actionId, wallet.toLowerCase());
    } catch {
      // Recheck after a concurrent insert: same-wallet retries are allowed.
      const conflictingWallet = dbAccess.checkNullifierOtherWallet(
        nullifier_hash, actionId, wallet.toLowerCase(),
      );
      if (conflictingWallet) {
        return reply.status(409).send({ error: "Sybil detected: this World ID identity is already used by another wallet", action: actionId });
      }
    }
  }

  // ── Step 4: Sign EIP-712 attestation ────────────────────────────────────────
  const roleValue = role === "worker" ? RoleEnum.Worker : RoleEnum.Reviewer;
  const bountyIdBigInt = BigInt(bountyId ?? "0");

  const attestation = await signAttestation(
    wallet as Address,
    roleValue,
    bountyIdBigInt,
  );

  return reply.status(200).send({
    success: true,
    attestation,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/bounties
//  List bounties with optional filters:
//    ?status=0-6     – filter by Status enum
//    ?minLat=X&maxLat=X&minLng=X&maxLng=X – bounding box (E5 integers)
//    ?worker=0x...   – filter by worker address
//    ?reviewer=0x... – filter by assigned reviewer
//    ?limit=50       – pagination limit
//    ?offset=0       – pagination offset
// ═══════════════════════════════════════════════════════════════════════════════

interface BountiesQuery {
  status?: string;
  minLat?: string;
  maxLat?: string;
  minLng?: string;
  maxLng?: string;
  worker?: string;
  reviewer?: string;
  limit?: string;
  offset?: string;
}

app.get<{ Querystring: BountiesQuery }>("/api/bounties", async (request, reply) => {
  const { status, minLat, maxLat, minLng, maxLng, worker, reviewer, limit, offset } = request.query;

  const lim = Math.min(Number(limit ?? 50), 200);
  const off = Number(offset ?? 0);

  let bounties: Record<string, unknown>[];

  if (worker) {
    bounties = dbAccess.listBountiesByWorker(worker.toLowerCase());
  } else if (minLat && maxLat && minLng && maxLng) {
    bounties = dbAccess.listBountiesInBBox(
      Number(minLat), Number(maxLat), Number(minLng), Number(maxLng), lim, off,
    );
  } else if (status !== undefined) {
    bounties = dbAccess.listBountiesByStatus(Number(status), lim, off);
  } else if (reviewer) {
    // Find bounties where this reviewer is in the panel
    const assignments = dbAccess.getAssignmentsByReviewer(reviewer.toLowerCase());
    const bountyIds = [...new Set(assignments.map((a) => a.bounty_id as string))];
    bounties = bountyIds.map((id) => dbAccess.getBounty(id)).filter(Boolean) as Record<string, unknown>[];
  } else {
    bounties = dbAccess.listBounties(lim, off);
  }

  return reply.send({ bounties, count: bounties.length });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/bounties/:id
//  Full bounty detail with pledges, assigned panel, votes, and settlement
// ═══════════════════════════════════════════════════════════════════════════════

app.get<{ Params: { id: string } }>("/api/bounties/:id", async (request, reply) => {
  const { id } = request.params;

  const bounty = dbAccess.getBounty(id);
  if (!bounty) {
    return reply.status(404).send({ error: "Bounty not found" });
  }

  const pledges    = dbAccess.getPledges(id);
  const panel      = dbAccess.getPanel(id);
  const votes      = dbAccess.getVotes(id);
  const settlement = dbAccess.getSettlement(id);

  // Build structured response
  const assignedReviewers = panel
    ? [panel.reviewer_0, panel.reviewer_1, panel.reviewer_2]
    : [];

  const voteStatus = votes.map((v) => ({
    reviewer:   v.reviewer,
    committed:  !!v.commit_hash,
    revealed:   !!v.revealed,
    approve:    v.revealed ? !!v.approve : null,
  }));

  return reply.send({
    bounty: {
      ...bounty,
      // Decode lat/lng for convenience
      lat: Number(bounty.lat_e5) / 1e5,
      lng: Number(bounty.lng_e5) / 1e5,
      // Format USDC for display (6 decimals)
      totalPledgedUsdc: (Number(bounty.total_pledged) / 1e6).toFixed(2),
    },
    pledges,
    assignedReviewers,
    reviewRound: panel?.review_round ?? 0,
    voteStatus,
    settlement: settlement ?? null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/reviewers/:address/assignments
//  All bounties assigned to a specific reviewer wallet
// ═══════════════════════════════════════════════════════════════════════════════

app.get<{ Params: { address: string } }>("/api/reviewers/:address/assignments", async (request, reply) => {
  const { address } = request.params;
  const addr = address.toLowerCase();

  const assignments = dbAccess.getAssignmentsByReviewer(addr);

  const enriched = assignments.map((a) => {
    const bounty = dbAccess.getBounty(a.bounty_id as string);
    const votes  = dbAccess.getVotes(a.bounty_id as string);
    const myVote = votes.find((v) => (v.reviewer as string).toLowerCase() === addr);

    return {
      bountyId:      a.bounty_id,
      reviewRound:   a.review_round,
      panelPosition: a.reviewer_0 === addr ? 0 : a.reviewer_1 === addr ? 1 : 2,
      bountyStatus:  bounty?.status ?? null,
      totalPledged:  bounty?.total_pledged ?? "0",
      worker:        bounty?.worker ?? null,
      myVote: myVote
        ? {
            committed: !!myVote.commit_hash,
            revealed:  !!myVote.revealed,
            approve:   myVote.revealed ? !!myVote.approve : null,
          }
        : null,
    };
  });

  return reply.send({ reviewer: addr, assignments: enriched });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/health
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", async (_request, reply) => {
  let escrowConfigured = true;
  try {
    getVerifyingContract();
  } catch {
    escrowConfigured = false;
  }
  const worldIdConfigured = Boolean(WORLD_APP_ID && !WORLD_APP_ID.includes("YOUR_"));
  const signerConfigured = isAttestationSignerReady();
  return reply.send({
    status: "ok",
    ready: worldIdConfigured && signerConfigured && escrowConfigured,
    readiness: { worldId: worldIdConfigured, signer: signerConfigured, escrow: escrowConfigured },
    chainId: CHAIN_ID,
    attester: getAttesterAddress(),
    worldAppId: WORLD_APP_ID,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Startup
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║         StreetSync Backend Server            ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`Attester address: ${getAttesterAddress() ?? "not configured"}`);
  console.log(`Chain ID:         ${CHAIN_ID}`);
  console.log(`World App ID:     ${WORLD_APP_ID}`);

  // Set verifying contract from env if available (indexer may override later)
  if (process.env.ESCROW_CONTRACT_ADDRESS) {
    setVerifyingContract(process.env.ESCROW_CONTRACT_ADDRESS as Address);
    console.log(`Escrow contract:  ${process.env.ESCROW_CONTRACT_ADDRESS}`);
  }
  try {
    console.log(`Signing domain contract: ${getVerifyingContract()}`);
  } catch {
    console.warn("Attestation signing is disabled until StreetSyncEscrow is deployed and configured.");
  }
  if (!WORLD_APP_ID || WORLD_APP_ID.includes("YOUR_")) {
    console.warn("World ID verification is disabled until WORLD_APP_ID is configured.");
  }

  // Start event indexer in background
  startIndexer().catch((e) => {
    console.error("[indexer] Fatal error:", e);
  });

  // Start HTTP server
  try {
    await app.listen({ port: BACKEND_PORT, host: HOST });
    console.log(`\nServer listening at http://${HOST}:${BACKEND_PORT}`);
    console.log("Endpoints:");
    console.log("  POST /api/worldid/verify");
    console.log("  GET  /api/bounties");
    console.log("  GET  /api/bounties/:id");
    console.log("  GET  /api/reviewers/:address/assignments");
    console.log("  GET  /api/health");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  stopIndexer();
  await app.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  stopIndexer();
  await app.close();
  process.exit(0);
});

main();

