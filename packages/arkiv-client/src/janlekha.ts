/**
 * @streetsync/arkiv-client - JanLekha evidence storage on Arkiv
 *
 * Writes prepared JanLekha evidence to Arkiv and reads it back with
 * full integrity verification. It reuses the existing IArkivClient
 * transport interface and the JanLekha prepare / manifest / chunk
 * helpers from @streetsync/evidence.
 *
 * Storage shapes:
 *   - Single entity: one JLKH envelope payload, kind "bundle".
 *   - Chunked: one JLKC chunk entity per chunk, then one manifest
 *     entity (kind "manifest") that lists the chunk keys in order,
 *     the per-chunk SHA-256 hashes, and a manifest hash. The manifest
 *     entity key is the evidence entity key for chunked evidence.
 *
 * Retrieval fails closed: manifest hash, per-chunk hash, chunk
 * order, sizes, decompression, and the final SHA-256 content hash
 * are all checked, and no raw bytes are returned on any failure.
 *
 * Live Arkiv access: the HttpArkivClient below is the real REST
 * gateway transport, matching the gateway format already used by
 * the StreetSync app (POST /entities with a base64 payload,
 * attributes as {key, value} pairs, ttlSeconds; GET
 * /entities/:key). It needs an Arkiv API key from the environment.
 * No live Arkiv write or read was performed in this environment and
 * no live key exists here, so the live path is labelled NOT VERIFIED
 * LIVE. createLiveArkivClient fails closed with a setup message
 * when ARKIV_API_KEY is not set, instead of inventing a key or a
 * successful write. Tests use an in-memory client, never the live
 * gateway, and never claim a live result.
 *
 * No transaction hash, Arkiv entity ID, or evidence record is ever
 * fabricated here. An entity key only ever comes from a real
 * client.writeEntity result. On-chain confirmation only exists
 * after a real DocumentRegistered event; see backend/src/evidence.ts.
 */

import { hexToBytes } from "viem";
import {
  buildJanLekhaManifest,
  decodeAndVerifySinglePayload,
  decompressAndVerify,
  encodeChunkPayload,
  parseAndVerifyManifest,
  reassembleJanLekhaChunks,
  sha256Bytes32,
  JANLEKHA_ARKIV_TARGET_BYTES,
  type JanLekhaEvidenceType,
  type JanLekhaManifest,
  type JanLekhaPreparedEvidence,
} from "@streetsync/evidence";
import type { IArkivClient } from "./index.js";

export const ARKIV_DEFAULT_URL = "https://arp.testnet.arkiv.golem.network";
export const ARKIV_ENTITY_TTL_SECONDS = 604_800; // 7 days
export const LIVE_ARKIV_NOT_VERIFIED_NOTE =
  "Live Arkiv access has not been verified in this environment: no live Arkiv API key is configured and no live write or read was performed here. This result comes from the client that was supplied, not from the live Arkiv gateway.";

export class ArkivNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArkivNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Entity key to bytes32, with a local reverse mapping
// ---------------------------------------------------------------------------

const janLekhaKeyMapping = new Map<string, string>();

async function entityKeyToBytes32Local(entityKey: string): Promise<`0x${string}`> {
  let bytes32Key: `0x${string}`;
  if (entityKey.startsWith("0x") && /^0x[0-9a-fA-F]{64}$/.test(entityKey)) {
    bytes32Key = entityKey.toLowerCase() as `0x${string}`;
  } else if (entityKey.startsWith("0x") && /^0x[0-9a-fA-F]+$/.test(entityKey)) {
    const rawHex = entityKey.slice(2);
    if (rawHex.length < 64) {
      bytes32Key = `0x${rawHex.padEnd(64, "0")}`.toLowerCase() as `0x${string}`;
    } else {
      bytes32Key = await sha256Bytes32(hexToBytes(entityKey as `0x${string}`));
    }
  } else {
    bytes32Key = await sha256Bytes32(new TextEncoder().encode(entityKey));
  }
  janLekhaKeyMapping.set(bytes32Key.toLowerCase(), entityKey);
  return bytes32Key;
}

