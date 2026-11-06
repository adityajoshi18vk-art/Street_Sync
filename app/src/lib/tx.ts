"use client";

import { getAccount, getBytecode, readContract, waitForTransactionReceipt } from "wagmi/actions";
import type { Config } from "wagmi";
import { erc20Abi, type Abi, type Hash } from "viem";
import {
  ACTIVE_CHAIN, ESCROW_ABI, ESCROW_ADDRESS, USDC_ABI, USDC_ADDRESS,
  assertContractsConfigured, parseUsdc, resolveAddress
} from "../config/contracts";

export type TxPhase = "idle" | "signing" | "mining" | "confirmed" | "error";

export function assertTransactionReady(config: Config): void {
  assertContractsConfigured();
  const account = getAccount(config);
  if (!account.isConnected) throw new Error("Connect your wallet before sending a transaction.");
  if (account.chainId !== ACTIVE_CHAIN.id) throw new Error("Switch your wallet to " + ACTIVE_CHAIN.name + ".");
}

/** Approve only the exact six-decimal amount after validating the deployment. */
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
    chainId?: typeof ACTIVE_CHAIN.id;
  }) => Promise<Hash>;
  onPhase?: (phase: TxPhase, message?: string) => void;
}): Promise<boolean> {
  const { config, owner, spender, amountUsdc, writeContractAsync, onPhase } = params;
  assertTransactionReady(config);
  if (!resolveAddress(owner) || !resolveAddress(spender) ||
      spender.toLowerCase() !== ESCROW_ADDRESS!.toLowerCase() ||
      owner.toLowerCase() !== getAccount(config).address?.toLowerCase()) {
    throw new Error("USDC approval requires the connected wallet and configured escrow address.");
  }
  const amount = parseUsdc(amountUsdc);
  const chainId = ACTIVE_CHAIN.id;
  const code = await getBytecode(config, { address: ESCROW_ADDRESS!, chainId });
  if (!code || code === "0x") throw new Error("No StreetSyncEscrow contract exists at the configured address on " + ACTIVE_CHAIN.name + ".");
  const [token, decimals] = await Promise.all([
    readContract(config, { address: ESCROW_ADDRESS!, abi: ESCROW_ABI, functionName: "USDC", chainId }),
    readContract(config, { address: USDC_ADDRESS!, abi: erc20Abi, functionName: "decimals", chainId })
  ]);
  if (String(token).toLowerCase() !== USDC_ADDRESS!.toLowerCase() || decimals !== 6) {
    throw new Error("The escrow must use the configured six-decimal USDC token.");
  }

  const current = (await readContract(config, {
    address: USDC_ADDRESS!, abi: USDC_ABI, functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`], chainId
  })) as bigint;
  if (current >= amount) return false;

  onPhase?.("signing", `Approve exactly ${amountUsdc} USDC`);
  const hash = await writeContractAsync({
    address: USDC_ADDRESS!, abi: USDC_ABI, functionName: "approve",
    args: [spender as `0x${string}`, amount], chainId
  });
  onPhase?.("mining", "Waiting for approval confirmation");
  await waitTx(config, hash);
  return true;
}

export async function waitTx(config: Config, hash: string): Promise<void> {
  const receipt = await waitForTransactionReceipt(config, {
    hash: hash as Hash, chainId: ACTIVE_CHAIN.id
  });
  if (receipt.status !== "success") throw new Error("Transaction reverted. No action was completed.");
}
