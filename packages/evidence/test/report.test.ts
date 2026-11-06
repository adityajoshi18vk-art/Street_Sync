import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { keccak256, stringToHex } from "viem";
import {
  packReport, unpackReport, reportHashOf, descriptionHashOf, InvalidReportError, REPORT_MAX_DESCRIPTION,
} from "../src/index.js";

const CREATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

async function webp(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .webp({ quality: 70 }).toBuffer();
  return new Uint8Array(buf);
}

describe("problem report bundle", () => {
  it("round-trips and commits to the exact bytes", async () => {
    const photo = await webp();
    const { bundle, reportHash, descriptionHash } = await packReport({
      creator: CREATOR.toLowerCase() as `0x${string}`, description: "  Deep pothole   near the bus stop ",
      latE5: 1304797, lngE5: 8028456, capturedAtMs: 1_718_000_000_000, photo,
    });
    expect(reportHash).toBe(await reportHashOf(bundle));
    expect(descriptionHash).toBe(keccak256(stringToHex("Deep pothole near the bus stop")));
    expect(descriptionHashOf("Deep pothole near the bus stop")).toBe(descriptionHash);
    const r = await unpackReport(bundle);
    expect(r.creator).toBe(CREATOR);
    expect(r.description).toBe("Deep pothole near the bus stop");
    expect([r.latE5, r.lngE5]).toEqual([1304797, 8028456]);
    expect(Buffer.from(r.photo).equals(Buffer.from(photo))).toBe(true);
  });

  it("rejects tampering, non-WebP photos and bad descriptions", async () => {
    const photo = await webp();
    const base = { creator: CREATOR as `0x${string}`, latE5: 1, lngE5: 2, capturedAtMs: 1, photo };
    const { bundle } = await packReport({ ...base, description: "Broken streetlight" });
    const tampered = new Uint8Array(bundle);
    tampered[tampered.length - 3] ^= 0xff;
    await expect(unpackReport(tampered)).rejects.toThrow(InvalidReportError);
    await expect(packReport({ ...base, description: "short" })).rejects.toThrow(/Description/);
    await expect(packReport({ ...base, description: "x".repeat(REPORT_MAX_DESCRIPTION + 1) })).rejects.toThrow(/Description/);
    await expect(packReport({ ...base, description: "Broken streetlight", photo: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }))
      .rejects.toThrow(/WebP/);
    await expect(unpackReport(new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toThrow(/Not a StreetSync/);
  });
});
