import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  http,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  type Address,
} from "viem";
import { publicEnv } from "@/env/public";

export const HEDERA_TESTNET_CHAIN_ID = 296;

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  mirrorNodeUrl: string;
  contractAddress: Address | null;
  deploymentBlock: bigint;
  isHedera: boolean;
  explorerUrl: string | null;
}

export function chainConfig(): ChainConfig {
  const chainId = publicEnv.NEXT_PUBLIC_HEDERA_CHAIN_ID;
  const isHedera = chainId === HEDERA_TESTNET_CHAIN_ID;
  return {
    chainId,
    rpcUrl: publicEnv.NEXT_PUBLIC_HEDERA_RPC_URL,
    mirrorNodeUrl: publicEnv.NEXT_PUBLIC_HEDERA_MIRROR_NODE_URL,
    contractAddress: (publicEnv.NEXT_PUBLIC_JANLEKHA_CONTRACT_ADDRESS as Address | undefined) ?? null,
    deploymentBlock: publicEnv.NEXT_PUBLIC_JANLEKHA_DEPLOYMENT_BLOCK,
    isHedera,
    explorerUrl: isHedera ? publicEnv.NEXT_PUBLIC_HASHSCAN_URL : null,
  };
}

export function publicClient(cfg: ChainConfig) {
  return createPublicClient({
    chain: defineChain({
      id: cfg.chainId,
      name: cfg.isHedera ? "Hedera Testnet" : `Chain ${cfg.chainId}`,
      nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    }),
    // Fail fast so an unavailable RPC produces an error state instead of a hung page.
    transport: http(cfg.rpcUrl, { timeout: 8_000, retryCount: 1 }),
  });
}

export type ReadFailureKind = "not-configured" | "rpc-unavailable" | "wrong-chain" | "no-contract" | "unexpected";

export interface ReadFailure {
  kind: ReadFailureKind;
  title: string;
  detail: string;
}

export class ReadError extends Error {
  constructor(readonly failure: ReadFailure) {
    super(failure.title);
  }
}

/** Name of the custom error a contract call reverted with, if any. */
export function revertErrorName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

export function toReadFailure(error: unknown, cfg: ChainConfig): ReadFailure {
  if (error instanceof ReadError) return error.failure;
  if (error instanceof BaseError) {
    const transport = error.walk(
      (e) => e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof RpcRequestError,
    );
    if (transport) {
      return {
        kind: "rpc-unavailable",
        title: "The blockchain RPC endpoint is unavailable",
        detail: `Could not read from ${cfg.rpcUrl} (chain ${cfg.chainId}). JanLekha does not show cached copies of contract state, so no records are displayed until the endpoint responds. Try again shortly.`,
      };
    }
  }
  console.error("[janlekha] unexpected chain read error:", error);
  return {
    kind: "unexpected",
    title: "Unexpected error reading contract state",
    detail: "The contract read failed for an unknown reason. Details were logged on the server.",
  };
}
