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
});

const parsed = schema.safeParse({ DATABASE_URL: process.env.DATABASE_URL });

if (!parsed.success) {
  throw new Error(`Invalid server environment variables:\n${z.prettifyError(parsed.error)}`);
}

/** Server-only values. Importing this from a Client Component fails the build. */
export const serverEnv = parsed.data;
