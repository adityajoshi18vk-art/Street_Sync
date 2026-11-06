import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import sharp from "sharp";
import { zeroAddress } from "viem";
import { descriptionHashOf, packReport, type ReportInput } from "@streetsync/evidence";
import {
  registerReportRoutes, reportAttributes, validateReportBundle, ReportRejectedError,
  type ArkivReportGateway, type ReportBountyView, type ReportRelayDeps,
} from "../src/report-relay.js";
import type { StoredReport } from "../src/db.js";

const CREATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const ESCROW = "0x3Fd53ce0728BfBDbc5559C4a573f54294FfEa356" as const;
const DESCRIPTION = "Broken streetlight at the corner of 5th and Main";

let photo: Uint8Array;
before(async () => {
  photo = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 40 } } }).webp().toBuffer());
});

async function makeReport(over: Partial<ReportInput> = {}) {
  const input: ReportInput = { creator: CREATOR, description: DESCRIPTION, latE5: 4001200, lngE5: -7513000, capturedAtMs: 1_700_000_000_000, photo, ...over };
  return packReport(input);
}

function chainFor(r: { reportHash: `0x${string}`; descriptionHash: `0x${string}` }, over: Partial<ReportBountyView> = {}): ReportBountyView {
  return { creator: CREATOR, descriptionHash: r.descriptionHash, reportHash: r.reportHash, latE5: 4001200, lngE5: -7513000, ...over };
}
const reader = (b: ReportBountyView) => async () => b;
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("validateReportBundle", () => {
  it("accepts a bundle that matches every on-chain commitment", async () => {
    const r = await makeReport();
    const v = await validateReportBundle(r.bundle, 7n, reader(chainFor(r)));
    assert.equal(v.reportHash, r.reportHash);
    assert.equal(v.report.description, DESCRIPTION);
    assert.equal(v.report.creator, CREATOR);
  });

  it("compares the creator case-insensitively", async () => {
    const r = await makeReport();
    await validateReportBundle(r.bundle, 7n, reader(chainFor(r, { creator: CREATOR.toLowerCase() as `0x${string}` })));
  });

  it("rejects garbage and oversized payloads before reading the chain", async () => {
    let reads = 0;
    const counting = async () => { reads++; return chainFor(await makeReport()); };
    await assert.rejects(validateReportBundle(new Uint8Array(20), 1n, counting), /Malformed/);
    await assert.rejects(validateReportBundle(new Uint8Array(64_001), 1n, counting), /must be/);
    await assert.rejects(validateReportBundle(new Uint8Array(0), 1n, counting), ReportRejectedError);
    assert.equal(reads, 0);
  });

  it("returns 404-class rejection when the bounty does not exist", async () => {
    const r = await makeReport();
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r, { creator: zeroAddress }))),
      (e: unknown) => e instanceof ReportRejectedError && e.status === 404);
  });

  it("rejects hash, creator, description and location mismatches", async () => {
    const r = await makeReport();
    const other = await makeReport({ capturedAtMs: 1_700_000_000_001 });
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(other))), /reportHash/);
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r, { creator: OTHER }))), /creator/);
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r, { descriptionHash: descriptionHashOf("something else entirely") }))), /description/);
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r, { latE5: 4001201 }))), /location/);
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r, { lngE5: 0 }))), /location/);
  });

  it("rejects a bundle whose own creator differs from the on-chain creator even if the hash matches", async () => {
    const r = await makeReport({ creator: OTHER });
    await assert.rejects(validateReportBundle(r.bundle, 7n, reader(chainFor(r))), /creator/);
  });

  it("rejects a bundle with a tampered byte (hash or parse failure)", async () => {
    const r = await makeReport();
    const bad = new Uint8Array(r.bundle);
    bad[bad.length - 5] ^= 0xff;
    await assert.rejects(validateReportBundle(bad, 7n, reader(chainFor(r))), ReportRejectedError);
  });
});

