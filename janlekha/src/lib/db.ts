import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/env/server";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Returns null when DATABASE_URL is not configured. */
export function getPrisma(): PrismaClient | null {
  if (!serverEnv.DATABASE_URL) return null;
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: serverEnv.DATABASE_URL }),
    });
  }
  return globalForPrisma.prisma;
}
