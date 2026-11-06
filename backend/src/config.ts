/**
 * config.ts
 * GET /api/config – public deployment settings the frontend needs at runtime.
 */

import type { FastifyInstance } from "fastify";
import { getVerifyingContract } from "./signer.js";
import { neighbourRadiusKm } from "./neighbour.js";
import { actionForRole } from "./worldid.js";

export function buildPublicConfig() {
  let escrow: string | null = null;
  try {
    escrow = getVerifyingContract();
  } catch {
    // Not deployed/configured yet.
  }
  return {
    chainId: Number(process.env.CHAIN_ID ?? "5042002"),
    escrow,
    neighbourRadiusKm: neighbourRadiusKm(),
    worldActions: {
      worker: actionForRole("worker"),
      reviewer: actionForRole("reviewer"),
      neighbour: actionForRole("neighbour"),
    },
  };
}

export function registerConfigRoute(app: FastifyInstance): void {
  app.get("/api/config", async (_request, reply) => reply.send(buildPublicConfig()));
}
