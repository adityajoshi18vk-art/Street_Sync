/**
 * @streetsync/evidence - Deterministic binary bundle packer, unpacker, and cryptographic verifier
 *
 * Binary layout (20-byte header):
 * Offset 0..3:   Magic (4 bytes): ASCII "SSYN" (0x53, 0x53, 0x59, 0x4E)
 * Offset 4:      Version (1 byte): 0x01
 * Offset 5:      Flags (1 byte): Bit 0: Zstd Dict Used (1), Bit 1: WebP (1)
 * Offset 6..7:   dictId (2 bytes): uint16 big-endian
 * Offset 8..11:  zstdMetadataLen (4 bytes): uint32 big-endian
 * Offset 12..15: beforeWebpLen (4 bytes): uint32 big-endian
 * Offset 16..19: afterWebpLen (4 bytes): uint32 big-endian
 * Offset 20..    zstd(metadata_cbor) bytes
 * Next:          before_image.webp bytes (<= 48,000 bytes)
 * Next:          after_image.webp bytes (<= 48,000 bytes)
 * Next 65 B:     Worker EIP-191 signature over SHA-256 of all preceding bytes
 */

import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, bytesToHex, hexToBytes } from "viem";
import { createHash } from "node:crypto";
import { compressMetadata, decompressMetadata, encodeMetadataToCBOR, DICT_ID } from "./compress.js";
import { MAX_IMAGE_BYTES } from "./resizer.js";
import type { BundleInput, CompressionStats, EvidenceMetadata, UnpackedBundle } from "./types.js";

export const MAGIC_BYTES = new Uint8Array([0x53, 0x53, 0x59, 0x4e]); // "SSYN"
export const BUNDLE_VERSION = 0x01;
export const FLAG_ZSTD_DICT = 0x01; // Bit 0
export const FLAG_WEBP = 0x02; // Bit 1
export const HEADER_SIZE = 20;
export const SIGNATURE_SIZE = 65;
export const MAX_BUNDLE_BYTES = 100_000;
export const MAX_SAFE_BUNDLE_BYTES = 120_000; // Arkiv safe budget
export const MAX_ARKIV_PAYLOAD = 128 * 1024;

/**
 * SHA-256 helper returning Uint8Array
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const buf = await globalThis.crypto.subtle.digest(
      "SHA-256",
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    );
    return new Uint8Array(buf);
  }
  const hash = createHash("sha256");
  hash.update(data);
  return new Uint8Array(hash.digest());
}

/**
 * SHA-256 helper returning 0x-prefixed 32-byte hex string (bytes32 compatible)
 */
export async function sha256Bytes32(data: Uint8Array): Promise<`0x${string}`> {
  const digest = await sha256(data);
  return bytesToHex(digest);
}

/**
 * Packs metadata and photos into a deterministic signed binary bundle.
 * Returns the bundle byte array, on-chain 32-byte evidenceHash, and compression stats.
 */
