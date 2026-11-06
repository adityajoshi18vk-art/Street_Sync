"use client";

import { useState } from "react";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { USDC_ABI, USDC_ADDRESS, formatUsdcDisplay, parseUsdc, usesMockUsdc } from "@/config/contracts";

const MINT_AMOUNT = "100";

/** Lets demo users mint MockUSDC (public mint) so they can fund bounties and stake. */
export function TestUsdcFaucet() {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: balance, refetch } = useReadContract({
    address: USDC_ADDRESS ?? undefined,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: usesMockUsdc && !!address }
  });

  const token = USDC_ADDRESS;
  if (!usesMockUsdc || !isConnected || !address || !token) return null;

  const mint = async () => {
    setError(null);
    setMinting(true);
    try {
      const hash = await writeContractAsync({
        address: token,
        abi: USDC_ABI,
        functionName: "mint",
        args: [address, parseUsdc(MINT_AMOUNT)]
      });
      await waitForTransactionReceipt(config, { hash });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="card-inset flex items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="min-w-0 text-xs">
        <p className="label-micro">Test USDC balance</p>
        <p className="mt-0.5 font-mono text-zinc-200">
          {typeof balance === "bigint" ? formatUsdcDisplay(balance) : "—"}
        </p>
        {error && <p className="mt-1 truncate text-red-300">{error}</p>}
      </div>
      <button onClick={mint} disabled={minting} className="btn-ghost btn-sm shrink-0">
        {minting && <span className="spinner spinner-sm" aria-hidden />}
        {minting ? "Minting…" : `Get ${MINT_AMOUNT} test USDC`}
      </button>
    </div>
  );
}