/** Look up the raw Arkiv entity key previously registered for a bytes32 key. */
export function lookupJanLekhaEntityKey(bytes32Key: string): string | null {
  return janLekhaKeyMapping.get(bytes32Key.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Real HTTP transport for the Arkiv gateway
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function normalizeAttributes(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw.map((entry) => {
        const e = entry as { key?: string; name?: string; value?: string };
        return [String(e.key ?? e.name ?? ""), String(e.value ?? "")];
      })
    );
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return {};
}

/**
 * Real Arkiv REST gateway client, same wire format as the StreetSync
 * app transport: POST /entities with base64 payload, attributes as
 * {key, value} pairs and ttlSeconds; GET /entities/:key. The API key
 * is sent as a Bearer token when one is supplied. It is never logged
 * and never stored in a file by this module.
 *
 * NOT VERIFIED LIVE in this environment. Construct it through
 * createLiveArkivClient, which refuses to build one without a key.
 */
export class HttpArkivClient implements IArkivClient {
  readonly liveVerified = false as const;
  constructor(
    private readonly baseUrl: string = ARKIV_DEFAULT_URL,
    private readonly apiKey?: string
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async writeEntity(
    payload: Uint8Array,
    attributes: Record<string, string>,
    options?: { ttl?: number }
  ): Promise<{ key: string }> {
    const res = await fetch(`${this.baseUrl}/entities`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        payload: bytesToBase64(payload),
        contentType: "application/octet-stream",
        attributes: Object.entries(attributes).map(([key, value]) => ({ key, value })),
        ttlSeconds: options?.ttl ?? ARKIV_ENTITY_TTL_SECONDS,
      }),
    });
    if (!res.ok) {
      throw new Error(`Arkiv write failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { entityKey?: string; key?: string; id?: string };
    const key = data.entityKey ?? data.key ?? data.id;
    if (!key) throw new Error("Arkiv write returned no entity key");
    return { key };
  }

  async readEntity(
    key: string
  ): Promise<{ payload: Uint8Array; attributes: Record<string, string> }> {
    const res = await fetch(`${this.baseUrl}/entities/${encodeURIComponent(key)}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Arkiv read failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      payload?: string;
      data?: string;
      attributes?: unknown;
    };
    const rawPayload = data.payload ?? data.data;
    if (rawPayload === undefined) throw new Error("Arkiv entity has no payload");
    return { payload: base64ToBytes(rawPayload), attributes: normalizeAttributes(data.attributes) };
  }
}

export interface LiveArkivEnv {
  ARKIV_API_KEY?: string;
  ARKIV_URL?: string;
  ARKIV_API_URL?: string;
  NEXT_PUBLIC_ARKIV_URL?: string;
  NEXT_PUBLIC_ARKIV_API_KEY?: string;
}

function readProcessEnv(): LiveArkivEnv {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return (proc?.env ?? {}) as LiveArkivEnv;
  } catch {
    return {};
  }
}

/**
 * Build the real live Arkiv client from the environment. Fails closed
 * when no API key is configured: set ARKIV_API_KEY to a real Arkiv
 * testnet key, and optionally ARKIV_URL to override the default
 * testnet gateway. The returned client has liveVerified false until
 * a real write and read round trip succeeds against the gateway,
 * which has not happened in this environment.
 */
export function createLiveArkivClient(env?: LiveArkivEnv): HttpArkivClient {
  const source: LiveArkivEnv = env ?? readProcessEnv();
  const apiKey = source.ARKIV_API_KEY ?? source.NEXT_PUBLIC_ARKIV_API_KEY;
  const baseUrl =
    source.ARKIV_URL ?? source.ARKIV_API_URL ?? source.NEXT_PUBLIC_ARKIV_URL ?? ARKIV_DEFAULT_URL;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ArkivNotConfiguredError(
      "Arkiv is not configured: set ARKIV_API_KEY to a real Arkiv testnet API key " +
        `(gateway ${baseUrl}). No live Arkiv write or read was attempted, and no entity ID was created. ` +
        "Live Arkiv access has not been verified in this environment."
    );
  }
  return new HttpArkivClient(baseUrl, apiKey);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface JanLekhaArkivWriteResult {
  entityKey: string;
  entityKeyBytes32: `0x${string}`;
  contentHash: `0x${string}`;
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  chunked: boolean;
  totalChunks: number;
  chunkKeys: string[] | null;
  manifestHash: `0x${string}` | null;
  manifestEntityKey: string | null;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compression: "zstd" | "none";
  note: string;
}

