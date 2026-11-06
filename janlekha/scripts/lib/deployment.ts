/**
 * Shared helpers for the JanLekha deployment scripts.
 *
 * Deployment artifacts live in `deployments/<network>.json`. They contain only
 * public data (addresses, hashes, ids); private keys are never read, logged or
 * written here.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Address, Hex } from "viem";

export const HEDERA_TESTNET_CHAIN_ID = 296;
export const CONTRACT_NAME = "JanLekha";
export const DEPLOYMENTS_DIR = "deployments";
/** Committed copy of the ABI so consumers don't need a local compile. */
export const ABI_PATH = `${DEPLOYMENTS_DIR}/abi/${CONTRACT_NAME}.json`;

const MIRROR_NODE_URL = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const HASHSCAN_URL = process.env.HEDERA_HASHSCAN_URL ?? "https://hashscan.io/testnet";

export interface TxRecord {
  /** EVM transaction hash as returned by the JSON-RPC relay. */
  hash: Hex;
  /** Native Hedera transaction id (e.g. 0.0.123-1700000000-000000000), from the mirror node. */
  hederaTransactionId: string | null;
  blockNumber: string;
  explorerUrl: string | null;
}

export interface RoleGrantRecord {
  role: string;
  roleId: Hex;
  account: Address;
  label: string;
  status: "granted" | "already-held";
  transaction: TxRecord | null;
  confirmedAt: string;
}

export interface SmokeTestRecord {
  ranAt: string;
  projectId: string;
  sanctionDocumentHash: Hex;
  sanctionDocumentText: string;
  allocationPaise: string;
  transaction: TxRecord;
  readback: {
    department: Address;
    sanctionDocumentHash: Hex;
    allocationPaise: string;
    createdAt: string;
  };
}

export interface DeploymentArtifact {
  network: string;
  chainId: number;
  contract: {
    name: string;
    address: Address;
    hederaContractId: string | null;
    abiPath: string;
    sourcePath: string;
    buildInfoId: string | null;
    /** keccak/sha256 fingerprint of the compiled runtime bytecode. */
    runtimeBytecodeSha256: Hex;
    runtimeBytecodeMatchesChain: boolean;
  };
  deployer: Address;
  admin: Address;
  deployment: TxRecord & { timestamp: string; blockTimestamp: string };
  roles: RoleGrantRecord[];
  smokeTest: SmokeTestRecord | null;
  notice: string;
}

export function artifactPath(networkName: string): string {
  return path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
}

export async function readArtifact(networkName: string): Promise<DeploymentArtifact | null> {
  try {
    return JSON.parse(await readFile(artifactPath(networkName), "utf8")) as DeploymentArtifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function requireArtifact(networkName: string): Promise<DeploymentArtifact> {
  const artifact = await readArtifact(networkName);
  if (!artifact) {
    throw new Error(
      `No deployment artifact at ${artifactPath(networkName)}. Run the deploy script for --network ${networkName} first.`,
    );
  }
  return artifact;
}

export async function writeArtifact(artifact: DeploymentArtifact): Promise<void> {
  await mkdir(DEPLOYMENTS_DIR, { recursive: true });
  await writeFile(artifactPath(artifact.network), `${JSON.stringify(artifact, null, 2)}\n`);
}

export async function writeAbi(abi: unknown): Promise<void> {
  await mkdir(path.dirname(ABI_PATH), { recursive: true });
  await writeFile(ABI_PATH, `${JSON.stringify(abi, null, 2)}\n`);
}

export function sha256Hex(data: string | Uint8Array): Hex {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
}

export function isHedera(chainId: number): boolean {
  return chainId === HEDERA_TESTNET_CHAIN_ID;
}

/** Explorer link for an EVM tx hash; HashScan resolves EVM hashes directly. */
export function explorerTxUrl(chainId: number, hash: Hex): string | null {
  return isHedera(chainId) ? `${HASHSCAN_URL}/transaction/${hash}` : null;
}

export function explorerContractUrl(chainId: number, address: Address): string | null {
  return isHedera(chainId) ? `${HASHSCAN_URL}/contract/${address}` : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror node ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/**
 * The mirror node indexes relay transactions a few seconds after consensus, so
 * retry briefly. Returns null on non-Hedera chains or if indexing never completes;
 * the EVM hash in the artifact remains the authoritative reference either way.
 */
export async function lookupHederaIds(
  chainId: number,
  hash: Hex,
): Promise<{ transactionId: string | null; contractId: string | null }> {
  const none = { transactionId: null, contractId: null };
  if (!isHedera(chainId)) return none;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await fetchJson<{ timestamp: string; contract_id: string | null }>(
        `${MIRROR_NODE_URL}/api/v1/contracts/results/${hash}`,
      );
      if (result?.timestamp) {
        const txs = await fetchJson<{ transactions: { transaction_id: string; name: string }[] }>(
          `${MIRROR_NODE_URL}/api/v1/transactions?timestamp=${result.timestamp}`,
        );
        const tx =
          txs?.transactions.find((t) => t.name === "ETHEREUMTRANSACTION") ?? txs?.transactions[0];
        return { transactionId: tx?.transaction_id ?? null, contractId: result.contract_id };
      }
    } catch (error) {
      console.warn(`  mirror node lookup failed (attempt ${attempt + 1}): ${(error as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  console.warn("  mirror node did not index the transaction in time; hederaTransactionId left null");
  return none;
}

export async function txRecord(chainId: number, hash: Hex, blockNumber: bigint): Promise<TxRecord> {
  const { transactionId } = await lookupHederaIds(chainId, hash);
  return {
    hash,
    hederaTransactionId: transactionId,
    blockNumber: blockNumber.toString(),
    explorerUrl: explorerTxUrl(chainId, hash),
  };
}

/**
 * Fails fast on key formats viem cannot sign EVM transactions with (e.g. a DER-encoded
 * ED25519 key copied from the Hedera portal). Never prints the value.
 */
export function assertEcdsaKeyFormat(envName: string): void {
  const value = process.env[envName];
  if (value === undefined || value === "") return; // may be supplied via the Hardhat keystore
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(
      `${envName} is not a 32-byte hex ECDSA private key. Hedera EVM transactions require an ECDSA ` +
        "(secp256k1) account; ED25519 or DER-encoded keys are not supported. (Value not shown.)",
    );
  }
}

export const SYNTHETIC_NOTICE =
  "Synthetic hackathon deployment. No real government identities, documents or payments are recorded; " +
  "payment records are mock PFMS attestations only.";
