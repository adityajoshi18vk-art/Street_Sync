/**
 * arkiv-relay.ts
 * Server-side Arkiv writer/reader for evidence bundles.
 *
 * Workers never need Rabdi gas or the Arkiv access key: the browser posts the
 * worker-signed bundle here, and the relay writes it as one Arkiv entity only
 * after checking the signature against the on-chain worker of a Claimed bounty.
 * The bundle's own EIP-191 signature and SHA-256 evidenceHash keep it
 * verifiable regardless of which account paid for the write.
 */

import type { FastifyInstance } from "fastify";
import { createPublicClient as createArkivPublicClient, createWalletClient as createArkivWalletClient, ExpirationTime, NoEntityFoundError } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { bytes, defineSchema, str } from "@arkiv-network/sdk/schema";
import { createPublicClient, defineChain, hexToBytes, http, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverWorkerAddress, sha256Bytes32, unpackBundle, MAX_SAFE_BUNDLE_BYTES } from "@streetsync/evidence";
import { ESCROW_ABI } from "./abi.js";
import { getVerifyingContract } from "./signer.js";

const EvidenceSchema = defineSchema("streetsync-evidence", {
  project: str().indexed(),
  entity_type: str().indexed(),
  bounty_id: str().indexed(),
  worker: str().indexed(),
  sha256_prefix: str().indexed(),
  bundle: bytes(),
});

const STATUS_CLAIMED = 1;
// Outlives the 7-day minimum so audits keep working after review settles.
const EVIDENCE_TTL_DAYS = 30;
const MAX_WRITES_PER_BOUNTY = 5;

export interface OnChainBountyView {
  worker: Address;
  status: number;
}

export interface ValidatedEvidence {
  bundle: Uint8Array;
  evidenceHash: Hex;
  attributes: {
    project: string;
    entity_type: string;
    bounty_id: string;
    worker: string;
    sha256_prefix: string;
  };
}

export class EvidenceRejectedError extends Error {}

/** Validates a worker-signed bundle against the bounty's on-chain state. */
export async function validateEvidenceBundle(
  bundle: Uint8Array,
  readBounty: (bountyId: bigint) => Promise<OnChainBountyView>,
): Promise<ValidatedEvidence> {
  if (bundle.length === 0 || bundle.length > MAX_SAFE_BUNDLE_BYTES) {
    throw new EvidenceRejectedError(`Evidence bundle must be 1..${MAX_SAFE_BUNDLE_BYTES} bytes`);
  }
  let unpacked;
  let signer: Address;
  try {
    unpacked = await unpackBundle(bundle);
    signer = await recoverWorkerAddress(bundle);
  } catch (e) {
    throw new EvidenceRejectedError(`Malformed evidence bundle: ${(e as Error).message}`);
  }
  const { metadata } = unpacked;
  if (!/^\d+$/.test(String(metadata.bountyId))) {
    throw new EvidenceRejectedError("Bundle metadata has an invalid bountyId");
  }
  if (metadata.workerAddress.toLowerCase() !== signer.toLowerCase()) {
    throw new EvidenceRejectedError("Bundle signature does not match its workerAddress");
  }
  const bounty = await readBounty(BigInt(metadata.bountyId));
  if (Number(bounty.status) !== STATUS_CLAIMED) {
    throw new EvidenceRejectedError("Bounty is not awaiting evidence");
  }
  if (bounty.worker.toLowerCase() !== signer.toLowerCase()) {
    throw new EvidenceRejectedError("Bundle is not signed by the bounty's worker");
  }
  const evidenceHash = await sha256Bytes32(bundle);
  return {
    bundle,
    evidenceHash,
    attributes: {
      project: "streetsync",
      entity_type: "evidence",
      bounty_id: String(metadata.bountyId),
      worker: signer.toLowerCase(),
      sha256_prefix: evidenceHash.slice(0, 32),
    },
  };
}

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

