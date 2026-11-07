// Arc Testnet settings and simulated payment helper, adapted for Next.js.
// No ethers dependency is used here. Wallet connection uses the injected
// provider directly. No private keys or real transaction hashes are used
// anywhere in this module. All payments in the demo are simulated.

export const ARC_TESTNET = {
  name: "Arc Testnet",
  chainId: 5042002,
  chainIdHex: "0x4CF6AA",
  rpc: "https://rpc.testnet.arc.io",
  explorer: "https://explorer.testnet.arc.io",
  currency: "USDC",
  currencyDecimals: 18,
};

export const ARC_MAINNET = {
  name: "Arc Mainnet",
  chainId: 5042,
  rpc: "https://rpc.mainnet.arc.io",
  explorer: "https://explorer.arc.io",
  currency: "USDC",
  currencyDecimals: 18,
};

export function explorerTxUrl(hash: string): string {
  return ARC_TESTNET.explorer + "/tx/" + hash;
}

export function explorerAddressUrl(addr: string): string {
  return ARC_TESTNET.explorer + "/address/" + addr;
}

export function usdcToBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1_000_000));
}

export function baseUnitsToUsdc(units: bigint): number {
  return Number(units) / 1_000_000;
}

export interface WalletState {
  address: string | null;
  chainId: number | null;
  connected: boolean;
  error?: string;
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return eth ?? null;
}

export async function connectWallet(): Promise<WalletState> {
  const eth = getEthereum();
  if (!eth) {
    return { address: null, chainId: null, connected: false, error: "No wallet found. Install a MetaMask compatible wallet to connect." };
  }
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const chainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
    return { address: accounts[0] ?? null, chainId: parseInt(chainIdHex, 16), connected: true };
  } catch (e) {
    return { address: null, chainId: null, connected: false, error: e instanceof Error ? e.message : "Wallet connection failed." };
  }
}

export async function switchToArcTestnet(): Promise<{ ok: boolean; error?: string }> {
  const eth = getEthereum();
  if (!eth) return { ok: false, error: "No wallet found." };
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET.chainIdHex }] });
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: ARC_TESTNET.chainIdHex, chainName: ARC_TESTNET.name, rpcUrls: [ARC_TESTNET.rpc], blockExplorerUrls: [ARC_TESTNET.explorer], nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 } }],
        });
        return { ok: true };
      } catch (e2) {
        return { ok: false, error: e2 instanceof Error ? e2.message : "Could not add Arc Testnet." };
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : "Could not switch network." };
  }
}

export function simulateArcPayment(amountUsdc: number): { ref: string; explorerUrl: string; note: string } {
  const ref = "SIM-ARC-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 9000 + 1000);
  return {
    ref,
    explorerUrl: ARC_TESTNET.explorer,
    note: "Simulated USDC settlement demonstration on Arc Testnet. This is not a real on chain transaction and " + ref + " is a demo reference, not a transaction hash. Amount " + amountUsdc.toFixed(2) + " USDC (ERC-20, 6 decimals) is shown separately from INR budget records.",
  };
}

// JanLekha registry contract addresses (Arc Testnet).
// Set these in the frontend env as NEXT_PUBLIC_ARC_* after deploying.
// All are empty by default, which means the app runs in SIMULATED demo mode
// and never fakes a transaction hash.
export const CONTRACT_ADDRESSES = {
  roleRegistry: process.env.NEXT_PUBLIC_ARC_ROLE_REGISTRY_ADDRESS ?? "",
  budgetRegistry: process.env.NEXT_PUBLIC_ARC_BUDGET_REGISTRY_ADDRESS ?? "",
  projectRegistry: process.env.NEXT_PUBLIC_ARC_PROJECT_REGISTRY_ADDRESS ?? "",
  procurementRegistry: process.env.NEXT_PUBLIC_ARC_PROCUREMENT_REGISTRY_ADDRESS ?? "",
  milestoneRegistry: process.env.NEXT_PUBLIC_ARC_MILESTONE_REGISTRY_ADDRESS ?? "",
  paymentRegistry: process.env.NEXT_PUBLIC_ARC_PAYMENT_REGISTRY_ADDRESS ?? "",
  documentRegistry: process.env.NEXT_PUBLIC_ARC_DOCUMENT_REGISTRY_ADDRESS ?? "",
  auditRegistry: process.env.NEXT_PUBLIC_ARC_AUDIT_REGISTRY_ADDRESS ?? "",
} as const;

export type RegistryName = keyof typeof CONTRACT_ADDRESSES;

// True only when every registry address is configured, meaning the
// contracts are deployed and the frontend can write to Arc Testnet.
export function areContractsDeployed(): boolean {
  return Object.values(CONTRACT_ADDRESSES).every((addr) => addr !== "");
}

// Names of the registries that have an address configured.
export function deployedContracts(): RegistryName[] {
  return (Object.keys(CONTRACT_ADDRESSES) as RegistryName[]).filter((name) => CONTRACT_ADDRESSES[name] !== "");
}
