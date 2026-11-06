import { describe, it, expect, beforeEach } from "vitest";
import {
  uploadVideo,
  getVideoUrl,
  isBeeAvailable,
  computeVideoSha256,
  registerMockVideo,
  getMockVideoRecord,
  getSwarmConfig,
} from "../src/index.js";

describe("@streetsync/swarm-client", () => {
  const dummyVideoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // mock mp4 header

  beforeEach(() => {
    process.env.SWARM_MODE = "mock";
  });

  it("computes 0x-prefixed 32-byte sha256 correctly", async () => {
    const hash = await computeVideoSha256(dummyVideoBytes);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("uploads video in mock fallback mode with deterministic 64-char reference", async () => {
    const res = await uploadVideo(dummyVideoBytes, {
      filename: "test-walkthrough.webm",
      durationSeconds: 10,
      mimeType: "video/webm",
    });

    expect(res.mode).toBe("mock");
    expect(res.swarmReference).toHaveLength(64);
    expect(res.swarmReference).toMatch(/^[0-9a-f]{64}$/);
    expect(res.videoSha256).toBe(`0x${res.swarmReference}`);
    expect(res.durationSeconds).toBe(10);
    expect(res.sizeBytes).toBe(dummyVideoBytes.length);
    expect(res.swarmUrl).toContain(res.swarmReference);
  });

  it("resolves video URLs correctly for gateway and local records", () => {
    const ref = "a".repeat(64);
    const url = getVideoUrl(ref, "https://gateway.example.com");
    expect(url).toBe(`https://gateway.example.com/bzz/${ref}`);

    // Register local mock
    registerMockVideo(ref, dummyVideoBytes, "video/mp4");
    const rec = getMockVideoRecord(ref);
    expect(rec).toBeDefined();
    expect(rec?.bytes).toEqual(dummyVideoBytes);
  });

  it("isBeeAvailable returns a boolean without throwing", async () => {
    const available = await isBeeAvailable(100);
    expect(typeof available).toBe("boolean");
  });

  it("reads config from environment variables", () => {
    process.env.SWARM_GATEWAY_URL = "http://localhost:1633";
    process.env.SWARM_POSTAGE_BATCH_ID = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    process.env.SWARM_MODE = "live";

    const config = getSwarmConfig();
    expect(config.gatewayUrl).toBe("http://localhost:1633");
    expect(config.postageBatchId).toBe("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    expect(config.mode).toBe("live");
  });
});

