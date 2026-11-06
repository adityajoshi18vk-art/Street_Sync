import type { Address, Hex } from "viem";
import catalog from "./demo-catalog.json";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** Formats integer paise as INR with Indian digit grouping (₹12,00,000.00) without float rounding. */
export function formatPaise(paise: bigint): string {
  const sign = paise < 0n ? "-" : "";
  const abs = paise < 0n ? -paise : paise;
  const decimal = `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return inr.format(decimal as Intl.StringNumericLiteral);
}

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTimestamp(unixSeconds: bigint | number): string {
  return `${dateFormat.format(new Date(Number(unixSeconds) * 1000))} IST`;
}

export function shortHex(value: Address | Hex, chars = 6): string {
  return `${value.slice(0, 2 + chars)}…${value.slice(-4)}`;
}

export interface CatalogDocument {
  title: string;
  kind: string;
  file: string;
}

/** Off-chain, unverified demo metadata keyed by on-chain hashes. */
export function catalogProject(sanctionHash: Hex) {
  return (catalog.projects as Record<string, { title: string; department: string; location: string }>)[sanctionHash.toLowerCase()];
}

export function catalogDocument(hash: Hex): CatalogDocument | undefined {
  return (catalog.documents as Record<string, CatalogDocument>)[hash.toLowerCase()];
}

export function txUrl(explorerUrl: string | null, hash: Hex): string | null {
  return explorerUrl ? `${explorerUrl}/transaction/${hash}` : null;
}

export function addressUrl(explorerUrl: string | null, address: Address): string | null {
  return explorerUrl ? `${explorerUrl}/account/${address}` : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
