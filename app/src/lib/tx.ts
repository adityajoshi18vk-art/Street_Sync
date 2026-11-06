"use client";

import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import type { Config } from "wagmi";
import type { Abi, Hash } from "viem";
import { USDC_ABI, USDC_ADDRESS, parseUsdc } from "@/config/contracts";

/** Poll-friendly human labels for the shared step stepper. */
export type TxPhase = "idle" | "signing" | "mining" | "confirmed" | "error";

/**
 * Rule 1 + exact-approve: read the current ERC-20 allowance and, if it is less
 * than the required amount, approve EXACTLY that amount (never a near-infinite
 * grant) and wait for the approval to mine before the caller proceeds.
 */
export async function approveUsdcExact(params: {
  config: Config;
  owner: string;
  spender: string;
  amountUsdc: string;
  writeContractAsync: (args: {
    address: `0x${string}`;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<Hash>;
  onPhase?: (phase: TxPhase, message?: string) => void;
}): Promise<boolean> {
  const { config, owner, spender, amountUsdc, writeContractAsync, onPhase } = params;
  const amount = parseUsdc(amountUsdc);

  const current = (await readContract(config, {
    address: USDC_ADDRESS!,
    abi: USDC_ABI,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`]
  })) as bigint;

  if (current >= amount) return false;

  onPhase?.("signing", `Approve exactly ${amountUsdc} USDC`);
  const hash = await writeContractAsync({
    address: USDC_ADDRESS!,
    abi: USDC_ABI,
    functionName: "approve",
    args: [spender as `0x${string}`, amount]
  });
  onPhase?.("mining", "Waiting for approval confirmation");
  await waitForTransactionReceipt(config, { hash });
  return true;
}

export async function waitTx(config: Config, hash: string): Promise<void> {
  await waitForTransactionReceipt(config, { hash: hash as `0x${string}` });
}
