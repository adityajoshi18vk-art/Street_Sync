import type { PrismaClient } from "../../generated/prisma/client";
import type { FeedbackStore } from "./service";

const UNIQUE_VIOLATION = "P2002";

export function createPrismaFeedbackStore(prisma: PrismaClient): FeedbackStore {
  return {
    async create({ scope, projectId, body, credential, verification }) {
      try {
        // Single nested insert = single transaction; the (action, nullifier) unique index decides races.
        const row = await prisma.citizenFeedback.create({
          data: {
            chainId: scope.chainId,
            contract: scope.contract.toLowerCase(),
            projectId,
            body,
            credential,
            verification: { create: verification },
          },
          select: { id: true, createdAt: true },
        });
        return row;
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) return "duplicate";
        throw error;
      }
    },
    async list(scope, projectId, limit) {
      // Explicit select: the private verification relation is never read for public output.
      return prisma.citizenFeedback.findMany({
        where: { chainId: scope.chainId, contract: scope.contract.toLowerCase(), projectId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, body: true, credential: true, createdAt: true },
      });
    },
  };
}
