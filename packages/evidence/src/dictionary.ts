/**
 * @streetsync/evidence - Shared pre-trained dictionary for metadata compression
 *
 * Contains high-frequency CBOR keys, standard values, device strings, coordinates,
 * and JSON/CBOR structural tokens so Zstandard can compress EvidenceMetadata to ~1-2 KiB.
 */

export const DICT_ID = 0x0001;

/**
 * Pre-trained dictionary buffer optimized for EvidenceMetadata CBOR structures.
 * Minimum 2 KiB corpus containing token sequences, keys, and values.
 */
function createDefaultDictionary(): Uint8Array {
  const dictionaryTokens = [
    // CBOR field identifiers and keys
    "bountyId",
    "challengeCode",
    "beforeTimestampMs",
    "afterTimestampMs",
    "accuracyMeters",
    "orientation",
    "beforeSha256",
    "afterSha256",
    "userAgent",
    "workerAddress",
    "notes",
    "project",
    "streetsync",
    "entity_type",
    "evidence",
    "bundle",
    "sha256_prefix",
    // Common value prefixes
    "0x",
    "Mozilla/5.0",
    "iPhone",
    "Android",
    "Mobile",
    "Chrome",
    "Safari",
    "WebKit",
    "StreetSync-Client/1.0.0",
    // Numeric tokens and padding patterns
    "1000",
    "2000",
    "3000",
    "4000",
    "5000",
    "6000",
    "7000",
    "8000",
    "9000",
    "3777490",
    "-12241940",
    "accuracy",
    "heading",
    "pothole",
    "sidewalk",
    "graffiti",
    "trash",
    "repaired",
    "cleaned",
    "verified",
    "Arc-Testnet",
    "5042002",
    "USDC",
    "Circle",
    "Hardhat",
    "Viem",
    "Arkiv",
    "WebP",
    "CBOR",
    "Zstd",
  ];

  const joined = dictionaryTokens.join("\x00");
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(joined);

  // Pad or structure dictionary to at least 2048 bytes with repeating token seeds
  const targetSize = 2048;
  const dictBuffer = new Uint8Array(targetSize);

  // Write Zstandard dictionary header (magic 0xEC30A437, dictId 0x0001)
  const view = new DataView(dictBuffer.buffer);
  view.setUint32(0, 0xec30a437, true); // ZSTD_MAGIC_DICTIONARY
  view.setUint32(4, DICT_ID, true);

  let offset = 8;
  while (offset < targetSize) {
    const chunkLen = Math.min(rawBytes.length, targetSize - offset);
    dictBuffer.set(rawBytes.subarray(0, chunkLen), offset);
    offset += chunkLen;
  }

  return dictBuffer;
}

export const ZSTD_DICTIONARY: Uint8Array = createDefaultDictionary();

