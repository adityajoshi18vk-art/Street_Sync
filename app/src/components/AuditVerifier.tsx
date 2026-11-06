"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_ARKIV_PAYLOAD } from "@streetsync/evidence";
import {
  computeEvidenceHash,
  readEvidenceBundle,
  verifyEvidenceBundle
} from "@streetsync/arkiv-client";
import { recoverWorkerAddress, unpackBundle } from "@streetsync/evidence";
import { readContract } from "wagmi/actions";
import { useConfig } from "wagmi";
import { ESCROW_ABI, ESCROW_ADDRESS, ACTIVE_CHAIN, assertContractsConfigured, formatUsdcDisplay } from "@/config/contracts";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import type { EvidenceMetadata } from "@streetsync/evidence";
import type { OnChainBounty } from "@/lib/types";
import { shortHash, formatUtc, isZeroHash } from "@/lib/types";
import { StatusBadge, HashBadge } from "./StatusBadge";
import BeforeAfterSlider from "./BeforeAfterSlider";

const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Public audit: no wallet required. Reads the bounty straight from Arc via the
 * public RPC transport, fetches the raw bundle bytes from Arkiv, recomputes
 * SHA-256 in the browser, recovers the worker's EIP-191 signature, and supports
 * a 1-byte in-memory tamper to demonstrate how the on-chain hash check breaks.
 */
