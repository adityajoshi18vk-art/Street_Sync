/**
 * backend/src/evidence.ts - JanLekha evidence records for Arc Testnet
 *
 * Library for turning a prepared JanLekha evidence item and a real
 * Arkiv write result into the exact record JanLekha anchors on Arc,
 * and for turning a real DocumentRegistered event back into an
 * evidence reference a UI can display.
 *
 * This file is a library only. It is not wired into server.ts (that
 * file is out of scope for this change); a future wiring step adds
 * the routes that call these helpers.
 *
 * Evidence reference format, matching JanLekha 2.0
 * (contracts/src/DocumentRegistry.sol in the JanLekha source and
 * src/lib/contracts.ts there):
 *   - registerDocument(bytes32 id, bytes32 projectId, bytes32
 *     contentHash, string docType). The id and projectId are
 *     keccak256 of the JanLekha string ids, the same conversion
 *     JanLekha's idToBytes32 applies. The contentHash is the SHA-256
 *     of the raw evidence bytes as a 0x-prefixed bytes32, the same
 *     hash JanLekha's browser verifier computes with
 *     crypto.subtle SHA-256. The docType is the JanLekha evidence
 *     type, one of the allowlisted public types.
 *   - The DocumentRegistered event carries (bytes32 indexed id,
 *     bytes32 indexed projectId, bytes32 indexed contentHash,
 *     string docType, address uploadedBy). Those five fields are the
 *     whole on-chain evidence reference. No transaction hash is
 *     invented here: txHash and blockNumber are null until the
 *     caller supplies them from a real transaction receipt, and the
 *     reference says "not-yet-observed" until then.
 *
 * Chain: Arc Testnet, chain ID 5042002. No mainnet. No private keys
 * or API keys are read, stored, or logged here. The only credential
 * touchpoint is getLiveArkivClientOrThrow, which delegates to the
 * Arkiv client and fails closed when ARKIV_API_KEY is not set.
 */

import { keccak256, stringToHex } from "viem";
import {
  verifyRawAgainstHash,
  JanLekhaEvidenceError,
  type JanLekhaEvidenceType,
  type JanLekhaPreparedEvidence,
} from "@streetsync/evidence";
import {
  createLiveArkivClient,
  LIVE_ARKIV_NOT_VERIFIED_NOTE,
  type HttpArkivClient,
  type JanLekhaArkivWriteResult,
  type LiveArkivEnv,
} from "@streetsync/arkiv-client";

export const JANLEKHA_ARC_CHAIN_ID = 5042002;
export const JANLEKHA_ARC_EXPLORER = "https://explorer.testnet.arc.io";
export const JANLEKHA_DOCUMENT_REGISTRY_METHOD = "registerDocument";
export const JANLEKHA_DOCUMENT_REGISTERED_EVENT = "DocumentRegistered";

/** Live Arkiv status in this environment: not verified live. */
export const LIVE_ARKIV_STATUS = {
  verifiedLive: false as const,
  note: LIVE_ARKIV_NOT_VERIFIED_NOTE,
} as const;

/**
 * Convert a JanLekha string id (for example "proj-1" or "doc-7") to
 * the bytes32 id used on chain: keccak256 of the UTF-8 bytes. This
 * is the same conversion as JanLekha's idToBytes32.
 */
export function janLekhaIdToBytes32(id: string): `0x${string}` {
  return keccak256(stringToHex(id));
}

/**
 * Validate a 0x-prefixed 32-byte hex string (bytes32).
 */
