import "server-only";
import { z } from "zod";
import { assertNoPublicSecrets } from "./guard";

assertNoPublicSecrets();

const schema = z.object({
  // Optional so the app and public pages run before a database is provisioned.
  DATABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string")
      .optional(),
  ),
  // Off-chain, content-addressed store for synthetic/public demo documents.
  DOCUMENT_STORAGE_DIR: z.preprocess((v) => (v === "" ? undefined : v), z.string().default(".data/documents")),
  // World ID RP signing key from the Developer Portal. Server-only: signs proof requests.
  WORLD_ID_RP_SIGNING_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte hex key").optional(),
  ),
  WORLD_ID_VERIFY_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("https://developer.world.org")),
});

const parsed = schema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DOCUMENT_STORAGE_DIR: process.env.DOCUMENT_STORAGE_DIR,
  WORLD_ID_RP_SIGNING_KEY: process.env.WORLD_ID_RP_SIGNING_KEY,
  WORLD_ID_VERIFY_BASE_URL: process.env.WORLD_ID_VERIFY_BASE_URL,
});

if (!parsed.success) {
  throw new Error(`Invalid server environment variables:\n${z.prettifyError(parsed.error)}`);
}

/** Server-only values. Importing this from a Client Component fails the build. */
export const serverEnv = parsed.data;