export async function packBundle(
  input: BundleInput,
  rawImagesOriginalBytes?: number
): Promise<{
  bundle: Uint8Array;
  evidenceHash: `0x${string}`;
  stats: CompressionStats;
  payloadHash: `0x${string}`;
}> {
  const { metadata, beforeImage, afterImage, signerPrivateKey } = input;

  // 1. Strict image size validation
  if (beforeImage.length > MAX_IMAGE_BYTES) {
    throw new RangeError(
      `Before photo is ${beforeImage.length} bytes; exceeds strict limit of ${MAX_IMAGE_BYTES} bytes`
    );
  }
  if (afterImage.length > MAX_IMAGE_BYTES) {
    throw new RangeError(
      `After photo is ${afterImage.length} bytes; exceeds strict limit of ${MAX_IMAGE_BYTES} bytes`
    );
  }

  // 2. Metadata compression (CBOR + Zstandard WASM with dictionary)
  const rawMetadataJson = JSON.stringify(metadata);
  const rawMetadataBytes = new TextEncoder().encode(rawMetadataJson).length;
  const cborBytes = encodeMetadataToCBOR(metadata);
  const { compressed: zstdMetadataBytes, dictUsed } = await compressMetadata(cborBytes);

  // 3. Flags and header composition
  let flags = FLAG_WEBP;
  if (dictUsed) {
    flags |= FLAG_ZSTD_DICT;
  }
  const dictIdToUse = dictUsed ? DICT_ID : 0x0000;

  const header = new Uint8Array(HEADER_SIZE);
  const headerView = new DataView(header.buffer);

  // Magic (4 bytes)
  header.set(MAGIC_BYTES, 0);
  // Version (1 byte)
  header[4] = BUNDLE_VERSION;
  // Flags (1 byte)
  header[5] = flags;
  // dictId (uint16 BE)
  headerView.setUint16(6, dictIdToUse, false);
  // zstdMetadataLen (uint32 BE)
  headerView.setUint32(8, zstdMetadataBytes.length, false);
  // beforeWebpLen (uint32 BE)
  headerView.setUint32(12, beforeImage.length, false);
  // afterWebpLen (uint32 BE)
  headerView.setUint32(16, afterImage.length, false);

  // 4. Assemble payload (everything preceding the signature)
  const payloadLen = HEADER_SIZE + zstdMetadataBytes.length + beforeImage.length + afterImage.length;
  const payload = new Uint8Array(payloadLen);

  let offset = 0;
  payload.set(header, offset);
  offset += HEADER_SIZE;

  payload.set(zstdMetadataBytes, offset);
  offset += zstdMetadataBytes.length;

  payload.set(beforeImage, offset);
  offset += beforeImage.length;

  payload.set(afterImage, offset);
  offset += afterImage.length;

  // 5. SHA-256 of all preceding bytes
  const payloadHash = await sha256(payload);
  const payloadHashHex = bytesToHex(payloadHash);

  // 6. 65-byte EIP-191 signature over SHA-256 of preceding bytes
  const account = privateKeyToAccount(signerPrivateKey);
  const signatureHex = await account.signMessage({
    message: { raw: payloadHash },
  });
  const signatureBytes = hexToBytes(signatureHex);

  if (signatureBytes.length !== SIGNATURE_SIZE) {
    throw new Error(`Signature length is ${signatureBytes.length}; expected ${SIGNATURE_SIZE}`);
  }

  // 7. Complete signed bundle
  const bundle = new Uint8Array(payloadLen + SIGNATURE_SIZE);
  bundle.set(payload, 0);
  bundle.set(signatureBytes, payloadLen);

  if (bundle.length > MAX_BUNDLE_BYTES) {
    throw new RangeError(`Evidence bundle is ${bundle.length} bytes; exceeds ${MAX_BUNDLE_BYTES}-byte target`);
  }

  // 8. Compute on-chain evidenceHash (SHA-256 over complete bundle including signature)
  const evidenceHash = await sha256Bytes32(bundle);

  // 9. Compute compression statistics
  const rawImages = rawImagesOriginalBytes ?? (beforeImage.length + afterImage.length);
  const encodedImages = beforeImage.length + afterImage.length;
  const rawTotal = rawImages + rawMetadataBytes;
  const totalBundle = bundle.length;

  const stats: CompressionStats = {
    rawImagesBytes: rawImages,
    encodedImagesBytes: encodedImages,
    rawMetadataBytes,
    cborMetadataBytes: cborBytes.length,
    zstdMetadataBytes: zstdMetadataBytes.length,
    headerBytes: HEADER_SIZE,
    signatureBytes: SIGNATURE_SIZE,
    totalBundleBytes: totalBundle,
    rawTotalBytes: rawTotal,
    overallCompressionRatio: rawTotal / totalBundle,
    overallSavingsPercent: Math.max(0, (1 - totalBundle / rawTotal) * 100),
    metadataSavingsPercent: Math.max(0, (1 - zstdMetadataBytes.length / rawMetadataBytes) * 100),
    imageSavingsPercent: Math.max(0, (1 - encodedImages / rawImages) * 100),
  };

  return {
    bundle,
    evidenceHash,
    stats,
    payloadHash: payloadHashHex,
  };
}

/**
 * Unpacks and validates a binary bundle according to exact layout specification.
 */
