import { encodeAbiParameters, getAddress, isAddress, isHex, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";

/**
 * A sealed bid can only be revealed with the exact amount, quotation hash and salt.
 * Losing them makes the bid unrevealable, so the vendor must export this backup before committing.
 */
export interface BidBackup {
  format: "janlekha-bid-backup";
  version: 1;
  chainId: number;
  contract: Address;
  projectId: string;
  vendor: Address;
  amountPaise: string;
  quotationDocumentHash: Hex;
  salt: Hex;
  commitment: Hex;
  createdAt: string;
  notice: string;
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Must match JanLekha.sol: keccak256(abi.encode(projectId, vendor, amountPaise, quotationDocumentHash, salt)). */
export function computeCommitment(projectId: bigint, vendor: Address, amountPaise: bigint, quotationDocumentHash: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, uint256, bytes32, bytes32"), [
      projectId,
      vendor,
      amountPaise,
      quotationDocumentHash,
      salt,
    ]),
  );
}

export function createBidBackup(p: {
  chainId: number;
  contract: Address;
  projectId: bigint;
  vendor: Address;
  amountPaise: bigint;
  quotationDocumentHash: Hex;
}): BidBackup {
  const salt = randomSalt();
  return {
    format: "janlekha-bid-backup",
    version: 1,
    chainId: p.chainId,
    contract: getAddress(p.contract),
    projectId: p.projectId.toString(),
    vendor: getAddress(p.vendor),
    amountPaise: p.amountPaise.toString(),
    quotationDocumentHash: p.quotationDocumentHash,
    salt,
    commitment: computeCommitment(p.projectId, p.vendor, p.amountPaise, p.quotationDocumentHash, salt),
    createdAt: new Date().toISOString(),
    notice: "Keep this file private until you reveal: it contains your bid amount. Only your vendor account can reveal this bid, and it cannot be revealed without this file.",
  };
}

const bytes32 = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length === 66;

export function parseBidBackup(text: string): BidBackup {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (raw.format !== "janlekha-bid-backup" || raw.version !== 1) throw new Error("This is not a JanLekha bid backup file.");
  if (typeof raw.chainId !== "number" || typeof raw.projectId !== "string" || !/^\d+$/.test(raw.projectId)) {
    throw new Error("The backup is missing its chain or project id.");
  }
  if (typeof raw.contract !== "string" || !isAddress(raw.contract) || typeof raw.vendor !== "string" || !isAddress(raw.vendor)) {
    throw new Error("The backup has an invalid contract or vendor address.");
  }
  if (typeof raw.amountPaise !== "string" || !/^\d+$/.test(raw.amountPaise)) throw new Error("The backup has an invalid amount.");
  if (!bytes32(raw.quotationDocumentHash) || !bytes32(raw.salt) || !bytes32(raw.commitment)) {
    throw new Error("The backup has an invalid hash, salt or commitment.");
  }
  return raw as unknown as BidBackup;
}

function storageKey(chainId: number, contract: Address, projectId: string, vendor: Address) {
  return `janlekha:bid:${chainId}:${contract.toLowerCase()}:${projectId}:${vendor.toLowerCase()}`;
}

export function saveBidBackup(b: BidBackup) {
  localStorage.setItem(storageKey(b.chainId, b.contract, b.projectId, b.vendor), JSON.stringify(b));
}

export function loadBidBackup(chainId: number, contract: Address, projectId: string, vendor: Address): BidBackup | null {
  const raw = localStorage.getItem(storageKey(chainId, contract, projectId, vendor));
  if (!raw) return null;
  try {
    return parseBidBackup(raw);
  } catch {
    return null;
  }
}

export function downloadBidBackup(b: BidBackup) {
  const blob = new Blob([`${JSON.stringify(b, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `janlekha-bid-project-${b.projectId}-${b.vendor.slice(0, 8).toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