export interface JanLekhaWriteOptions {
  ttl?: number;
  uploaderAddress?: string;
}

function baseAttributes(
  prepared: JanLekhaPreparedEvidence,
  kind: "bundle" | "chunk" | "manifest",
  options?: JanLekhaWriteOptions
): Record<string, string> {
  const attrs: Record<string, string> = {
    project: "janlekha",
    entity_type: "evidence",
    document_id: prepared.documentId,
    project_id: prepared.projectId,
    evidence_type: prepared.evidenceType,
    sha256_prefix: prepared.contentHash.slice(0, 18),
    kind,
  };
  if (options?.uploaderAddress) attrs.uploader = options.uploaderAddress.toLowerCase();
  return attrs;
}

/**
 * Write prepared JanLekha evidence to Arkiv through any IArkivClient.
 * Single payloads go in one entity. Larger evidence is chunked: each
 * chunk entity is written first, in order, then the manifest entity
 * is written last and its key is the evidence entity key. The entity
 * key in the result always comes from a real writeEntity response.
 */
export async function writeJanLekhaEvidence(
  client: IArkivClient,
  prepared: JanLekhaPreparedEvidence,
  options?: JanLekhaWriteOptions
): Promise<JanLekhaArkivWriteResult> {
  const ttl = options?.ttl ?? ARKIV_ENTITY_TTL_SECONDS;
  const note =
    "Entity key came from a real Arkiv client write result. No transaction hash is included: " +
    "on-chain confirmation only exists after a real DocumentRegistered event is observed on Arc Testnet (5042002). " +
    LIVE_ARKIV_NOT_VERIFIED_NOTE;

  if (!prepared.chunked) {
    if (!prepared.singlePayload) {
      throw new Error("JanLekha prepared evidence is marked single-entity but has no payload.");
    }
    const res = await client.writeEntity(
      prepared.singlePayload,
      baseAttributes(prepared, "bundle", options),
      { ttl }
    );
    const entityKeyBytes32 = await entityKeyToBytes32Local(res.key);
    return {
      entityKey: res.key,
      entityKeyBytes32,
      contentHash: prepared.contentHash,
      documentId: prepared.documentId,
      projectId: prepared.projectId,
      evidenceType: prepared.evidenceType,
      chunked: false,
      totalChunks: 1,
      chunkKeys: null,
      manifestHash: null,
      manifestEntityKey: null,
      originalSizeBytes: prepared.originalSizeBytes,
      compressedSizeBytes: prepared.compressedSizeBytes,
      compression: prepared.compression,
      note,
    };
  }

  if (!prepared.manifestCore) {
    throw new Error("JanLekha prepared evidence is marked chunked but has no manifest core.");
  }
  const chunkKeys: string[] = [];
  for (const plan of prepared.chunks) {
    const chunkPayload = encodeChunkPayload(plan, prepared.manifestCore.totalChunks);
    if (chunkPayload.length > JANLEKHA_ARKIV_TARGET_BYTES) {
      throw new RangeError(
        `JanLekha chunk ${plan.index} payload is ${chunkPayload.length} bytes, over the ${JANLEKHA_ARKIV_TARGET_BYTES} byte target.`
      );
    }
    const attrs = baseAttributes(prepared, "chunk", options);
    attrs.chunk_index = String(plan.index);
    attrs.total_chunks = String(prepared.manifestCore.totalChunks);
    const res = await client.writeEntity(chunkPayload, attrs, { ttl });
    chunkKeys.push(res.key);
  }
  const { manifest, payload } = await buildJanLekhaManifest(prepared.manifestCore, chunkKeys);
  const manifestRes = await client.writeEntity(
    payload,
    baseAttributes(prepared, "manifest", options),
    { ttl }
  );
  const entityKeyBytes32 = await entityKeyToBytes32Local(manifestRes.key);
  return {
    entityKey: manifestRes.key,
    entityKeyBytes32,
    contentHash: prepared.contentHash,
    documentId: prepared.documentId,
    projectId: prepared.projectId,
    evidenceType: prepared.evidenceType,
    chunked: true,
    totalChunks: prepared.manifestCore.totalChunks,
    chunkKeys,
    manifestHash: manifest.manifestHash,
    manifestEntityKey: manifestRes.key,
    originalSizeBytes: prepared.originalSizeBytes,
    compressedSizeBytes: prepared.compressedSizeBytes,
    compression: prepared.compression,
    note,
  };
}

