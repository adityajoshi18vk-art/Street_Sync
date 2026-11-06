/**
 * @streetsync/evidence - End-to-end pipeline test
 *
 * Proves that a 4 MB raw photo pair + JSON metadata compresses into
 * a single <100 KiB signed bundle and unpacks bit-for-bit with valid
 * signature recovery and Hardhat/Viem bytes32 compatibility.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import sharp from "sharp";
import { createHash, randomBytes } from "node:crypto";
import {
  initZstd,
  resizeAndEncodePhoto,
  packBundle,
  unpackBundle,
  recoverWorkerAddress,
  verifyBundleIntegrity,
  chunkBundle,
  MAX_IMAGE_BYTES,
  MAGIC_BYTES,
  BUNDLE_VERSION,
  HEADER_SIZE,
  SIGNATURE_SIZE,
} from "../src/index.js";
import type { EvidenceMetadata } from "../src/index.js";

// Deterministic Hardhat account #0 for testing
const TEST_PRIVATE_KEY: `0x${string}` =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_WORKER_ADDRESS = TEST_ACCOUNT.address; // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

describe("Evidence Pipeline & Arkiv Compression Benchmark", () => {
  beforeAll(async () => {
    // Ensure Zstd WASM engine is initialized
    await initZstd();
  });

  it("proves 4 MB raw photo pair + JSON metadata compresses into a single <100 KiB signed bundle and unpacks bit-for-bit", async () => {
    // ═════════════════════════════════════════════════════════════════════
    // 1. Generate 4 MB raw photo pair (2 high-resolution uncompressed/high-detail photos)
    // ═════════════════════════════════════════════════════════════════════
    console.log("Generating 4 MB raw photo pair (simulating high-res camera captures)...");

    // Realistic high-detail camera capture simulation: 2048x1536 JPEG with texture
    // Each image is ~2.0 MB to prove compression from a 4 MB raw pair
    const texture1 = randomBytes(1600 * 1200 * 3);
    const beforeRaw = await sharp(texture1, {
      raw: { width: 1600, height: 1200, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const texture2 = randomBytes(1600 * 1200 * 3);
    const afterRaw = await sharp(texture2, {
      raw: { width: 1600, height: 1200, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const totalRawImagesBytes = beforeRaw.length + afterRaw.length;
    console.log(`Raw photo pair size: ${(totalRawImagesBytes / 1024 / 1024).toFixed(2)} MB (${totalRawImagesBytes.toLocaleString()} bytes)`);
    expect(totalRawImagesBytes).toBeGreaterThanOrEqual(3_500_000); // ~4 MB raw photo pair

    // ═════════════════════════════════════════════════════════════════════
    // 2. Strict Client-Side Image Re-encoding
    // ═════════════════════════════════════════════════════════════════════
    // Constraints: max 1280px longest edge, WebP quality 0.75 stepping down to 0.60, strictly <= 45 KiB per image
    const beforeEncoded = await resizeAndEncodePhoto(new Uint8Array(beforeRaw), {
      maxEdge: 1280,
      quality: 0.75,
      minQuality: 0.6,
      maxSizeBytes: MAX_IMAGE_BYTES,
    });

    const afterEncoded = await resizeAndEncodePhoto(new Uint8Array(afterRaw), {
      maxEdge: 1280,
      quality: 0.75,
      minQuality: 0.6,
      maxSizeBytes: MAX_IMAGE_BYTES,
    });

    expect(beforeEncoded.webpBytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(afterEncoded.webpBytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(beforeEncoded.finalWidth).toBeLessThanOrEqual(1280);
    expect(beforeEncoded.finalHeight).toBeLessThanOrEqual(1280);
    expect(afterEncoded.finalWidth).toBeLessThanOrEqual(1280);
    expect(afterEncoded.finalHeight).toBeLessThanOrEqual(1280);

    console.log(`Re-encoded Before WebP: ${(beforeEncoded.webpBytes.length / 1024).toFixed(2)} KiB (quality ${beforeEncoded.quality})`);
    console.log(`Re-encoded After WebP:  ${(afterEncoded.webpBytes.length / 1024).toFixed(2)} KiB (quality ${afterEncoded.quality})`);

    // ═════════════════════════════════════════════════════════════════════
    // 3. Structured Metadata with Visual Challenge Code
    // ═════════════════════════════════════════════════════════════════════
    const visualChallengeCode = 4821; // 4-digit uint16 emitted on Claimed
    const metadata: EvidenceMetadata = {
      bountyId: "1",
      visualChallengeCode,
      beforeTimestamp: 1718000000000,
      afterTimestamp: 1718003600000,
      gpsLatE5: 3777490,
      gpsLngE5: -12241940,
      gpsAccuracyM: 3.8,
      compassHeadingDeg: 194.5,
      deviceSummary: "iPhone 15 Pro, iOS 17.5, Mobile Safari",
      beforeImageSha256: beforeEncoded.sha256Hex,
      afterImageSha256: afterEncoded.sha256Hex,
      appVersion: "1.0.0",
      workerAddress: TEST_WORKER_ADDRESS,
      notes: "Filled pothole with hot mix asphalt, compacted and sealed edges.",
    };

    // ═════════════════════════════════════════════════════════════════════
    // 4. Pack into Deterministic Binary Bundle
    // ═════════════════════════════════════════════════════════════════════
    const { bundle, evidenceHash, stats, payloadHash } = await packBundle(
      {
        metadata,
        beforeImage: beforeEncoded.webpBytes,
        afterImage: afterEncoded.webpBytes,
        signerPrivateKey: TEST_PRIVATE_KEY,
      },
      totalRawImagesBytes
    );

    console.log("=== COMPRESSION STATS FOR UI PANEL ===");
    console.log(`Raw Total (Photos + Metadata JSON): ${(stats.rawTotalBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Metadata: Raw JSON: ${stats.rawMetadataBytes} B -> CBOR: ${stats.cborMetadataBytes} B -> Zstd Dict: ${stats.zstdMetadataBytes} B`);
    console.log(`Images: Raw: ${(stats.rawImagesBytes / 1024 / 1024).toFixed(2)} MB -> WebP: ${(stats.encodedImagesBytes / 1024).toFixed(2)} KiB`);
    console.log(`Signed Bundle Total Size: ${(bundle.length / 1024).toFixed(2)} KiB (${bundle.length} bytes)`);
    console.log(`Overall Compression Savings: ${stats.overallSavingsPercent.toFixed(2)}%`);
    console.log(`Overall Compression Ratio:   ${stats.overallCompressionRatio.toFixed(1)}x`);
    console.log(`Solidity bytes32 evidenceHash: ${evidenceHash}`);

    // STRICT SPEC VERIFICATION:
    // Single bundle MUST be < 100 KiB (102,400 bytes)
    expect(bundle.length).toBeLessThan(100 * 1024);
    // Well under Arkiv 120,000 bytes budget
    expect(bundle.length).toBeLessThan(120_000);

    // Verify layout constants
    expect(bundle[0]).toBe(MAGIC_BYTES[0]); // 'S'
    expect(bundle[1]).toBe(MAGIC_BYTES[1]); // 'S'
    expect(bundle[2]).toBe(MAGIC_BYTES[2]); // 'Y'
    expect(bundle[3]).toBe(MAGIC_BYTES[3]); // 'N'
    expect(bundle[4]).toBe(BUNDLE_VERSION); // 0x01

    // Verify 0x-prefixed 32-byte hex string format (bytes32 in Solidity / Hex in Viem)
    expect(evidenceHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(payloadHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Verify high compression ratio
    expect(stats.overallCompressionRatio).toBeGreaterThan(40);
    expect(stats.overallSavingsPercent).toBeGreaterThan(97);

    // ═════════════════════════════════════════════════════════════════════
    // 5. Bit-for-bit Unpacking & Verification
    // ═════════════════════════════════════════════════════════════════════
    const unpacked = await unpackBundle(bundle);

    expect(unpacked.magic).toBe("SSYN");
    expect(unpacked.version).toBe(1);
    expect(unpacked.beforeWebpLen).toBe(beforeEncoded.webpBytes.length);
    expect(unpacked.afterWebpLen).toBe(afterEncoded.webpBytes.length);

    // Images MUST match bit-for-bit
    expect(Buffer.from(unpacked.beforeImage).equals(Buffer.from(beforeEncoded.webpBytes))).toBe(true);
    expect(Buffer.from(unpacked.afterImage).equals(Buffer.from(afterEncoded.webpBytes))).toBe(true);

    // Metadata MUST match field-for-field
    expect(unpacked.metadata.bountyId).toBe(metadata.bountyId);
    expect(unpacked.metadata.visualChallengeCode).toBe(visualChallengeCode);
    expect(unpacked.metadata.beforeTimestamp).toBe(metadata.beforeTimestamp);
    expect(unpacked.metadata.afterTimestamp).toBe(metadata.afterTimestamp);
    expect(unpacked.metadata.gpsLatE5).toBe(metadata.gpsLatE5);
    expect(unpacked.metadata.gpsLngE5).toBe(metadata.gpsLngE5);
    expect(unpacked.metadata.gpsAccuracyM).toBe(metadata.gpsAccuracyM);
    expect(unpacked.metadata.compassHeadingDeg).toBe(metadata.compassHeadingDeg);
    expect(unpacked.metadata.deviceSummary).toBe(metadata.deviceSummary);
    expect(unpacked.metadata.beforeImageSha256).toBe(metadata.beforeImageSha256);
    expect(unpacked.metadata.afterImageSha256).toBe(metadata.afterImageSha256);
    expect(unpacked.metadata.appVersion).toBe(metadata.appVersion);

    // ═════════════════════════════════════════════════════════════════════
    // 6. Cryptographic Signature Recovery (Worker Wallet)
    // ═════════════════════════════════════════════════════════════════════
    expect(unpacked.signature.length).toBe(SIGNATURE_SIZE);
    const recoveredWorker = await recoverWorkerAddress(bundle);
    expect(recoveredWorker.toLowerCase()).toBe(TEST_WORKER_ADDRESS.toLowerCase());

    // ═════════════════════════════════════════════════════════════════════
    // 7. Full Integrity Auditor
    // ═════════════════════════════════════════════════════════════════════
    const auditValid = await verifyBundleIntegrity(bundle, evidenceHash, TEST_WORKER_ADDRESS);
    expect(auditValid.valid).toBe(true);
    expect(auditValid.errors).toHaveLength(0);

    // Test tamper detection: corrupt 1 byte in payload
    const tamperedBundle = new Uint8Array(bundle);
    tamperedBundle[HEADER_SIZE + 5] ^= 0xff;
    const auditTampered = await verifyBundleIntegrity(tamperedBundle, evidenceHash, TEST_WORKER_ADDRESS);
    expect(auditTampered.valid).toBe(false);
    expect(auditTampered.errors.length).toBeGreaterThan(0);

    // Test wrong worker address detection
    const wrongAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const auditWrongWorker = await verifyBundleIntegrity(bundle, evidenceHash, wrongAddress);
    expect(auditWrongWorker.valid).toBe(false);
    expect(auditWrongWorker.errors.some((e) => e.includes("mismatch"))).toBe(true);
  });

  it("handles automatic chunking fallback if bundle exceeds 120,000 bytes", () => {
    // Construct an oversized artificial bundle of 250,000 bytes
    const oversizedPayload = new Uint8Array(250_000);
    oversizedPayload.fill(0xab);

    const chunks = chunkBundle(oversizedPayload, 115_000);
    expect(chunks.length).toBe(3);

    // Each chunk starts with mini-header "SC" (0x53, 0x43) + index + total
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      expect(c[0]).toBe(0x53);
      expect(c[1]).toBe(0x43);
      expect(c[2]).toBe(i);
      expect(c[3]).toBe(chunks.length);
    }

    // Verify bit-for-bit reassembly
    let reassembledLength = 0;
    for (const c of chunks) {
      reassembledLength += c.length - 4;
    }
    expect(reassembledLength).toBe(oversizedPayload.length);

    const reassembled = new Uint8Array(reassembledLength);
    let offset = 0;
    for (const c of chunks) {
      const data = c.subarray(4);
      reassembled.set(data, offset);
      offset += data.length;
    }
    expect(Buffer.from(reassembled).equals(Buffer.from(oversizedPayload))).toBe(true);
  });

  it("preserves Ethereum Swarm video metadata and cryptographic hashes in signed CBOR bundle", async () => {
    const dummyImage = new Uint8Array(500);
    dummyImage.fill(0x42);

    const videoRef = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const videoSha = `0x${videoRef}`;

    const metadataWithVideo: EvidenceMetadata = {
      bountyId: 99,
      visualChallengeCode: 7788,
      beforeTimestamp: 1710000000000,
      afterTimestamp: 1710000010000,
      gpsLatE5: 3777490,
      gpsLngE5: -12241940,
      gpsAccuracyM: 2.5,
      compassHeadingDeg: 180,
      deviceSummary: "Test Mobile Device",
      beforeImageSha256: "0x1111",
      afterImageSha256: "0x2222",
      appVersion: "1.0.0",
      video: {
        swarmReference: videoRef,
        videoSha256: videoSha,
        durationSeconds: 10,
        mimeType: "video/webm",
        sizeBytes: 2_450_000,
      },
    };

    const { bundle, evidenceHash } = await packBundle({
      metadata: metadataWithVideo,
      beforeImage: dummyImage,
      afterImage: dummyImage,
      signerPrivateKey: TEST_PRIVATE_KEY,
    });

    const unpacked = await unpackBundle(bundle);
    expect(unpacked.metadata.video).toBeDefined();
    expect(unpacked.metadata.video?.swarmReference).toBe(videoRef);
    expect(unpacked.metadata.video?.videoSha256).toBe(videoSha);
    expect(unpacked.metadata.video?.durationSeconds).toBe(10);
    expect(unpacked.metadata.video?.mimeType).toBe("video/webm");
    expect(unpacked.metadata.video?.sizeBytes).toBe(2_450_000);

    const audit = await verifyBundleIntegrity(bundle, evidenceHash, TEST_WORKER_ADDRESS);
    expect(audit.valid).toBe(true);
    expect(audit.unpacked?.metadata?.video?.swarmReference).toBe(videoRef);
  });
});
