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
import { signAttestation, attesterAddress, RoleEnum, setVerifyingContract } from "./signer.js";
import { computeStickerProfile } from "./stickers.js";
import { startIndexer, stopIndexer } from "./indexer.js";
import type { Address } from "viem";
import { randomBytes } from "node:crypto";
import { hashToField } from "@worldcoin/idkit-core/hashing";

// ─── Configuration ───────────────────────────────────────────────────────────

// Not PORT: hosts and the root dev runner set PORT for the web app, which would make both bind the same port.
const PORT = Number(process.env.BACKEND_PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const WORLD_APP_ID = process.env.WORLD_APP_ID ?? "app_streetsync_dev";
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

// World ID 4.0 verify API; accepts IDKit 2.x proofs as "legacy 3.0" responses.
// The v2 endpoint answers "Action not found" for apps migrated to 4.0.
const WORLD_VERIFY_URL =
  process.env.WORLD_VERIFY_URL ??
  `https://developer.world.org/api/v4/verify/${process.env.WORLD_RP_ID ?? WORLD_APP_ID}`;

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
}): Promise<WorldVerifyResult> {
  const res = await fetch(WORLD_VERIFY_URL, {
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
          // Same hashing IDKit applies to the widget's `signal` (the wallet address).
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

const WORLD_ACTION_WORKER = process.env.WORLD_ACTION_WORKER ?? "claim-bounty";
const WORLD_ACTION_REVIEWER = process.env.WORLD_ACTION_REVIEWER ?? "register-reviewer";

/**
 * The action is derived here, never trusted from the client: otherwise one human could
 * mint unlimited attestations by verifying against fresh action names. Worker claims are
 * per bounty (one human, one claim per bounty); reviewer registration is once per human.
 */
function expectedAction(role: "worker" | "reviewer", bountyId: string | undefined): string | null {
  if (role === "reviewer") return WORLD_ACTION_REVIEWER;
  if (role === "worker" && bountyId && /^\d+$/.test(bountyId)) return `${WORLD_ACTION_WORKER}-${bountyId}`;
  return null;
}

app.post<{ Body: WorldIdVerifyBody }>("/api/worldid/verify", async (request, reply) => {
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
  if (!proof || !merkle_root || !nullifier_hash || !verification_level || !action || !wallet || !role) {
    return reply.status(400).send({
      error: "Missing required fields: proof, merkle_root, nullifier_hash, verification_level, action, wallet, role",
    });
  }

  const actionId = expectedAction(role, bountyId);
  if (!actionId || action !== actionId) {
    return reply.status(400).send({
      error: `World ID action mismatch: expected "${actionId ?? "(invalid role or bountyId)"}"`,
    });
  }

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

  // Check if this exact wallet+nullifier+action is already attested
  const existingExact = dbAccess.checkNullifier(nullifier_hash, actionId);
  if (existingExact) {
    return reply.status(409).send({
      error: "This World ID identity has already been attested for this action",
      action: actionId,
    });
  }

  // ── Step 2: Verify the proof with World's cloud API ─────────────────────────
  let verified: WorldVerifyResult;
  if (DEV_BYPASS_ENABLED && request.body.dev_bypass) {
    request.log.warn("World ID verification bypassed via ALLOW_DEV_WORLD_ID_BYPASS");
    verified = { success: true };
  } else {
    try {
      verified = await verifyWorldIdProof({
        proof,
        merkle_root,
        nullifier_hash,
        verification_level,
        action: actionId,
        signal: wallet,
      });
    } catch (e) {
      request.log.error(`World ID API error: ${(e as Error).message}`);
      return reply.status(502).send({
        error: "Cannot reach World ID verification API",
      });
    }
  }

  if (!verified.success) {
    request.log.warn(`World ID verification rejected: ${verified.code} ${verified.detail}`);
    const alreadyUsed = /max_verifications|already_verified|exceeded/i.test(verified.code ?? "");
    return reply.status(alreadyUsed ? 409 : 401).send({
      error: alreadyUsed
        ? "This World ID has already been used for this action"
        : `World ID verification failed: ${verified.detail ?? verified.code ?? "invalid proof"}`,
      code: verified.code,
    });
  }

  // ── Step 3: Record nullifier in DB ──────────────────────────────────────────
  try {
    dbAccess.insertNullifier(nullifier_hash, actionId, wallet.toLowerCase());
  } catch (e) {
    // Unique constraint violation = already recorded (race condition guard)
    return reply.status(409).send({
      error: "Nullifier already recorded for this action",
    });
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
//  GET /api/stickers/:address
//  Gamification: sticker collection, XP, and level for a wallet
// ═══════════════════════════════════════════════════════════════════════════════

app.get<{ Params: { address: string } }>("/api/stickers/:address", async (request, reply) => {
  const addr = request.params.address?.toLowerCase();
  if (!addr || !/^0x[0-9a-f]{40}$/.test(addr)) {
    return reply.status(400).send({ error: "Invalid wallet address" });
  }
  return reply.send(computeStickerProfile(addr));
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/health
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", async (_request, reply) => {
  return reply.send({
    status: "ok",
    chainId: CHAIN_ID,
    attester: attesterAddress,
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
  console.log(`Attester address: ${attesterAddress}`);
  console.log(`Chain ID:         ${CHAIN_ID}`);
  console.log(`World App ID:     ${WORLD_APP_ID}`);

  // Set verifying contract from env if available (indexer may override later)
  if (process.env.ESCROW_CONTRACT_ADDRESS) {
    setVerifyingContract(process.env.ESCROW_CONTRACT_ADDRESS as Address);
    console.log(`Escrow contract:  ${process.env.ESCROW_CONTRACT_ADDRESS}`);
  }

  // Start event indexer in background
  startIndexer().catch((e) => {
    console.error("[indexer] Fatal error:", e);
  });

  // Start HTTP server
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\nServer listening at http://${HOST}:${PORT}`);
    console.log("Endpoints:");
    console.log("  POST /api/worldid/verify");
    console.log("  GET  /api/bounties");
    console.log("  GET  /api/bounties/:id");
    console.log("  GET  /api/reviewers/:address/assignments");
    console.log("  GET  /api/stickers/:address");
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

