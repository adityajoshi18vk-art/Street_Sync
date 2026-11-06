// Production entrypoint: runs the backend (internal, 127.0.0.1:BACKEND_PORT) and the
// Next.js app (public, 0.0.0.0:PORT) in one container. Next proxies /api/* to the backend.
// If either process exits, the other is stopped and the container exits non-zero so the
// platform restarts it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "3000";
const backendPort = process.env.BACKEND_PORT ?? "3001";

// The /api rewrite target is fixed at `next build`; a different runtime port would break it.
const expected = new URL(process.env.BACKEND_API_URL ?? "http://127.0.0.1:3001");
if (expected.port !== backendPort) {
  console.error(`[start] BACKEND_PORT=${backendPort} does not match the built /api target ${expected.href}`);
  process.exit(1);
}

const nextBin = createRequire(join(root, "app", "package.json")).resolve("next/dist/bin/next");

const children = new Map();
let shuttingDown = false;

function run(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) {
      if (children.size === 0) process.exit(0);
      return;
    }
    console.error(`[start] ${name} exited (code ${code}, signal ${signal}); stopping container`);
    stopAll("SIGTERM");
    setTimeout(() => process.exit(1), 10_000).unref();
    if (children.size === 0) process.exit(1);
  });
  return child;
}

function stopAll(signal) {
  shuttingDown = true;
  for (const child of children.values()) child.kill(signal);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[start] received ${signal}, shutting down`);
    stopAll(signal);
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

run("backend", ["dist/server.js"], join(root, "backend"), {
  BACKEND_PORT: backendPort,
  HOST: process.env.BACKEND_HOST ?? "127.0.0.1",
});
run("app", [nextBin, "start", "-p", port, "-H", "0.0.0.0"], join(root, "app"), {});
