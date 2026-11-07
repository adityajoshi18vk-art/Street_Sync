/**
 * @streetsync/evidence - JanLekha evidence pipeline tests
 *
 * Covers the JanLekha pipeline in packages/evidence/src/janlekha.ts:
 * SHA-256 of known inputs, Zstd compress/decompress round trip,
 * payload size validation at the Arkiv boundaries, chunking and
 * manifest reassembly in order, manifest integrity failure on a
 * tampered chunk, and rejection of sensitive document types.
 * Nothing here touches the live Arkiv gateway or any chain.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  initZstd,
  compressBytes,
  decompressBytes,
  sha256Hex,
  sha256HexBytes32,
  validatePayloadSize,
  prepareJanLekhaEvidence,
  decodeAndVerifySinglePayload,
  encodeChunkPayload,
  encodeJanLekhaManifest,
  buildJanLekhaManifest,
  parseAndVerifyManifest,
  reassembleJanLekhaChunks,
  decompressAndVerify,
  assertAllowedEvidenceType,
  JANLEKHA_EVIDENCE_TYPES,
  JANLEKHA_ARKIV_MAX_ENTITY_BYTES,
  JANLEKHA_ARKIV_TARGET_BYTES,
  JANLEKHA_MAX_CHUNK_DATA_BYTES,
  JANLEKHA_CHUNK_HEADER_BYTES,
  JanLekhaEvidenceError,
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

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("JanLekha evidence pipeline", () => {
  beforeAll(async () => {
    await initZstd();
  });

  it("computes SHA-256 of known inputs", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(await sha256HexBytes32("abc")).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(await sha256Hex(textBytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(await sha256Hex("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("round trips bytes through Zstd compress then decompress", async () => {
    const text = "INVOICE JanLekha milestone payment. ".repeat(4000);
    const raw = textBytes(text);
    const { compressed, method } = await compressBytes(raw);
    expect(method).toBe("zstd");
    expect(compressed.length).toBeLessThan(raw.length);
    const roundTripped = await decompressBytes(compressed, method);
    expect(Buffer.from(roundTripped).equals(Buffer.from(raw))).toBe(true);

    const random = pseudoRandomBytes(50_000);
    const packed = await compressBytes(random);
    expect(packed.method).toBe("zstd");
    const unpacked = await decompressBytes(packed.compressed, packed.method);
    expect(Buffer.from(unpacked).equals(Buffer.from(random))).toBe(true);
  });

  it("validates payload size at the Arkiv boundaries", () => {
    expect(JANLEKHA_ARKIV_TARGET_BYTES).toBe(120_000);
    expect(JANLEKHA_ARKIV_MAX_ENTITY_BYTES).toBe(128_000);

    const atTarget = validatePayloadSize(new Uint8Array(120_000), "test payload");
    expect(atTarget.fitsTarget).toBe(true);
    expect(atTarget.fitsHardLimit).toBe(true);

    const overTarget = validatePayloadSize(new Uint8Array(120_001), "test payload");
    expect(overTarget.fitsTarget).toBe(false);
    expect(overTarget.fitsHardLimit).toBe(true);

    const atHard = validatePayloadSize(new Uint8Array(128_000), "test payload");
    expect(atHard.fitsTarget).toBe(false);
    expect(atHard.fitsHardLimit).toBe(true);

    expect(() => validatePayloadSize(new Uint8Array(128_001), "test payload")).toThrow(RangeError);
    expect(() => validatePayloadSize(new Uint8Array(200_000), "test payload")).toThrow(
      /128000/
    );
  });

  it("accepts every allowlisted public evidence type and rejects an empty file", async () => {
    for (const type of JANLEKHA_EVIDENCE_TYPES) {
      expect(assertAllowedEvidenceType(type)).toBe(type);
      const prepared = await prepareJanLekhaEvidence({
        raw: textBytes(`Public evidence for ${type}.`),
        documentId: `doc-${type}`,
        projectId: "proj-1",
        evidenceType: type,
      });
      expect(prepared.chunked).toBe(false);
      expect(prepared.singlePayload).not.toBeNull();
      expect(prepared.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
      const raw = await decodeAndVerifySinglePayload(
        prepared.singlePayload as Uint8Array,
        prepared.contentHash
      );
      expect(new TextDecoder().decode(raw)).toBe(`Public evidence for ${type}.`);
    }
    await expect(
      prepareJanLekhaEvidence({
        raw: new Uint8Array(0),
        documentId: "doc-empty",
        projectId: "proj-1",
        evidenceType: "invoice",
      })
    ).rejects.toThrow(/empty/);
  });

  it("chunks large evidence, reassembles it in manifest order, and verifies the content hash", async () => {
    const raw = pseudoRandomBytes(300_000);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-chunk-1",
      projectId: "proj-1",
      evidenceType: "invoice",
      fileName: "invoice-300k.bin",
      mimeType: "application/octet-stream",
    });
    expect(prepared.chunked).toBe(true);
    expect(prepared.singlePayload).toBeNull();
    expect(prepared.manifestCore).not.toBeNull();
    const expectedChunks = Math.ceil(
      prepared.compressedSizeBytes / JANLEKHA_MAX_CHUNK_DATA_BYTES
    );
    expect(prepared.chunks.length).toBe(expectedChunks);
    expect(expectedChunks).toBe(3);
    expect(prepared.manifestCore?.totalChunks).toBe(3);
    expect(prepared.manifestCore?.chunkHashes).toHaveLength(3);
    expect(prepared.manifestCore?.chunkSizes).toHaveLength(3);
    expect(prepared.manifestCore?.contentHash).toBe(prepared.contentHash);

    const fakeKeys = ["arkiv://chunk-0", "arkiv://chunk-1", "arkiv://chunk-2"];
    const { manifest, payload } = await buildJanLekhaManifest(
      prepared.manifestCore as NonNullable<typeof prepared.manifestCore>,
      fakeKeys
    );
    expect(manifest.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payload.length).toBeLessThanOrEqual(JANLEKHA_ARKIV_TARGET_BYTES);

    const verifiedManifest = await parseAndVerifyManifest(payload);
    expect(verifiedManifest.manifestHash).toBe(manifest.manifestHash);
    expect(verifiedManifest.chunkKeys).toEqual(fakeKeys);

    const chunkPayloads = prepared.chunks.map((plan) =>
      encodeChunkPayload(plan, prepared.manifestCore?.totalChunks ?? 3)
    );
    for (const chunkPayload of chunkPayloads) {
      expect(chunkPayload.length).toBeLessThanOrEqual(JANLEKHA_ARKIV_TARGET_BYTES);
    }
    const compressed = await reassembleJanLekhaChunks(chunkPayloads, verifiedManifest);
    expect(compressed.length).toBe(prepared.compressedSizeBytes);
    const recovered = await decompressAndVerify(
      compressed,
      prepared.compression,
      prepared.contentHash,
      prepared.originalSizeBytes
    );
    expect(Buffer.from(recovered).equals(Buffer.from(raw))).toBe(true);
  });

  it("fails reassembly when chunks arrive out of order", async () => {
    const raw = pseudoRandomBytes(300_000, 0xabcdef01);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-order-1",
      projectId: "proj-1",
      evidenceType: "progress-report",
    });
    expect(prepared.chunked).toBe(true);
    const { manifest } = await buildJanLekhaManifest(
      prepared.manifestCore as NonNullable<typeof prepared.manifestCore>,
      ["arkiv://c0", "arkiv://c1", "arkiv://c2"]
    );
    const chunkPayloads = prepared.chunks.map((plan) =>
      encodeChunkPayload(plan, manifest.totalChunks)
    );
    const swapped = [chunkPayloads[1], chunkPayloads[0], chunkPayloads[2]];
    await expect(reassembleJanLekhaChunks(swapped, manifest)).rejects.toThrow(
      /out of order|CHUNK_ORDER_MISMATCH/
    );
  });

  it("fails manifest integrity on a tampered chunk and on a tampered manifest", async () => {
    const raw = pseudoRandomBytes(300_000, 0x55555555);
    const prepared = await prepareJanLekhaEvidence({
      raw,
      documentId: "doc-tamper-1",
      projectId: "proj-1",
      evidenceType: "inspection-report",
    });
    const { manifest } = await buildJanLekhaManifest(
      prepared.manifestCore as NonNullable<typeof prepared.manifestCore>,
      ["arkiv://c0", "arkiv://c1", "arkiv://c2"]
    );
    const chunkPayloads = prepared.chunks.map((plan) =>
      encodeChunkPayload(plan, manifest.totalChunks)
    );

    // Tamper one byte inside chunk 1 data (after the 49 byte header).
    const tampered = chunkPayloads.map((c) => new Uint8Array(c));
    tampered[1][JANLEKHA_CHUNK_HEADER_BYTES + 10] ^= 0xff;
    await expect(reassembleJanLekhaChunks(tampered, manifest)).rejects.toThrow(
      /hash mismatch|CHUNK_HASH_MISMATCH/
    );

    // Tamper the manifest itself: change one chunk hash entry.
    const tamperedManifest = {
      ...manifest,
      chunkHashes: [
        manifest.chunkHashes[0].slice(0, 10) +
          (manifest.chunkHashes[0][10] === "a" ? "b" : "a") +
          manifest.chunkHashes[0].slice(11),
        manifest.chunkHashes[1],
        manifest.chunkHashes[2],
      ] as [`0x${string}`, `0x${string}`, `0x${string}`],
    };
    await expect(
      parseAndVerifyManifest(encodeJanLekhaManifest(tamperedManifest))
    ).rejects.toThrow(/manifest hash mismatch|MANIFEST_HASH_MISMATCH/);
  });

  it("rejects sensitive and other non-allowlisted document types", async () => {
    for (const sensitive of ["passport", "aadhaar", "pan-card", "bank-statement", "medical-record", "confidential"]) {
      await expect(
        prepareJanLekhaEvidence({
          raw: textBytes("sensitive content"),
          documentId: "doc-sensitive",
          projectId: "proj-1",
          evidenceType: sensitive,
        })
      ).rejects.toThrow(JanLekhaEvidenceError);
      await expect(
        prepareJanLekhaEvidence({
          raw: textBytes("sensitive content"),
          documentId: "doc-sensitive",
          projectId: "proj-1",
          evidenceType: sensitive,
        })
      ).rejects.toMatchObject({ code: "EVIDENCE_TYPE_SENSITIVE" });
    }
    await expect(
      prepareJanLekhaEvidence({
        raw: textBytes("not allowed"),
        documentId: "doc-other",
        projectId: "proj-1",
        evidenceType: "tender-document",
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_TYPE_REJECTED" });
    await expect(
      prepareJanLekhaEvidence({
        raw: textBytes("not allowed"),
        documentId: "doc-other",
        projectId: "proj-1",
        evidenceType: "",
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_TYPE_REJECTED" });
  });

  it("fails closed when a single payload is verified against the wrong hash or tampered", async () => {
    const prepared = await prepareJanLekhaEvidence({
      raw: textBytes("Invoice INV-100 for milestone work."),
      documentId: "doc-single-1",
      projectId: "proj-1",
      evidenceType: "invoice",
    });
    const payload = prepared.singlePayload as Uint8Array;
    const wrongHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    await expect(decodeAndVerifySinglePayload(payload, wrongHash)).rejects.toThrow(
      /SHA-256|integrity check failed|hash mismatch|CONTENT_HASH_MISMATCH/i
    );
    const tampered = new Uint8Array(payload);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(decodeAndVerifySinglePayload(tampered, prepared.contentHash)).rejects.toThrow(
      /SHA-256|integrity check failed|hash mismatch|CONTENT_HASH_MISMATCH|decompression/i
    );
  });
});