function fakeGateway(initial: Array<{ entityKey: string; bundle: Uint8Array }> = []) {
  const stored = [...initial];
  const calls = { create: 0, find: 0 };
  const state = { write: true, read: true, failCreate: false };
  const gw: ArkivReportGateway = {
    canWrite: () => state.write,
    canRead: () => state.read,
    async find() { calls.find++; return [...stored]; },
    async create(attrs, bundle) {
      calls.create++;
      if (state.failCreate) throw new Error("rabdi down");
      const entityKey = `0x${(stored.length + 1).toString(16).padStart(64, "0")}`;
      stored.push({ entityKey, bundle });
      lastAttrs = attrs;
      return { entityKey, txHash: "0xabc" };
    },
  };
  let lastAttrs: unknown;
  return { gw, calls, state, stored, get lastAttrs() { return lastAttrs; } };
}

function fakeDb() {
  const rows = new Map<string, StoredReport>();
  return { rows, db: { getReport: (id: string) => rows.get(id), upsertReport: (r: StoredReport) => { rows.set(r.bounty_id, r); } } as unknown as ReportRelayDeps["db"] };
}

async function build(over: { chain?: ReportBountyView; gateway?: ReturnType<typeof fakeGateway>; escrow?: () => `0x${string}` } = {}) {
  const r = await makeReport();
  const gateway = over.gateway ?? fakeGateway();
  const { rows, db } = fakeDb();
  const app = Fastify();
  registerReportRoutes(app, {
    readBounty: async () => over.chain ?? chainFor(r),
    arkiv: gateway.gw, chainId: 5042002, escrow: over.escrow ?? (() => ESCROW), db,
  });
  await app.ready();
  return { app, r, gateway, rows };
}

