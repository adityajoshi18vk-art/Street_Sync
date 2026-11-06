import "server-only";
import { publicEnv } from "@/env/public";
import { getPrisma } from "@/lib/db";

export type DatabaseStatus = "ok" | "not_configured" | "unreachable";

export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  chain: { id: number; rpcUrl: string; contractAddress: string | null };
  database: { status: DatabaseStatus; latencyMs?: number };
}

const DB_TIMEOUT_MS = 3_000;

async function checkDatabase(): Promise<HealthReport["database"]> {
  const prisma = getPrisma();
  if (!prisma) return { status: "not_configured" };

  const started = performance.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database health check timed out")), DB_TIMEOUT_MS),
      ),
    ]);
    return { status: "ok", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    // Logged server-side only: driver errors can include host or user names.
    console.error("[health] database check failed:", error);
    return { status: "unreachable" };
  }
}

export async function getHealth(): Promise<HealthReport> {
  const database = await checkDatabase();
  return {
    status: database.status === "unreachable" ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    chain: {
      id: publicEnv.NEXT_PUBLIC_HEDERA_CHAIN_ID,
      rpcUrl: publicEnv.NEXT_PUBLIC_HEDERA_RPC_URL,
      contractAddress: publicEnv.NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS ?? null,
    },
    database,
  };
}
