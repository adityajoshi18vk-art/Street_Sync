/**
 * @streetsync/evidence - JanLekha evidence pipeline
 *
 * Real JanLekha evidence handling on top of the existing StreetSync
 * pipeline. It reuses the existing Zstd engine (compress.ts) and the
 * existing SHA-256 helpers (bundle.ts) and adds what JanLekha needs:
 *
 *   1. Raw evidence bytes, SHA-256 content hash, Zstd compression.
 *   2. Payload size validation against the Arkiv atomic limits.
 *   3. Chunking with a manifest when one entity cannot hold the data.
 *   4. An allowlist of permitted public evidence types. Anything else,
 *      including sensitive personal or confidential documents, is
 *      rejected before any byte is stored.
 *   5. Retrieval that verifies every layer and fails closed on any
 *      mismatch: manifest hash, per-chunk hash, chunk order, sizes,
 *      decompression, and the final content hash.
 *
 * Arkiv limits (see the master spec, Rule 7): a single atomic entity
 * payload is 128000 bytes at most, with a target under 120000 bytes.
 * Nothing here assumes all data fits in one entity.
 *
 * Chain: Arc Testnet, chain ID 5042002. No mainnet. No private keys
 * or API keys are read or stored here. No transaction hash, Arkiv
 * entity ID, or evidence record is ever fabricated: identifiers only
 * ever come from a real Arkiv write result or a real on-chain event.
 *
 * Evidence reference format, matching JanLekha 2.0
 * (~/workspace/janlekha/contracts/src/DocumentRegistry.sol and
 * ~/workspace/janlekha/src/lib/contracts.ts):
 *   - contentHash is the SHA-256 of the raw evidence bytes, as a
 *     0x-prefixed 32-byte hex string (bytes32). It is the
 *     DocumentRegistry contentHash, the indexed contentHash field of
 *     the DocumentRegistered event, and the evidenceHash a milestone
 *     cites. It is a hash of the raw file, exactly as JanLekha's
 *     browser verifier computes it with crypto.subtle SHA-256.
 *   - DocumentRegistry registerDocument takes (bytes32 id, bytes32
 *     projectId, bytes32 contentHash, string docType). The id and
 *     projectId are keccak256 of the JanLekha string ids, the same
 *     conversion JanLekha's idToBytes32 applies. See
 *     backend/src/evidence.ts for the call builder.
 */

import { bytesToHex, hexToBytes } from "viem";
import { sha256, sha256Bytes32 } from "./bundle.js";
import { compressBytes, decompressBytes } from "./compress.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Arkiv hard limit for one atomic entity payload, in bytes. */
export const JANLEKHA_ARKIV_MAX_ENTITY_BYTES = 128_000;
/** Arkiv target: keep a single entity payload under this many bytes. */
export const JANLEKHA_ARKIV_TARGET_BYTES = 120_000;
/** Largest compressed-data slice carried by one chunk entity. */
export const JANLEKHA_MAX_CHUNK_DATA_BYTES = 115_000;
/** Largest number of chunks one manifest may reference. */
export const JANLEKHA_MAX_CHUNKS = 255;
/** Arc Testnet chain ID. No mainnet. */
export const JANLEKHA_ARC_CHAIN_ID = 5042002;

export const JANLEKHA_SINGLE_MAGIC = "JLKH";
export const JANLEKHA_CHUNK_MAGIC = "JLKC";
export const JANLEKHA_MANIFEST_FORMAT = "janlekha-evidence-manifest-v1";
export const JANLEKHA_MANIFEST_VERSION = 1;
export const JANLEKHA_PAYLOAD_VERSION = 1;

/** Single-entity envelope header: magic 4 + version 1 + flags 1 + sizes 16 + hash 32. */
export const JANLEKHA_SINGLE_HEADER_BYTES = 54;
/** Chunk envelope header: magic 4 + version 1 + index 4 + total 4 + len 4 + hash 32. */
export const JANLEKHA_CHUNK_HEADER_BYTES = 49;

// ---------------------------------------------------------------------------
// Evidence types: allowlist only. Nothing else is stored publicly.
// ---------------------------------------------------------------------------

/**
 * Permitted public evidence types. These are the only document kinds
 * JanLekha may publish as public evidence: expenditure documents,
 * invoices, progress reports, photos, inspection reports, and audit
 * documents. Anything not on this list is rejected.
 */
