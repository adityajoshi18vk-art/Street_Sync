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
            className="btn-ghost !px-3 !py-1.5 !text-xs"
          >
            {connect.isPending ? "Connecting…" : `Connect ${c.name === "Injected" ? "wallet" : c.name}`}
          </button>
        ))}
        {connect.error && (
          <span role="alert" className="text-xs text-red-300">
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
          className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${wrongNetwork ? "bg-red-400/10 text-red-300 ring-red-400/30" : "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"}`}
        >
          {wrongNetwork ? `Wrong network (chain ${connection.chainId})` : appChain.name}
        </span>
        <code data-testid="wallet-address" title={account} className="font-mono">{shortHex(account)}</code>
        <span data-testid="wallet-roles" className="text-slate-300">
          {roles.status === "ready"
            ? roles.roles.size > 0
              ? [...roles.roles].map((r) => ROLE_LABELS[r]).join(", ")
              : "No JanLekha role (citizen)"
            : roles.status === "error"
              ? "Roles unavailable"
              : CONTRACT_ADDRESS ? "Checking roles…" : ""}
        </span>
        <button type="button" onClick={() => disconnect.mutate()} className="text-slate-400 underline underline-offset-2">
          Disconnect
        </button>
      </div>
      {wrongNetwork && (
        <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs text-red-300">
          <span>Transactions are disabled until your wallet is on {appChain.name}.</span>
          <button
            type="button"
            onClick={() => switchChain.mutate({ chainId: appChain.id })}
            disabled={switchChain.isPending}
            className="rounded-md bg-gradient-to-b from-red-500 to-red-700 px-2 py-1 font-medium text-white disabled:opacity-50"
          >
            {switchChain.isPending ? "Switching…" : `Switch to ${appChain.name}`}
          </button>
          {switchChain.error && <span>{describeTxError(switchChain.error).message}</span>}
        </div>
      )}
    </div>
  );
}
