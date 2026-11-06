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
  // Total size cap for stored documents, so anonymous uploads cannot fill the disk.
  DOCUMENT_STORAGE_MAX_BYTES: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().default(256 * 1024 * 1024),
  ),
});

const parsed = schema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DOCUMENT_STORAGE_DIR: process.env.DOCUMENT_STORAGE_DIR,
  DOCUMENT_STORAGE_MAX_BYTES: process.env.DOCUMENT_STORAGE_MAX_BYTES,
});

if (!parsed.success) {
  throw new Error(`Invalid server environment variables:\n${z.prettifyError(parsed.error)}`);
}

/** Server-only values. Importing this from a Client Component fails the build. */
export const serverEnv = parsed.data;