export function isBytes32(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export interface DocumentRegistryCall {
  chainId: number;
  method: typeof JANLEKHA_DOCUMENT_REGISTRY_METHOD;
  args: {
    id: `0x${string}`;
    projectId: `0x${string}`;
    contentHash: `0x${string}`;
    docType: JanLekhaEvidenceType;
  };
  note: string;
}

/**
 * Build the exact registerDocument call arguments for a prepared
 * JanLekha evidence item. This only builds the arguments; it does
 * not send a transaction and it returns no transaction hash.
 */
export function buildDocumentRegistryCall(
  prepared: Pick<JanLekhaPreparedEvidence, "documentId" | "projectId" | "contentHash" | "evidenceType">
): DocumentRegistryCall {
  if (!isBytes32(prepared.contentHash)) {
    throw new JanLekhaEvidenceError(
      "CONTENT_HASH_MISMATCH",
      `JanLekha content hash "${prepared.contentHash}" is not a 0x-prefixed 32-byte hex string.`
    );
  }
  return {
    chainId: JANLEKHA_ARC_CHAIN_ID,
    method: JANLEKHA_DOCUMENT_REGISTRY_METHOD,
    args: {
      id: janLekhaIdToBytes32(prepared.documentId),
      projectId: janLekhaIdToBytes32(prepared.projectId),
      contentHash: prepared.contentHash,
      docType: prepared.evidenceType,
    },
    note:
      "Call arguments only. Sending registerDocument needs a role-holding signer on Arc Testnet (5042002). " +
      "The transaction hash comes from the real receipt afterwards, never from this builder.",
  };
}

export interface DocumentRegisteredEventArgs {
  id: string;
  projectId: string;
  contentHash: string;
  docType: string;
  uploadedBy: string;
}

export interface JanLekhaEvidenceReference {
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  fileName?: string;
  mimeType?: string;
  contentHash: `0x${string}`;
  arkivEntityKey: string;
  arkivEntityKeyBytes32: `0x${string}`;
  manifestHash: `0x${string}` | null;
  chunked: boolean;
  chunkCount: number;
  uploadedBy: string;
  chainId: number;
  onChain: {
    event: typeof JANLEKHA_DOCUMENT_REGISTERED_EVENT;
    id: `0x${string}`;
    projectId: `0x${string}`;
    contentHash: `0x${string}`;
    docType: string;
    txHash: string | null;
    blockNumber: number | null;
    explorerUrl: string | null;
    confirmed: boolean;
    note: string;
  };
}

export interface EvidenceReferenceOptions {
  uploadedBy?: string;
  txHash?: string | null;
  blockNumber?: number | null;
  fileName?: string;
  mimeType?: string;
}

/**
 * Build an evidence reference from a real Arkiv write result. The
 * txHash is null unless the caller supplies a real receipt hash, in
 * which case it must be a 0x-prefixed 32-byte hex string. Until a
 * real DocumentRegistered event is observed, the reference is
 * explicitly marked not-yet-observed on chain.
 */
export function buildEvidenceReference(
  writeResult: JanLekhaArkivWriteResult,
  options?: EvidenceReferenceOptions
): JanLekhaEvidenceReference {
  const txHash =
    options?.txHash && /^0x[0-9a-fA-F]{64}$/.test(options.txHash) ? options.txHash : null;
  const blockNumber =
    typeof options?.blockNumber === "number" && Number.isInteger(options.blockNumber)
      ? options.blockNumber
      : null;
  const confirmed = txHash !== null;
  return {
    documentId: writeResult.documentId,
    projectId: writeResult.projectId,
    evidenceType: writeResult.evidenceType,
    ...(options?.fileName ? { fileName: options.fileName } : {}),
    ...(options?.mimeType ? { mimeType: options.mimeType } : {}),
    contentHash: writeResult.contentHash,
    arkivEntityKey: writeResult.entityKey,
    arkivEntityKeyBytes32: writeResult.entityKeyBytes32,
    manifestHash: writeResult.manifestHash,
    chunked: writeResult.chunked,
    chunkCount: writeResult.totalChunks,
    uploadedBy: options?.uploadedBy ?? "",
    chainId: JANLEKHA_ARC_CHAIN_ID,
    onChain: {
      event: JANLEKHA_DOCUMENT_REGISTERED_EVENT,
      id: janLekhaIdToBytes32(writeResult.documentId),
      projectId: janLekhaIdToBytes32(writeResult.projectId),
      contentHash: writeResult.contentHash,
      docType: writeResult.evidenceType,
      txHash,
      blockNumber,
      explorerUrl: txHash ? `${JANLEKHA_ARC_EXPLORER}/tx/${txHash}` : null,
      confirmed,
      note: confirmed
        ? "DocumentRegistered observed on Arc Testnet (5042002) in the transaction above."
        : "Not yet observed on chain. The evidence is stored on Arkiv, but no DocumentRegistered event has been seen for it yet, so no transaction hash is shown.",
    },
  };
}

/**
 * Parse a real DocumentRegistered event and check it against the
 * expected evidence. Every indexed field must match the expected
 * ids and content hash, and docType must match the evidence type.
 * Throws on any mismatch. The receipt fields (txHash, blockNumber)
 * are accepted only from a real receipt supplied by the caller.
 */
export function parseDocumentRegisteredEvent(
  event: DocumentRegisteredEventArgs,
  expected: {
    documentId: string;
    projectId: string;
    contentHash: string;
    evidenceType: JanLekhaEvidenceType;
    arkivEntityKey: string;
    arkivEntityKeyBytes32: `0x${string}`;
    manifestHash?: `0x${string}` | null;
    chunked?: boolean;
    chunkCount?: number;
  },
  receipt?: { txHash?: string | null; blockNumber?: number | null }
): JanLekhaEvidenceReference {
  const expectedId = janLekhaIdToBytes32(expected.documentId);
  const expectedProjectId = janLekhaIdToBytes32(expected.projectId);
  if (event.id.toLowerCase() !== expectedId.toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "EVENT_ID_MISMATCH",
      `DocumentRegistered event id ${event.id} does not match the expected document id ${expectedId} for "${expected.documentId}".`
    );
  }
  if (event.projectId.toLowerCase() !== expectedProjectId.toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "EVENT_PROJECT_MISMATCH",
      `DocumentRegistered event projectId ${event.projectId} does not match the expected project id ${expectedProjectId} for "${expected.projectId}".`
    );
  }
  if (event.contentHash.toLowerCase() !== expected.contentHash.toLowerCase()) {
    throw new JanLekhaEvidenceError(
      "CONTENT_HASH_MISMATCH",
      `DocumentRegistered event contentHash ${event.contentHash} does not match the expected content hash ${expected.contentHash}.`
    );
  }
  if (event.docType !== expected.evidenceType) {
    throw new JanLekhaEvidenceError(
      "EVENT_DOCTYPE_MISMATCH",
      `DocumentRegistered event docType "${event.docType}" does not match the expected evidence type "${expected.evidenceType}".`
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(event.uploadedBy)) {
    throw new JanLekhaEvidenceError(
      "EVENT_UPLOADER_INVALID",
      `DocumentRegistered event uploadedBy "${event.uploadedBy}" is not a valid address.`
    );
  }
  return buildEvidenceReference(
    {
      entityKey: expected.arkivEntityKey,
      entityKeyBytes32: expected.arkivEntityKeyBytes32,
      contentHash: expected.contentHash as `0x${string}`,
      documentId: expected.documentId,
      projectId: expected.projectId,
      evidenceType: expected.evidenceType,
      chunked: expected.chunked ?? false,
      totalChunks: expected.chunkCount ?? 1,
      chunkKeys: null,
      manifestHash: expected.manifestHash ?? null,
      manifestEntityKey: null,
      originalSizeBytes: 0,
      compressedSizeBytes: 0,
      compression: "zstd",
      note: "",
    },
    {
      uploadedBy: event.uploadedBy,
      txHash: receipt?.txHash ?? null,
      blockNumber: receipt?.blockNumber ?? null,
    }
  );
}

