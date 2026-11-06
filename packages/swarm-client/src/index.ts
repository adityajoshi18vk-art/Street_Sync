/**
 * @streetsync/swarm-client
 *
 * StreetSync Ethereum Swarm client wrapper:
 * Video upload to Swarm Bee gateway / postage batch, HTML5 streaming URL derivation,
 * 4-second timeout with resilient local fallback, and deterministic 64-char Swarm reference generation.
 */

import { createHash } from "node:crypto";

export interface VideoMetadata {
  filename?: string;
  mimeType?: string;
  durationSeconds?: number;
}

export interface VideoEvidence {
  swarmReference: string; // 64-character hex Swarm reference (32 bytes)
  videoSha256: string;    // 0x-prefixed 32-byte SHA-256 of the video
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
}

export interface SwarmUploadResult extends VideoEvidence {
  swarmUrl: string;
  playbackUrl: string;
  mode: "live" | "mock";
}

export interface SwarmConfig {
  gatewayUrl: string;
  postageBatchId: string;
  mode: "live" | "mock" | "auto";
}

export const DEFAULT_SWARM_GATEWAY = "https://api.gateway.ethswarm.org";
export const UPLOAD_TIMEOUT_MS = 4000;

// Local in-memory store for fallback/mock video blobs
export interface LocalVideoRecord {
  bytes: Uint8Array;
  mimeType: string;
  blobUrl?: string;
}

const localVideoStorage = new Map<string, LocalVideoRecord>();

/**
 * Resolve Swarm configuration from environment variables (browser or Node).
 */
export function getSwarmConfig(): SwarmConfig {
  const env = (typeof process !== "undefined" && process.env) ? process.env : ({} as Record<string, string | undefined>);
  
  const gatewayUrl =
    env.NEXT_PUBLIC_SWARM_GATEWAY_URL ||
    env.SWARM_GATEWAY_URL ||
    DEFAULT_SWARM_GATEWAY;

  const postageBatchId =
    env.NEXT_PUBLIC_SWARM_POSTAGE_BATCH_ID ||
    env.SWARM_POSTAGE_BATCH_ID ||
    "";

  const rawMode = (
    env.NEXT_PUBLIC_SWARM_MODE ||
    env.SWARM_MODE ||
    "auto"
  ).toLowerCase();

  const mode: "live" | "mock" | "auto" =
    rawMode === "live" ? "live" : rawMode === "mock" ? "mock" : "auto";

  return { gatewayUrl: gatewayUrl.replace(/\/+$/, ""), postageBatchId, mode };
}

/**
 * SHA-256 helper for arbitrary byte inputs. Returns 0x-prefixed 64-char hex string.
 */
export async function computeVideoSha256(data: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const buf = await globalThis.crypto.subtle.digest(
      "SHA-256",
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    );
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `0x${hex}`;
  }
  const hash = createHash("sha256");
  hash.update(data);
  return `0x${hash.digest("hex")}`;
}

/**
 * Convert Blob or Uint8Array to Uint8Array.
 */
async function toUint8Array(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input;
  }
  const arrayBuffer = await input.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Check if the Swarm Bee node or gateway is reachable and healthy.
 */
