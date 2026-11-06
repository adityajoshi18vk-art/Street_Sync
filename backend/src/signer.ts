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
import {
  createWalletClient,
  http,
  type Hex,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dbAccess from "./db.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const ATTESTER_PRIVATE_KEY = (process.env.ATTESTER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");

// The verifying contract address is resolved at runtime from env or deployment artifacts
let _verifyingContract: Address | null = null;

export function setVerifyingContract(addr: Address): void {
  _verifyingContract = addr;
}

export function getVerifyingContract(): Address {
  if (!_verifyingContract) {
    const fromEnv = process.env.ESCROW_CONTRACT_ADDRESS;
    if (fromEnv) {
      _verifyingContract = fromEnv as Address;
    } else {
      throw new Error("Verifying contract address not set. Call setVerifyingContract() or set ESCROW_CONTRACT_ADDRESS");
    }
  }
  return _verifyingContract;
}

// ─── Viem Account ────────────────────────────────────────────────────────────

const attesterAccount = privateKeyToAccount(ATTESTER_PRIVATE_KEY);

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
    chainId: BigInt(CHAIN_ID),
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

