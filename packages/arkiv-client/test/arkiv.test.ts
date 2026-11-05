/**
 * @streetsync/arkiv-client - Integration and verification tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  initZstd,
  packBundle,
  resizeAndEncodePhoto,
  MAX_IMAGE_BYTES,
} from "@streetsync/evidence";
import type { EvidenceMetadata } from "@streetsync/evidence";
import {
  writeEvidenceBundle,
  readEvidenceBundle,
  verifyEvidenceBundle,
  entityKeyToBytes32,
  bytes32ToEntityKey,
  computeEvidenceHash,
  type IArkivClient,
} from "../src/index.js";

const TEST_PRIVATE_KEY: `0x${string}` =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_WORKER = TEST_ACCOUNT.address;

/**
 * In-memory mock implementation of Arkiv decentralized storage client
 */
class MockArkivClient implements IArkivClient {
  public entities = new Map<
    string,
    { payload: Uint8Array; attributes: Record<string, string>; ttl?: number }
  >();
  private idCounter = 1;

  async writeEntity(
    payload: Uint8Array,
    attributes: Record<string, string>,
    options?: { ttl?: number }
  ): Promise<{ key: string }> {
    const key = `arkiv://entity-${this.idCounter++}-${Date.now()}`;
    this.entities.set(key, { payload: new Uint8Array(payload), attributes, ttl: options?.ttl });
    return { key };
  }

  async readEntity(
    key: string
  ): Promise<{ payload: Uint8Array; attributes: Record<string, string> }> {
    const found = this.entities.get(key);
    if (!found) {
      throw new Error(`Arkiv entity not found: ${key}`);
    }
    return { payload: found.payload, attributes: found.attributes };
  }
}

describe("Arkiv Client SDK Integration & Audit Engine", () => {
  let mockClient: MockArkivClient;

  beforeAll(async () => {
    await initZstd();
    mockClient = new MockArkivClient();
  });

  it("converts arbitrary Arkiv entity keys to 0x-prefixed bytes32 strings and back", async () => {
    const arkivKey = "arkiv://streetsync-bounty-1-evidence-abc123xyz";
    const bytes32Hex = await entityKeyToBytes32(arkivKey);

    expect(bytes32Hex).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const reversed = bytes32ToEntityKey(bytes32Hex);
    expect(reversed).toBe(arkivKey);
  });

  it("writes evidence bundle to Arkiv with exact attributes and verifies on-chain compatibility", async () => {
    // 1. Prepare minimal valid mock photos
    const mockPhoto1 = new Uint8Array(2000).fill(0x11);
    const mockPhoto2 = new Uint8Array(2000).fill(0x22);

    const metadata: EvidenceMetadata = {
      bountyId: "42",
      visualChallengeCode: 7890,
      beforeTimestamp: 1718000000000,
      afterTimestamp: 1718003600000,
      gpsLatE5: 3777490,
      gpsLngE5: -12241940,
      gpsAccuracyM: 2.5,
      compassHeadingDeg: 90.0,
      deviceSummary: "Pixel 8 Pro, Android 14, Chrome Mobile",
      beforeImageSha256: "0x1111111111111111111111111111111111111111111111111111111111111111",
      afterImageSha256: "0x2222222222222222222222222222222222222222222222222222222222222222",
      appVersion: "1.0.0",
      workerAddress: TEST_WORKER,
    };

    const { bundle, evidenceHash } = await packBundle({
      metadata,
      beforeImage: mockPhoto1,
      afterImage: mockPhoto2,
      signerPrivateKey: TEST_PRIVATE_KEY,
    });

    // 2. Write to Arkiv
    const writeResult = await writeEvidenceBundle(
      mockClient,
      bundle,
      TEST_WORKER,
      42,
      evidenceHash
    );

    expect(writeResult.chunked).toBe(false);
    expect(writeResult.entityKeyBytes32).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(writeResult.evidenceHash).toBe(evidenceHash);

    // Verify stored entity attributes
    const stored = mockClient.entities.get(writeResult.entityKey);
    expect(stored).toBeDefined();
    expect(stored?.attributes.project).toBe("streetsync");
    expect(stored?.attributes.entity_type).toBe("evidence");
    expect(stored?.attributes.bounty_id).toBe("42");
    expect(stored?.attributes.worker).toBe(TEST_WORKER.toLowerCase());
    expect(stored?.attributes.kind).toBe("bundle");
    // Strict requirement: sha256_prefix is evidenceHash.slice(0, 18)
    expect(stored?.attributes.sha256_prefix).toBe(evidenceHash.slice(0, 18));

    // 3. Read back from Arkiv using either raw key or bytes32 key
    const readFromRaw = await readEvidenceBundle(mockClient, writeResult.entityKey);
    expect(Buffer.from(readFromRaw.bundle).equals(Buffer.from(bundle))).toBe(true);

    const readFromBytes32 = await readEvidenceBundle(mockClient, writeResult.entityKeyBytes32);
    expect(Buffer.from(readFromBytes32.bundle).equals(Buffer.from(bundle))).toBe(true);

    // 4. Public verification and cryptographic audit
    const audit = await verifyEvidenceBundle(
      mockClient,
      writeResult.entityKeyBytes32,
      evidenceHash,
      TEST_WORKER
    );

    expect(audit.valid).toBe(true);
    expect(audit.errors).toHaveLength(0);
    expect(audit.evidenceHashMatch).toBe(true);
    expect(audit.signatureValid).toBe(true);
    expect(audit.recoveredWorker?.toLowerCase()).toBe(TEST_WORKER.toLowerCase());
    expect(audit.metadata?.visualChallengeCode).toBe(7890);
    expect(audit.metadata?.bountyId).toBe("42");
  });

  it("handles automatic chunking fallback for bundles exceeding 120,000 bytes", async () => {
    // Create an artificial oversized bundle
    const bigBundle = new Uint8Array(180_000);
    bigBundle.fill(0xcc);

    const evidenceHash = await computeEvidenceHash(bigBundle);

    const writeResult = await writeEvidenceBundle(
      mockClient,
      bigBundle,
      TEST_WORKER,
      99,
      evidenceHash
    );

    expect(writeResult.chunked).toBe(true);
    expect(writeResult.chunkKeys).toBeDefined();
    expect(writeResult.chunkKeys!.length).toBe(2);

    // Read back and verify transparent reassembly
    const readResult = await readEvidenceBundle(mockClient, writeResult.entityKey);
    expect(readResult.bundle.length).toBe(bigBundle.length);
    expect(Buffer.from(readResult.bundle).equals(Buffer.from(bigBundle))).toBe(true);
  });
});

