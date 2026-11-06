"use client";

import { useState } from "react";
import { useAccount, useConnect, useSwitchChain, useDisconnect, useChainId } from "wagmi";
import { ChevronDown, TriangleAlert, Wallet } from "lucide-react";
import { ACTIVE_CHAIN, contractsDeployed } from "@/config/contracts";
import { shortAddress } from "@/lib/types";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const [open, setOpen] = useState(false);

  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN.id;

  if (!isConnected) {
    return (
      <div>
      <button
        onClick={() => {
          const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
          if (injected) connect({ connector: injected, chainId: ACTIVE_CHAIN.id });
        }}
        disabled={isPending}
        className="btn-primary btn-sm"
      >
        {isPending ? (
          <>
            <span className="spinner spinner-sm spinner-inherit" />
            Connecting…
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            Connect Wallet
          </>
        )}
      </button>
      {connectError && <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">{connectError.message}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {switchError && <p role="alert" className="max-w-xs text-xs text-red-700">{switchError.message}</p>}
      {wrongChain && (
        <button
          onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}
          disabled={switching}
          className="btn btn-sm border border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20"
        >
          <TriangleAlert className="h-4 w-4" aria-hidden />
          {switching ? "Switching…" : `Switch to ${ACTIVE_CHAIN.name}`}
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[2rem] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-sm font-semibold text-zinc-200 transition hover:border-white/30 hover:bg-white/10"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              wrongChain ? "bg-red-400" : "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.8)]"
            }`}
          />
          <span className="font-mono text-xs">{shortAddress(address)}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {open && (
          <div className="card absolute right-0 z-50 mt-2 w-60 p-4 text-xs animate-rise">
            <p className="label-micro">Network</p>
            <p className="mb-3 mt-0.5 font-semibold text-zinc-100">{ACTIVE_CHAIN.name}</p>
            <p className="label-micro">Wallet</p>
            <p className="mb-3 mt-0.5 break-all font-mono text-[11px] text-zinc-300">{address}</p>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="btn-ghost btn-sm w-full text-xs text-red-400 hover:text-red-300"
            >
              Disconnect
            </button>
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
