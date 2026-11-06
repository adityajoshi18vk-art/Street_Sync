/**
 * report-relay.ts
 * Problem-report bundles (photo + description) → Arkiv.
 *
 * The reporter commits `reportHash = sha256(bundle)` on-chain in createBounty, so the hash
 * authenticates the bundle and the relay only has to check it against the chain before paying
 * for the Arkiv write. Verified bundles are cached in SQLite; Arkiv is the durable copy and
 * the source for cache misses.
 *
 * All chain, Arkiv and DB access is injectable so the routes are testable offline.
 */

import type { FastifyInstance } from "fastify";
import { createPublicClient as createArkivPublicClient, createWalletClient as createArkivWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { and, eq } from "@arkiv-network/sdk/query";
import { bytes, defineSchema, str } from "@arkiv-network/sdk/schema";
import { getAddress, hexToBytes, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  descriptionHashOf,
  REPORT_MAX_BYTES,
  sha256Bytes32,
  unpackReport,
  type ReportData,
} from "@streetsync/evidence";
import { arkivChain, isArkivRelayConfigured } from "./arkiv-relay.js";
import { bountyExists, readBountyOnChain, type OnChainBounty } from "./chain.js";
import dbAccess, { type StoredReport } from "./db.js";
import { getVerifyingContract } from "./signer.js";

const ReportSchema = defineSchema("streetsync-report", {
  project: str().indexed(),
  entity_type: str().indexed(),
  chain_id: str().indexed(),
  escrow: str().indexed(),
  bounty_id: str().indexed(),
  creator: str().indexed(),
  sha256_prefix: str().indexed(),
  bundle: bytes(),
});

const REPORT_TTL_DAYS = 60;
const MAX_CANDIDATES = 10;
const MAX_BODY_BYTES = 256 * 1024;

export type ReportBountyView = Pick<OnChainBounty, "creator" | "descriptionHash" | "reportHash" | "latE5" | "lngE5">;

export class ReportRejectedError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
  }
}

export interface ValidatedReport {
  bundle: Uint8Array;
  reportHash: Hex;
  report: ReportData;
}

/** Checks a bundle against the bounty's on-chain commitments. Throws ReportRejectedError. */
export async function validateReportBundle(
  bundle: Uint8Array,
  bountyId: bigint,
  readBounty: (bountyId: bigint) => Promise<ReportBountyView>,
): Promise<ValidatedReport> {
  if (bundle.length === 0 || bundle.length > REPORT_MAX_BYTES) {
    throw new ReportRejectedError(`Report bundle must be 1..${REPORT_MAX_BYTES} bytes`);
  }
  let report: ReportData;
  try {
    report = await unpackReport(bundle);
  } catch (e) {
    throw new ReportRejectedError(`Malformed report bundle: ${(e as Error).message}`);
  }

  const bounty = await readBounty(bountyId);
  if (!bountyExists(bounty)) throw new ReportRejectedError("Bounty not found on-chain", 404);

  const reportHash = (await sha256Bytes32(bundle)) as Hex;
  if (reportHash.toLowerCase() !== bounty.reportHash.toLowerCase()) {
    throw new ReportRejectedError("Report hash does not match the bounty's on-chain reportHash");
  }
  if (report.creator.toLowerCase() !== bounty.creator.toLowerCase()) {
    throw new ReportRejectedError("Report creator does not match the bounty's on-chain creator");
  }
  if (descriptionHashOf(report.description).toLowerCase() !== bounty.descriptionHash.toLowerCase()) {
    throw new ReportRejectedError("Report description does not match the bounty's on-chain descriptionHash");
  }
  if (report.latE5 !== bounty.latE5 || report.lngE5 !== bounty.lngE5) {
    throw new ReportRejectedError("Report location does not match the bounty's on-chain location");
  }
  return { bundle, reportHash, report };
}

// ─── Arkiv gateway ───────────────────────────────────────────────────────────

export interface ReportAttributes {
  project: string;
  entity_type: string;
  chain_id: string;
  escrow: string;
  bounty_id: string;
  creator: string;
  sha256_prefix: string;
}

export interface ArkivReportGateway {
  canWrite(): boolean;
  canRead(): boolean;
  find(scope: { chainId: number; escrow: string; bountyId: string }): Promise<Array<{ entityKey: string; bundle: Uint8Array }>>;
  create(attributes: ReportAttributes, bundle: Uint8Array): Promise<{ entityKey: string; txHash: string | null }>;
}

