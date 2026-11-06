"use client";

import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { shortHex } from "@/lib/janlekha/format";
import { appChain, CONTRACT_ADDRESS } from "@/lib/wallet/chain";
import { describeTxError } from "@/lib/wallet/errors";
import { ROLE_LABELS } from "@/lib/wallet/roles";
import { useRoles } from "./hooks";

export function WalletBar() {
  const connection = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const account = connection.isConnected ? connection.address : undefined;
  const roles = useRoles(account);
  const wrongNetwork = !!account && connection.chainId !== appChain.id;

  if (!account) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {connectors.map((c) => (
          <button
            key={c.uid}
            type="button"
            onClick={() => connect.mutate({ connector: c, chainId: appChain.id })}
            disabled={connect.isPending}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {connect.isPending ? "Connecting…" : `Connect ${c.name === "Injected" ? "wallet" : c.name}`}
          </button>
        ))}
        {connect.error && (
          <span role="alert" className="text-xs text-red-700">
            {(connect.error as Error).name === "ProviderNotFoundError"
              ? "No browser wallet found. Install an EVM wallet such as MetaMask or HashPack."
              : describeTxError(connect.error).message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span
          data-testid="wallet-network"
          className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${wrongNetwork ? "bg-red-50 text-red-800 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
        >
          {wrongNetwork ? `Wrong network (chain ${connection.chainId})` : appChain.name}
        </span>
        <code data-testid="wallet-address" title={account} className="font-mono">{shortHex(account)}</code>
        <span data-testid="wallet-roles" className="text-neutral-600">
          {roles.status === "ready"
            ? roles.roles.size > 0
              ? [...roles.roles].map((r) => ROLE_LABELS[r]).join(", ")
              : "No JanLekha role (citizen)"
            : roles.status === "error"
              ? "Roles unavailable"
              : CONTRACT_ADDRESS ? "Checking roles…" : ""}
        </span>
        <button type="button" onClick={() => disconnect.mutate()} className="text-neutral-500 underline underline-offset-2">
          Disconnect
        </button>
      </div>
      {wrongNetwork && (
        <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs text-red-800">
          <span>Transactions are disabled until your wallet is on {appChain.name}.</span>
          <button
            type="button"
            onClick={() => switchChain.mutate({ chainId: appChain.id })}
            disabled={switchChain.isPending}
            className="rounded-md bg-red-700 px-2 py-1 font-medium text-white disabled:opacity-50"
          >
            {switchChain.isPending ? "Switching…" : `Switch to ${appChain.name}`}
          </button>
          {switchChain.error && <span>{describeTxError(switchChain.error).message}</span>}
        </div>
      )}
    </div>
  );
}
