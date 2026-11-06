/**
 * @streetsync/evidence - Type definitions
 */

/**
 * Structured telemetry & challenge metadata captured by the worker client.
 */
export interface EvidenceMetadata {
  /** Bounty ID from contract */
  bountyId: string | number;
  /** 4-digit uint16 challenge code emitted on claim (1000 - 9999) */
  visualChallengeCode: number;
  /** Unix timestamp in ms when before photo was captured */
  beforeTimestamp: number;
  /** Unix timestamp in ms when after photo was captured */
  afterTimestamp: number;
  /** Latitude x 1e5 (integer representation) */
  gpsLatE5: number;
  /** Longitude x 1e5 (integer representation) */
  gpsLngE5: number;
  /** GPS accuracy in meters */
  gpsAccuracyM: number;
  /** Compass heading (degrees 0-360) or null */
  compassHeadingDeg: number | null;
  /** Summary of mobile device / browser */
  deviceSummary: string;
  /** Hex SHA-256 of the re-encoded before WebP image */
  beforeImageSha256: string;
  /** Hex SHA-256 of the re-encoded after WebP image */
  afterImageSha256: string;
  /** Client application version */
  appVersion: string;

  // Optional fields for extended telemetry / compatibility
  workerAddress?: `0x${string}`;
  notes?: string;
  v?: number;

  /** Optional Ethereum Swarm video walkthrough attachment */
  video?: {
    swarmReference: string;
    videoSha256: string;
    durationSeconds: number;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface VideoEvidence {
  swarmReference: string;
  videoSha256: string;
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
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

