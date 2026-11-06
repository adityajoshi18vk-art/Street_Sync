import { z } from "zod";

// Treat blank values in .env as unset so defaults apply.
const blank = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  NEXT_PUBLIC_HEDERA_CHAIN_ID: z.preprocess(blank, z.coerce.number().int().positive().default(296)),
  NEXT_PUBLIC_HEDERA_RPC_URL: z.preprocess(blank, z.url().default("https://testnet.hashio.io/api")),
  NEXT_PUBLIC_HASHSCAN_URL: z.preprocess(blank, z.url().default("https://hashscan.io/testnet")),
  NEXT_PUBLIC_HEDERA_MIRROR_NODE_URL: z.preprocess(
    blank,
    z.url().default("https://testnet.mirrornode.hedera.com"),
  ),
  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS: z.preprocess(
    blank,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
      .optional(),
  ),
  // World ID (citizen feedback only). Feedback is disabled until both ids are set.
  NEXT_PUBLIC_WORLD_APP_ID: z.preprocess(blank, z.string().regex(/^app_[A-Za-z0-9_]+$/, "must start with app_").optional()),
  // Same rule as IDKit: "rp_" + up to 16 hex digits (a u64).
  NEXT_PUBLIC_WORLD_RP_ID: z.preprocess(blank, z.string().regex(/^rp_[0-9a-fA-F]{1,16}$/, "must be rp_ followed by up to 16 hex digits").optional()),
  NEXT_PUBLIC_WORLD_ID_ENVIRONMENT: z.preprocess(blank, z.enum(["production", "staging"]).default("production")),
  // Scopes nullifiers: one feedback per human per "<prefix>-p<projectId>". Change it per deployment.
  NEXT_PUBLIC_WORLD_ID_ACTION_PREFIX: z.preprocess(
    blank,
    z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/, "lowercase letters, digits and hyphens").default("janlekha-feedback"),
  ),
  // Block to start event scans from (the deployment block); avoids scanning from genesis.
  NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK: z.preprocess(blank, z.coerce.bigint().nonnegative().default(0n)),
});

// Each variable is referenced literally so Next.js can inline it into client bundles.
const parsed = schema.safeParse({
  NEXT_PUBLIC_HEDERA_CHAIN_ID: process.env.NEXT_PUBLIC_HEDERA_CHAIN_ID,
  NEXT_PUBLIC_HEDERA_RPC_URL: process.env.NEXT_PUBLIC_HEDERA_RPC_URL,
  NEXT_PUBLIC_HASHSCAN_URL: process.env.NEXT_PUBLIC_HASHSCAN_URL,
  NEXT_PUBLIC_HEDERA_MIRROR_NODE_URL: process.env.NEXT_PUBLIC_HEDERA_MIRROR_NODE_URL,
  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS,
  NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK: process.env.NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK,
  NEXT_PUBLIC_WORLD_APP_ID: process.env.NEXT_PUBLIC_WORLD_APP_ID,
  NEXT_PUBLIC_WORLD_RP_ID: process.env.NEXT_PUBLIC_WORLD_RP_ID,
  NEXT_PUBLIC_WORLD_ID_ENVIRONMENT: process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT,
  NEXT_PUBLIC_WORLD_ID_ACTION_PREFIX: process.env.NEXT_PUBLIC_WORLD_ID_ACTION_PREFIX,
});

if (!parsed.success) {
  throw new Error(`Invalid public environment variables:\n${z.prettifyError(parsed.error)}`);
}

/** Safe to import from client and server code. */
export const publicEnv = parsed.data;
