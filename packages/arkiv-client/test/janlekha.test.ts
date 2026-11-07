/**
 * @streetsync/arkiv-client - JanLekha evidence storage tests
 *
 * Covers write/read/verify of JanLekha evidence through an
 * in-memory Arkiv client: single-entity round trip, chunked
 * write/read round trip with manifest verification, fail-closed
 * behaviour on a tampered chunk, a tampered manifest, and a wrong
 * content hash, and the fail-closed live-client setup error.
 * Nothing here touches the live Arkiv gateway or any chain.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  initZstd,
  prepareJanLekhaEvidence,
  JANLEKHA_CHUNK_HEADER_BYTES,
} from "@streetsync/evidence";
import {
  writeJanLekhaEvidence,
  readJanLekhaEvidence,
  verifyJanLekhaEvidence,
  createLiveArkivClient,
  HttpArkivClient,
  ArkivNotConfiguredError,
  type IArkivClient,
} from "../src/index.js";

/** Deterministic pseudo-random bytes (xorshift32). Incompressible by design. */
function pseudoRandomBytes(length: number, seed = 0x12345678): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

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
    const key = `arkiv://entity-${this.idCounter++}`;
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

describe("JanLekha evidence on Arkiv", () => {
  beforeAll(async () => {
    await initZstd();
  });

  it("writes and reads a single-entity invoice, verified by content hash", async () => {
    const client = new MockArkivClient();
    const raw = new TextEncoder().encode("Invoice INV-200, milestone 1, Rs 12,00,000.");
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-inv-200",
      projectId: "proj-1",
      evidenceType: "invoice",
      fileName: "invoice-200.pdf",
      mimeType: "application/pdf",
    });
    expect(prepared.chunked).toBe(false);

    const write = await writeJanLekhaEvidence(client, prepared);
    expect(write.chunked).toBe(false);
    expect(write.entityKey).toMatch(/^arkiv:\/\/entity-/);
    expect(write.entityKeyBytes32).toMatch(/^0x[0-9a-f]{64}$/);
    expect(write.contentHash).toBe(prepared.contentHash);
    expect(write.manifestHash).toBeNull();

    const stored = client.entities.get(write.entityKey);
    expect(stored?.attributes.project).toBe("janlekha");
    expect(stored?.attributes.entity_type).toBe("evidence");
    expect(stored?.attributes.document_id).toBe("doc-inv-200");
    expect(stored?.attributes.project_id).toBe("proj-1");
    expect(stored?.attributes.evidence_type).toBe("invoice");
    expect(stored?.attributes.kind).toBe("bundle");

    const read = await readJanLekhaEvidence(client, write.entityKey, prepared.contentHash, {
      expectedDocumentId: "doc-inv-200",
      expectedProjectId: "proj-1",
      expectedEvidenceType: "invoice",
    });
    expect(read.verified).toBe(true);
    expect(read.chunked).toBe(false);
    expect(Buffer.from(read.raw).equals(Buffer.from(raw))).toBe(true);

    // Reading by the bytes32 key resolves through the local mapping.
    const readByBytes32 = await readJanLekhaEvidence(
      client,
      write.entityKeyBytes32,
      prepared.contentHash
    );
    expect(Buffer.from(readByBytes32.raw).equals(Buffer.from(raw))).toBe(true);

    const audit = await verifyJanLekhaEvidence(client, write.entityKey, prepared.contentHash);
    expect(audit.valid).toBe(true);
    expect(audit.errors).toHaveLength(0);
    expect(Buffer.from(audit.raw as Uint8Array).equals(Buffer.from(raw))).toBe(true);
  });

  it("writes and reads chunked evidence, reassembling in manifest order", async () => {
    const client = new MockArkivClient();
    const raw = pseudoRandomBytes(300_000);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-big-1",
      projectId: "proj-1",
      evidenceType: "progress-report",
      fileName: "progress-300k.bin",
    });
    expect(prepared.chunked).toBe(true);

    const write = await writeJanLekhaEvidence(client, prepared);
    expect(write.chunked).toBe(true);
    expect(write.totalChunks).toBe(3);
    expect(write.chunkKeys).toHaveLength(3);
    expect(write.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(write.manifestEntityKey).toBe(write.entityKey);
    expect(write.contentHash).toBe(prepared.contentHash);

    const manifestStored = client.entities.get(write.entityKey);
    expect(manifestStored?.attributes.kind).toBe("manifest");
    const manifestJson = JSON.parse(new TextDecoder().decode(manifestStored?.payload));
    expect(manifestJson.chunkKeys).toEqual(write.chunkKeys);
    expect(manifestJson.manifestHash).toBe(write.manifestHash);
    expect(manifestJson.totalChunks).toBe(3);
    expect(manifestJson.chunkHashes).toHaveLength(3);

    const read = await readJanLekhaEvidence(client, write.entityKey, prepared.contentHash);
    expect(read.verified).toBe(true);
    expect(read.chunked).toBe(true);
    expect(read.manifest?.totalChunks).toBe(3);
    expect(Buffer.from(read.raw).equals(Buffer.from(raw))).toBe(true);

    const audit = await verifyJanLekhaEvidence(client, write.entityKey, prepared.contentHash);
    expect(audit.valid).toBe(true);
    expect(audit.errors).toHaveLength(0);
  });

  it("fails closed when a stored chunk is tampered with", async () => {
    const client = new MockArkivClient();
    const raw = pseudoRandomBytes(300_000, 0x77777777);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-tamper-chunk",
      projectId: "proj-1",
      evidenceType: "inspection-report",
    });
    const write = await writeJanLekhaEvidence(client, prepared);
    const chunkKey = (write.chunkKeys as string[])[1];
    const storedChunk = client.entities.get(chunkKey) as {
      payload: Uint8Array;
      attributes: Record<string, string>;
    };
    const tampered = new Uint8Array(storedChunk.payload);
    tampered[JANLEKHA_CHUNK_HEADER_BYTES + 5] ^= 0xff;
    client.entities.set(chunkKey, { payload: tampered, attributes: storedChunk.attributes });

    const audit = await verifyJanLekhaEvidence(client, write.entityKey, prepared.contentHash);
    expect(audit.valid).toBe(false);
    expect(audit.raw).toBeNull();
    expect(audit.errors.length).toBeGreaterThan(0);
    expect(audit.errors[0]).toMatch(/hash mismatch/i);

    await expect(
      readJanLekhaEvidence(client, write.entityKey, prepared.contentHash)
    ).rejects.toThrow(/hash mismatch/i);
  });

  it("fails closed when the stored manifest is tampered with", async () => {
    const client = new MockArkivClient();
    const raw = pseudoRandomBytes(300_000, 0x99999999);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-tamper-manifest",
      projectId: "proj-1",
      evidenceType: "audit-document",
    });
    const write = await writeJanLekhaEvidence(client, prepared);
    const stored = client.entities.get(write.entityKey) as {
      payload: Uint8Array;
      attributes: Record<string, string>;
    };
    const manifestJson = JSON.parse(new TextDecoder().decode(stored.payload)) as {
      chunkHashes: string[];
    };
    manifestJson.chunkHashes[0] =
      manifestJson.chunkHashes[0].slice(0, 10) +
      (manifestJson.chunkHashes[0][10] === "a" ? "b" : "a") +
      manifestJson.chunkHashes[0].slice(11);
    client.entities.set(write.entityKey, {
      payload: new TextEncoder().encode(JSON.stringify(manifestJson)),
      attributes: stored.attributes,
    });

    const audit = await verifyJanLekhaEvidence(client, write.entityKey, prepared.contentHash);
    expect(audit.valid).toBe(false);
    expect(audit.raw).toBeNull();
    expect(audit.errors[0]).toMatch(/manifest hash mismatch/i);
  });

  it("fails closed on a wrong expected content hash", async () => {
    const client = new MockArkivClient();
    const raw = new TextEncoder().encode("Expenditure statement, Q3.");
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-exp-1",
      projectId: "proj-1",
      evidenceType: "expenditure-document",
    });
    const write = await writeJanLekhaEvidence(client, prepared);
    const wrongHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    const audit = await verifyJanLekhaEvidence(client, write.entityKey, wrongHash);
    expect(audit.valid).toBe(false);
    expect(audit.raw).toBeNull();
    await expect(
      readJanLekhaEvidence(client, write.entityKey, wrongHash)
    ).rejects.toThrow(/hash mismatch/i);
  });

  it("fails closed when no live Arkiv API key is configured, and never claims live verification", () => {
    expect(() => createLiveArkivClient({})).toThrow(ArkivNotConfiguredError);
    expect(() => createLiveArkivClient({})).toThrow(/ARKIV_API_KEY/);
    expect(() => createLiveArkivClient({ ARKIV_API_KEY: "" })).toThrow(/ARKIV_API_KEY/);
    expect(() => createLiveArkivClient({ ARKIV_API_KEY: "   " })).toThrow(/ARKIV_API_KEY/);
    const client = new HttpArkivClient();
    expect(client.liveVerified).toBe(false);
  });
});
