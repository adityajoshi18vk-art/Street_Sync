import { defineChain, type Address } from "viem";
import { publicEnv } from "@/env/public";

const id = publicEnv.NEXT_PUBLIC_HEDERA_CHAIN_ID;
export const IS_HEDERA = id === 296;

/** The single chain JanLekha writes to. Wallets on any other chain are blocked from writing. */
export const appChain = defineChain({
  id,
  name: IS_HEDERA ? "Hedera Testnet" : `Local development chain (${id})`,
  nativeCurrency: IS_HEDERA
    ? { name: "HBAR", symbol: "HBAR", decimals: 18 }
    : { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [publicEnv.NEXT_PUBLIC_HEDERA_RPC_URL] } },
  blockExplorers: IS_HEDERA
    ? { default: { name: "HashScan", url: publicEnv.NEXT_PUBLIC_HASHSCAN_URL } }
    : undefined,
  testnet: true,
});

export const CONTRACT_ADDRESS = publicEnv.NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS as Address | undefined;
export const EXPLORER_URL = appChain.blockExplorers?.default.url ?? null;
