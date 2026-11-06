// Applies migrations to TEST_DATABASE_URL, then runs the feedback/World ID tests against it.
import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set. Point it at an empty PostgreSQL database, e.g.\n  TEST_DATABASE_URL=postgresql://postgres@localhost:5432/janlekha_test npm run test:feedback");
  process.exit(1);
}
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: url });
run("npx", ["tsx", "--test", "tests/feedback.test.ts"]);