export const JANLEKHA_EVIDENCE_TYPES = [
  "expenditure-document",
  "invoice",
  "progress-report",
  "photo",
  "inspection-report",
  "audit-document",
] as const;

export type JanLekhaEvidenceType = (typeof JANLEKHA_EVIDENCE_TYPES)[number];

/**
 * Sensitive or confidential kinds that must never be stored as public
 * evidence. They are rejected with a specific error, but the allowlist
 * above is the real gate: even a type not named here is rejected
 * unless it is on the allowlist.
 */
export const JANLEKHA_SENSITIVE_EVIDENCE_TYPES = [
  "personal-id",
  "passport",
  "aadhaar",
  "pan-card",
  "bank-statement",
  "bank-account",
  "medical-record",
  "salary-slip",
  "confidential",
  "private",
  "personal-data",
  "identity-document",
] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class JanLekhaEvidenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JanLekhaEvidenceError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/** SHA-256 of raw bytes, as lowercase hex without a 0x prefix. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await sha256(bytes);
  return bytesToHex(digest).slice(2);
}

/** SHA-256 of raw bytes, as a 0x-prefixed 32-byte hex string (bytes32). */
export async function sha256HexBytes32(data: Uint8Array | string): Promise<`0x${string}`> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return sha256Bytes32(bytes);
}

// ---------------------------------------------------------------------------
// Evidence type validation
// ---------------------------------------------------------------------------