export default function AuditVerifier({ bountyId }: { bountyId: string }) {
  const config = useConfig();

  const [bounty, setBounty] = useState<OnChainBounty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [recoveredWorker, setRecoveredWorker] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<EvidenceMetadata | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [bundleSize, setBundleSize] = useState<number | null>(null);
  const [entityKeyUsed, setEntityKeyUsed] = useState<string | null>(null);
  const [tamperResult, setTamperResult] = useState<{
    tamperedHash: string;
    match: boolean;
    flippedByteOffset: number;
  } | null>(null);

  const bundleRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setLoadError(null);
      try {
        // 1. On-chain bounty (public RPC — wallet NOT required)
        assertContractsConfigured();
        const raw = (await readContract(config, {
          address: ESCROW_ADDRESS!,
          chainId: ACTIVE_CHAIN.id,
          abi: ESCROW_ABI,
          functionName: "getBounty",
          args: [BigInt(bountyId)]
        })) as unknown as OnChainBounty;
        if (cancelled) return;
        setBounty(raw);

        if (isZeroHash(raw.arkivEntityKey)) {
          throw new Error("This bounty has no evidence entity key on-chain yet.");
        }

        // 2. Fetch raw bytes from Arkiv (bytes32 key → stored original key if any)
        const client = getArkivClient();
        const candidates = [
          lookupStoredEntityKey(raw.arkivEntityKey),
          lookupBountyEntityKey(bountyId),
          raw.arkivEntityKey
        ].filter((k): k is string => !!k && k !== ZERO_KEY);

        let bundle: Uint8Array | null = null;
        let lastError: unknown = null;
        for (const key of candidates) {
          try {
            const res = await readEvidenceBundle(client, key);
            bundle = res.bundle;
            setEntityKeyUsed(key);
            break;
          } catch (e) {
            lastError = e;
          }
        }
        if (!bundle) {
          throw new Error(
            `Could not fetch evidence entity: ${String(lastError)}. If the entity was written on another device, open this audit link from the worker's device or set the entity key mapping.`
          );
        }
        bundleRef.current = bundle;
        setBundleSize(bundle.length);

        // 3. Recompute SHA-256 in the browser and compare with the Arc hash
        const computed = await computeEvidenceHash(bundle);
        setComputedHash(computed);

        // 4. Recover the worker's EIP-191 signature
        try {
          const recovered = await recoverWorkerAddress(bundle);
          setRecoveredWorker(recovered);
        } catch {
          setRecoveredWorker(null);
        }

        // 5. Unpack metadata + images
        const unpacked = await unpackBundle(bundle);
        setMetadata(unpacked.metadata);
        setBeforeUrl(URL.createObjectURL(new Blob([new Uint8Array(unpacked.beforeImage)], { type: "image/webp" })));
        setAfterUrl(URL.createObjectURL(new Blob([new Uint8Array(unpacked.afterImage)], { type: "image/webp" })));

        setPhase("done");
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bountyId, config]);

  const hashMatch = useMemo(
    () =>
      !!bounty &&
      !!computedHash &&
      computedHash.toLowerCase() === bounty.evidenceHash.toLowerCase(),
    [bounty, computedHash]
  );

  const signatureMatch = useMemo(
    () =>
      !!bounty &&
      !!recoveredWorker &&
      !!bounty.worker &&
      recoveredWorker.toLowerCase() === bounty.worker.toLowerCase(),
    [bounty, recoveredWorker]
  );

  const challengeMatch = useMemo(
    () =>
      !!bounty &&
      !!metadata &&
      Number(metadata.challengeCode) === Number(bounty.visualChallengeCode),
    [bounty, metadata]
  );

  /** Flip exactly ONE byte in memory and re-verify — the tamper demo. */
  const simulateTamper = async () => {
    const bundle = bundleRef.current;
    if (!bundle || !bounty) return;
    // Flip a byte inside the AFTER image region (never the signature slot, so
    // the demo isolates payload tampering breaking the integrity hash).
    const offset = Math.max(0, bundle.length - 65 - 8);
    const tampered = Uint8Array.from(bundle);
    tampered[offset] = tampered[offset] ^ 0xff;
    const tamperedHash = await computeEvidenceHash(tampered);
    setTamperResult({
      tamperedHash,
      match: tamperedHash.toLowerCase() === bounty.evidenceHash.toLowerCase(),
      flippedByteOffset: offset
    });
  };

  const resetAndReverify = async () => {
    const bundle = bundleRef.current;
    if (!bundle || !bounty || !entityKeyUsed) return;
    setPhase("loading");
    try {
      const result = await verifyEvidenceBundle(
        getArkivClient(),
        entityKeyUsed,
        bounty.evidenceHash,
        bounty.worker
      );
      setComputedHash(await computeEvidenceHash(bundle));
      setLoadError(result.valid ? null : result.errors.join(" · "));
      setPhase("done");
    } catch (e) {
      setLoadError(String(e));
      setPhase("error");
    }
  };

  if (!ESCROW_ADDRESS || ESCROW_ADDRESS === ZERO_KEY) {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-amber-200">
        Escrow contract address is not configured for {ACTIVE_CHAIN.name}. Deploy the contracts and
        set NEXT_PUBLIC_ESCROW_ADDRESS (see app/.env.example).
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {bounty && (
        <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-gray-900">Bounty #{bounty.id.toString()}</h2>
            <StatusBadge status={bounty.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Field label="Escrow" value={`${formatUsdcDisplay(bounty.totalPledged)} USDC`} />
            <Field label="Worker" value={shortHash(bounty.worker)} />
            <Field label="Region cell" value={String(bounty.regionCell)} />
            <Field label="Claim deadline" value={formatUtc(bounty.claimDeadline)} />
          </div>
          <div className="mt-3 space-y-2">
            <HashBadge label="On-chain evidenceHash (Arc)" hash={bounty.evidenceHash} />
            <HashBadge
              label="Arkiv entity key"
              hash={isZeroHash(bounty.arkivEntityKey) ? null : bounty.arkivEntityKey}
            />
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-card ring-1 ring-gray-200">
          Fetching raw entity bytes from Arkiv and recomputing SHA-256…
        </div>
      )}

      {loadError && (
        <div className="rounded-xl bg-red-50 p-5 text-sm text-red-700 ring-1 ring-red-200">
          {loadError}
        </div>
      )}

      {phase === "done" && bounty && (
        <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
          <p className="text-sm font-semibold text-gray-900">Cryptographic verification</p>
          <div className="mt-3 space-y-2">
            <HashBadge
              label="Recomputed SHA-256 (browser)"
              hash={computedHash}
              match={hashMatch}
            />
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  Worker EIP-191 signature
                </p>
                <p className="truncate font-mono text-xs text-gray-700">
                  {recoveredWorker ?? "recovery failed"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  signatureMatch ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}
              >
                {signatureMatch ? "VERIFIED" : "MISMATCH"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs ring-1 ring-gray-200">
              <span className="text-gray-500">Bundle size (Arkiv entity, ≤128 KiB)</span>
              <span className="font-mono font-semibold text-gray-800">
                {bundleSize?.toLocaleString()} B / {MAX_ARKIV_PAYLOAD.toLocaleString()} B
              </span>
            </div>
            {entityKeyUsed && (
              <p className="truncate text-[11px] text-gray-400">
                Entity resolved via key: {entityKeyUsed}
              </p>
            )}
          </div>

          {metadata && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <Field
                label="Challenge code"
                value={String(metadata.challengeCode)}
                highlight={challengeMatch}
              />
              <Field
                label="GPS accuracy"
                value={
                  metadata.gps.accuracyMeters !== undefined
                    ? `±${Math.round(metadata.gps.accuracyMeters)} m`
                    : "—"
                }
              />
              <Field label="Before capture" value={formatCaptureTime(metadata.beforeTimestampMs)} />
              <Field label="After capture" value={formatCaptureTime(metadata.afterTimestampMs)} />
              <Field
                label="Compass heading"
                value={
                  metadata.orientation.alpha !== null &&
                  metadata.orientation.alpha !== undefined
                    ? `${Math.round(metadata.orientation.alpha)}°`
                    : "—"
                }
              />
              <Field label="Signer (claimed)" value={shortHash(metadata.workerAddress)} />
            </div>
          )}
        </div>
      )}

      {beforeUrl && afterUrl && (
        <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
          <p className="mb-3 text-sm font-semibold text-gray-900">Evidence photos (from Arkiv)</p>
          <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={afterUrl} />
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
          <p className="text-sm font-semibold text-gray-900">Tamper demonstration</p>
          <p className="mt-1 text-xs text-gray-500">
            Flips exactly one byte of the bundle <em>in memory only</em> (nothing is written back to
            Arkiv) and recomputes the SHA-256 — showing why the on-chain Arc hash check makes silent
            edits impossible.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={simulateTamper}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Simulate Tamper (flip 1 byte)
            </button>
            {tamperResult && (
              <button
                onClick={resetAndReverify}
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 transition hover:bg-gray-50"
              >
                Reset &amp; re-verify
              </button>
            )}
          </div>
          {tamperResult && (
            <div
              className={`mt-3 rounded-lg p-3 text-xs ring-1 ${
                tamperResult.match
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-red-50 text-red-700 ring-red-200"
              }`}
            >
              <p className="font-semibold">
                Byte {tamperResult.flippedByteOffset} flipped →{" "}
                {tamperResult.match
                  ? "hash still matches (unexpected!)"
                  : "HASH MISMATCH — tampering detected"}
              </p>
              <p className="mt-1 break-all font-mono text-[11px]">
                tampered: {tamperResult.tamperedHash}
              </p>
              <p className="break-all font-mono text-[11px]">on-chain: {bounty?.evidenceHash}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ring-1 ${
        highlight === undefined
          ? "bg-gray-50 ring-gray-200"
          : highlight
            ? "bg-emerald-50 ring-emerald-200"
            : "bg-red-50 ring-red-200"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-mono text-xs font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function formatCaptureTime(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
