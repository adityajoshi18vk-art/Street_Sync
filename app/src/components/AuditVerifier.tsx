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
import { getVideoPlaybackUrl, getVideoUrl } from "@streetsync/swarm-client";

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
      <div className="alert-warn p-6">
        Escrow contract address is not configured for {ACTIVE_CHAIN.name}. Deploy the contracts and
        set NEXT_PUBLIC_ESCROW_ADDRESS (see app/.env.example).
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {bounty && (
        <div className="card animate-rise p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="heading text-lg">Bounty #{bounty.id.toString()}</h2>
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
        <div className="card flex flex-col items-center gap-3 p-6 text-center text-sm text-zinc-400">
          <span className="spinner" aria-hidden />
          Fetching raw entity bytes from Arkiv and recomputing SHA-256…
        </div>
      )}

      {loadError && (
        <div className="alert-error p-5">
          {loadError}
        </div>
      )}

      {phase === "done" && bounty && (
        <div className="card animate-rise p-6">
          <p className="text-sm font-semibold text-white">Cryptographic verification</p>
          <div className="mt-3 space-y-2">
            <HashBadge
              label="Recomputed SHA-256 (browser)"
              hash={computedHash}
              match={hashMatch}
            />
            <div className="card-inset flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="label-micro">
                  Worker EIP-191 signature
                </p>
                <p className="truncate font-mono text-xs text-zinc-300">
                  {recoveredWorker ?? "recovery failed"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  signatureMatch ? "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30" : "bg-red-400/10 text-red-300 ring-1 ring-red-400/30"
                }`}
              >
                {signatureMatch ? "VERIFIED" : "MISMATCH"}
              </span>
            </div>
            <div className="card-inset flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
              <span className="text-zinc-400">Bundle size (Arkiv entity, ≤128 KiB)</span>
              <span className="font-mono font-semibold text-zinc-200">
                {bundleSize?.toLocaleString()} B / {MAX_ARKIV_PAYLOAD.toLocaleString()} B
              </span>
            </div>
            {metadata?.video && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-xs ring-1 ring-amber-400/30">
                <div>
                  <p className="font-semibold text-amber-200">Swarm Video Cryptographic Seal</p>
                  <p className="font-mono text-[11px] text-amber-300/80">
                    Ref: {metadata.video.swarmReference.slice(0, 16)}… · SHA-256: {metadata.video.videoSha256.slice(0, 12)}…
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                  SEALED IN ARKIV
                </span>
              </div>
            )}
            {entityKeyUsed && (
              <p className="truncate text-[11px] text-zinc-500">
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
        <div className="card animate-rise p-6">
          <p className="mb-3 text-sm font-semibold text-white">Evidence photos (from Arkiv)</p>
          <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={afterUrl} />
        </div>
      )}

      {metadata?.video && (
        <div className="card animate-rise space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-white">Video Walkthrough (Ethereum Swarm)</p>
              <p className="text-xs text-zinc-400">
                Decentralized chunked streaming via Bzz protocol · {metadata.video.durationSeconds}s · {(metadata.video.sizeBytes / 1024).toFixed(0)} KB
              </p>
            </div>
            <a
              href={getVideoUrl(metadata.video.swarmReference)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/30 transition hover:bg-amber-400/20"
            >
              Verify on Swarm Gateway ↗
            </a>
          </div>

          <video
            src={getVideoPlaybackUrl(metadata.video.swarmReference)}
            controls
            playsInline
            className="w-full max-h-80 rounded-xl bg-black object-contain"
          />

          <div className="card-inset grid grid-cols-1 gap-2 p-3 font-mono text-[11px] text-zinc-400 sm:grid-cols-2">
            <div className="truncate">
              <span className="text-zinc-500">Swarm Reference: </span>
              <span className="font-semibold text-zinc-200">{metadata.video.swarmReference}</span>
            </div>
            <div className="truncate">
              <span className="text-zinc-500">Video SHA-256: </span>
              <span className="font-semibold text-zinc-200">{metadata.video.videoSha256}</span>
            </div>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card animate-rise p-6">
          <p className="text-sm font-semibold text-white">Tamper demonstration</p>
          <p className="mt-1 text-xs text-zinc-400">
            Flips exactly one byte of the bundle <em>in memory only</em> (nothing is written back to
            Arkiv) and recomputes the SHA-256 — showing why the on-chain Arc hash check makes silent
            edits impossible.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={simulateTamper}
              className="btn-danger"
            >
              Simulate Tamper (flip 1 byte)
            </button>
            {tamperResult && (
              <button
                onClick={resetAndReverify}
                className="btn-ghost"
              >
                Reset &amp; re-verify
              </button>
            )}
          </div>
          {tamperResult && (
            <div
              className={`mt-3 rounded-xl p-3.5 text-xs ring-1 ${
                tamperResult.match
                  ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
                  : "bg-red-400/10 text-red-300 ring-red-400/30"
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
      className={`rounded-xl px-3.5 py-2.5 ring-1 ${
        highlight === undefined
          ? "bg-black/30 ring-white/[0.06]"
          : highlight
            ? "bg-emerald-400/10 ring-emerald-400/30"
            : "bg-red-400/10 ring-red-400/30"
      }`}
    >
      <p className="label-micro">{label}</p>
      <p className="font-mono text-xs font-semibold text-zinc-200">{value}</p>
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
