import type { BackendBounty, OnChainBounty } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x" + "0".repeat(64);

/** Map an escrow `getBounty` struct onto the backend row shape so one normaliser serves both sources. */
export function onChainToRow(b: OnChainBounty): BackendBounty {
  const worker = b.worker && b.worker.toLowerCase() !== ZERO_ADDRESS ? b.worker.toLowerCase() : null;
  return {
    bounty_id: b.id.toString(),
    creator: b.creator.toLowerCase(),
    description_hash: b.descriptionHash,
    report_hash: b.reportHash && b.reportHash !== ZERO_HASH ? b.reportHash : null,
    has_report: !!b.reportHash && b.reportHash !== ZERO_HASH,
    lat_e5: Number(b.latE5),
    lng_e5: Number(b.lngE5),
    region_cell: Number(b.regionCell),
    total_pledged: b.totalPledged.toString(),
    status: Number(b.status),
    worker,
    claim_deadline: Number(b.claimDeadline),
    validation_deadline: Number(b.validationDeadline),
    work_deadline: Number(b.workDeadline),
    confirmations: Number(b.confirmations),
    disputes: Number(b.disputes),
    // Descriptions live in the backend/Arkiv report, not on-chain.
    description: null
  };
}

export function filterRows(rows: BackendBounty[], params?: { status?: number; worker?: string }): BackendBounty[] {
  const worker = params?.worker?.toLowerCase();
  return rows.filter(
    (r) =>
      (params?.status === undefined || Number(r.status) === params.status) &&
      (!worker || (typeof r.worker === "string" && r.worker.toLowerCase() === worker))
  );
}

/** Newest-first ids to read when the backend index is down, capped at `limit`. */
export function recentBountyIds(nextBountyId: bigint, limit: number): bigint[] {
  const ids: bigint[] = [];
  for (let id = nextBountyId - 1n; id >= 0n && ids.length < limit; id--) ids.push(id);
  return ids;
}

/** Turn a raw fetch failure into something a user can act on. */
export function describeBackendError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) {
    return "the StreetSync server can't be reached";
  }
  return msg;
}
