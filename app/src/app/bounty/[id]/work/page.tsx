"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { IDKitWidget } from "@worldcoin/idkit";
import type { ISuccessResult } from "@worldcoin/idkit";
import { useAccount, useChainId, useConfig, useReadContract, useSignMessage, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { decodeEventLog, type Hash } from "viem";

import {
  ACTIVE_CHAIN,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  USDC_ABI,
  WORLD_APP_ID,
  WORLD_ACTION_WORKER,
  contractsDeployed,
  formatUsdcDisplay
} from "@/config/contracts";
import { requestAttestation, type Attestation, type WorldIdSuccessResult } from "@/lib/api";
import { getArkivClient, rememberEntityMapping } from "@/lib/arkiv";
import { buildSignedBundle, type CompressionStats, type EvidenceMetadata } from "@/lib/evidence";
import { statusName } from "@/lib/types";
import CameraCapture, { type CaptureResult } from "@/components/CameraCapture";
import CompressionStatsPanel from "@/components/CompressionStatsPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { resizeAndEncodePhoto } from "@streetsync/evidence";

type Phase =
  | "verify"
  | "claiming"
  | "work"
  | "building"
  | "publishing"
  | "submitting"
  | "done";

export default function WorkerPage() {
  const params = useParams<{ id: string }>();
  const bountyId = params.id;
  const router = useRouter();
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id && !!address;
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>("verify");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const attestationRef = useRef<Attestation | null>(null);

  const [beforeCapture, setBeforeCapture] = useState<CaptureResult | null>(null);
  const [afterCapture, setAfterCapture] = useState<CaptureResult | null>(null);
  const [stats, setStats] = useState<CompressionStats | null>(null);
  const [bundleResult, setBundleResult] = useState<{
    bundle: Uint8Array;
    evidenceHash: string;
    entityKey: string;
    entityKeyBytes32: string;
  } | null>(null);

  const bountyIdBig = useMemo(() => {
    const n = Number(bountyId);
    return Number.isFinite(n) && n >= 0 ? BigInt(n) : null;
  }, [bountyId]);

  const { data: bounty, refetch: refetchBounty } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getBounty",
    args: bountyIdBig ? [bountyIdBig] : undefined,
    query: { enabled: contractsDeployed && bountyIdBig !== null, refetchInterval: 15_000 }
  });

  const { data: usdcBalance } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (USDC_ADDRESS as `0x${string}`) : undefined,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });

  const raw = bounty as unknown[] | undefined;
  const status = raw ? Number(raw[16]) : -1;
  const worker = raw && typeof raw[9] === "string" ? (raw[9] as string) : undefined;
  const challengeCode = raw ? Number(raw[10]) : 0;
  const isWorker = !!address && !!worker && worker.toLowerCase() === address.toLowerCase();
  const evidenceHash = raw && typeof raw[12] === "string" ? (raw[12] as string) : null;

  // ─── Step 1: World ID verify → attestation → claim() ───────────────────────

  const runClaim = useCallback(
    async (attestation: Attestation) => {
      if (!canWrite || !address || !bountyIdBig || !ESCROW_ADDRESS) {
        setError("Connect a wallet on the configured contract network to claim this bounty.");
        return;
      }
      setPhase("claiming");
      setError(null);
      try {
        const hash = await writeContractAsync({
          address: ESCROW_ADDRESS as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: "claim",
          args: [
            bountyIdBig,
            BigInt(attestation.nonce),
            BigInt(attestation.expiry),
            attestation.signature
          ],
          chain: ACTIVE_CHAIN,
          account: address
        });
        setTxHash(hash);
        await waitForTransactionReceipt(config, { hash, chainId: ACTIVE_CHAIN.id });
        await refetchBounty();
        setPhase("work");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("verify");
      }
    },
    [address, bountyIdBig, canWrite, config, refetchBounty, writeContractAsync]
  );

  const handleWorldIdVerify = useCallback(
    async (result: ISuccessResult) => {
      if (!canWrite || !address) throw new Error("Connect a wallet on the configured contract network first");
      const proof: WorldIdSuccessResult = {
        nullifier_hash: result.nullifier_hash,
        merkle_root: result.merkle_root,
        proof: result.proof,
        verification_level: result.verification_level
      };
      const attestation = await requestAttestation({
        wallet: address,
        role: "worker",
        bountyId,
        action: WORLD_ACTION_WORKER,
        worldIdProof: proof
      });
      attestationRef.current = attestation;
      await runClaim(attestation);
    },
    [address, bountyId, canWrite, runClaim, WORLD_ACTION_WORKER]
  );

  // ─── Step 2: Build the evidence bundle (resize → WebP → CBOR → Zstd → sign) ─

  const buildBundle = useCallback(async () => {
    if (!beforeCapture || !afterCapture || !address) {
      setError("Capture both the before and after photos first.");
      return;
    }
    setPhase("building");
    setError(null);
    try {
      const beforeRes = await resizeAndEncodePhoto(beforeCapture.bytes);
      const afterRes = await resizeAndEncodePhoto(afterCapture.bytes);
      const gps = afterCapture.telemetry.lat !== null && afterCapture.telemetry.lng !== null
        ? afterCapture.telemetry
        : beforeCapture.telemetry;
      const orientation = (window as Window & { lastDeviceOrientation?: DeviceOrientationEvent })
        .lastDeviceOrientation;

      const metadata: EvidenceMetadata = {
        v: 1,
        bountyId,
        workerAddress: address,
        challengeCode,
        beforeTimestampMs: beforeCapture.telemetry.timestampMs,
        afterTimestampMs: afterCapture.telemetry.timestampMs,
        gps: {
          lat: gps.lat ?? 0,
          lng: gps.lng ?? 0,
          accuracyMeters: gps.accuracyM ?? 0
        },
        orientation: {
          alpha: orientation?.alpha ?? null,
          beta: orientation?.beta ?? null,
          gamma: orientation?.gamma ?? null
        },
        beforeSha256: beforeRes.sha256Hex,
        afterSha256: afterRes.sha256Hex,
        userAgent: navigator.userAgent,
        notes: ""
      };

      const built = await buildSignedBundle({
        metadata,
        beforeImage: beforeRes.webpBytes,
        afterImage: afterRes.webpBytes,
        rawImagesOriginalBytes: beforeCapture.rawBytes + afterCapture.rawBytes,
        signPayloadHash: async (payloadHash) =>
          signMessageAsync({ message: { raw: payloadHash } })
      });

      setStats(built.stats);
      setBundleResult({
        bundle: built.bundle,
        evidenceHash: built.evidenceHash,
        entityKey: "",
        entityKeyBytes32: ""
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("work");
    }
  }, [
    address,
    afterCapture,
    beforeCapture,
    challengeCode,
    bountyId,
    deviceSummary,
    phase,
    signMessageAsync
  ]);

  // ─── Step 3: Write to Arkiv → submitEvidence() ─────────────────────────────

  const publishAndSubmit = useCallback(async () => {
    if (!canWrite || !bundleResult || !address || !bountyIdBig || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured contract network before submitting evidence.");
      return;
    }
    setPhase("publishing");
    setError(null);
    try {
      const client = getArkivClient();
      const writeRes = await import("@streetsync/arkiv-client").then((m) =>
        m.writeEvidenceBundle(
          client,
          bundleResult.bundle,
          address,
          bountyId,
          bundleResult.evidenceHash
        )
      );

      rememberEntityMapping(bountyId, writeRes.entityKey);
      localStorage.setItem(
        `streetsync:arkivkey:${writeRes.entityKeyBytes32.toLowerCase()}`,
        writeRes.entityKey
      );

      setBundleResult({
        ...bundleResult,
        entityKey: writeRes.entityKey,
        entityKeyBytes32: writeRes.entityKeyBytes32
      });

      setPhase("submitting");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "submitEvidence",
        args: [
          bountyIdBig,
          writeRes.entityKeyBytes32 as `0x${string}`,
          bundleResult.evidenceHash as `0x${string}`
        ],
        chain: ACTIVE_CHAIN,
        account: address
      });
      setTxHash(hash);
      await waitForTransactionReceipt(config, { hash, chainId: ACTIVE_CHAIN.id });
      await refetchBounty();
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("work");
    }
  }, [address, bountyId, bountyIdBig, bundleResult, canWrite, config, refetchBounty, writeContractAsync]);

  const resetCaptures = useCallback(() => {
    setBeforeCapture(null);
    setAfterCapture(null);
    setStats(null);
    setBundleResult(null);
    setPhase("work");
  }, []);

  // ─── Derived view state ────────────────────────────────────────────────────

  const canBuild = phase === "work" && beforeCapture !== null && afterCapture !== null;
  const pendingSlot: "before" | "after" | null =
    beforeCapture === null ? "before" : afterCapture === null ? "after" : null;

  if (!bountyIdBig) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-sm text-red-600">Invalid bounty id: {bountyId}</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-indigo-600">
          ← Back to the map
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Work bounty #{bountyId}</h1>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Verify → claim → before/after photos → Arkiv → submitEvidence
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {txHash && (
        <div className="mb-4 break-all rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          Last tx: {txHash}
        </div>
      )}

      {/* Step 1 — World ID + claim */}
      {phase === "verify" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">1 · Verify with World ID</h2>
          <p className="mt-1 text-xs text-gray-500">
            Prove humanity once with World ID v4. The backend countersigns an EIP-712
            attestation which this page submits to <code>claim()</code>.
          </p>
          {!isConnected && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              Connect your wallet (header) before verifying.
            </p>
          )}
          {status === 0 && isConnected && (
            <div className="mt-4">
              <IDKitWidget
                app_id={WORLD_APP_ID}
                action={WORLD_ACTION_WORKER}
                signal={address}
                handleVerify={handleWorldIdVerify}
                onSuccess={() => {
                  /* claim already ran inside handleVerify */
                }}
                onError={(err) => setError(`World ID error: ${err.code} — ${err.message}`)}
              >
                {({ open }) => (
                  <button
                    type="button"
                    onClick={open}
                    disabled={!canWrite}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99]"
                  >
                    Verify with World ID &amp; claim
                  </button>
                )}
              </IDKitWidget>
            </div>
          )}
          {status !== 0 && (
            <p className="mt-3 text-xs text-gray-500">
              This bounty is no longer open for claims (status {statusName(status)}).
            </p>
          )}
        </section>
      )}

      {phase === "claiming" && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-700">
          Submitting claim() — confirm the transaction in your wallet…
        </div>
      )}

      {/* Step 2 — camera + challenge code */}
      {(["work", "building", "publishing", "submitting", "done"].includes(phase) ||
        isWorker) && (
        <section className="mt-4 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">
              2 · Visual Challenge Code
            </h2>
            {challengeCode > 0 ? (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  Emitted deterministically by the contract on claim. It is burned into
                  every photo frame by the camera HUD — keep it visible while shooting.
                </p>
                <div className="mt-3 flex items-center justify-center gap-1">
                  {String(challengeCode)
                    .padStart(4, "0")
                    .split("")
                    .map((digit, i) => (
                      <span
                        key={i}
                        className="rounded-lg border-2 border-indigo-500 bg-indigo-50 px-3 py-2 font-mono text-2xl font-bold text-indigo-700"
                      >
                        {digit}
                      </span>
                    ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                No challenge code yet — it appears after claim().
              </p>
            )}
          </div>

          {pendingSlot && challengeCode > 0 && (
            <CameraCapture
              slot={pendingSlot}
              challengeCode={challengeCode}
              onCapture={(result) =>
                pendingSlot === "before"
                  ? setBeforeCapture(result)
                  : setAfterCapture(result)
              }
            />
          )}

          {(beforeCapture || afterCapture) && (
            <div className="grid grid-cols-2 gap-3">
              {[beforeCapture, afterCapture].map((cap, i) =>
                cap ? (
                  <div key={i} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cap.previewUrl} alt={`${cap.slot} capture`} className="h-40 w-full object-cover" />
                    <div className="p-2 text-[11px] text-gray-500">
                      <span className="font-semibold capitalize text-gray-700">{cap.slot}</span>
                      {cap.telemetry.lat !== null && (
                        <>
                          {" · "}
                          {cap.telemetry.lat.toFixed(5)}, {cap.telemetry.lng?.toFixed(5)} ±
                          {cap.telemetry.accuracyM !== null
                            ? Math.round(cap.telemetry.accuracyM)
                            : "?"}
                          m
                        </>
                      )}
                      {cap.telemetry.headingDeg !== null && (
                        <> · {Math.round(cap.telemetry.headingDeg)}°</>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 text-xs text-gray-400">
                    {i === 0 ? "Before photo" : "After photo"}
                  </div>
                )
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={phase === "building" || !canBuild}
              onClick={buildBundle}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {phase === "building" ? "Building bundle…" : "Build evidence bundle"}
            </button>
            {(beforeCapture || afterCapture) && phase === "work" && (
              <button
                type="button"
                onClick={resetCaptures}
                className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Retake
              </button>
            )}
          </div>

          <CompressionStatsPanel stats={stats} busy={phase === "building"} />

          {stats && bundleResult && phase !== "publishing" && phase !== "submitting" && (
            <button
              type="button"
              onClick={publishAndSubmit}
              disabled={phase === "done" || !canWrite}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {phase === "done"
                ? "Evidence submitted ✓"
                : "Publish to Arkiv & submitEvidence"}
            </button>
          )}

          {(phase === "publishing" || phase === "submitting") && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700">
              {phase === "publishing"
                ? "Writing the SSYN bundle to Arkiv…"
                : "Calling submitEvidence(bountyId, arkivKey, evidenceHash) — confirm in your wallet…"}
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                Evidence published. The panel is selected 2 blocks after this transaction
                (Rule 4), then commit-reveal voting runs.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/bounty/${bountyId}`}
                  className="rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Bounty detail
                </Link>
                <Link
                  href={`/audit/${bountyId}`}
                  className="rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Public audit
                </Link>
              </div>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Back to the map
              </button>
            </div>
          )}
        </section>
      )}

      {evidenceHash && evidenceHash !== "0x" + "0".repeat(64) && (
        <p className="mt-6 break-all rounded-xl bg-gray-50 p-3 text-[11px] text-gray-500">
          On-chain evidence hash: {evidenceHash}
        </p>
      )}

      <p className="mt-8 text-center text-xs text-gray-400">
        Escrow {(ESCROW_ADDRESS ?? "").slice(0, 10)}… · USDC{" "}
        {(typeof usdcBalance === "bigint" ? formatUsdcDisplay(usdcBalance) : "—")} available
      </p>
    </main>
  );
}