// ---------------------------------------------------------------------------
// Read and verify
// ---------------------------------------------------------------------------

export interface JanLekhaArkivReadResult {
  raw: Uint8Array;
  contentHash: `0x${string}`;
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  fileName?: string;
  mimeType?: string;
  chunked: boolean;
  manifest: JanLekhaManifest | null;
  entityKey: string;
  verified: true;
}

export interface JanLekhaReadOptions {
  expectedDocumentId?: string;
  expectedProjectId?: string;
  expectedEvidenceType?: string;
}

async function resolveReadKey(client: IArkivClient, entityKeyOrBytes32: string): Promise<string> {
  if (/^0x[0-9a-fA-F]{64}$/.test(entityKeyOrBytes32)) {
    const mapped = lookupJanLekhaEntityKey(entityKeyOrBytes32);
    if (mapped) return mapped;
    // Some clients mint bytes32-shaped keys directly; try the key as given.
    try {
      await client.readEntity(entityKeyOrBytes32);
      return entityKeyOrBytes32;
    } catch {
      throw new Error(
        `No local mapping for Arkiv bytes32 key ${entityKeyOrBytes32}. Pass the raw Arkiv entity key returned by the write, or write the evidence in this process first so the mapping is registered.`
      );
    }
  }
  return entityKeyOrBytes32;
}

function checkAttributes(
  attributes: Record<string, string>,
  options: JanLekhaReadOptions | undefined,
  documentId: string,
  projectId: string,
  evidenceType: string
): void {
  if (attributes.document_id && attributes.document_id !== documentId) {
    throw new Error(
      `Arkiv entity attributes disagree: document_id is "${attributes.document_id}", expected "${documentId}".`
    );
  }
  if (attributes.project_id && attributes.project_id !== projectId) {
    throw new Error(
      `Arkiv entity attributes disagree: project_id is "${attributes.project_id}", expected "${projectId}".`
    );
  }
  if (attributes.evidence_type && attributes.evidence_type !== evidenceType) {
    throw new Error(
      `Arkiv entity attributes disagree: evidence_type is "${attributes.evidence_type}", expected "${evidenceType}".`
    );
  }
  if (options?.expectedDocumentId && documentId !== options.expectedDocumentId) {
    throw new Error(
      `JanLekha evidence documentId mismatch: got "${documentId}", expected "${options.expectedDocumentId}".`
    );
  }
  if (options?.expectedProjectId && projectId !== options.expectedProjectId) {
    throw new Error(
      `JanLekha evidence projectId mismatch: got "${projectId}", expected "${options.expectedProjectId}".`
    );
  }
  if (options?.expectedEvidenceType && evidenceType !== options.expectedEvidenceType) {
    throw new Error(
      `JanLekha evidence evidenceType mismatch: got "${evidenceType}", expected "${options.expectedEvidenceType}".`
    );
  }
}

/**
 * Read JanLekha evidence from Arkiv and verify it end to end.
 * Manifest payloads are verified by manifest hash, then each chunk
 * is fetched in manifest order and verified by index, total, size,
 * and per-chunk SHA-256, then the reassembled bytes are decompressed
 * and checked against the content hash. Single payloads go through
 * the same final decompression and content hash gate. Any failure
 * throws and no raw bytes are returned. Use
 * verifyJanLekhaEvidence for a result object instead of a throw.
 */
