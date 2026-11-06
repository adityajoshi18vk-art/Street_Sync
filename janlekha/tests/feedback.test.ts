/**
 * Citizen feedback + World ID verification.
 *
 * Exercises the real verifier, service and Prisma store against PostgreSQL. Only the
 * World ID Developer Portal is replaced, at the HTTP (fetch) boundary.
 * Run with `npm run test:feedback` (needs TEST_DATABASE_URL).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaFeedbackStore } from "../src/lib/feedback/prisma-store";
import { listFeedback, submitFeedback, type SubmitDeps } from "../src/lib/feedback/service";
import { UNIQUE_HUMAN_LABEL, feedbackAction, feedbackSignal } from "../src/lib/feedback/signal";
import { canonicalNullifier, createWorldIdVerifier } from "../src/lib/feedback/world-id";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!DATABASE_URL) throw new Error("TEST_DATABASE_URL is required (run via `npm run test:feedback`).");

const RP_ID = "rp_janlekha_test";
const PREFIX = "janlekha-test";
const SCOPE = { chainId: 296, contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3" };
const EXISTING_PROJECTS = new Set(["1", "2"]);

const NULLIFIER_A = "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
const NULLIFIER_B = "0x0e5c8f3e6a7d1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aab";

type WorldResponse = { status: number; json?: unknown } | "network-error" | "hang";

/** Fake Developer Portal: records requests and replies with the queued responses. */
function fakeWorld(defaultReply: WorldResponse = { status: 200 }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const queue: WorldResponse[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const reply = queue.shift() ?? defaultReply;
    if (reply === "network-error") throw new TypeError("fetch failed");
    if (reply === "hang") {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))),
      );
    }
    const json =
      reply.json ??
      (reply.status === 200
        ? {
            success: true,
            action: body.action,
            nullifier: (body.responses as { nullifier: string }[])[0].nullifier,
            environment: "production",
            results: [{ identifier: "proof_of_human", success: true, nullifier: (body.responses as { nullifier: string }[])[0].nullifier }],
          }
        : {});
    return new Response(JSON.stringify(json), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl, calls, queue };
}

/** Shape of an IDKit 4.x uniqueness result (proof contents are opaque to us). */
async function idkitResult(projectId: string, text: string, nullifier: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0",
    nonce: "0x6e6f6e6365",
    action: feedbackAction(PREFIX, projectId),
    environment: "production",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(await feedbackSignal(projectId, text)),
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        nullifier,
        issuer_schema_id: 1,
        expires_at_min: 1_900_000_000,
      },
    ],
    ...overrides,
  };
}

