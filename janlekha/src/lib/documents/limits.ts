/** Shared by the browser and the upload API. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_DOCUMENT_TYPE = "application/pdf";
export const PDF_MAGIC = "%PDF-";

export function isHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-f]{64}$/.test(value);
}

export async function sha256OfBytes(bytes: ArrayBuffer | Uint8Array): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `0x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.split("").every((ch, i) => bytes[i] === ch.charCodeAt(0));
}