export async function readJanLekhaEvidence(
  client: IArkivClient,
  entityKeyOrBytes32: string,
  expectedContentHash: string,
  options?: JanLekhaReadOptions
): Promise<JanLekhaArkivReadResult> {
  const resolvedKey = await resolveReadKey(client, entityKeyOrBytes32);
  const entity = await client.readEntity(resolvedKey);
  const payload = entity.payload;

  if (payload.length > 0 && payload[0] === 0x7b) {
    // Starts with "{": a JSON manifest payload.
    const manifest = await parseAndVerifyManifest(payload);
    if (manifest.contentHash.toLowerCase() !== expectedContentHash.toLowerCase()) {
      throw new Error(
        `JanLekha evidence content hash mismatch: manifest carries ${manifest.contentHash}, expected ${expectedContentHash}. Refusing to display the evidence.`
      );
    }
    checkAttributes(
      entity.attributes,
      options,
      manifest.documentId,
      manifest.projectId,
      manifest.evidenceType
    );
    const chunkPayloads: Uint8Array[] = [];
    for (let i = 0; i < manifest.chunkKeys.length; i++) {
      const chunkEntity = await client.readEntity(manifest.chunkKeys[i]);
      chunkPayloads.push(chunkEntity.payload);
    }
    const compressed = await reassembleJanLekhaChunks(chunkPayloads, manifest);
    const raw = await decompressAndVerify(
      compressed,
      manifest.compression,
      manifest.contentHash,
      manifest.originalSizeBytes
    );
    return {
      raw,
      contentHash: manifest.contentHash,
      documentId: manifest.documentId,
      projectId: manifest.projectId,
      evidenceType: manifest.evidenceType,
      fileName: manifest.fileName,
      mimeType: manifest.mimeType,
      chunked: true,
      manifest,
      entityKey: resolvedKey,
      verified: true,
    };
  }

  const raw = await decodeAndVerifySinglePayload(payload, expectedContentHash);
  // Single payloads carry no document or project id in the envelope,
  // so identity comes from the entity attributes when present. The
  // content hash is the anchor: it was already verified above.
  // Attributes, when present, must agree with the caller's
  // expectations; when absent there is nothing further to check.
  if (entity.attributes.document_id && options?.expectedDocumentId) {
    checkAttributes(entity.attributes, options, entity.attributes.document_id, entity.attributes.project_id ?? "", entity.attributes.evidence_type ?? "");
  }
  return {
    raw,
    contentHash: expectedContentHash as `0x${string}`,
    documentId: entity.attributes.document_id ?? options?.expectedDocumentId ?? "",
    projectId: entity.attributes.project_id ?? options?.expectedProjectId ?? "",
    evidenceType: (entity.attributes.evidence_type ?? options?.expectedEvidenceType ?? "") as JanLekhaEvidenceType,
    fileName: undefined,
    mimeType: undefined,
    chunked: false,
    manifest: null,
    entityKey: resolvedKey,
    verified: true,
  };
}

export interface JanLekhaArkivVerificationResult {
  valid: boolean;
  errors: string[];
  raw: Uint8Array | null;
  contentHash: `0x${string}` | null;
  chunked: boolean;
  manifest: JanLekhaManifest | null;
  documentId: string | null;
  projectId: string | null;
  evidenceType: string | null;
}

/**
 * Verify JanLekha evidence from Arkiv without throwing on integrity
 * failure: returns valid false with the errors listed, and raw null.
 * The evidence is only usable for display when valid is true.
 */
export async function verifyJanLekhaEvidence(
  client: IArkivClient,
  entityKeyOrBytes32: string,
  expectedContentHash: string,
  options?: JanLekhaReadOptions
): Promise<JanLekhaArkivVerificationResult> {
  try {
    const read = await readJanLekhaEvidence(client, entityKeyOrBytes32, expectedContentHash, options);
    return {
      valid: true,
      errors: [],
      raw: read.raw,
      contentHash: read.contentHash,
      chunked: read.chunked,
      manifest: read.manifest,
      documentId: read.documentId,
      projectId: read.projectId,
      evidenceType: read.evidenceType,
    };
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      raw: null,
      contentHash: null,
      chunked: false,
      manifest: null,
      documentId: null,
      projectId: null,
      evidenceType: null,
    };
  }
}
