import "server-only";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { publicEnv } from "@/env/public";
import { serverEnv } from "@/env/server";
import { getPrisma } from "@/lib/db";
import { janLekhaAbi } from "@/lib/janlekha/abi";
import { chainConfig, publicClient, revertErrorName } from "@/lib/janlekha/chain";
import { createPrismaFeedbackStore } from "./prisma-store";
import type { FeedbackStore, ProjectScope, SubmitDeps } from "./service";
import { feedbackAction } from "./signal";
import { createWorldIdVerifier } from "./world-id";

export type FeedbackAvailability =
  | { enabled: false; reason: string }
  | { enabled: true; store: FeedbackStore; scope: ProjectScope };

/** Feedback needs a database (off-chain storage) and a configured contract to scope it to. */
export function feedbackAvailability(): FeedbackAvailability {
  const prisma = getPrisma();
  if (!prisma) return { enabled: false, reason: "Citizen feedback is not enabled on this deployment (no database configured)." };
  const cfg = chainConfig();
  if (!cfg.contractAddress) return { enabled: false, reason: "Citizen feedback is unavailable because no JanLekha contract is configured." };
  return { enabled: true, store: createPrismaFeedbackStore(prisma), scope: { chainId: cfg.chainId, contract: cfg.contractAddress } };
}

export interface WorldIdClientConfig {
  appId: `app_${string}`;
  rpId: string;
  environment: "production" | "staging";
}

/** Null when World ID is not fully configured; submission is then disabled with an explanation. */
export function worldIdClientConfig(): WorldIdClientConfig | null {
  const appId = publicEnv.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
  const rpId = publicEnv.NEXT_PUBLIC_WORLD_RP_ID;
  if (!appId || !rpId || !serverEnv.WORLD_ID_RP_SIGNING_KEY) return null;
  return { appId, rpId, environment: publicEnv.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT };
}

export async function projectExistsOnChain(projectId: string): Promise<boolean> {
  const cfg = chainConfig();
  if (!cfg.contractAddress) throw new Error("contract not configured");
  try {
    await publicClient(cfg).readContract({ address: cfg.contractAddress, abi: janLekhaAbi, functionName: "getProject", args: [BigInt(projectId)] });
    return true;
  } catch (error) {
    if (revertErrorName(error) === "UnknownProject") return false;
    throw error;
  }
}

/** Signs a World ID request for this project's feedback action (RP signature, server-side only). */
export function signFeedbackRequest(projectId: string, world: WorldIdClientConfig) {
  const action = feedbackAction(publicEnv.NEXT_PUBLIC_WORLD_ID_ACTION_PREFIX, projectId);
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: serverEnv.WORLD_ID_RP_SIGNING_KEY!, action });
  return {
    app_id: world.appId,
    action,
    environment: world.environment,
    rp_context: { rp_id: world.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
  };
}

export function submitDeps(store: FeedbackStore, scope: ProjectScope, world: WorldIdClientConfig): SubmitDeps {
  return {
    scope,
    actionPrefix: publicEnv.NEXT_PUBLIC_WORLD_ID_ACTION_PREFIX,
    projectExists: projectExistsOnChain,
    verify: createWorldIdVerifier({ rpId: world.rpId, environment: world.environment, baseUrl: serverEnv.WORLD_ID_VERIFY_BASE_URL }),
    store,
  };
}