export function isAllowedEvidenceType(value: string): value is JanLekhaEvidenceType {
  return (JANLEKHA_EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function isSensitiveEvidenceType(value: string): boolean {
  return (JANLEKHA_SENSITIVE_EVIDENCE_TYPES as readonly string[]).includes(value);
}

/**
 * Validate an evidence type against the allowlist. Throws a
 * JanLekhaEvidenceError for anything else. Sensitive personal or
 * confidential kinds get code EVIDENCE_TYPE_SENSITIVE; every other
 * unlisted kind gets EVIDENCE_TYPE_REJECTED. Both name the allowlist.
 */
export function assertAllowedEvidenceType(value: string): JanLekhaEvidenceType {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JanLekhaEvidenceError(
      "EVIDENCE_TYPE_REJECTED",
      `Evidence type is empty. Permitted public evidence types are: ${JANLEKHA_EVIDENCE_TYPES.join(", ")}.`
    );
  }
  const type = value.trim();
  if (isAllowedEvidenceType(type)) {
    return type;
  }
  if (isSensitiveEvidenceType(type)) {
    throw new JanLekhaEvidenceError(
      "EVIDENCE_TYPE_SENSITIVE",
      `Evidence type "${type}" is rejected: sensitive personal or confidential documents must never be stored as public evidence. Permitted public evidence types are: ${JANLEKHA_EVIDENCE_TYPES.join(", ")}.`
    );
  }
  throw new JanLekhaEvidenceError(
    "EVIDENCE_TYPE_REJECTED",
    `Evidence type "${type}" is not permitted. Permitted public evidence types are: ${JANLEKHA_EVIDENCE_TYPES.join(", ")}.`
  );
}

// ---------------------------------------------------------------------------
// Payload size validation
// ---------------------------------------------------------------------------

export interface PayloadSizeCheck {
  bytes: number;
  fitsTarget: boolean;
  fitsHardLimit: boolean;
  hardLimitBytes: number;
  targetBytes: number;
}

/**
 * Validate one Arkiv entity payload against the atomic limits.
 * Returns fitsTarget / fitsHardLimit. Throws a RangeError when the
 * payload exceeds the 128000 byte hard limit; a payload over the
 * 120000 byte target but under the hard limit does not throw, it
 * reports fitsTarget false so the caller chunks it instead.
 */
export function validatePayloadSize(
  payload: Uint8Array,
  label: string = "payload"
): PayloadSizeCheck {
  const bytes = payload.length;
  const check: PayloadSizeCheck = {
    bytes,
    fitsTarget: bytes <= JANLEKHA_ARKIV_TARGET_BYTES,
    fitsHardLimit: bytes <= JANLEKHA_ARKIV_MAX_ENTITY_BYTES,
    hardLimitBytes: JANLEKHA_ARKIV_MAX_ENTITY_BYTES,
    targetBytes: JANLEKHA_ARKIV_TARGET_BYTES,
  };
  if (!check.fitsHardLimit) {
    throw new RangeError(
      `JanLekha ${label} is ${bytes} bytes, exceeding the Arkiv atomic limit of ${JANLEKHA_ARKIV_MAX_ENTITY_BYTES} bytes. Split it into chunks instead of writing it as one entity.`
    );
  }
  return check;
}

// ---------------------------------------------------------------------------
// Single-entity envelope
// ---------------------------------------------------------------------------

export interface JanLekhaSinglePayloadInfo {
  compression: "zstd" | "none";
  originalSizeBytes: number;
  compressedSizeBytes: number;
  contentHash: `0x${string}`;
  compressed: Uint8Array;
}

/**
 * Encode compressed evidence as one self-describing Arkiv entity
 * payload: magic "JLKH", version, flags (bit 0 set when compressed
 * with Zstd), original size (uint64 BE), compressed size (uint64 BE),
 * raw SHA-256 content hash (32 bytes), then the compressed bytes.
 * The content hash inside the envelope is the hash of the raw file,
 * so a reader can verify the file without trusting any attribute.
 */
export function encodeSinglePayload(
  compressed: Uint8Array,
  contentHash: `0x${string}`,
  originalSizeBytes: number,
  compression: "zstd" | "none"
): Uint8Array {
  const header = new Uint8Array(JANLEKHA_SINGLE_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const magic = new TextEncoder().encode(JANLEKHA_SINGLE_MAGIC);
  header.set(magic, 0);
  header[4] = JANLEKHA_PAYLOAD_VERSION;
  header[5] = compression === "zstd" ? 0x01 : 0x00;
  view.setBigUint64(6, BigInt(originalSizeBytes), false);
  view.setBigUint64(14, BigInt(compressed.length), false);
  header.set(hexToBytes(contentHash), 22);
  const payload = new Uint8Array(header.length + compressed.length);
  payload.set(header, 0);
  payload.set(compressed, header.length);
  return payload;
}

/**
 * Decode and structurally validate a single-entity payload. Throws
 * on a bad magic, version, truncation, or a declared size that does
 * not match the actual bytes. When expectedContentHash is given, the
 * hash inside the envelope must match it or decoding fails closed.
 */
export function decodeSinglePayload(
  payload: Uint8Array,
  expectedContentHash?: string
): JanLekhaSinglePayloadInfo {
  if (payload.length < JANLEKHA_SINGLE_HEADER_BYTES) {
    throw new JanLekhaEvidenceError(
      "PAYLOAD_TOO_SMALL",
      `JanLekha evidence payload is ${payload.length} bytes, smaller than the ${JANLEKHA_SINGLE_HEADER_BYTES} byte header.`
    );
  }
  const magic = new TextDecoder().decode(payload.subarray(0, 4));
  if (magic !== JANLEKHA_SINGLE_MAGIC) {
    throw new JanLekhaEvidenceError(
      "PAYLOAD_BAD_MAGIC",
      `JanLekha evidence payload has magic "${magic}", expected "${JANLEKHA_SINGLE_MAGIC}".`
    );
  }
  if (payload[4] !== JANLEKHA_PAYLOAD_VERSION) {
    throw new JanLekhaEvidenceError(
      "PAYLOAD_BAD_VERSION",
      `JanLekha evidence payload version is ${payload[4]}, expected ${JANLEKHA_PAYLOAD_VERSION}.`
    );
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const compression: "zstd" | "none" = (payload[5] & 0x01) !== 0 ? "zstd" : "none";
  const originalSizeBytes = Number(view.getBigUint64(6, false));
  const compressedSizeBytes = Number(view.getBigUint64(14, false));
  const contentHash = bytesToHex(payload.subarray(22, 54)) as `0x${string}`;
  if (payload.length !== JANLEKHA_SINGLE_HEADER_BYTES + compressedSizeBytes) {
    throw new JanLekhaEvidenceError(
      "PAYLOAD_SIZE_MISMATCH",
      `JanLekha evidence payload declares ${compressedSizeBytes} compressed bytes but holds ${payload.length - JANLEKHA_SINGLE_HEADER_BYTES}.`
    );
  }
  if (
    expectedContentHash &&
    contentHash.toLowerCase() !== expectedContentHash.toLowerCase()
  ) {
    throw new JanLekhaEvidenceError(
      "CONTENT_HASH_MISMATCH",
      `JanLekha evidence content hash mismatch: payload carries ${contentHash}, expected ${expectedContentHash}.`
    );
  }
  return {
    compression,
    originalSizeBytes,
    compressedSizeBytes,
    contentHash,
    compressed: new Uint8Array(payload.subarray(JANLEKHA_SINGLE_HEADER_BYTES)),
  };
}

// ---------------------------------------------------------------------------
// Prepare: hash, compress, decide single vs chunked
// ---------------------------------------------------------------------------

export interface JanLekhaEvidenceInput {
  raw: Uint8Array;
  documentId: string;
  projectId: string;
  evidenceType: string;
  fileName?: string;
  mimeType?: string;
}

export interface JanLekhaChunkPlan {
  index: number;
  data: Uint8Array;
  sha256: `0x${string}`;
  sizeBytes: number;
}

export interface JanLekhaManifestCore {
  format: string;
  manifestVersion: number;
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  fileName?: string;
  mimeType?: string;
  contentHash: `0x${string}`;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compression: "zstd" | "none";
  totalChunks: number;
  chunkHashes: `0x${string}`[];
  chunkSizes: number[];
}

export interface JanLekhaPreparedEvidence {
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  fileName?: string;
  mimeType?: string;
  contentHash: `0x${string}`;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compression: "zstd" | "none";
  chunked: boolean;
  singlePayload: Uint8Array | null;
  chunks: JanLekhaChunkPlan[];
  manifestCore: JanLekhaManifestCore | null;
}

function requireNonEmptyId(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JanLekhaEvidenceError(
      "MISSING_ID",
      `JanLekha evidence ${field} is empty. A documentId and a projectId are required.`
    );
  }
  return value.trim();
}

/**
 * Prepare raw evidence for Arkiv: validate the type against the
 * allowlist, SHA-256 the raw bytes, Zstd compress them, then decide
 * the storage shape. When the single envelope fits the 120000 byte
 * target it is built; otherwise the compressed bytes are split into
 * chunk plans with a per-chunk SHA-256 and a manifest core. Nothing
 * is written here, so no entity ID exists yet at this stage.
 */
export async function prepareJanLekhaEvidence(
  input: JanLekhaEvidenceInput
): Promise<JanLekhaPreparedEvidence> {
  const evidenceType = assertAllowedEvidenceType(input.evidenceType);
  const documentId = requireNonEmptyId(input.documentId, "documentId");
  const projectId = requireNonEmptyId(input.projectId, "projectId");
  if (!input.raw || input.raw.length === 0) {
    throw new JanLekhaEvidenceError(
      "EMPTY_EVIDENCE",
      "JanLekha evidence file is empty. Refusing to store an empty evidence record."
    );
  }
  const raw = new Uint8Array(input.raw);
  const contentHash = await sha256Bytes32(raw);
  const { compressed, method } = await compressBytes(raw);
  const originalSizeBytes = raw.length;
  const compressedSizeBytes = compressed.length;

  const singlePayload = encodeSinglePayload(
    compressed,
    contentHash,
    originalSizeBytes,
    method
  );
  if (singlePayload.length <= JANLEKHA_ARKIV_TARGET_BYTES) {
    validatePayloadSize(singlePayload, "single evidence payload");
    return {
      documentId,
      projectId,
      evidenceType,
      fileName: input.fileName,
      mimeType: input.mimeType,
      contentHash,
      originalSizeBytes,
      compressedSizeBytes,
      compression: method,
      chunked: false,
      singlePayload,
      chunks: [],
      manifestCore: null,
    };
  }

  const totalChunks = Math.ceil(compressedSizeBytes / JANLEKHA_MAX_CHUNK_DATA_BYTES);
  if (totalChunks > JANLEKHA_MAX_CHUNKS) {
    throw new RangeError(
      `JanLekha evidence needs ${totalChunks} chunks, over the maximum of ${JANLEKHA_MAX_CHUNKS}. Compressed size is ${compressedSizeBytes} bytes.`
    );
  }
  const chunks: JanLekhaChunkPlan[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * JANLEKHA_MAX_CHUNK_DATA_BYTES;
    const end = Math.min(start + JANLEKHA_MAX_CHUNK_DATA_BYTES, compressedSizeBytes);
    const data = new Uint8Array(compressed.subarray(start, end));
    chunks.push({
      index: i,
      data,
      sha256: await sha256Bytes32(data),
      sizeBytes: data.length,
    });
  }
  const manifestCore: JanLekhaManifestCore = {
    format: JANLEKHA_MANIFEST_FORMAT,
    manifestVersion: JANLEKHA_MANIFEST_VERSION,
    documentId,
    projectId,
    evidenceType,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    contentHash,
    originalSizeBytes,
    compressedSizeBytes,
    compression: method,
    totalChunks,
    chunkHashes: chunks.map((c) => c.sha256),
    chunkSizes: chunks.map((c) => c.sizeBytes),
  };
  return {
    documentId,
    projectId,
    evidenceType,
    fileName: input.fileName,
    mimeType: input.mimeType,
    contentHash,
    originalSizeBytes,
    compressedSizeBytes,
    compression: method,
    chunked: true,
    singlePayload: null,
    chunks,
    manifestCore,
  };
}

// ---------------------------------------------------------------------------
// Manifest: build, hash, verify
// ---------------------------------------------------------------------------

export interface JanLekhaManifest extends JanLekhaManifestCore {
  chunkKeys: string[];
  manifestHash: `0x${string}`;
}

/**
 * Canonical manifest hash input: the manifest core plus the chunk
 * keys, in a fixed field order. The same function builds the input
 * for writing and for verification, so a tampered chunk hash, key,
 * size, or content hash changes the recomputed hash.
 */
export function manifestHashInput(
  core: JanLekhaManifestCore,
  chunkKeys: string[]
): Record<string, unknown> {
  return {
    format: core.format,
    manifestVersion: core.manifestVersion,
    documentId: core.documentId,
    projectId: core.projectId,
    evidenceType: core.evidenceType,
    ...(core.fileName ? { fileName: core.fileName } : {}),
    ...(core.mimeType ? { mimeType: core.mimeType } : {}),
    contentHash: core.contentHash,
    originalSizeBytes: core.originalSizeBytes,
    compressedSizeBytes: core.compressedSizeBytes,
    compression: core.compression,
    totalChunks: core.totalChunks,
    chunkHashes: core.chunkHashes,
    chunkSizes: core.chunkSizes,
    chunkKeys,
  };
}

export async function computeManifestHash(
  core: JanLekhaManifestCore,
  chunkKeys: string[]
): Promise<`0x${string}`> {
  const input = JSON.stringify(manifestHashInput(core, chunkKeys));
  return sha256Bytes32(new TextEncoder().encode(input));
}

/**
 * Build the manifest once chunk entity keys are known (they only
 * exist after real Arkiv writes). The manifest hash covers the core
 * and the keys. The serialized manifest must itself fit the target.
 */
export async function buildJanLekhaManifest(
  core: JanLekhaManifestCore,
  chunkKeys: string[]
): Promise<{ manifest: JanLekhaManifest; payload: Uint8Array }> {
  if (chunkKeys.length !== core.totalChunks) {
    throw new JanLekhaEvidenceError(
      "MANIFEST_KEY_COUNT_MISMATCH",
      `JanLekha manifest expects ${core.totalChunks} chunk keys, got ${chunkKeys.length}.`
    );
  }
  const manifestHash = await computeManifestHash(core, chunkKeys);
  const manifest: JanLekhaManifest = { ...core, chunkKeys: [...chunkKeys], manifestHash };
  const payload = new TextEncoder().encode(JSON.stringify(manifest));
  validatePayloadSize(payload, "manifest payload");
  return { manifest, payload };
}

export function encodeJanLekhaManifest(manifest: JanLekhaManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}

/**
 * Parse a manifest payload and verify it. Throws on invalid JSON, a
 * wrong format or version, missing or mistyped fields, a chunk count
 * that does not match the hashes, sizes, and keys, or a manifest hash
 * that does not recompute. A tampered manifest never verifies.
 */
export async function parseAndVerifyManifest(payload: Uint8Array): Promise<JanLekhaManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new JanLekhaEvidenceError(
      "MANIFEST_BAD_JSON",
      "JanLekha manifest payload is not valid JSON."
    );
  }
  const m = parsed as Partial<JanLekhaManifest>;
  if (m.format !== JANLEKHA_MANIFEST_FORMAT) {
    throw new JanLekhaEvidenceError(
      "MANIFEST_BAD_FORMAT",
      `JanLekha manifest format is "${String(m.format)}", expected "${JANLEKHA_MANIFEST_FORMAT}".`
    );
  }
  if (m.manifestVersion !== JANLEKHA_MANIFEST_VERSION) {
    throw new JanLekhaEvidenceError(
      "MANIFEST_BAD_VERSION",
      `JanLekha manifest version is ${String(m.manifestVersion)}, expected ${JANLEKHA_MANIFEST_VERSION}.`
    );
  }
  const required: Array<keyof JanLekhaManifest> = [
    "documentId",
    "projectId",
    "evidenceType",
    "contentHash",
    "originalSizeBytes",
    "compressedSizeBytes",
    "compression",
    "totalChunks",
    "chunkHashes",
    "chunkSizes",
    "chunkKeys",
    "manifestHash",
  ];
  for (const field of required) {
    if (m[field] === undefined || m[field] === null) {
      throw new JanLekhaEvidenceError(
        "MANIFEST_MISSING_FIELD",
        `JanLekha manifest is missing field "${field}".`
      );
    }
  }
  if (
    !Array.isArray(m.chunkHashes) ||
    !Array.isArray(m.chunkSizes) ||
    !Array.isArray(m.chunkKeys) ||
    m.chunkHashes.length !== m.totalChunks ||
    m.chunkSizes.length !== m.totalChunks ||
    m.chunkKeys.length !== m.totalChunks
  ) {
    throw new JanLekhaEvidenceError(
      "MANIFEST_COUNT_MISMATCH",
      `JanLekha manifest chunk counts disagree: totalChunks is ${String(m.totalChunks)}, chunkHashes has ${Array.isArray(m.chunkHashes) ? m.chunkHashes.length : "?"}, chunkSizes has ${Array.isArray(m.chunkSizes) ? m.chunkSizes.length : "?"}, chunkKeys has ${Array.isArray(m.chunkKeys) ? m.chunkKeys.length : "?"} entries.`
    );
  }
  const core: JanLekhaManifestCore = {
    format: m.format as string,
    manifestVersion: m.manifestVersion as number,
    documentId: m.documentId as string,
    projectId: m.projectId as string,
    evidenceType: m.evidenceType as JanLekhaEvidenceType,
    ...(m.fileName ? { fileName: m.fileName as string } : {}),
    ...(m.mimeType ? { mimeType: m.mimeType as string } : {}),
    contentHash: m.contentHash as `0x${string}`,
    originalSizeBytes: m.originalSizeBytes as number,
    compressedSizeBytes: m.compressedSizeBytes as number,
    compression: m.compression as "zstd" | "none",
    totalChunks: m.totalChunks as number,
    chunkHashes: m.chunkHashes as `0x${string}`[],
    chunkSizes: m.chunkSizes as number[],
  };
  const recomputed = await computeManifestHash(core, m.chunkKeys as string[]);
  if (recomputed.toLowerCase() !== (m.manifestHash as string).toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "MANIFEST_HASH_MISMATCH",
      `JanLekha manifest hash mismatch: recomputed ${recomputed}, stored ${String(m.manifestHash)}. The manifest was tampered with or corrupted.`
    );
  }
  return m as JanLekhaManifest;
}