export function reportAttributes(
  v: ValidatedReport, chainId: number, escrow: string, bountyId: bigint,
): ReportAttributes {
  return {
    project: "streetsync",
    entity_type: "report",
    chain_id: String(chainId),
    escrow: escrow.toLowerCase(),
    bounty_id: bountyId.toString(),
    creator: v.report.creator.toLowerCase(),
    sha256_prefix: v.reportHash.slice(0, 32),
  };
}

export const rabdiReportGateway: ArkivReportGateway = {
  canWrite: isArkivRelayConfigured,
  canRead: () => Boolean(process.env.ARKIV_ACCESS_KEY),
  async find({ chainId, escrow, bountyId }) {
    const client = createArkivPublicClient({ chain: arkivChain(), transport: http() });
    const page = await client
      .select()
      .from(ReportSchema)
      .where(and(eq("escrow", escrow.toLowerCase()), eq("chain_id", String(chainId)), eq("bounty_id", bountyId)))
      .limit(MAX_CANDIDATES)
      .fetch();
    return page.entities.map((row) => ({ entityKey: row.$key as string, bundle: hexToBytes(row.bundle.value as Hex) }));
  },
  async create(attributes, bundle) {
    const wallet = createArkivWalletClient({
      chain: arkivChain(),
      transport: http(),
      account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY as Hex),
    });
    const { entityKey, txHash } = await wallet.createEntity(
      ReportSchema,
      { ...attributes, bundle },
      { expiration: ExpirationTime.fromDays(REPORT_TTL_DAYS) },
    );
    return { entityKey, txHash };
  },
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export interface ReportRelayDeps {
  readBounty: (bountyId: bigint) => Promise<ReportBountyView>;
  arkiv: ArkivReportGateway;
  chainId: number;
  /** Escrow the indexer/signer is bound to; throws when not configured. */
  escrow: () => Address;
  db: Pick<typeof dbAccess, "getReport" | "upsertReport">;
  isMockGateway?: boolean;
}

export function defaultReportRelayDeps(): ReportRelayDeps {
  return {
    readBounty: readBountyOnChain,
    arkiv: rabdiReportGateway,
    chainId: Number(process.env.CHAIN_ID ?? "5042002"),
    escrow: getVerifyingContract,
    db: dbAccess,
    isMockGateway: false,
  };
}

function parseBountyId(raw: unknown): bigint | null {
  return typeof raw === "string" && /^\d{1,30}$/.test(raw) ? BigInt(raw) : null;
}

function toStored(v: ValidatedReport, bountyId: bigint, entityKey: string): StoredReport {
  return {
    bounty_id: bountyId.toString(),
    entity_key: entityKey,
    report_hash: v.reportHash,
    creator: v.report.creator,
    description: v.report.description,
    lat_e5: v.report.latE5,
    lng_e5: v.report.lngE5,
    captured_at_ms: v.report.capturedAtMs,
    photo: v.report.photo,
  };
}

function publicReport(r: StoredReport) {
  return {
    bountyId: r.bounty_id,
    entityKey: r.entity_key,
    reportHash: r.report_hash,
    description: r.description,
    creator: getAddress(r.creator),
    latE5: Number(r.lat_e5),
    lngE5: Number(r.lng_e5),
    capturedAtMs: Number(r.captured_at_ms),
    photoBase64: Buffer.from(r.photo).toString("base64"),
    photoMime: "image/webp" as const,
  };
}

