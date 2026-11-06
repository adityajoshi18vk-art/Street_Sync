import { MAX_IMAGE_BYTES, resizeAndEncodePhoto } from "@streetsync/evidence";

export function isWebp(bytes: Uint8Array): boolean {
  const tag = (from: number, s: string) => [...s].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  return bytes.length > 12 && tag(0, "RIFF") && tag(8, "WEBP");
}

const EDGE_STEPS = [1280, 960, 720, 540, 400];

/**
 * Encodes a picked/captured image to WebP ≤ 48 KB. The browser encoder only lowers quality,
 * so shrink the longest edge step by step until the result fits.
 */
export async function encodeReportPhoto(imageBytes: Uint8Array): Promise<Uint8Array> {
  for (const maxEdge of EDGE_STEPS) {
    const res = await resizeAndEncodePhoto(imageBytes, { maxEdge, minQuality: 0.5 });
    if (!isWebp(res.webpBytes)) {
      throw new Error("This browser can't convert photos to WebP. Try a recent Chrome, Edge, Firefox or Safari.");
    }
    if (res.webpBytes.length <= MAX_IMAGE_BYTES) return res.webpBytes;
  }
  throw new Error("Couldn't shrink this photo enough. Try a different photo.");
}
