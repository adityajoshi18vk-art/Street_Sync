import type { Config } from "wagmi";
import { readContract } from "wagmi/actions";
import { ACTIVE_CHAIN, ESCROW_ABI, ESCROW_ADDRESS, contractsDeployed } from "@/config/contracts";
import { listBounties } from "./api";
import { describeBackendError, filterRows, onChainToRow, recentBountyIds } from "./chain-bounties";
import type { BackendBounty, OnChainBounty } from "./types";

export interface BountyLoadResult {
  rows: BackendBounty[];
  source: "backend" | "chain";
  /** Set when the backend failed, even if the chain fallback succeeded. */
  backendError: string | null;
}

/** Backend index first; if it's unreachable, read bounties straight from the escrow contract. */
export async function loadBounties(
  config: Config,
  params: { status?: number; limit?: number; worker?: string } = {}
): Promise<BountyLoadResult> {
  const limit = params.limit ?? 200;
  try {
    return { rows: await listBounties({ ...params, limit }), source: "backend", backendError: null };
  } catch (e) {
    const backendError = describeBackendError(e);
    if (!contractsDeployed || !ESCROW_ADDRESS) throw new Error(backendError);
    const base = { address: ESCROW_ADDRESS as `0x${string}`, abi: ESCROW_ABI, chainId: ACTIVE_CHAIN.id } as const;
    const next = (await readContract(config, { ...base, functionName: "nextBountyId" })) as bigint;
    const structs = await Promise.all(
      recentBountyIds(next, limit).map(
        (id) => readContract(config, { ...base, functionName: "getBounty", args: [id] }) as Promise<OnChainBounty>
      )
    );
    return { rows: filterRows(structs.map(onChainToRow), params), source: "chain", backendError };
  }
}