// ---------------------------------------------------------------------------
// Chunk envelopes
// ---------------------------------------------------------------------------

export interface JanLekhaDecodedChunk {
  index: number;
  totalChunks: number;
  data: Uint8Array;
  sha256: `0x${string}`;
}

/**
 * Encode one chunk plan as an Arkiv entity payload: magic "JLKC",
 * version, chunk index (uint32 BE), total chunks (uint32 BE), data
 * length (uint32 BE), SHA-256 of the chunk data (32 bytes), then the
 * chunk data. The envelope must fit the target size.
 */
export function encodeChunkPayload(plan: JanLekhaChunkPlan, totalChunks: number): Uint8Array {
  const header = new Uint8Array(JANLEKHA_CHUNK_HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode(JANLEKHA_CHUNK_MAGIC), 0);
  header[4] = JANLEKHA_PAYLOAD_VERSION;
  view.setUint32(5, plan.index, false);
  view.setUint32(9, totalChunks, false);
  view.setUint32(13, plan.data.length, false);
  header.set(hexToBytes(plan.sha256), 17);
  const payload = new Uint8Array(header.length + plan.data.length);
  payload.set(header, 0);
  payload.set(plan.data, header.length);
  validatePayloadSize(payload, `chunk ${plan.index} payload`);
  return payload;
}

