/**
 * Problem-report bundle: the reporter's photo + description, stored as one Arkiv
 * entity and committed on-chain as `reportHash = sha256(bundle)` in createBounty.
 *
 * Layout:  "SSRP" (4) | version (1) | CBOR(ReportPayload)
 *
 * The on-chain hash authenticates the bundle, so it carries no signature: only the
 * creator's createBounty transaction can bind a given bundle to a bounty.
 */

import { encode as cborEncode, decode as cborDecode } from "cbor-x";
import { getAddress, isAddress, keccak256, stringToHex } from "viem";
import { sha256, sha256Bytes32 } from "./bundle.js";
import { MAX_IMAGE_BYTES } from "./resizer.js";

export const REPORT_MAGIC = new Uint8Array([0x53, 0x53, 0x52, 0x50]); // "SSRP"
export const REPORT_VERSION = 1;
export const REPORT_MIN_DESCRIPTION = 8;
export const REPORT_MAX_DESCRIPTION = 500;
export const REPORT_MAX_BYTES = 64_000;

export interface ReportInput {
  creator: `0x${string}`;
  description: string;
  latE5: number;
  lngE5: number;
  capturedAtMs: number;
  /** WebP photo, at most MAX_IMAGE_BYTES. */
  photo: Uint8Array;
}

export interface ReportData extends ReportInput {
  v: 1;
  photoSha256: `0x${string}`;
}

export class InvalidReportError extends Error {}

/** keccak256 of the UTF-8 description, as stored in Bounty.descriptionHash. */
export function descriptionHashOf(description: string): `0x${string}` {
  return keccak256(stringToHex(description));
}

export function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ");
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // WEBP
}

function validateFields(r: ReportInput): void {
  if (!isAddress(r.creator)) throw new InvalidReportError("Invalid creator address");
  if (typeof r.description !== "string" || r.description !== normalizeDescription(r.description)) {
    throw new InvalidReportError("Description must be normalized text");
  }
  const len = [...r.description].length;
  if (len < REPORT_MIN_DESCRIPTION || len > REPORT_MAX_DESCRIPTION) {
    throw new InvalidReportError(`Description must be ${REPORT_MIN_DESCRIPTION}-${REPORT_MAX_DESCRIPTION} characters`);
  }
  for (const v of [r.latE5, r.lngE5]) {
    if (!Number.isInteger(v)) throw new InvalidReportError("Coordinates must be integer ×1e5 values");
  }
  if (Math.abs(r.latE5) > 9_000_000 || Math.abs(r.lngE5) > 18_000_000) {
    throw new InvalidReportError("Coordinates out of range");
  }
  if (!Number.isSafeInteger(r.capturedAtMs) || r.capturedAtMs <= 0) {
    throw new InvalidReportError("Invalid capture timestamp");
  }
  if (!(r.photo instanceof Uint8Array) || r.photo.length === 0 || r.photo.length > MAX_IMAGE_BYTES) {
    throw new InvalidReportError(`Photo must be 1-${MAX_IMAGE_BYTES} bytes`);
  }
  if (!isWebp(r.photo)) throw new InvalidReportError("Photo must be WebP");
}

/** Builds the bundle and its on-chain hashes. */
export async function packReport(input: ReportInput): Promise<{
  bundle: Uint8Array;
  reportHash: `0x${string}`;
  descriptionHash: `0x${string}`;
}> {
  const report: ReportInput = { ...input, creator: getAddress(input.creator), description: normalizeDescription(input.description) };
  validateFields(report);
  const payload: ReportData = {
    v: 1,
    creator: report.creator,
    description: report.description,
    latE5: report.latE5,
    lngE5: report.lngE5,
    capturedAtMs: report.capturedAtMs,
    photoSha256: await sha256Bytes32(report.photo),
    photo: report.photo,
  };
  const cbor = cborEncode(payload);
  const bundle = new Uint8Array(REPORT_MAGIC.length + 1 + cbor.length);
  bundle.set(REPORT_MAGIC, 0);
  bundle[REPORT_MAGIC.length] = REPORT_VERSION;
  bundle.set(cbor, REPORT_MAGIC.length + 1);
  if (bundle.length > REPORT_MAX_BYTES) throw new InvalidReportError(`Report is ${bundle.length} bytes; limit ${REPORT_MAX_BYTES}`);
  return { bundle, reportHash: await sha256Bytes32(bundle), descriptionHash: descriptionHashOf(report.description) };
}

/** Parses and validates a bundle (does not check it against the chain). */
export async function unpackReport(bundle: Uint8Array): Promise<ReportData> {
  if (!(bundle instanceof Uint8Array) || bundle.length < 6 || bundle.length > REPORT_MAX_BYTES) {
    throw new InvalidReportError("Report bundle has an invalid size");
  }
  for (let i = 0; i < REPORT_MAGIC.length; i++) {
    if (bundle[i] !== REPORT_MAGIC[i]) throw new InvalidReportError("Not a StreetSync report bundle");
  }
  if (bundle[REPORT_MAGIC.length] !== REPORT_VERSION) throw new InvalidReportError("Unsupported report version");
  let decoded: ReportData;
  try {
    decoded = cborDecode(bundle.subarray(REPORT_MAGIC.length + 1)) as ReportData;
  } catch {
    throw new InvalidReportError("Report payload is not valid CBOR");
  }
  if (!decoded || typeof decoded !== "object" || decoded.v !== 1) throw new InvalidReportError("Unsupported report payload");
  const photo = decoded.photo instanceof Uint8Array ? decoded.photo : new Uint8Array(decoded.photo ?? []);
  const report: ReportData = { ...decoded, photo };
  validateFields(report);
  if (report.photoSha256 !== await sha256Bytes32(photo)) throw new InvalidReportError("Photo hash mismatch");
  return report;
}

export async function reportHashOf(bundle: Uint8Array): Promise<`0x${string}`> {
  return sha256Bytes32(bundle);
}

export { sha256 as reportSha256 };
