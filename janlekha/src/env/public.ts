import { z } from "zod";

// Treat blank values in .env as unset so defaults apply.
const blank = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  NEXT_PUBLIC_HEDERA_CHAIN_ID: z.preprocess(blank, z.coerce.number().int().positive().default(296)),
  NEXT_PUBLIC_HEDERA_RPC_URL: z.preprocess(blank, z.url().default("https://testnet.hashio.io/api")),
  NEXT_PUBLIC_HASHSCAN_URL: z.preprocess(blank, z.url().default("https://hashscan.io/testnet")),
  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS: z.preprocess(
    blank,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
      .optional(),
  ),
});

// Each variable is referenced literally so Next.js can inline it into client bundles.
const parsed = schema.safeParse({
  NEXT_PUBLIC_HEDERA_CHAIN_ID: process.env.NEXT_PUBLIC_HEDERA_CHAIN_ID,
  NEXT_PUBLIC_HEDERA_RPC_URL: process.env.NEXT_PUBLIC_HEDERA_RPC_URL,
  NEXT_PUBLIC_HASHSCAN_URL: process.env.NEXT_PUBLIC_HASHSCAN_URL,
  NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS,
});

if (!parsed.success) {
  throw new Error(`Invalid public environment variables:\n${z.prettifyError(parsed.error)}`);
}

/** Safe to import from client and server code. */
export const publicEnv = parsed.data;
