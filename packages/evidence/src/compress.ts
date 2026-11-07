/**
 * @streetsync/evidence - Hybrid CBOR + Zstandard WASM compression pipeline
 */

import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { decompress as fzstdDecompress } from "fzstd";
import { ZSTD_DICTIONARY, DICT_ID } from "./dictionary.js";
import type { EvidenceMetadata } from "./types.js";

// Ensure globalThis._malloc and _free exist for @bokuweb/zstd-wasm in strict mode
if (typeof (globalThis as Record<string, unknown>)._malloc === "undefined") {
  (globalThis as Record<string, unknown>)._malloc = undefined;
}
if (typeof (globalThis as Record<string, unknown>)._free === "undefined") {
  (globalThis as Record<string, unknown>)._free = undefined;
}

let zstdWasmModule: typeof import("@bokuweb/zstd-wasm") | null = null;
let zstdInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize Zstd WASM engine.
 * Safe to call multiple times.
 */
export async function initZstd(): Promise<void> {
  if (zstdInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import("@bokuweb/zstd-wasm");
      await mod.init();
      zstdWasmModule = mod;
      zstdInitialized = true;
    } catch {
      // If WASM fails to load in this environment, fallback mechanisms will be used
      zstdWasmModule = null;
    }
  })();

  return initPromise;
}

/**
 * Encode EvidenceMetadata into CBOR bytes.
 */
export function encodeMetadataToCBOR(metadata: EvidenceMetadata): Uint8Array {
  const encoded = cborEncode(metadata);
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}

/**
 * Decode CBOR bytes into EvidenceMetadata.
 */
export function decodeMetadataFromCBOR(cborBytes: Uint8Array): EvidenceMetadata {
  return cborDecode(cborBytes) as EvidenceMetadata;
}

/**
 * Compresses CBOR bytes using Zstd WASM and the pre-trained dictionary buffer.
 * If Zstd WASM is not available, falls back to plain CBOR or standard compression.
 */
export async function compressMetadata(
  cborBytes: Uint8Array,
  dict: Uint8Array = ZSTD_DICTIONARY
): Promise<{ compressed: Uint8Array; dictUsed: boolean }> {
  await initZstd();

  if (zstdWasmModule && zstdInitialized) {
    try {
      const cctx = zstdWasmModule.createCCtx();
      try {
        const compressed = zstdWasmModule.compressUsingDict(cctx, cborBytes, dict, 10);
        return { compressed, dictUsed: true };
      } finally {
        zstdWasmModule.freeCCtx(cctx);
      }
    } catch {
      // Fallback: standard zstd compression without dict
      try {
        const compressed = zstdWasmModule.compress(cborBytes, 10);
        return { compressed, dictUsed: false };
      } catch {
        // Fallback: uncompressed CBOR
        return { compressed: cborBytes, dictUsed: false };
      }
    }
  }

  // Pure-JS fallback if WASM is unavailable
  return { compressed: cborBytes, dictUsed: false };
}

/**
 * Decompresses Zstd-compressed CBOR bytes using dictionary if flagged,
 * with multi-tier fallback (zstd-wasm dict -> zstd-wasm standard -> fzstd -> raw).
 */
export async function decompressMetadata(
  compressedBytes: Uint8Array,
  dictUsed: boolean = true,
  dict: Uint8Array = ZSTD_DICTIONARY
): Promise<EvidenceMetadata> {
  let cborBytes: Uint8Array | null = null;

  await initZstd();

  if (zstdWasmModule && zstdInitialized) {
    if (dictUsed) {
      try {
        const dctx = zstdWasmModule.createDCtx();
        try {
          cborBytes = zstdWasmModule.decompressUsingDict(dctx, compressedBytes, dict);
        } finally {
          zstdWasmModule.freeDCtx(dctx);
        }
      } catch {
        // Attempt without dict
        try {
          cborBytes = zstdWasmModule.decompress(compressedBytes);
        } catch {
          // Continue to next fallback
        }
      }
    } else {
      try {
        cborBytes = zstdWasmModule.decompress(compressedBytes);
      } catch {
        // Continue to next fallback
      }
    }
  }

  // Fallback to fzstd pure JS decompressor
  if (!cborBytes) {
    try {
      cborBytes = fzstdDecompress(compressedBytes);
    } catch {
      // Maybe the bytes were uncompressed CBOR
      cborBytes = compressedBytes;
    }
  }

  return decodeMetadataFromCBOR(cborBytes);
}

export { DICT_ID, ZSTD_DICTIONARY };

/**
 * Compress arbitrary raw bytes with Zstd.
 * Returns method "zstd" when the WASM engine compresses the data, and
 * method "none" when WASM is unavailable, in which case the input is
 * returned unchanged and the caller must record method "none" so the
 * reader does not try to decompress it. The method is never guessed:
 * it travels with the payload in the JanLekha envelope and manifest.
 */
export async function compressBytes(
  data: Uint8Array,
  level: number = 10
): Promise<{ compressed: Uint8Array; method: "zstd" | "none" }> {
  await initZstd();
  if (zstdWasmModule && zstdInitialized) {
    try {
      const compressed = zstdWasmModule.compress(data, level);
      return { compressed: new Uint8Array(compressed), method: "zstd" };
    } catch {
      return { compressed: new Uint8Array(data), method: "none" };
    }
  }
  return { compressed: new Uint8Array(data), method: "none" };
}

/**
 * Decompress bytes produced by compressBytes. Method "none" returns a
 * copy of the input. Method "zstd" tries the WASM engine first, then
 * the pure JS fzstd decompressor, and throws instead of returning
 * corrupt or partial data when both fail. Fail closed, never guess.
 */
export async function decompressBytes(
  data: Uint8Array,
  method: "zstd" | "none"
): Promise<Uint8Array> {
  if (method === "none") {
    return new Uint8Array(data);
  }
  await initZstd();
  if (zstdWasmModule && zstdInitialized) {
    try {
      const out = zstdWasmModule.decompress(data);
      return new Uint8Array(out);
    } catch {
      // Fall through to the fzstd fallback below.
    }
  }
  try {
    return new Uint8Array(fzstdDecompress(data));
  } catch (err) {
    throw new Error(`Zstd decompression failed: ${String(err)}`);
  }
}