export async function isBeeAvailable(timeoutMs = 2000): Promise<boolean> {
  const { gatewayUrl } = getSwarmConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${gatewayUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    }).catch(() => null);

    if (res && res.ok) return true;

    // Alternative probe: readiness check
    const readyRes = await fetch(`${gatewayUrl}/readiness`, {
      method: "GET",
      signal: controller.signal,
    }).catch(() => null);

    return !!(readyRes && readyRes.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive canonical Swarm gateway URL from a reference.
 * Example: https://api.gateway.ethswarm.org/bzz/<reference>
 */
export function getVideoUrl(reference: string, customGateway?: string): string {
  const cleanRef = reference.replace(/^bzz:\/\//, "");
  const { gatewayUrl } = getSwarmConfig();
  const base = (customGateway || gatewayUrl).replace(/\/+$/, "");
  return `${base}/bzz/${cleanRef}`;
}

/**
 * Derive streaming video playback URL.
 * In browser offline / mock mode, prefers cached local Blob URL; otherwise uses canonical gateway URL.
 */
export function getVideoPlaybackUrl(reference: string, customGateway?: string): string {
  const cleanRef = reference.replace(/^bzz:\/\//, "");
  const local = localVideoStorage.get(cleanRef);
  if (local?.blobUrl) {
    return local.blobUrl;
  }
  return getVideoUrl(cleanRef, customGateway);
}

/**
 * Manually register a video blob in local storage (useful for testing or fallback playback).
 */
export function registerMockVideo(
  reference: string,
  data: Uint8Array | Blob,
  mimeType = "video/webm"
): void {
  const cleanRef = reference.replace(/^bzz:\/\//, "");
  let bytes: Uint8Array;
  let blobUrl: string | undefined;

  if (data instanceof Uint8Array) {
    bytes = data;
    if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
      try {
        blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
      } catch {
        blobUrl = undefined;
      }
    }
  } else {
    bytes = new Uint8Array();
    if (typeof URL !== "undefined") {
      try {
        blobUrl = URL.createObjectURL(data);
      } catch {
        blobUrl = undefined;
      }
    }
  }

  localVideoStorage.set(cleanRef, { bytes, mimeType, blobUrl });
}

/**
 * Retrieve a stored video blob from local fallback cache if available.
 */
export function getMockVideoRecord(reference: string): LocalVideoRecord | undefined {
  return localVideoStorage.get(reference.replace(/^bzz:\/\//, ""));
}

/**
 * Upload a video to Ethereum Swarm with automatic 4-second timeout and local fallback.
 */
export async function uploadVideo(
  videoBlob: Blob | Uint8Array,
  metadata: VideoMetadata = {}
): Promise<SwarmUploadResult> {
  const bytes = await toUint8Array(videoBlob);
  const sizeBytes = bytes.length;
  const mimeType = metadata.mimeType || (videoBlob instanceof Blob && videoBlob.type ? videoBlob.type : "video/webm");
  const durationSeconds = metadata.durationSeconds ?? 10;
  const filename = metadata.filename || `streetsync-walkthrough-${Date.now()}.webm`;

  // Compute 0x-prefixed 32-byte SHA-256 for integrity verification
  const videoSha256 = await computeVideoSha256(bytes);

  const { gatewayUrl, postageBatchId, mode } = getSwarmConfig();

  // If live mode is requested or auto with configured postage batch, attempt upload to Swarm Bee
  if (mode === "live" || (mode === "auto" && postageBatchId)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      const uploadHeaders: Record<string, string> = {
        "Content-Type": mimeType,
      };
      if (postageBatchId) {
        uploadHeaders["swarm-postage-batch-id"] = postageBatchId;
      }

      const response = await fetch(`${gatewayUrl}/bzz?name=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: uploadHeaders,
        body: bytes as BodyInit,
        signal: controller.signal,
      });

      if (response.ok) {
        const json = await response.json().catch(() => null);
        const reference: string = json?.reference || (await response.text()).trim();

        if (reference && /^[0-9a-fA-F]{64}$/.test(reference)) {
          clearTimeout(timer);
          const cleanRef = reference.toLowerCase();
          return {
            swarmReference: cleanRef,
            videoSha256,
            durationSeconds,
            mimeType,
            sizeBytes,
            swarmUrl: getVideoUrl(cleanRef),
            playbackUrl: getVideoUrl(cleanRef),
            mode: "live",
          };
        }
      }
    } catch {
      // Handled by fallback below
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback: Deterministic 64-char hex Swarm reference from SHA-256
  // (Standard 32-byte Swarm Reference hex string)
  const deterministicRef = videoSha256.slice(2).toLowerCase();

  // Register in local store for seamless HTML5 video playback
  registerMockVideo(deterministicRef, bytes, mimeType);

  return {
    swarmReference: deterministicRef,
    videoSha256,
    durationSeconds,
    mimeType,
    sizeBytes,
    swarmUrl: getVideoUrl(deterministicRef),
    playbackUrl: getVideoPlaybackUrl(deterministicRef),
    mode: "mock",
  };
}
