/**
 * @streetsync/evidence
 *
 * Client-side evidence builder, hybrid compression pipeline (WebP + CBOR + Zstd WASM with dictionary),
 * deterministic binary packer/unpacker, and cryptographic verification for StreetSync.
 */

import { resizeAndEncodePhoto } from "./resizer.js";
import {
  recoverWorkerAddress,
  MAGIC_BYTES,
  BUNDLE_VERSION,
  FLAG_ZSTD_DICT,
  FLAG_WEBP,
  MAX_SAFE_BUNDLE_BYTES,
} from "./bundle.js";

export * from "./types.js";
export * from "./dictionary.js";
export * from "./compress.js";
export * from "./resizer.js";
export * from "./bundle.js";
export * from "./report.js";

// Convenience aliases matching various caller conventions
export {
  resizeAndEncodePhoto as resizeImage,
  recoverWorkerAddress as recoverSigner,
  MAGIC_BYTES as MAGIC,
  BUNDLE_VERSION as VERSION,
  FLAG_ZSTD_DICT as FLAGS_ZSTD_DICT,
  FLAG_WEBP as FLAGS_WEBP,
  MAX_SAFE_BUNDLE_BYTES as MAX_BUNDLE_BYTES,
};
