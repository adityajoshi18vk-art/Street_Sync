"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConfig } from "wagmi";
import { getConnection, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { ContractFunctionArgs, ContractFunctionName, Hex, TransactionReceipt } from "viem";
import { janLekhaAbi } from "@/lib/janlekha/abi";
import { appChain, CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/wallet/chain";
import { describeTxError } from "@/lib/wallet/errors";

type WriteName = ContractFunctionName<typeof janLekhaAbi, "nonpayable">;
type WriteArgs<F extends WriteName> = ContractFunctionArgs<typeof janLekhaAbi, "nonpayable", F>;

export type FailureStage = "preflight" | "wallet" | "reverted" | "unconfirmed";

export type TxState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "awaiting-wallet" }
  | { status: "pending"; hash: Hex }
  | { status: "confirmed"; hash: Hex; blockNumber: bigint }
  | { status: "failed"; stage: FailureStage; message: string; hash?: Hex };

interface LogEntry {
  id: number;
  label: string;
  state: TxState;
}

const TxLogContext = createContext<((id: number, label: string, state: TxState) => void) | null>(null);

/** Keeps a page-level record of transactions, so a confirmation stays visible after its form disappears. */
export function TxActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const update = useCallback((id: number, label: string, state: TxState) => {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.id !== id);
      return [{ id, label, state }, ...rest].sort((a, b) => b.id - a.id).slice(0, 20);
    });
  }, []);
  return (
    <TxLogContext.Provider value={update}>
      {entries.length > 0 && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4" data-testid="tx-activity">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Your transactions on this page</p>
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} data-testid="tx-entry" data-tx-id={e.id} data-status={e.state.status}>
                <p className="text-sm font-medium">{e.label}</p>
                <TxStatus state={e.state} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </TxLogContext.Provider>
  );
}

let nextId = 1;

/**
 * Pre-flight simulate → wallet signature → wait for receipt. Success is only shown after a
 * receipt with status "success"; public reads are refreshed only then.
 */
export function useContractTx(label: string) {
  const config = useConfig();
  const router = useRouter();
  const log = useContext(TxLogContext);
  const [state, setStateRaw] = useState<TxState>({ status: "idle" });
  const idRef = useRef(0);

  const setState = useCallback(
    (s: TxState) => {
      setStateRaw(s);
      if (s.status !== "idle") log?.(idRef.current, label, s);
    },
    [label, log],
  );

  const run = useCallback(
    async <F extends WriteName>(
      functionName: F,
      args: WriteArgs<F>,
      opts?: { onConfirmed?: (receipt: TransactionReceipt) => void; refresh?: boolean },
    ) => {
      idRef.current = nextId++;
      const account = getConnection(config).address;
      if (!CONTRACT_ADDRESS || !account) return;

      setState({ status: "checking" });
      let request;
      try {
        ({ request } = await simulateContract(config, {
          address: CONTRACT_ADDRESS,
          abi: janLekhaAbi,
          functionName,
          args,
          account,
          chainId: appChain.id,
        } as never));
      } catch (error) {
        setState({ status: "failed", stage: "preflight", message: describeTxError(error).message });
        return;
      }

      setState({ status: "awaiting-wallet" });
      let hash: Hex;
      try {
        hash = await writeContract(config, request as never);
      } catch (error) {
        setState({ status: "failed", stage: "wallet", message: describeTxError(error).message });
        return;
      }

      setState({ status: "pending", hash });
      let receipt: TransactionReceipt;
      try {
        receipt = await waitForTransactionReceipt(config, { hash, chainId: appChain.id, timeout: 180_000 });
      } catch {
        // Outcome unknown: do not claim failure or success.
        setState({
          status: "failed",
          stage: "unconfirmed",
          hash,
          message: "No confirmation was received in time. The transaction may still be processed; check the explorer.",
        });
        return;
      }
      if (receipt.status !== "success") {
        setState({ status: "failed", stage: "reverted", hash, message: "The transaction was mined but reverted. No state changed." });
        return;
      }
      setState({ status: "confirmed", hash, blockNumber: receipt.blockNumber });
      opts?.onConfirmed?.(receipt);
      if (opts?.refresh !== false) router.refresh();
    },
    [config, router, setState],
  );

  const busy = state.status === "checking" || state.status === "awaiting-wallet" || state.status === "pending";
  return { state, run, busy };
}

function HashRef({ hash }: { hash: Hex }) {
  const label = <code className="break-all font-mono text-[11px]">{hash}</code>;
  return EXPLORER_URL ? (
    <a href={`${EXPLORER_URL}/transaction/${hash}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {label}
    </a>
  ) : (
    label
  );
}

const STAGE_NOTE: Record<FailureStage, string> = {
  preflight: "The contract rejected this transaction in a pre-flight check against current state. Nothing was sent and no fee was charged.",
  wallet: "Nothing was sent.",
  reverted: "",
  unconfirmed: "The page has not been updated.",
};

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const base = "mt-2 rounded-lg px-3 py-2 text-sm";
  switch (state.status) {
    case "checking":
      return <p data-testid="tx-status" data-status="checking" className={`${base} bg-neutral-100 text-neutral-700`}>Checking the transaction against current contract state…</p>;
    case "awaiting-wallet":
      return <p data-testid="tx-status" data-status="awaiting-wallet" className={`${base} bg-blue-50 text-blue-900`}>Confirm the transaction in your wallet…</p>;
    case "pending":
      return (
        <div data-testid="tx-status" data-status="pending" className={`${base} bg-blue-50 text-blue-900`}>
          <p className="font-semibold">Pending: waiting for network confirmation…</p>
          <p className="mt-0.5 text-xs">Transaction <HashRef hash={state.hash} />. Public records update only after confirmation.</p>
        </div>
      );
    case "confirmed":
      return (
        <div data-testid="tx-status" data-status="confirmed" className={`${base} bg-emerald-50 text-emerald-900`}>
          <p className="font-semibold">Confirmed in block {state.blockNumber.toString()}</p>
          <p className="mt-0.5 text-xs">Transaction <HashRef hash={state.hash} />. Public records refreshed from the contract.</p>
        </div>
      );
    case "failed":
      return (
        <div role="alert" data-testid="tx-status" data-status="failed" data-stage={state.stage} className={`${base} bg-red-50 text-red-900`}>
          <p className="font-semibold">Failed: {state.message}</p>
          {STAGE_NOTE[state.stage] && <p className="mt-0.5 text-xs">{STAGE_NOTE[state.stage]}</p>}
          {state.hash && <p className="mt-0.5 text-xs">Transaction <HashRef hash={state.hash} /></p>}
        </div>
      );
  }
}
