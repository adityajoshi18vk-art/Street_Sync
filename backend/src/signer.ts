/**
 * signer.ts
 * EIP-712 attestation generator using viem.
 *
 * Matches AttestationVerifier.sol byte-for-byte:
 *   Domain:    { name: "StreetSync", version: "1", chainId, verifyingContract }
 *   TypeHash:  Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)
 *
 * The signer uses ATTESTER_PRIVATE_KEY which MUST correspond to the on-chain
 * `attester` address configured in the StreetSyncEscrow constructor.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  createWalletClient,
  http,
  isAddress,
  type Hex,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dbAccess from "./db.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const configuredPrivateKey = process.env.ATTESTER_PRIVATE_KEY;
if (!configuredPrivateKey) {
  throw new Error("ATTESTER_PRIVATE_KEY is required; refusing to use a public development key");
}
const ATTESTER_PRIVATE_KEY = configuredPrivateKey as Hex;

export function getChainId(): number {
  return Number(process.env.CHAIN_ID ?? "5042002");
}

// The verifying contract address is resolved at runtime from env or deployment artifacts
let _verifyingContract: Address | null = null;

export function setVerifyingContract(addr: Address): void {
  if (!isAddress(addr) || addr.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("ESCROW_CONTRACT_ADDRESS must be a non-zero EVM address");
  }
  _verifyingContract = addr;
}

export function getVerifyingContract(): Address {
  if (_verifyingContract) return _verifyingContract;

  // 1. Check environment variable
  const fromEnv = process.env.ESCROW_CONTRACT_ADDRESS;
  if (fromEnv) {
    if (!isAddress(fromEnv) || fromEnv.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      throw new Error("ESCROW_CONTRACT_ADDRESS must be a non-zero EVM address");
    }
    _verifyingContract = fromEnv as Address;
    return _verifyingContract;
  }

  // 2. Check deployment artifacts dynamically based on CHAIN_ID
  const chainId = getChainId();
  const networkName = chainId === 31337 ? "localhost" : "arcTestnet";
  const defaultPath = path.resolve(`../contracts/deployments/${networkName}.json`);
  const deploymentsPath = process.env.DEPLOYMENTS_PATH ? path.resolve(process.env.DEPLOYMENTS_PATH) : defaultPath;

  if (fs.existsSync(deploymentsPath)) {
    try {
      const raw = fs.readFileSync(deploymentsPath, "utf-8");
      const deployment = JSON.parse(raw);
      const addr = deployment.contracts?.StreetSyncEscrow?.address ??
                   deployment.StreetSyncEscrow?.address ??
                   deployment.address;
      if (addr && isAddress(addr) && addr.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
        _verifyingContract = addr as Address;
        return _verifyingContract;
      }
    } catch {
      // ignore parse error, will throw below if needed
    }
  }

  throw new Error("StreetSyncEscrow address is not configured; set ESCROW_CONTRACT_ADDRESS or DEPLOYMENTS_PATH");
}

// ─── Viem Account ────────────────────────────────────────────────────────────

const attesterAccount = privateKeyToAccount(ATTESTER_PRIVATE_KEY);

const expectedAttester = process.env.ATTESTER_SIGNER_ADDRESS ?? process.env.ATTESTER_ADDRESS;
if (!expectedAttester || !isAddress(expectedAttester)) {
  throw new Error("ATTESTER_SIGNER_ADDRESS is required and must be an EVM address");
}
if (expectedAttester.toLowerCase() !== attesterAccount.address.toLowerCase()) {
  throw new Error("Configured attester address does not match ATTESTER_PRIVATE_KEY");
}

/** The public address derived from ATTESTER_PRIVATE_KEY. */
export const attesterAddress: Address = attesterAccount.address;

// ─── EIP-712 Domain & Types ──────────────────────────────────────────────────

/**
 * Returns the EIP-712 domain object matching AttestationVerifier.sol's
 * _buildDomainSeparator(), which encodes:
 *   keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
 *   keccak256("StreetSync"), keccak256("1"), chainId, verifyingContract
 */
function getDomain() {
  return {
    name: "StreetSync" as const,
    version: "1" as const,
    chainId: BigInt(getChainId()),
    verifyingContract: getVerifyingContract(),
  } as const;
}

/**
 * EIP-712 type definition matching the contract's ATTESTATION_TYPE_HASH:
 *   keccak256("Attestation(address wallet,uint8 role,uint256 bountyId,uint256 nonce,uint64 expiry)")
 */
const ATTESTATION_TYPES = {
  Attestation: [
    { name: "wallet",   type: "address" },
    { name: "role",     type: "uint8"   },
    { name: "bountyId", type: "uint256" },
    { name: "nonce",    type: "uint256" },
    { name: "expiry",   type: "uint64"  },
  ],
} as const;

// ─── Role enum (matches StreetSyncTypes.sol) ─────────────────────────────────

export const RoleEnum = {
  None: 0,
  Worker: 1,
  Reviewer: 2,
} as const;

export type RoleValue = (typeof RoleEnum)[keyof typeof RoleEnum];

// ─── Sign Attestation ────────────────────────────────────────────────────────

export interface AttestationResult {
  wallet: Address;
  role: number;
  bountyId: string;
  nonce: string;
  expiry: number;
  signature: Hex;
  attester: Address;
}

/**
 * Issues a signed EIP-712 attestation for a World-ID-verified wallet.
 *
 * @param wallet   Target wallet address.
 * @param role     RoleEnum value (1 = Worker, 2 = Reviewer).
 * @param bountyId Bounty scope (0n for Reviewer registration).
 * @returns        The attestation fields + ECDSA signature, ready for the client
 *                 to pass to claim() or registerReviewer().
 */
export async function signAttestation(
  wallet: Address,
  role: RoleValue,
  bountyId: bigint,
): Promise<AttestationResult> {
  // Generate a unique monotonic nonce for this wallet
  const nonce = dbAccess.nextNonce(wallet.toLowerCase());

  // Expiry = now + 1 hour
  const expiry = Math.floor(Date.now() / 1000) + 3600;

  const domain = getDomain();

  const message = {
    wallet,
    role,
    bountyId,
    nonce,
    expiry: BigInt(expiry),
  };

  // Sign using viem's signTypedData (produces standard 65-byte r+s+v signature)
  const signature = await attesterAccount.signTypedData({
    domain,
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
  });

  // Record the nonce in DB for auditing
  dbAccess.recordNonce(
    wallet.toLowerCase(),
    nonce,
    role,
    bountyId.toString(),
    expiry,
  );

  return {
    wallet,
    role,
    bountyId: bountyId.toString(),
    nonce: nonce.toString(),
    expiry,
    signature,
    attester: attesterAddress,
  };
}

export default {
  signAttestation,
  attesterAddress,
  setVerifyingContract,
  getVerifyingContract,
  RoleEnum,
};