describe("citizen feedback with World ID", () => {
  let prisma: PrismaClient;
  let store: ReturnType<typeof createPrismaFeedbackStore>;
  let world: ReturnType<typeof fakeWorld>;
  let chainUp: boolean;

  const deps = (timeoutMs = 2_000): SubmitDeps => ({
    scope: SCOPE,
    actionPrefix: PREFIX,
    projectExists: async (id) => {
      if (!chainUp) throw new Error("RPC down");
      return EXISTING_PROJECTS.has(id);
    },
    verify: createWorldIdVerifier({ rpId: RP_ID, environment: "production", baseUrl: "https://developer.world.org", fetch: world.fetch, timeoutMs }),
    store,
  });

  const counts = async () => ({
    feedback: await prisma.citizenFeedback.count(),
    verifications: await prisma.worldIdVerification.count(),
  });

  before(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
    store = createPrismaFeedbackStore(prisma);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe("TRUNCATE world_id_verifications, citizen_feedback");
    world = fakeWorld();
    chainUp = true;
  });
  after(async () => {
    await prisma.$disconnect();
  });

  // ─── valid verification ───────────────────────────────────────────────────
  it("accepts a valid proof, forwards it unmodified to the v4 verify endpoint and stores the nullifier privately", async () => {
    const text = "The drain cover near the school gate is still missing.";
    const result = await idkitResult("1", text, NULLIFIER_A);
    const res = await submitFeedback({ projectId: "1", body: text, idkitResult: result }, deps());

    assert.equal(res.status, 201);
    assert.ok("feedback" in res.body);
    assert.equal(res.body.feedback.verification, "Unique human verified");
    assert.equal(res.body.feedback.body, text);
    assert.deepEqual(Object.keys(res.body.feedback).sort(), ["body", "createdAt", "credential", "id", "projectId", "verification"]);

    assert.equal(world.calls.length, 1);
    assert.equal(world.calls[0].url, `https://developer.world.org/api/v4/verify/${RP_ID}`);
    assert.deepEqual(world.calls[0].body, { ...result, environment: "production" });

    const stored = await prisma.worldIdVerification.findFirstOrThrow();
    assert.equal(stored.nullifier, NULLIFIER_A);
    assert.equal(stored.action, "janlekha-test-p1");
    assert.equal(stored.protocolVersion, "4.0");
  });

  it("never exposes the nullifier in submit or public list responses", async () => {
    const text = "Work quality on the culvert looks good so far.";
    const res = await submitFeedback({ projectId: "1", body: text, idkitResult: await idkitResult("1", text, NULLIFIER_A) }, deps());
    const listed = await listFeedback(store, SCOPE, "1");
    const serialized = JSON.stringify({ res: res.body, listed }).toLowerCase();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].verification, UNIQUE_HUMAN_LABEL);
    assert.ok(!serialized.includes(NULLIFIER_A.slice(2)), "nullifier must not appear in public output");
    assert.ok(!serialized.includes("nullifier"));
    assert.ok(!serialized.includes("kyc"));
  });

  it("normalizes decimal and hex nullifier encodings to the same value", async () => {
    assert.equal(canonicalNullifier(BigInt(NULLIFIER_A).toString(10)), NULLIFIER_A);
    assert.equal(canonicalNullifier(NULLIFIER_A.toUpperCase().replace("0X", "0x")), NULLIFIER_A);
    assert.throws(() => canonicalNullifier("0x" + "f".repeat(64))); // outside the World ID field
  });

  // ─── reused nullifier ─────────────────────────────────────────────────────
  it("rejects a reused nullifier for the same project even with different text (409)", async () => {
    const first = "First feedback from this person on project one.";
    const second = "Trying to submit a second opinion on project one.";
    assert.equal((await submitFeedback({ projectId: "1", body: first, idkitResult: await idkitResult("1", first, NULLIFIER_A) }, deps())).status, 201);

    // Same human, decimal encoding of the same nullifier: still a duplicate.
    const decimal = BigInt(NULLIFIER_A).toString(10);
    const res = await submitFeedback({ projectId: "1", body: second, idkitResult: await idkitResult("1", second, decimal) }, deps());
    assert.equal(res.status, 409);
    assert.equal((res.body as { code: string }).code, "already_submitted");
    assert.deepEqual(await counts(), { feedback: 1, verifications: 1 });
  });

  it("enforces uniqueness in the database under concurrent submissions", async () => {
    const texts = Array.from({ length: 5 }, (_, i) => `Concurrent feedback attempt number ${i}.`);
    const results = await Promise.all(
      texts.map(async (t) => submitFeedback({ projectId: "1", body: t, idkitResult: await idkitResult("1", t, NULLIFIER_A) }, deps())),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
    assert.deepEqual(await counts(), { feedback: 1, verifications: 1 });
  });

  it("allows the same human one feedback per project (different action)", async () => {
    const t1 = "Feedback on the drain rehabilitation project.";
    const t2 = "Feedback on the rooftop solar project instead.";
    assert.equal((await submitFeedback({ projectId: "1", body: t1, idkitResult: await idkitResult("1", t1, NULLIFIER_A) }, deps())).status, 201);
    assert.equal((await submitFeedback({ projectId: "2", body: t2, idkitResult: await idkitResult("2", t2, NULLIFIER_A) }, deps())).status, 201);
    assert.equal((await submitFeedback({ projectId: "1", body: t2, idkitResult: await idkitResult("1", t2, NULLIFIER_B) }, deps())).status, 201);
    assert.equal((await counts()).feedback, 3);
  });

  // ─── invalid proof response ───────────────────────────────────────────────
  it("rejects a proof that World ID reports as invalid (400) and stores nothing", async () => {
    world.queue.push({
      status: 400,
      json: {
        success: false,
        code: "all_verifications_failed",
        detail: "All proof verifications failed.",
        results: [{ identifier: "proof_of_human", success: false, code: "verification_error", detail: "On-chain proof verification failed." }],
      },
    });
    const text = "This proof has been tampered with by someone.";
    const res = await submitFeedback({ projectId: "1", body: text, idkitResult: await idkitResult("1", text, NULLIFIER_A) }, deps());
    assert.equal(res.status, 400);
    assert.equal((res.body as { code: string }).code, "all_verifications_failed");
    assert.deepEqual(await counts(), { feedback: 0, verifications: 0 });
  });

  it("rejects a 200 response that does not confirm the proof", async () => {
    world.queue.push({ status: 200, json: { success: false, results: [] } });
    world.queue.push({ status: 200, json: { success: true, environment: "staging", results: [] } });
    world.queue.push({ status: 200, json: { success: true, nullifier: NULLIFIER_B, results: [{ identifier: "proof_of_human", success: true }] } });
    const text = "Checking how odd verifier responses are handled.";
    for (const code of ["verification_failed", "environment_mismatch", "nullifier_mismatch"]) {
      const res = await submitFeedback({ projectId: "1", body: text, idkitResult: await idkitResult("1", text, NULLIFIER_A) }, deps());
      assert.equal(res.status, 400);
      assert.equal((res.body as { code: string }).code, code);
    }
    assert.equal((await counts()).feedback, 0);
  });

  it("rejects proofs bound to other text, another project, another environment or an older protocol before calling World ID", async () => {
    const text = "The original text the citizen proved.";
    const cases: [string, Promise<Record<string, unknown>>, string][] = [
      ["edited text after proving", idkitResult("1", text, NULLIFIER_A), "signal_mismatch"],
      ["proof for project 2", idkitResult("2", "Some other project text here.", NULLIFIER_A), "action_mismatch"],
      ["staging proof", idkitResult("1", text, NULLIFIER_A, { environment: "staging" }), "environment_mismatch"],
      ["legacy v3 proof", idkitResult("1", text, NULLIFIER_A, { protocol_version: "3.0" }), "unsupported_protocol"],
    ];
    for (const [label, result, code] of cases) {
      const body = label === "edited text after proving" ? `${text} (edited)` : text;
      const res = await submitFeedback({ projectId: "1", body, idkitResult: await result }, deps());
      assert.equal(res.status, 400, label);
      assert.equal((res.body as { code: string }).code, code, label);
    }
    assert.equal(world.calls.length, 0);
    assert.equal((await counts()).feedback, 0);
  });

  // ─── verification-service failure ─────────────────────────────────────────
  it("returns 503 when the verification service fails, stores nothing, and does not burn the nullifier", async () => {
    const text = "The streetlight on the bridge is still not working.";
    const result = await idkitResult("1", text, NULLIFIER_A);
    for (const failure of [{ status: 500 }, { status: 502 }, { status: 429 }, { status: 404 }, "network-error", "hang"] as WorldResponse[]) {
      world.queue.push(failure);
      const res = await submitFeedback({ projectId: "1", body: text, idkitResult: result }, deps(200));
      assert.equal(res.status, 503, JSON.stringify(failure));
      assert.equal((res.body as { code: string }).code, "verification_unavailable");
    }
    assert.deepEqual(await counts(), { feedback: 0, verifications: 0 });

    // The same human can retry once the service recovers.
    const retry = await submitFeedback({ projectId: "1", body: text, idkitResult: result }, deps());
    assert.equal(retry.status, 201);
  });

  // ─── input and project checks ─────────────────────────────────────────────
  it("rejects unknown projects, an unavailable chain and invalid text without verifying", async () => {
    const text = "Valid length feedback for checks.";
    const r404 = await submitFeedback({ projectId: "9", body: text, idkitResult: await idkitResult("9", text, NULLIFIER_A) }, deps());
    assert.equal(r404.status, 404);
    const bad = await submitFeedback({ projectId: "abc", body: text, idkitResult: {} }, deps());
    assert.equal(bad.status, 404);
    const short = await submitFeedback({ projectId: "1", body: "too short", idkitResult: {} }, deps());
    assert.equal(short.status, 400);
    chainUp = false;
    const down = await submitFeedback({ projectId: "1", body: text, idkitResult: await idkitResult("1", text, NULLIFIER_A) }, deps());
    assert.equal(down.status, 503);
    assert.equal((down.body as { code: string }).code, "chain_unavailable");
    assert.equal(world.calls.length, 0);
  });
});
