import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { bytesToHex, hexToBytes, recoverMessageAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeRpSignatureMessage } from "@worldcoin/idkit-server";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

const SIGNING_KEY = `0x${"ab".repeat(32)}` as const;
process.env.ATTESTER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
process.env.ATTESTER_SIGNER_ADDRESS = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
process.env.ESCROW_CONTRACT_ADDRESS = "0x3Fd53ce0728BfBDbc5559C4a573f54294FfEa356";
process.env.WORLD_APP_ID = "app_401e8c235a6b3bbd1bc62df14d5c021d";
process.env.WORLD_RP_ID = "rp_63fad5532a28bde4";
process.env.WORLD_RP_SIGNING_KEY = SIGNING_KEY;
process.env.CHAIN_ID = "5042002";

const { registerWorldIdRoutes, validateIdkitResult, WorldIdRequestError } = await import("../src/worldid-v4.js");
const { default: dbAccess } = await import("../src/db.js");

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function proof(wallet: string, nullifier: string, action = "claim-bounty", environment = "production") {
  return {
    protocol_version: "4.0", nonce: "0x01", action, environment,
    responses: [{ identifier: "proof_of_human", signal_hash: hashSignal(wallet.toLowerCase()), nullifier,
      issuer_schema_id: 1, expires_at_min: 1, proof: ["0x1", "0x2", "0x3", "0x4", "0x5"] }],
  };
}

describe("World ID 4.0 backend", () => {
  const app = Fastify();
  const realFetch = globalThis.fetch;
  let portalCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let portalReply: { status: number; body: unknown } = { status: 200, body: { success: true, environment: "production" } };

  before(async () => {
    dbAccess.raw.exec("DELETE FROM nullifiers; DELETE FROM nonces;");
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      portalCalls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(portalReply.body), { status: portalReply.status });
    }) as typeof fetch;
    registerWorldIdRoutes(app);
    await app.ready();
  });
  after(async () => { globalThis.fetch = realFetch; await app.close(); });

  it("matches World's published RP signature message test vector", () => {
    const nonce = hexToBytes("0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd");
    assert.equal(bytesToHex(computeRpSignatureMessage(nonce, 1700000000, 1700000300, "test-action")),
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a");
  });

  it("issues an rp_context signed by the RP signing key for known actions only", async () => {
    const res = await app.inject({ method: "POST", url: "/api/worldid/rp-context", payload: { action: "claim-bounty" } });
    assert.equal(res.statusCode, 200);
    const { rp_context: ctx, app_id } = res.json();
    assert.equal(app_id, "app_401e8c235a6b3bbd1bc62df14d5c021d");
    assert.equal(ctx.rp_id, "rp_63fad5532a28bde4");
    assert.equal(ctx.expires_at - ctx.created_at, 300);
    const message = computeRpSignatureMessage(hexToBytes(ctx.nonce), ctx.created_at, ctx.expires_at, "claim-bounty");
    const signer = await recoverMessageAddress({ message: { raw: message }, signature: ctx.signature });
    assert.equal(signer, privateKeyToAccount(SIGNING_KEY).address);

    const bad = await app.inject({ method: "POST", url: "/api/worldid/rp-context", payload: { action: "anything-else" } });
    assert.equal(bad.statusCode, 400);
  });

  it("rejects proofs for another wallet, action or environment before calling World", () => {
    assert.throws(() => validateIdkitResult(proof(OTHER, "0xaa"), WALLET, "worker", "production"), /not bound to this wallet/);
    assert.throws(() => validateIdkitResult(proof(WALLET, "0xaa", "register-reviewer"), WALLET, "worker", "production"), /different action/);
    assert.throws(() => validateIdkitResult(proof(WALLET, "0xaa", "claim-bounty", "staging"), WALLET, "worker", "production"), /wrong World ID environment/);
    const noSignal = proof(WALLET, "0xaa");
    delete (noSignal.responses[0] as { signal_hash?: string }).signal_hash;
    assert.throws(() => validateIdkitResult(noSignal, WALLET, "worker", "production"), WorldIdRequestError);
  });

  it("verifies through the v4 API, then reuses the verification for later bounties", async () => {
    const before = await app.inject({ method: "POST", url: "/api/worldid/attest", payload: { wallet: WALLET, role: "worker", bountyId: "1" } });
    assert.equal(before.statusCode, 404);

    const res = await app.inject({ method: "POST", url: "/api/worldid/verify",
      payload: { wallet: WALLET, role: "worker", bountyId: "1", idkitResponse: proof(WALLET, "0xbeef") } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(portalCalls.at(-1)?.url, "https://developer.world.org/api/v4/verify/rp_63fad5532a28bde4");
    assert.equal(portalCalls.at(-1)?.body.environment, "production");
    const att = res.json().attestation;
    const signer = await recoverTypedDataAddress({
      domain: { name: "StreetSync", version: "1", chainId: 5042002n, verifyingContract: "0x3Fd53ce0728BfBDbc5559C4a573f54294FfEa356" },
      types: { Attestation: [
        { name: "wallet", type: "address" }, { name: "role", type: "uint8" }, { name: "bountyId", type: "uint256" },
        { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint64" }] },
      primaryType: "Attestation",
      message: { wallet: WALLET, role: 1, bountyId: 1n, nonce: BigInt(att.nonce), expiry: BigInt(att.expiry) },
      signature: att.signature,
    });
    assert.equal(signer, "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");

    const calls = portalCalls.length;
    const again = await app.inject({ method: "POST", url: "/api/worldid/attest", payload: { wallet: WALLET, role: "worker", bountyId: "2" } });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().attestation.bountyId, "2");
    assert.equal(portalCalls.length, calls, "re-issue must not need a new World ID proof");

    const reviewer = await app.inject({ method: "POST", url: "/api/worldid/attest", payload: { wallet: WALLET, role: "reviewer", bountyId: "0" } });
    assert.equal(reviewer.statusCode, 404, "worker verification must not grant reviewer role");
  });

  it("refuses to link one World ID to a second wallet", async () => {
    const res = await app.inject({ method: "POST", url: "/api/worldid/verify",
      payload: { wallet: OTHER, role: "worker", bountyId: "1", idkitResponse: proof(OTHER, "0xbeef") } });
    assert.equal(res.statusCode, 409);
  });

  it("issues nothing when World rejects the proof", async () => {
    portalReply = { status: 400, body: { success: false, code: "all_verifications_failed", detail: "bad proof" } };
    const res = await app.inject({ method: "POST", url: "/api/worldid/verify",
      payload: { wallet: OTHER, role: "reviewer", bountyId: "0", idkitResponse: proof(OTHER, "0xcafe", "register-reviewer") } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "all_verifications_failed");
    assert.equal(dbAccess.findVerifiedWallet("register-reviewer", OTHER), undefined);
  });
});
