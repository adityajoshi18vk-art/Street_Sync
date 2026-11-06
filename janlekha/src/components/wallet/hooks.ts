"use client";

import { useBlock, useConnection, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { janLekhaAbi } from "@/lib/janlekha/abi";
import { appChain, CONTRACT_ADDRESS } from "@/lib/wallet/chain";
import { ROLE_IDS, ROLE_LABELS, ROLE_NAMES, type RoleName } from "@/lib/wallet/roles";

export type RolesState =
  | { status: "idle" | "loading" }
  | { status: "error" }
  | { status: "ready"; roles: ReadonlySet<RoleName> };

/** Reads the connected account's roles from the contract through the app RPC. */
export function useRoles(account: Address | undefined): RolesState {
  const { data, status } = useReadContracts({
    contracts: ROLE_NAMES.map((name) => ({
      address: CONTRACT_ADDRESS!,
      abi: janLekhaAbi,
      functionName: "hasRole" as const,
      args: [ROLE_IDS[name], account!] as const,
      chainId: appChain.id,
    })),
    allowFailure: false,
    query: { enabled: !!account && !!CONTRACT_ADDRESS, staleTime: 15_000 },
  });
  if (!account || !CONTRACT_ADDRESS) return { status: "idle" };
  if (status === "pending") return { status: "loading" };
  if (status === "error" || !data) return { status: "error" };
  return { status: "ready", roles: new Set(ROLE_NAMES.filter((_, i) => data[i])) };
}

/** Latest block timestamp; deadlines are enforced against chain time, not the browser clock. */
export function useChainTime(fallback: bigint): bigint {
  const { data } = useBlock({ chainId: appChain.id, query: { refetchInterval: 4_000 } });
  return data?.timestamp ?? fallback;
}

export interface WriteGate {
  /** Why no write is possible right now, or null when the wallet is ready. */
  reason: string | null;
  account: Address | undefined;
  roles: ReadonlySet<RoleName>;
  /** Explanation when the account lacks `role`, else null. */
  needRole: (role: RoleName, action: string) => string | null;
}

export function useWriteGate(): WriteGate {
  const connection = useConnection();
  const account = connection.isConnected ? connection.address : undefined;
  const rolesState = useRoles(account);
  const roles = rolesState.status === "ready" ? rolesState.roles : new Set<RoleName>();

  let reason: string | null = null;
  if (!CONTRACT_ADDRESS) reason = "No JanLekha contract address is configured, so no transactions can be sent.";
  else if (!account) reason = "Connect a wallet to perform this action.";
  else if (connection.chainId !== appChain.id) {
    reason = `Wrong network: your wallet is on chain ${connection.chainId}. Switch to ${appChain.name} (chain ${appChain.id}).`;
  } else if (rolesState.status === "loading" || rolesState.status === "idle") reason = "Checking your roles on the contract…";
  else if (rolesState.status === "error") reason = "Could not read your roles from the contract. The RPC endpoint may be unavailable.";

  return {
    reason,
    account,
    roles,
    needRole: (role, action) =>
      roles.has(role) ? null : `Your account does not hold ${ROLE_LABELS[role]} role (${role}), which is required to ${action}.`,
  };
}
