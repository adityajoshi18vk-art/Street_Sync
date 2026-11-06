import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { packBundle, type EvidenceMetadata } from "@streetsync/evidence";
import { validateEvidenceBundle, EvidenceRejectedError, type OnChainBountyView } from "../src/arkiv-relay.js";

const WORKER_KEY = `0x${"22".repeat(32)}` as const;
const worker = privateKeyToAccount(WORKER_KEY).address;

async function makeBundle(overrides: Partial<EvidenceMetadata> = {}) {
  const metadata: EvidenceMetadata = {
    v: 1, bountyId: "7", workerAddress: worker, challengeCode: 4321,
    beforeTimestampMs: 1, afterTimestampMs: 2,
    gps: { lat: 1, lng: 2, accuracyMeters: 5 },
    orientation: { alpha: null, beta: null, gamma: null },
    beforeSha256: "00", afterSha256: "11", userAgent: "test", notes: "",
    ...overrides,
  };
  const { bundle } = await packBundle({
    metadata, beforeImage: new Uint8Array([1, 2, 3]), afterImage: new Uint8Array([4, 5, 6]),
    signerPrivateKey: WORKER_KEY,
  });
  return bundle;
}

const claimedBy = (w: string, status = 1) => async (): Promise<OnChainBountyView> =>
  ({ worker: w as `0x${string}`, status });

describe("Arkiv evidence relay validation", () => {
  it("accepts a bundle signed by the on-chain worker of a claimed bounty", async () => {
    const v = await validateEvidenceBundle(await makeBundle(), claimedBy(worker));
    assert.equal(v.attributes.bounty_id, "7");
    assert.equal(v.attributes.worker, worker.toLowerCase());
    assert.equal(v.attributes.sha256_prefix, v.evidenceHash.slice(0, 32));
  });

  it("rejects a bundle whose claimed worker did not sign it", async () => {
    const bundle = await makeBundle({ workerAddress: "0x1111111111111111111111111111111111111111" });
    await assert.rejects(validateEvidenceBundle(bundle, claimedBy(worker)), EvidenceRejectedError);
  });

  it("rejects bundles for bounties not awaiting evidence or claimed by someone else", async () => {
    const bundle = await makeBundle();
    await assert.rejects(validateEvidenceBundle(bundle, claimedBy(worker, 2)), /not awaiting evidence/);
    await assert.rejects(
      validateEvidenceBundle(bundle, claimedBy("0x1111111111111111111111111111111111111111")),
      /not signed by the bounty's worker/,
    );
  });

  it("rejects malformed and oversized payloads before any chain read", async () => {
    let reads = 0;
    const reader = async () => { reads++; return { worker, status: 1 }; };
    await assert.rejects(validateEvidenceBundle(new Uint8Array(10), reader), /Malformed/);
    await assert.rejects(validateEvidenceBundle(new Uint8Array(120_001), reader), /must be/);
    assert.equal(reads, 0);
  });
});
