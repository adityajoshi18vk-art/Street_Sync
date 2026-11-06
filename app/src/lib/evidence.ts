"use client";

import {
  packBundle,
  sha256,
  sha256Bytes32,
  SIGNATURE_SIZE
} from "@streetsync/evidence";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import type { CompressionStats, EvidenceMetadata } from "@streetsync/evidence";

export type { CompressionStats, EvidenceMetadata };

/**
 * Builds the deterministic SSYN evidence bundle and returns the on-chain
 * evidenceHash. packBundle() signs with a supplied private key, but injected
 * wallets never expose one — so we reuse the packer's deterministic payload
 * assembly (ephemeral throwaway key) and then swap the 65-byte signature slot
 * for the worker wallet's EIP-191 signature over the same payload hash
 * (signMessage with raw bytes == personal_sign, which recoverMessageAddress
 * unwraps identically on the audit path).
 */
export async function buildSignedBundle(params: {
  metadata: EvidenceMetadata;
  beforeImage: Uint8Array;
  afterImage: Uint8Array;
  rawImagesOriginalBytes?: number;
  signPayloadHash: (payloadHash: Uint8Array) => Promise<`0x${string}`>;
}): Promise<{
  bundle: Uint8Array;
  evidenceHash: `0x${string}`;
  stats: CompressionStats;
}> {
  // Deterministic payload assembly via the package packer (header + Zstd CBOR
  // metadata + WebP images). The ephemeral signature is discarded below.
  const ephemeralKey: Hex = generatePrivateKey();
  const assembled = await packBundle(
    {
      metadata: params.metadata,
      beforeImage: params.beforeImage,
      afterImage: params.afterImage,
      signerPrivateKey: ephemeralKey
    },
    params.rawImagesOriginalBytes
  );

  const payload = assembled.bundle.subarray(0, assembled.bundle.length - SIGNATURE_SIZE);
  const payloadHash = await sha256(payload);

  const walletSigHex = await params.signPayloadHash(payloadHash);
  const walletSig = hexToBytes(walletSigHex);
  if (walletSig.length !== SIGNATURE_SIZE) {
    throw new Error(`Wallet signature is ${walletSig.length} bytes; expected ${SIGNATURE_SIZE}`);
  }

  const bundle = new Uint8Array(payload.length + SIGNATURE_SIZE);
  bundle.set(payload, 0);
  bundle.set(walletSig, payload.length);

  const evidenceHash = await sha256Bytes32(bundle);

  return { bundle, evidenceHash, stats: assembled.stats };
}

/** Random 32-byte commit-reveal salt as bytes32 hex. */
export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * voteHash = keccak256(abi.encodePacked(bountyId, reviewRound, approve, salt, voter))
 * — mirrors VotingModule.sol byte-for-byte (uint256 | uint8 | bool | bytes32 | address).
 */
export async function computeVoteHash(params: {
  bountyId: bigint;
  reviewRound: number;
  approve: boolean;
  salt: `0x${string}`;
  voter: string;
}): Promise<`0x${string}`> {
  const { encodePacked, keccak256, pad, toHex } = await import("viem");
  const encoded = encodePacked(
    ["uint256", "uint8", "bool", "bytes32", "address"],
    [
      params.bountyId,
      params.reviewRound,
      params.approve,
      pad(params.salt, { size: 32 }),
      params.voter as `0x${string}`
    ]
  );
  return keccak256(encoded);
}

export function voteStorageKey(bountyId: bigint, reviewRound: number, wallet: string): string {
  return `streetsync:vote:${bountyId.toString()}:${reviewRound}:${wallet.toLowerCase()}`;
}

export interface StoredVote {
  salt: `0x${string}`;
  approve: boolean;
  committedAt: number;
  commitHash: `0x${string}`;
}

export function saveVote(key: string, vote: StoredVote): void {
  localStorage.setItem(key, JSON.stringify(vote));
}

export function loadVote(key: string): StoredVote | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredVote) : null;
  } catch {
    return null;
  }
}