export interface JanLekhaDisplayEvidence {
  documentId: string;
  projectId: string;
  evidenceType: JanLekhaEvidenceType;
  fileName?: string;
  mimeType?: string;
  sizeBytes: number;
  contentHash: `0x${string}`;
  verified: true;
  raw: Uint8Array;
}

/**
 * Final gate before display: re-verify retrieved raw bytes against
 * the expected content hash. Returns the display record, including
 * the raw bytes, only when the hash matches exactly. Throws and
 * returns nothing on any mismatch.
 */
export async function verifyAndPrepareForDisplay(
  raw: Uint8Array,
  expectedContentHash: string,
  meta: {
    documentId: string;
    projectId: string;
    evidenceType: JanLekhaEvidenceType;
    fileName?: string;
    mimeType?: string;
  }
): Promise<JanLekhaDisplayEvidence> {
  const ok = await verifyRawAgainstHash(raw, expectedContentHash);
  if (!ok) {
    throw new JanLekhaEvidenceError(
      "CONTENT_HASH_MISMATCH",
      `JanLekha evidence integrity check failed for document "${meta.documentId}": SHA-256 of retrieved bytes does not match ${expectedContentHash}. Refusing to display the evidence.`
    );
  }
  return {
    documentId: meta.documentId,
    projectId: meta.projectId,
    evidenceType: meta.evidenceType,
    ...(meta.fileName ? { fileName: meta.fileName } : {}),
    ...(meta.mimeType ? { mimeType: meta.mimeType } : {}),
    sizeBytes: raw.length,
    contentHash: expectedContentHash as `0x${string}`,
    verified: true,
    raw: new Uint8Array(raw),
  };
}

/**
 * Build the real live Arkiv client. Fails closed when ARKIV_API_KEY
 * is not set. Live Arkiv access has not been verified in this
 * environment; see LIVE_ARKIV_STATUS.
 */
export function getLiveArkivClientOrThrow(env?: LiveArkivEnv): HttpArkivClient {
  return createLiveArkivClient(env);
}
