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
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50"
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
          className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-300 transition hover:bg-red-200"
        >
          {switching ? "Switching…" : `Switch to ${ACTIVE_CHAIN.name}`}
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-800 ring-1 ring-gray-200 transition hover:bg-gray-50"
        >
          <span className={`h-2 w-2 rounded-full ${wrongChain ? "bg-red-500" : "bg-emerald-500"}`} />
          {shortAddress(address)}
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl bg-white p-3 text-xs shadow-card ring-1 ring-gray-200">
            <p className="text-gray-400">Network</p>
            <p className="mb-2 font-semibold text-gray-800">{ACTIVE_CHAIN.name}</p>
            <p className="text-gray-400">Wallet</p>
            <p className="mb-2 break-all font-mono text-[11px] text-gray-800">{address}</p>
            {!contractsDeployed && (
              <p className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-amber-700 ring-1 ring-amber-200">
                Escrow contracts not configured on this network.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
