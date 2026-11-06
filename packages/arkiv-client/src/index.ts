/**
 * @streetsync/arkiv-client
 *
 * Arkiv SDK integration, bytes32 conversion,
 * entity reader, and cryptographic audit verifier for StreetSync.
 */

import { recoverMessageAddress, bytesToHex, hexToBytes } from "viem";
import { createHash } from "node:crypto";
import { unpackBundle, sha256Bytes32, HEADER_SIZE, SIGNATURE_SIZE, MAGIC_BYTES } from "@streetsync/evidence";
import type { EvidenceMetadata, UnpackedBundle, CompressionStats } from "@streetsync/evidence";

// Re-export compression stats for UI stats panel as requested
export type { CompressionStats };

// ═══════════════════════════════════════════════════════════════════════════════
// A. Types & Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface ArkivEntityAttributes {
  project: "streetsync";
  entity_type: "evidence";
  bounty_id: string;
  worker: string;
  sha256_prefix: string;
}

export interface ArkivWriteResult {
  entityKey: string;
  entityKeyBytes32: `0x${string}`;
  evidenceHash: `0x${string}`;
  chunked: boolean;
  chunkKeys?: string[];
}

export interface ArkivReadResult {
  bundle: Uint8Array;
  attributes: Record<string, string>;
  entityKey: string;
}

export interface ArkivVerificationResult {
  valid: boolean;
  errors: string[];
  recoveredWorker: `0x${string}` | null;
  metadata: EvidenceMetadata | null;
  beforeImage: Uint8Array | null;
  afterImage: Uint8Array | null;
  bundleSizeBytes: number;
  evidenceHashMatch: boolean;
  signatureValid: boolean;
  unpacked?: UnpackedBundle;
}

/**
 * Standard Arkiv SDK client interface.
 * Decouples contract integration from specific Arkiv SDK transport.
 */
export interface IArkivClient {
  writeEntity(
    payload: Uint8Array,
    attributes: Record<string, string>,
    options?: { ttl?: number }
  ): Promise<{ key: string }>;

