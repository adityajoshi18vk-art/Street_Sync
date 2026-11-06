"use client";

import { useState } from "react";
import { useAccount, useConnect, useSwitchChain, useChainId } from "wagmi";
import { ACTIVE_CHAIN, contractsDeployed } from "@/config/contracts";
import { shortAddress } from "@/lib/types";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const chainId = useChainId();
  const [open, setOpen] = useState(false);

  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN.id;

  if (!isConnected) {
    return (
      <button
        onClick={() => {
          const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
          if (injected) connect({ connector: injected });
        }}
        disabled={isPending}
        className="btn-primary px-4 py-2 text-sm"
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button
          onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}
          disabled={switching}
          className="btn rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300 hover:bg-red-400/20"
        >
          {switching ? "Switching…" : `Switch to ${ACTIVE_CHAIN.name}`}
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              wrongChain ? "bg-red-400" : "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.8)]"
            }`}
          />
          <span className="font-mono text-xs">{shortAddress(address)}</span>
        </button>
        {open && (
          <div className="card absolute right-0 z-50 mt-2 w-60 p-4 text-xs animate-rise">
            <p className="label-micro">Network</p>
            <p className="mb-3 mt-0.5 font-semibold text-slate-100">{ACTIVE_CHAIN.name}</p>
            <p className="label-micro">Wallet</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-slate-300">{address}</p>
            {!contractsDeployed && (
              <p className="alert-warn mt-3 p-2.5 text-[11px]">
                Escrow contracts not configured on this network.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