/**
 * Decode and validate one chunk payload. Throws on a bad magic,
 * version, index, total, length, or per-chunk SHA-256 mismatch.
 * When expected values are given they must all match, so a chunk
 * read out of order or from the wrong evidence set fails closed.
 */
export function decodeChunkPayload(
  payload: Uint8Array,
  expected?: { index?: number; totalChunks?: number; sha256?: string; sizeBytes?: number }
): JanLekhaDecodedChunk {
  if (payload.length < JANLEKHA_CHUNK_HEADER_BYTES) {
    throw new JanLekhaEvidenceError(
      "CHUNK_TOO_SMALL",
      `JanLekha chunk payload is ${payload.length} bytes, smaller than the ${JANLEKHA_CHUNK_HEADER_BYTES} byte header.`
    );
  }
  const magic = new TextDecoder().decode(payload.subarray(0, 4));
  if (magic !== JANLEKHA_CHUNK_MAGIC) {
    throw new JanLekhaEvidenceError(
      "CHUNK_BAD_MAGIC",
      `JanLekha chunk payload has magic "${magic}", expected "${JANLEKHA_CHUNK_MAGIC}".`
    );
  }
  if (payload[4] !== JANLEKHA_PAYLOAD_VERSION) {
    throw new JanLekhaEvidenceError(
      "CHUNK_BAD_VERSION",
      `JanLekha chunk payload version is ${payload[4]}, expected ${JANLEKHA_PAYLOAD_VERSION}.`
    );
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const index = view.getUint32(5, false);
  const totalChunks = view.getUint32(9, false);
  const dataLen = view.getUint32(13, false);
  const sha256Value = bytesToHex(payload.subarray(17, 49)) as `0x${string}`;
  if (payload.length !== JANLEKHA_CHUNK_HEADER_BYTES + dataLen) {
    throw new JanLekhaEvidenceError(
      "CHUNK_SIZE_MISMATCH",
      `JanLekha chunk ${index} declares ${dataLen} data bytes but holds ${payload.length - JANLEKHA_CHUNK_HEADER_BYTES}.`
    );
  }
  if (expected?.index !== undefined && index !== expected.index) {
    throw new JanLekhaEvidenceError(
      "CHUNK_ORDER_MISMATCH",
      `JanLekha chunk out of order: expected index ${expected.index}, got ${index}.`
    );
  }
  if (expected?.totalChunks !== undefined && totalChunks !== expected.totalChunks) {
    throw new JanLekhaEvidenceError(
      "CHUNK_TOTAL_MISMATCH",
      `JanLekha chunk ${index} belongs to a set of ${totalChunks} chunks, expected ${expected.totalChunks}.`
    );
  }
  if (expected?.sha256 && sha256Value.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "CHUNK_HASH_MISMATCH",
      `JanLekha chunk ${index} hash mismatch: envelope carries ${sha256Value}, manifest expects ${expected.sha256}.`
    );
  }
  if (expected?.sizeBytes !== undefined && dataLen !== expected.sizeBytes) {
    throw new JanLekhaEvidenceError(
      "CHUNK_SIZE_MISMATCH",
      `JanLekha chunk ${index} size is ${dataLen} bytes, manifest expects ${expected.sizeBytes}.`
    );
  }
  const data = new Uint8Array(payload.subarray(JANLEKHA_CHUNK_HEADER_BYTES));
  return { index, totalChunks, data, sha256: sha256Value };
}