  readEntity(
    key: string
  ): Promise<{ payload: Uint8Array; attributes: Record<string, string> }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const MAX_SAFE_BUNDLE_BYTES = 120_000;
export const ENTITY_TTL_SECONDS = 604_800; // 7 days

// ═══════════════════════════════════════════════════════════════════════════════
// C. Bytes32 / Arkiv Key Conversion Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const keyMappingRegistry = new Map<string, string>();

/**
 * Normalizes any Arkiv entity key (UUID, alphanumeric, hex, base64) into
 * a 0x-prefixed 32-byte hex string (bytes32 in Solidity / Hex in Viem).
 * Automatically registers the reverse mapping for later queries.
 */
export async function entityKeyToBytes32(entityKey: string): Promise<`0x${string}`> {
  let bytes32Key: `0x${string}`;

  if (entityKey.startsWith("0x") && /^0x[0-9a-fA-F]{64}$/.test(entityKey)) {
    bytes32Key = entityKey.toLowerCase() as `0x${string}`;
  } else if (entityKey.startsWith("0x") && /^0x[0-9a-fA-F]+$/.test(entityKey)) {
    const rawHex = entityKey.slice(2);
    if (rawHex.length < 64) {
      bytes32Key = `0x${rawHex.padEnd(64, "0")}`.toLowerCase() as `0x${string}`;
    } else {
      const rawBytes = hexToBytes(entityKey as `0x${string}`);
      bytes32Key = await sha256Bytes32(rawBytes);
    }
  } else {
    // Arbitrary string (e.g. Arkiv UUID or CID) -> SHA-256 hash
    const utf8Bytes = new TextEncoder().encode(entityKey);
    bytes32Key = await sha256Bytes32(utf8Bytes);
  }

  // Register in memory mapping
  keyMappingRegistry.set(bytes32Key.toLowerCase(), entityKey);
  return bytes32Key;
}

/**
 * Converts a bytes32 key back to the original Arkiv entity key.
 * If the key is not found in the local registry, returns the bytes32 hex string.
 */
export function bytes32ToEntityKey(bytes32Key: `0x${string}`): string {
  const normalized = bytes32Key.toLowerCase();
  const found = keyMappingRegistry.get(normalized);
  if (found) {
    return found;
  }
  return bytes32Key;
}

/**
 * Explicitly register a key mapping.
 */
export function registerKeyMapping(bytes32Key: string, originalKey: string): void {
  keyMappingRegistry.set(bytes32Key.toLowerCase(), originalKey);
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. Arkiv Entity Writer
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute SHA-256 evidence hash of a complete bundle.
 */
export async function computeEvidenceHash(bundle: Uint8Array): Promise<`0x${string}`> {
  return sha256Bytes32(bundle);
}

/**
 * Writes an evidence bundle to Arkiv.
 * Evidence is stored atomically as one entity; oversized bundles are rejected.
 */
export async function writeEvidenceBundle(
  client: IArkivClient,
  bundle: Uint8Array,
  workerAddress: string,
  bountyId: string | number,
  expectedEvidenceHash?: string
): Promise<ArkivWriteResult> {
  if (bundle.length === 0) {
    throw new RangeError("Cannot write empty evidence bundle");
  }
  if (bundle.length > MAX_SAFE_BUNDLE_BYTES) {
    throw new RangeError(`Evidence bundle is ${bundle.length} bytes; exceeds the ${MAX_SAFE_BUNDLE_BYTES}-byte Arkiv safe budget`);
  }

  const computedHash = await computeEvidenceHash(bundle);
  if (expectedEvidenceHash && computedHash.toLowerCase() !== expectedEvidenceHash.toLowerCase()) {
    throw new Error(
      `Evidence hash mismatch: computed ${computedHash}, expected ${expectedEvidenceHash}`
    );
  }

  const sha256Prefix = computedHash.slice(0, 32);
  const baseAttributes: Record<string, string> = {
    project: "streetsync",
    entity_type: "evidence",
    bounty_id: String(bountyId),
    worker: workerAddress.toLowerCase(),
    sha256_prefix: sha256Prefix,
  };
  const oversizedAttribute = Object.entries(baseAttributes).find(([, value]) => value.length > 128);
  if (oversizedAttribute) {
    throw new RangeError(`Arkiv attribute ${oversizedAttribute[0]} exceeds 128 bytes`);
  }

  const writeResponse = await client.writeEntity(bundle, baseAttributes, {
    ttl: ENTITY_TTL_SECONDS,
  });
  const entityKeyBytes32 = await entityKeyToBytes32(writeResponse.key);

  return {
    entityKey: writeResponse.key,
    entityKeyBytes32,
    evidenceHash: computedHash,
    chunked: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. Arkiv Entity Reader & Reassembler
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads an evidence bundle from Arkiv.
 * Accepts either raw Arkiv entity key or 32-byte hex key (bytes32).
 * Automatically reassembles chunked entities.
 */
export async function readEvidenceBundle(
  client: IArkivClient,
  arkivKeyOrBytes32: string
): Promise<ArkivReadResult> {
  const resolvedKey = arkivKeyOrBytes32.startsWith("0x") && arkivKeyOrBytes32.length === 66
    ? bytes32ToEntityKey(arkivKeyOrBytes32 as `0x${string}`)
    : arkivKeyOrBytes32;

  const entity = await client.readEntity(resolvedKey);

  // Check if this entity is a chunk manifest
  try {
    const text = new TextDecoder().decode(entity.payload);
    const manifest = JSON.parse(text);
    if (manifest && Array.isArray(manifest.chunkKeys) && manifest.totalChunks) {
      // Reassemble chunks
      const chunkBuffers: Uint8Array[] = [];
      for (let i = 0; i < manifest.chunkKeys.length; i++) {
        const chunkKey = manifest.chunkKeys[i];
        const chunkEntity = await client.readEntity(chunkKey);
        const payload = chunkEntity.payload;

        if (payload.length < CHUNK_HEADER_SIZE || payload[0] !== 0x53 || payload[1] !== 0x43) {
          throw new Error(`Invalid chunk header on chunk ${i} (${chunkKey})`);
        }

        chunkBuffers.push(payload.subarray(CHUNK_HEADER_SIZE));
      }

      // Concat all chunks
      const totalLen = chunkBuffers.reduce((sum, b) => sum + b.length, 0);
      const reassembled = new Uint8Array(totalLen);
      let offset = 0;
      for (const b of chunkBuffers) {
        reassembled.set(b, offset);
        offset += b.length;
      }

      return {
        bundle: reassembled,
        attributes: entity.attributes,
        entityKey: resolvedKey,
      };
    }
  } catch {
    // Not a JSON manifest; treat payload as direct binary bundle
  }

  return {
    bundle: entity.payload,
    attributes: entity.attributes,
    entityKey: resolvedKey,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// F. Public Verification & Cryptographic Auditor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Public Verification helper:
 * Fetches the entity from Arkiv, recomputes SHA-256, compares it against the
 * on-chain bytes32 commitment, recovers the worker's EIP-191 signature, and
 * unpacks the photos and telemetry.
 */
export async function verifyEvidenceBundle(
  client: IArkivClient,
  arkivKeyOrBytes32: string,
  onChainEvidenceHash: string,
  expectedWorkerAddress: string
): Promise<ArkivVerificationResult> {
  const errors: string[] = [];
  let bundle: Uint8Array;
  let attributes: Record<string, string> = {};

  // 1. Fetch entity from Arkiv
  try {
    const readRes = await readEvidenceBundle(client, arkivKeyOrBytes32);
    bundle = readRes.bundle;
    attributes = readRes.attributes;
  } catch (err: unknown) {
    errors.push(`Failed to read Arkiv entity: ${String(err)}`);
    return {
      valid: false,
      errors,
      recoveredWorker: null,
      metadata: null,
      beforeImage: null,
      afterImage: null,
      bundleSizeBytes: 0,
      evidenceHashMatch: false,
      signatureValid: false,
    };
  }

  const bundleSizeBytes = bundle.length;

  // 2. Recompute SHA-256 hash of complete bundle
  const computedHash = await computeEvidenceHash(bundle);
  const evidenceHashMatch = computedHash.toLowerCase() === onChainEvidenceHash.toLowerCase();
  if (!evidenceHashMatch) {
    errors.push(`Evidence hash mismatch: computed ${computedHash}, on-chain ${onChainEvidenceHash}`);
  }

  // 3. Unpack bundle
  let unpacked: UnpackedBundle | undefined;
  try {
    unpacked = await unpackBundle(bundle);
  } catch (err: unknown) {
    errors.push(`Bundle unpacking failed: ${String(err)}`);
  }

  // 4. Recover worker wallet signature
  let recoveredWorker: `0x${string}` | null = null;
  let signatureValid = false;

  if (unpacked) {
    try {
      const sigHex = bytesToHex(unpacked.signature);
      const recovered = await recoverMessageAddress({
        message: { raw: unpacked.payloadHash },
        signature: sigHex,
      });
      recoveredWorker = recovered.toLowerCase() as `0x${string}`;

      if (recoveredWorker.toLowerCase() === expectedWorkerAddress.toLowerCase()) {
        signatureValid = true;
      } else {
        errors.push(
          `Worker address mismatch: recovered ${recoveredWorker}, expected ${expectedWorkerAddress.toLowerCase()}`
        );
      }
    } catch (err: unknown) {
      errors.push(`Worker signature recovery failed: ${String(err)}`);
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    recoveredWorker,
    metadata: unpacked ? unpacked.metadata : null,
    beforeImage: unpacked ? unpacked.beforeImage : null,
    afterImage: unpacked ? unpacked.afterImage : null,
    bundleSizeBytes,
    evidenceHashMatch,
    signatureValid,
    unpacked,
  };
}