export function isArkivRelayConfigured(): boolean {
  const key = process.env.ARKIV_PRIVATE_KEY;
  return Boolean(key && isHex(key) && key.length === 66 && process.env.ARKIV_ACCESS_KEY);
}

export function arkivChain() {
  return rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
}

function arcBountyReader() {
  const chainId = Number(process.env.CHAIN_ID ?? "5042002");
  const rpc = chainId === 31337
    ? process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"
    : process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
  const client = createPublicClient({
    chain: defineChain({ id: chainId, name: "settlement", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }),
    transport: http(rpc),
  });
  return async (bountyId: bigint): Promise<OnChainBountyView> => {
    const raw = await client.readContract({
      address: getVerifyingContract(),
      abi: ESCROW_ABI,
      functionName: "getBounty",
      args: [bountyId],
    }) as unknown as OnChainBountyView;
    return { worker: raw.worker, status: Number(raw.status) };
  };
}

export function registerArkivRoutes(app: FastifyInstance): void {
  const writesPerBounty = new Map<string, number>();

  app.post<{ Body: { payload?: unknown } }>("/api/arkiv/entities", { bodyLimit: 512 * 1024 }, async (request, reply) => {
    if (!isArkivRelayConfigured()) {
      return reply.status(503).send({ error: "Arkiv storage is not configured on the backend" });
    }
    const payload = request.body?.payload;
    if (typeof payload !== "string" || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
      return reply.status(400).send({ error: "Expected a base64 evidence payload" });
    }

    let validated: ValidatedEvidence;
    try {
      validated = await validateEvidenceBundle(new Uint8Array(Buffer.from(payload, "base64")), arcBountyReader());
    } catch (e) {
      if (e instanceof EvidenceRejectedError) return reply.status(400).send({ error: e.message });
      request.log.error(e);
      return reply.status(502).send({ error: "Could not verify the bounty on-chain" });
    }

    const bountyId = validated.attributes.bounty_id;
    const count = writesPerBounty.get(bountyId) ?? 0;
    if (count >= MAX_WRITES_PER_BOUNTY) {
      return reply.status(429).send({ error: "Too many evidence uploads for this bounty" });
    }
    writesPerBounty.set(bountyId, count + 1);

    try {
      const wallet = createArkivWalletClient({
        chain: arkivChain(),
        transport: http(),
        account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY as Hex),
      });
      const { entityKey, txHash } = await wallet.createEntity(
        EvidenceSchema,
        { ...validated.attributes, bundle: validated.bundle },
        { expiration: ExpirationTime.fromDays(EVIDENCE_TTL_DAYS) },
      );
      request.log.info({ entityKey, txHash, bountyId }, "Arkiv evidence entity created");
      return reply.send({ entityKey, txHash, evidenceHash: validated.evidenceHash });
    } catch (e) {
      writesPerBounty.set(bountyId, count);
      request.log.error(e);
      return reply.status(502).send({ error: `Arkiv write failed: ${(e as Error).message}` });
    }
  });

  app.get<{ Params: { key: string } }>("/api/arkiv/entities/:key", async (request, reply) => {
    const key = request.params.key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      return reply.status(400).send({ error: "Entity key must be 32-byte hex" });
    }
    try {
      const client = createArkivPublicClient({ chain: arkivChain(), transport: http() });
      const row = await client.getEntity(key as Hex, EvidenceSchema);
      return reply.send({
        entityKey: key,
        payload: bytesToBase64(hexToBytes(row.bundle.value)),
        attributes: {
          project: row.project.value,
          entity_type: row.entity_type.value,
          bounty_id: row.bounty_id.value,
          worker: row.worker.value,
          sha256_prefix: row.sha256_prefix.value,
        },
      });
    } catch (e) {
      if (e instanceof NoEntityFoundError) return reply.status(404).send({ error: "Evidence entity not found or expired" });
      request.log.error(e);
      return reply.status(502).send({ error: "Arkiv read failed" });
    }
  });
}