export function registerReportRoutes(app: FastifyInstance, deps: ReportRelayDeps = defaultReportRelayDeps()): void {
  const inflight = new Map<string, Promise<unknown>>();

  /** Serialises work per bounty so concurrent uploads cannot create two entities. */
  async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = inflight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    inflight.set(key, run);
    try {
      return await run;
    } finally {
      if (inflight.get(key) === run) inflight.delete(key);
    }
  }

  app.post<{ Body: { bountyId?: unknown; payload?: unknown } }>(
    "/api/arkiv/reports",
    { bodyLimit: MAX_BODY_BYTES },
    async (request, reply) => {
      const bountyId = parseBountyId(request.body?.bountyId);
      const payload = request.body?.payload;
      if (bountyId === null) return reply.status(400).send({ error: "bountyId must be a decimal string" });
      if (typeof payload !== "string" || !payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
        return reply.status(400).send({ error: "Expected a base64 report payload" });
      }

      let escrow: Address;
      try {
        escrow = deps.escrow();
      } catch {
        return reply.status(503).send({ error: "Escrow contract is not configured on the backend" });
      }

      let validated: ValidatedReport;
      try {
        validated = await validateReportBundle(new Uint8Array(Buffer.from(payload, "base64")), bountyId, deps.readBounty);
      } catch (e) {
        if (e instanceof ReportRejectedError) return reply.status(e.status).send({ error: e.message });
        request.log.error(e);
        return reply.status(502).send({ error: "Could not verify the bounty on-chain" });
      }

      const id = bountyId.toString();
      try {
        return await exclusive(id, async () => {
          const cached = deps.db.getReport(id);
          if (cached) {
            return reply.send({ entityKey: cached.entity_key, txHash: null, reportHash: cached.report_hash, alreadyStored: true });
          }
          if (!deps.arkiv.canWrite()) {
            if (deps.isMockGateway === false && process.env.ALLOW_DEV_ARKIV_BYPASS === "true") {
              const entityKey = validated.reportHash;
              deps.db.upsertReport(toStored(validated, bountyId, entityKey));
              request.log.info({ entityKey, bountyId: id }, "Report stored in local SQLite database cache (ALLOW_DEV_ARKIV_BYPASS enabled)");
              return reply.send({ entityKey, txHash: null, reportHash: validated.reportHash, alreadyStored: false });
            }
            return reply.status(503).send({ error: "Arkiv storage is not configured on the backend" });
          }
          // The cache may have been rebuilt; never write a second entity if Arkiv already has one.
          const existing = await findValid(deps, escrow, bountyId, request.log);
          if (existing) {
            deps.db.upsertReport(toStored(existing.validated, bountyId, existing.entityKey));
            return reply.send({ entityKey: existing.entityKey, txHash: null, reportHash: existing.validated.reportHash, alreadyStored: true });
          }
          const { entityKey, txHash } = await deps.arkiv.create(reportAttributes(validated, deps.chainId, escrow, bountyId), validated.bundle);
          deps.db.upsertReport(toStored(validated, bountyId, entityKey));
          request.log.info({ entityKey, txHash, bountyId: id }, "Arkiv report entity created");
          return reply.send({ entityKey, txHash, reportHash: validated.reportHash, alreadyStored: false });
        });
      } catch (e) {
        request.log.error(e);
        return reply.status(502).send({ error: `Arkiv write failed: ${(e as Error).message}` });
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/bounties/:id/report", async (request, reply) => {
    const bountyId = parseBountyId(request.params.id);
    if (bountyId === null) return reply.status(400).send({ error: "Invalid bounty id" });
    const id = bountyId.toString();

    const cached = deps.db.getReport(id);
    if (cached) return reply.send(publicReport(cached));

    let escrow: Address;
    try {
      escrow = deps.escrow();
    } catch {
      return reply.status(404).send({ error: "Report not uploaded yet" });
    }
    if (!deps.arkiv.canRead()) {
      if (deps.isMockGateway === false && process.env.ALLOW_DEV_ARKIV_BYPASS === "true") {
        return reply.status(404).send({ error: "Report not uploaded yet" });
      }
      return reply.status(503).send({ error: "Arkiv storage is not configured on the backend" });
    }

    try {
      const found = await exclusive(id, async () => {
        const hit = await findValid(deps, escrow, bountyId, request.log);
        if (hit) deps.db.upsertReport(toStored(hit.validated, bountyId, hit.entityKey));
        return hit;
      });
      if (!found) return reply.status(404).send({ error: "Report not uploaded yet" });
      return reply.send(publicReport(deps.db.getReport(id)!));
    } catch (e) {
      request.log.error(e);
      return reply.status(502).send({ error: "Could not load the report from Arkiv" });
    }
  });
}

/**
 * First Arkiv entity for this bounty whose bundle validates against the chain. Anyone can write
 * entities with matching attributes, so non-validating candidates are skipped, not trusted.
 */
async function findValid(
  deps: ReportRelayDeps,
  escrow: Address,
  bountyId: bigint,
  log: { warn: (o: object, m: string) => void },
): Promise<{ entityKey: string; validated: ValidatedReport } | null> {
  const candidates = await deps.arkiv.find({ chainId: deps.chainId, escrow, bountyId: bountyId.toString() });
  for (const c of candidates) {
    try {
      return { entityKey: c.entityKey, validated: await validateReportBundle(c.bundle, bountyId, deps.readBounty) };
    } catch (e) {
      if (!(e instanceof ReportRejectedError)) throw e;
      log.warn({ entityKey: c.entityKey, reason: e.message }, "Ignoring Arkiv report entity that fails validation");
    }
  }
  return null;
}