/**
 * Reassemble chunk payloads in manifest order into the compressed
 * bytes. Every chunk is decoded and checked against the manifest:
 * index equals its position, total matches, per-chunk SHA-256 of the
 * actual data matches the manifest entry, and size matches. The
 * reassembled length must equal the manifest compressed size.
 * Any failure throws; no partial data is returned.
 */
export async function reassembleJanLekhaChunks(
  chunkPayloadsInOrder: Uint8Array[],
  manifest: JanLekhaManifest
): Promise<Uint8Array> {
  if (chunkPayloadsInOrder.length !== manifest.totalChunks) {
    throw new JanLekhaEvidenceError(
      "CHUNK_COUNT_MISMATCH",
      `JanLekha reassembly expected ${manifest.totalChunks} chunks, got ${chunkPayloadsInOrder.length}.`
    );
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < chunkPayloadsInOrder.length; i++) {
    const decoded = decodeChunkPayload(chunkPayloadsInOrder[i], {
      index: i,
      totalChunks: manifest.totalChunks,
      sha256: manifest.chunkHashes[i],
      sizeBytes: manifest.chunkSizes[i],
    });
    const actualHash = await sha256Bytes32(decoded.data);
    if (actualHash.toLowerCase() !== manifest.chunkHashes[i].toLowerCase()) {
      throw new JanLekhaEvidenceError(
        "CHUNK_HASH_MISMATCH",
        `JanLekha chunk ${i} data hash mismatch: computed ${actualHash}, manifest expects ${manifest.chunkHashes[i]}. The chunk was tampered with or corrupted.`
      );
    }
    parts.push(decoded.data);
    total += decoded.data.length;
  }
  if (total !== manifest.compressedSizeBytes) {
    throw new JanLekhaEvidenceError(
      "COMPRESSED_SIZE_MISMATCH",
      `JanLekha reassembled compressed size is ${total} bytes, manifest expects ${manifest.compressedSizeBytes}.`
    );
  }
  const compressed = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    compressed.set(part, offset);
    offset += part.length;
  }
  return compressed;
}

