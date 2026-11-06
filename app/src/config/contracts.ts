import { defineChain, parseUnits, formatUnits, isAddress, zeroAddress, type Abi, type Address } from "viem";
import arcTestnetDeployment from "../../../contracts/deployments/arcTestnet.json";
import localhostDeployment from "../../../contracts/deployments/localhost.json";

export const ARC_CHAIN_ID = 5042002;
export const LOCALHOST_CHAIN_ID = 31337;

/**
 * Rule 1 (USDC decimal trap): ERC-20 USDC uses STRICTLY 6 decimals on Arc
 * (1 USDC = 1_000_000 base units). Every amount crossing the escrow boundary
 * goes through parseUsdc / formatUsdc below — never the native 18-decimal view.
 */
export const USDC_DECIMALS = 6;

export interface ContractDeployment {
  address: Address;
  transactionHash?: string | null;
  abi: Abi;
  note?: string;
}

export interface DeploymentFile {
  network: string;
  chainId: number;
  deployedAt: string | null;
  note?: string;
  parameters: {
    reviewerStakeUsdc: string;
    reviewerStakeRaw: string;
    reviewerCutBps: number;
    panelSize: number;
    quorum: number;
    commitWindowSeconds: number;
    revealWindowSeconds: number;
    claimDurationSeconds: number;
    usdcDecimals: number;
  };
  contracts: {
    StreetSyncEscrow?: ContractDeployment;
    MockUSDC?: ContractDeployment;
    USDC?: ContractDeployment;
    [key: string]: ContractDeployment | undefined;
  };
}

const arcDeployment = arcTestnetDeployment as unknown as DeploymentFile;
const localDeployment = localhostDeployment as unknown as DeploymentFile;

const deployments: Record<number, DeploymentFile> = {
  [ARC_CHAIN_ID]: arcDeployment,
  [LOCALHOST_CHAIN_ID]: localDeployment
};

export const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

export const ARC_TESTNET = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    // Gas on Arc is paid natively in USDC (18-decimal native gas view).
    // ERC-20 bounty/stake amounts remain strictly 6 decimals — see Rule 1.
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://explorer.testnet.arc.io"
    }
  },
  testnet: true
});

export const HARDHAT_LOCAL = defineChain({
  id: LOCALHOST_CHAIN_ID,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_LOCALHOST_RPC_URL ?? "http://127.0.0.1:8545"] }
  },
  testnet: true
});

const envChainId = process.env.NEXT_PUBLIC_CHAIN_ID
  ? Number(process.env.NEXT_PUBLIC_CHAIN_ID)
  : ARC_CHAIN_ID;

if (![ARC_CHAIN_ID, LOCALHOST_CHAIN_ID].includes(envChainId)) {
  throw new Error("NEXT_PUBLIC_CHAIN_ID must be 5042002 (Arc Testnet) or 31337 (local).");
}

export const ACTIVE_CHAIN =
  envChainId === LOCALHOST_CHAIN_ID ? HARDHAT_LOCAL : ARC_TESTNET;

export const isLocalNetwork = ACTIVE_CHAIN.id === LOCALHOST_CHAIN_ID;

const deploymentForChain =
  deployments[ACTIVE_CHAIN.id] ?? arcDeployment;
export const deployment = deploymentForChain;

export function resolveAddress(value: string | undefined): Address | null {
  return value && isAddress(value, { strict: false }) && value.toLowerCase() !== zeroAddress
    ? (value as Address) : null;
}

export function resolveDeploymentAddress(override: string | undefined, fallback: string | undefined): Address | null {
  // An explicitly invalid override must not silently select a different contract.
  return resolveAddress(override === undefined ? fallback : override);
}

export const ARC_USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";

export const ESCROW_ADDRESS = resolveDeploymentAddress(
  process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
  deploymentForChain.contracts.StreetSyncEscrow?.address
);

export const USDC_ADDRESS = resolveDeploymentAddress(
  process.env.NEXT_PUBLIC_USDC_ADDRESS,
  isLocalNetwork
    ? deploymentForChain.contracts.MockUSDC?.address ?? deploymentForChain.contracts.USDC?.address
    : ARC_USDC_ADDRESS
);

export const contractsDeployed = ESCROW_ADDRESS !== null && USDC_ADDRESS !== null;
export const DEPLOYMENT_ERROR =
  "StreetSync contracts are not configured for " + ACTIVE_CHAIN.name +
  ". Deploy StreetSyncEscrow and configure its address before sending transactions.";

export function assertContractsConfigured(): void {
  if (!contractsDeployed) throw new Error(DEPLOYMENT_ERROR);
}

export const ESCROW_ABI: Abi = (deploymentForChain.contracts.StreetSyncEscrow?.abi ??
  []) as Abi;

export const USDC_ABI: Abi = (deploymentForChain.contracts.MockUSDC?.abi ??
  deploymentForChain.contracts.USDC?.abi ??
  []) as Abi;

export const REVIEWER_STAKE = deploymentForChain.parameters.reviewerStakeUsdc;
export const PANEL_SIZE = deploymentForChain.parameters.panelSize;
export const QUORUM = deploymentForChain.parameters.quorum;

export const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "";

export const WORLD_APP_ID = (process.env.NEXT_PUBLIC_WORLD_APP_ID ??
  "app_staging_streetsync") as `app_${string}`;
export const WORLD_ACTION_WORKER =
  process.env.NEXT_PUBLIC_WORLD_ACTION_WORKER ?? "claim-bounty";
export const WORLD_ACTION_REVIEWER =
  process.env.NEXT_PUBLIC_WORLD_ACTION_REVIEWER ?? "register-reviewer";

/**
 * parseUnits(amount, 6) — the ONLY sanctioned way to turn a human USDC amount
 * into a contract value (createBounty, pledge, registerReviewer stakes).
 */
export function parseUsdc(amount: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, USDC_DECIMALS) <= 0n) {
    throw new Error("Enter a positive USDC amount with at most 6 decimal places.");
  }
  return parseUnits(amount, USDC_DECIMALS);
}

/**
 * formatUnits(value, 6) — the ONLY sanctioned way to turn a contract USDC
 * value back into a human-readable string.
 */
export function formatUsdc(value: bigint): string {
  return formatUnits(value, USDC_DECIMALS);
}

export function formatUsdcDisplay(value: bigint): string {
  const n = Number(formatUsdc(value));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Latitude/Longitude × 1e5 integer encoding used by the Bounty struct. */
export function latLngToE5(lat: number, lng: number): { latE5: number; lngE5: number } {
  return { latE5: Math.round(lat * 1e5), lngE5: Math.round(lng * 1e5) };
}

export function e5ToLatLng(latE5: number, lngE5: number): { lat: number; lng: number } {
  return { lat: latE5 / 1e5, lng: lngE5 / 1e5 };
}

/**
 * Deterministic uint16 region cell for reviewer routing (H3-style coarse grid:
 * 128 × 128 cells ≈ 0.7° lat × 2.8° lng). Stable across clients so reviewers
 * and bounties land in the same regional pool.
 */
export function regionCellFromLatLng(lat: number, lng: number): number {
  const latIdx = Math.min(127, Math.max(0, Math.floor(((lat + 90) / 180) * 128)));
  const lngIdx = Math.min(127, Math.max(0, Math.floor(((lng + 180) / 360) * 128)));
  return (latIdx << 7) | lngIdx;
}

export function explorerTxUrl(txHash: string): string {
  return `${ACTIVE_CHAIN.blockExplorers?.default.url}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ACTIVE_CHAIN.blockExplorers?.default.url}/address/${address}`;
}