export async function unpackBundle(bundle: Uint8Array): Promise<UnpackedBundle> {
  if (bundle.length < HEADER_SIZE + SIGNATURE_SIZE) {
    throw new RangeError(
      `Bundle is ${bundle.length} bytes, minimum required is ${HEADER_SIZE + SIGNATURE_SIZE}`
    );
  }

  // 1. Verify Magic
  for (let i = 0; i < 4; i++) {
    if (bundle[i] !== MAGIC_BYTES[i]) {
      throw new Error(`Invalid bundle magic: expected SSYN (0x5353594E)`);
    }
  }

  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);

  // 2. Read Header
  const version = bundle[4];
  const flags = bundle[5];
  const dictId = view.getUint16(6, false);
  const zstdMetadataLen = view.getUint32(8, false);
  const beforeWebpLen = view.getUint32(12, false);
  const afterWebpLen = view.getUint32(16, false);

  const expectedLength = HEADER_SIZE + zstdMetadataLen + beforeWebpLen + afterWebpLen + SIGNATURE_SIZE;
  if (bundle.length !== expectedLength) {
    throw new RangeError(
      `Corrupted bundle: declared content requires exactly ${expectedLength} bytes, but bundle has ${bundle.length}`
    );
  }

  // 3. Extract sections
  let offset = HEADER_SIZE;

  const zstdMetadata = bundle.subarray(offset, offset + zstdMetadataLen);
  offset += zstdMetadataLen;

  const beforeImage = bundle.subarray(offset, offset + beforeWebpLen);
  offset += beforeWebpLen;

  const afterImage = bundle.subarray(offset, offset + afterWebpLen);
  offset += afterWebpLen;

  const signature = bundle.subarray(offset, offset + SIGNATURE_SIZE);

  // 4. Payload hash (preceding signature)
  const payloadBytes = bundle.subarray(0, offset);
  const payloadHash = await sha256(payloadBytes);

  // 5. Decompress metadata
  const dictUsed = (flags & FLAG_ZSTD_DICT) !== 0;
  const metadata = await decompressMetadata(zstdMetadata, dictUsed);

  return {
    magic: "SSYN",
    version,
    flags,
    dictId,
    zstdMetadataLen,
    beforeWebpLen,
    afterWebpLen,
    metadata,
    beforeImage: new Uint8Array(beforeImage),
    afterImage: new Uint8Array(afterImage),
    signature: new Uint8Array(signature),
    payloadHash,
  };
}

/**
 * Recovers the worker's Ethereum address from the bundle signature.
 */
export async function recoverWorkerAddress(bundle: Uint8Array): Promise<`0x${string}`> {
  if (bundle.length < HEADER_SIZE + SIGNATURE_SIZE) {
    throw new RangeError("Bundle too small to contain signature");
  }

  const payloadEnd = bundle.length - SIGNATURE_SIZE;
  const payload = bundle.subarray(0, payloadEnd);
  const signatureBytes = bundle.subarray(payloadEnd);

  const payloadHash = await sha256(payload);
  const sigHex = bytesToHex(signatureBytes);

  const address = await recoverMessageAddress({
    message: { raw: payloadHash },
    signature: sigHex,
  });

  return address.toLowerCase() as `0x${string}`;
}

/**
 * Verifies the integrity of a bundle against an expected on-chain evidenceHash and worker address.
 */
export async function verifyBundleIntegrity(
  bundle: Uint8Array,
  expectedEvidenceHash: `0x${string}`,
  expectedWorkerAddress: `0x${string}`
): Promise<{
  valid: boolean;
  errors: string[];
  unpacked?: UnpackedBundle;
  recoveredWorker?: `0x${string}`;
}> {
  const errors: string[] = [];

  // Check 1: SHA-256 hash
  const actualHash = await sha256Bytes32(bundle);
  if (actualHash.toLowerCase() !== expectedEvidenceHash.toLowerCase()) {
    errors.push(`Evidence hash mismatch: computed ${actualHash}, expected ${expectedEvidenceHash}`);
  }

  // Check 2: Signer address recovery
  let recoveredWorker: `0x${string}` | undefined;
  try {
    recoveredWorker = await recoverWorkerAddress(bundle);
    if (recoveredWorker.toLowerCase() !== expectedWorkerAddress.toLowerCase()) {
      errors.push(
        `Worker signature mismatch: recovered ${recoveredWorker}, expected ${expectedWorkerAddress}`
      );
    }
  } catch (err: unknown) {
    errors.push(`Failed to recover worker signature: ${String(err)}`);
  }

  // Check 3: Unpacking and structural integrity
  let unpacked: UnpackedBundle | undefined;
  try {
    unpacked = await unpackBundle(bundle);
  } catch (err: unknown) {
    errors.push(`Failed to unpack bundle: ${String(err)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    unpacked,
    recoveredWorker,
  };
}
