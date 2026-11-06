/**
 * @streetsync/evidence - Type definitions
 */

/**
 * Structured telemetry & challenge metadata captured by the worker client.
 */
export interface EvidenceMetadata {
  v: 1;
  bountyId: string;
  workerAddress: `0x${string}`;
  challengeCode: number;
  beforeTimestampMs: number;
  afterTimestampMs: number;
  gps: {
    lat: number;
    lng: number;
    accuracyMeters: number;
  };
  orientation: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
  beforeSha256: string;
  afterSha256: string;
  userAgent: string;
  notes: string;
}

export interface BundleInput {
  metadata: EvidenceMetadata;
  beforeImage: Uint8Array;
  afterImage: Uint8Array;
  signerPrivateKey: `0x${string}`;
}

export interface UnpackedBundle {
  magic: string;
  version: number;
  flags: number;
  dictId: number;
  zstdMetadataLen: number;
  beforeWebpLen: number;
  afterWebpLen: number;
  metadata: EvidenceMetadata;
  beforeImage: Uint8Array;
  afterImage: Uint8Array;
  signature: Uint8Array;
  payloadHash: Uint8Array;
}

export interface CompressionStats {
  rawImagesBytes: number;
  encodedImagesBytes: number;
  rawMetadataBytes: number;
  cborMetadataBytes: number;
  zstdMetadataBytes: number;
  headerBytes: number;
  signatureBytes: number;
  totalBundleBytes: number;
  rawTotalBytes: number;
  overallCompressionRatio: number;
  overallSavingsPercent: number;
  metadataSavingsPercent: number;
  imageSavingsPercent: number;
}

export interface ImageResizeResult {
  webpBytes: Uint8Array;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  quality: number;
  sha256Hex: string;
}

export interface ImageResizeOptions {
  maxEdge?: number;
  quality?: number;
  minQuality?: number;
  maxSizeBytes?: number;
}