// ---------------------------------------------------------------------------
// Decompress and verify: the final gate before display
// ---------------------------------------------------------------------------

/**
 * Decompress compressed bytes and verify the result against the
 * expected raw content hash and original size. Throws on any
 * mismatch. This is the gate that runs before evidence is displayed.
 */
export async function decompressAndVerify(
  compressed: Uint8Array,
  compression: "zstd" | "none",
  expectedContentHash: string,
  expectedOriginalSizeBytes: number
): Promise<Uint8Array> {
  let raw: Uint8Array;
  try {
    raw = await decompressBytes(compressed, compression);
  } catch (err) {
    throw new JanLekhaEvidenceError(
      "DECOMPRESSION_FAILED",
      `JanLekha evidence decompression failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (raw.length !== expectedOriginalSizeBytes) {
    throw new JanLekhaEvidenceError(
      "ORIGINAL_SIZE_MISMATCH",
      `JanLekha evidence decompressed to ${raw.length} bytes, expected ${expectedOriginalSizeBytes}.`
    );
  }
  const actualHash = await sha256Bytes32(raw);
  if (actualHash.toLowerCase() !== expectedContentHash.toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "CONTENT_HASH_MISMATCH",
      `JanLekha evidence integrity check failed: SHA-256 of retrieved bytes is ${actualHash}, expected ${expectedContentHash}. Refusing to display the evidence.`
    );
  }
  return raw;
}

/**
 * Decode a single-entity payload and verify it end to end: envelope
 * checks, Zstd decompression, size, and SHA-256 of the raw bytes.
 * Returns the raw bytes only when every check passes.
 */
export async function decodeAndVerifySinglePayload(
  payload: Uint8Array,
  expectedContentHash?: string
): Promise<Uint8Array> {
  const info = decodeSinglePayload(payload, expectedContentHash);
  return decompressAndVerify(
    info.compressed,
    info.compression,
    info.contentHash,
    info.originalSizeBytes
  );
}

/**
 * Verify raw bytes against an expected content hash. Returns true
 * only on an exact match; does not throw for a mismatch, so callers
 * that build a result object can report it instead.
 */
export async function verifyRawAgainstHash(
  raw: Uint8Array,
  expectedContentHash: string
): Promise<boolean> {
  const actual = await sha256Bytes32(raw);
  return actual.toLowerCase() === expectedContentHash.toLowerCase();
}