describe("report relay routes", () => {
  it("stores a valid report once on Arkiv with the specified attributes and is idempotent", async () => {
    const { app, r, gateway, rows } = await build();
    const post = () => app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(r.bundle) } });

    const first = await post();
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), { entityKey: `0x${"1".padStart(64, "0")}`, txHash: "0xabc", reportHash: r.reportHash, alreadyStored: false });
    assert.deepEqual(gateway.lastAttrs, {
      project: "streetsync", entity_type: "report", chain_id: "5042002", escrow: ESCROW.toLowerCase(),
      bounty_id: "7", creator: CREATOR.toLowerCase(), sha256_prefix: r.reportHash.slice(0, 32),
    });
    assert.ok(rows.has("7"));

    const second = await post();
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), { entityKey: first.json().entityKey, txHash: null, reportHash: r.reportHash, alreadyStored: true });
    assert.equal(gateway.calls.create, 1);
    await app.close();
  });

  it("serialises concurrent uploads into one Arkiv write", async () => {
    const { app, r, gateway } = await build();
    const results = await Promise.all([1, 2, 3].map(() =>
      app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(r.bundle) } })));
    assert.deepEqual(results.map((x) => x.json().alreadyStored).sort(), [false, true, true]);
    assert.equal(gateway.calls.create, 1);
    await app.close();
  });

  it("does not write again when Arkiv already holds a valid entity but the cache is empty", async () => {
    const r = await makeReport();
    const gateway = fakeGateway([{ entityKey: "0xjunk", bundle: new Uint8Array(10) }, { entityKey: `0x${"9".padStart(64, "0")}`, bundle: r.bundle }]);
    const { app } = await build({ gateway });
    const res = await app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(r.bundle) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().alreadyStored, true);
    assert.equal(res.json().entityKey, `0x${"9".padStart(64, "0")}`);
    assert.equal(gateway.calls.create, 0);
    await app.close();
  });

  it("maps failures to 400 / 404 / 502 / 503", async () => {
    const { app, r } = await build();
    const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/arkiv/reports", payload });
    assert.equal((await post({ bountyId: "abc", payload: b64(r.bundle) })).statusCode, 400);
    assert.equal((await post({ bountyId: "7", payload: "***" })).statusCode, 400);
    assert.equal((await post({ bountyId: "7", payload: b64(new Uint8Array(40)) })).statusCode, 400);
    await app.close();

    const mismatch = await build({ chain: { ...chainFor(await makeReport()), latE5: 1 } });
    assert.equal((await mismatch.app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(mismatch.r.bundle) } })).statusCode, 400);
    await mismatch.app.close();

    const missing = await build({ chain: { ...chainFor(await makeReport()), creator: zeroAddress } });
    assert.equal((await missing.app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(missing.r.bundle) } })).statusCode, 404);
    await missing.app.close();

    const failing = fakeGateway(); failing.state.failCreate = true;
    const w = await build({ gateway: failing });
    const res = await w.app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(w.r.bundle) } });
    assert.equal(res.statusCode, 502);
    assert.equal(w.rows.size, 0, "nothing cached when the write failed");
    await w.app.close();

    const off = fakeGateway(); off.state.write = false;
    const o = await build({ gateway: off });
    assert.equal((await o.app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(o.r.bundle) } })).statusCode, 503);
    await o.app.close();

    const noEscrow = await build({ escrow: () => { throw new Error("unset"); } });
    assert.equal((await noEscrow.app.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(noEscrow.r.bundle) } })).statusCode, 503);
    await noEscrow.app.close();

    const rpcDown = Fastify();
    registerReportRoutes(rpcDown, { readBounty: async () => { throw new Error("rpc 429"); }, arkiv: fakeGateway().gw, chainId: 1, escrow: () => ESCROW, db: fakeDb().db });
    assert.equal((await rpcDown.inject({ method: "POST", url: "/api/arkiv/reports", payload: { bountyId: "7", payload: b64(r.bundle) } })).statusCode, 502);
    await rpcDown.close();
  });

  it("GET serves a cached report, falls back to Arkiv on a miss (re-validating and caching), else 404", async () => {
    const r = await makeReport();
    const gateway = fakeGateway([{ entityKey: "0xevil", bundle: (await makeReport({ description: "A different problem entirely" })).bundle }]);
    const { app, rows } = await build({ gateway });

    const none = await app.inject({ method: "GET", url: "/api/bounties/7/report" });
    assert.equal(none.statusCode, 404);
    assert.ok(none.json().error);
    assert.equal(rows.size, 0, "an entity that fails validation is never cached");

    gateway.stored.push({ entityKey: `0x${"5".padStart(64, "0")}`, bundle: r.bundle });
    const miss = await app.inject({ method: "GET", url: "/api/bounties/7/report" });
    assert.equal(miss.statusCode, 200, miss.body);
    assert.deepEqual(miss.json(), {
      bountyId: "7", entityKey: `0x${"5".padStart(64, "0")}`, reportHash: r.reportHash, description: DESCRIPTION, creator: CREATOR,
      latE5: 4001200, lngE5: -7513000, capturedAtMs: 1_700_000_000_000, photoBase64: b64(photo), photoMime: "image/webp",
    });
    assert.ok(rows.has("7"));

    const finds = gateway.calls.find;
    const hit = await app.inject({ method: "GET", url: "/api/bounties/7/report" });
    assert.equal(hit.statusCode, 200);
    assert.equal(gateway.calls.find, finds, "cache hit must not query Arkiv");

    assert.equal((await app.inject({ method: "GET", url: "/api/bounties/x/report" })).statusCode, 400);
    await app.close();
  });

  it("builds the documented Arkiv attributes", async () => {
    const r = await makeReport();
    const v = await validateReportBundle(r.bundle, 3n, reader(chainFor(r)));
    assert.deepEqual(reportAttributes(v, 31337, ESCROW, 3n), {
      project: "streetsync", entity_type: "report", chain_id: "31337", escrow: ESCROW.toLowerCase(), bounty_id: "3",
      creator: CREATOR.toLowerCase(), sha256_prefix: r.reportHash.slice(0, 32),
    });
    assert.equal(r.reportHash.slice(0, 32).length, 32);
  });
});
