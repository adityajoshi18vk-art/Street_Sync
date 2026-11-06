"use client";

import { waitTx } from "@/lib/tx";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import WorldIdButton from "@/components/WorldIdButton";
import { useAccount, useChainId, useConfig, useReadContract, useSignMessage, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { decodeEventLog, type Hash } from "viem";

import {
  ACTIVE_CHAIN,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  USDC_ABI,
  contractsDeployed,
  formatUsdcDisplay
} from "@/config/contracts";
import type { Attestation } from "@/lib/api";
import { getArkivClient, rememberEntityMapping } from "@/lib/arkiv";
import { buildSignedBundle, type CompressionStats, type EvidenceMetadata } from "@/lib/evidence";
import { statusName } from "@/lib/types";
import { friendlyError } from "@/lib/errors";
import { STATUS, canRework, countdownLabel, isClaimable, toLifecycleBounty, willReopenAfterRejection } from "@/lib/lifecycle";
import { useBountyReport } from "@/lib/useBountyReport";
import { useNow } from "@/lib/useNow";
import ReportCard from "@/components/ReportCard";
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
    return typeof bountyId === "string" && /^\d+$/.test(bountyId) ? BigInt(bountyId) : null;
  }, [bountyId]);

  const { data: bounty, refetch: refetchBounty } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getBounty",
    args: bountyIdBig !== null ? [bountyIdBig] : undefined,
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

  const b = bounty as
    | {
        creator: string;
        worker: string;
        status: number;
        visualChallengeCode: number;
        evidenceHash: string;
        validationDeadline: bigint;
        claimDeadline: bigint;
        workDeadline: bigint;
        reworkCount: number;
      }
    | undefined;
  const now = useNow();
  const lc = b ? toLifecycleBounty(b) : null;
  const status = b ? Number(b.status) : -1;
  const worker = b?.worker;
  const challengeCode = b ? Number(b.visualChallengeCode) : 0;
  const isWorker = !!address && !!worker && worker.toLowerCase() === address.toLowerCase();
  const isCreator = !!address && !!b && b.creator.toLowerCase() === address.toLowerCase();
  const evidenceHash = b?.evidenceHash ?? null;
  const { report } = useBountyReport(bountyId);

  const myPledge = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "pledges",
    args: bountyIdBig !== null && address ? [bountyIdBig, address] : undefined,
    query: { enabled: contractsDeployed && bountyIdBig !== null && !!address }
  }).data as bigint | undefined;
  const myProblemVote = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "problemVote",
    args: bountyIdBig !== null && address ? [bountyIdBig, address] : undefined,
    query: { enabled: contractsDeployed && bountyIdBig !== null && !!address }
  }).data as number | undefined;
  const blocked = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "blockedWorker",
    args: bountyIdBig !== null && address ? [bountyIdBig, address] : undefined,
    query: { enabled: contractsDeployed && bountyIdBig !== null && !!address }
  }).data as boolean | undefined;

  // Mirrors the contract's claim() checks so ineligible wallets get a reason, not a revert.
  const claimBlockReason = !lc
    ? null
    : !isClaimable(lc, now)
      ? status === STATUS.Open
        ? "This bounty's claim deadline has passed."
        : `This bounty is not open for claims (status ${statusName(status)}).`
      : isCreator
        ? "You created this bounty, so you can't claim it."
        : (myPledge ?? 0n) > 0n
          ? "You pledged to this bounty, so you can't claim it."
          : (myProblemVote ?? 0) !== 0
            ? "You voted on this problem as a neighbour, so you can't claim it."
            : blocked
              ? "You were removed from this bounty after missing a deadline, so you can't claim it again."
              : null;
  const workDeadline = lc?.workDeadline ?? 0;
  const [reworkBusy, setReworkBusy] = useState(false);

  useEffect(() => {
    if (isWorker && status === STATUS.Claimed && phase === "verify") setPhase("work");
  }, [isWorker, status, phase]);

  // ─── Step 1: World ID verify → attestation → claim() ───────────────────────

  const runClaim = useCallback(
    async (attestation: Attestation) => {
      if (!canWrite || !address || bountyIdBig === null || !ESCROW_ADDRESS) {
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
        chainId: ACTIVE_CHAIN.id,
          account: address
        });
        setTxHash(hash);
        await waitTx(config, hash);
        await refetchBounty();
        setPhase("work");
      } catch (err) {
        setError(friendlyError(err));
        setPhase("verify");
      }
    },
    [address, bountyIdBig, canWrite, config, refetchBounty, writeContractAsync]
  );

  const handleAttestation = useCallback(
    async (attestation: Attestation) => {
      setError(null);
      attestationRef.current = attestation;
      await runClaim(attestation);
    },
    [runClaim]
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
      setError(friendlyError(err));
      setPhase("work");
    }
  }, [
    address,
    afterCapture,
    beforeCapture,
    challengeCode,
    bountyId,
    phase,
    signMessageAsync
  ]);

  // ─── Step 3: Write to Arkiv → submitEvidence() ─────────────────────────────

  const publishAndSubmit = useCallback(async () => {
    if (!canWrite || !bundleResult || !address || bountyIdBig === null || !ESCROW_ADDRESS) {
      setError("Connect a wallet on the configured contract network before submitting evidence.");
      return;
    }
    setError(null);
    try {
      // A retry after a failed submitEvidence reuses the entity already written to Arkiv.
      let writeRes = bundleResult.entityKeyBytes32
        ? { entityKey: bundleResult.entityKey, entityKeyBytes32: bundleResult.entityKeyBytes32 }
        : null;
      if (!writeRes) {
        setPhase("publishing");
        const client = getArkivClient();
        writeRes = await import("@streetsync/arkiv-client").then((m) =>
          m.writeEvidenceBundle(client, bundleResult.bundle, address, bountyId, bundleResult.evidenceHash)
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
      }

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
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setTxHash(hash);
      await waitTx(config, hash);
      await refetchBounty();
      setPhase("done");
    } catch (err) {
      setError(friendlyError(err));
      setPhase("work");
    }
  }, [address, bountyId, bountyIdBig, bundleResult, canWrite, config, refetchBounty, writeContractAsync]);

  const runRework = useCallback(async () => {
    if (!canWrite || !address || bountyIdBig === null || !ESCROW_ADDRESS) return;
    setReworkBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "rework",
        args: [bountyIdBig],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setTxHash(hash);
      await waitTx(config, hash);
      setBeforeCapture(null);
      setAfterCapture(null);
      setStats(null);
      setBundleResult(null);
      await refetchBounty();
      setPhase("work");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setReworkBusy(false);
    }
  }, [address, bountyIdBig, canWrite, config, refetchBounty, writeContractAsync]);

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

  if (bountyIdBig === null) {
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

      {report && (
        <div className="mb-4">
          <ReportCard report={report} compact title="Problem to fix" />
        </div>
      )}

      {isWorker && status === STATUS.Claimed && workDeadline > 0 && (
        <div className={`mb-4 rounded-xl border p-3 text-xs ${now > workDeadline ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {now > workDeadline
            ? "Your work deadline has passed. Anyone can now reopen this bounty for other workers; submit immediately if you can."
            : `Submit your evidence within ${countdownLabel(workDeadline, now)}. After that the bounty can be reopened for other workers.`}
        </div>
      )}

      {isWorker && status === STATUS.Rejected && lc && (
        <section className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <h2 className="font-semibold">Reviewers rejected the work</h2>
          {canRework(lc, now, true) ? (
            <>
              <p className="mt-1 text-xs">
                You have one chance to redo it. Rework within {countdownLabel(lc.workDeadline, now)}, then take new
                before/after photos and submit again.
              </p>
              <button
                type="button"
                onClick={() => void runRework()}
                disabled={reworkBusy || !canWrite}
                className="mt-3 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                {reworkBusy ? "Confirm in your wallet…" : "Rework this bounty"}
              </button>
            </>
          ) : willReopenAfterRejection(lc, now) ? (
            <p className="mt-1 text-xs">
              The rework window is over, so this bounty will reopen for other workers.
            </p>
          ) : null}
        </section>
      )}

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
          {isConnected && claimBlockReason && !isWorker && (
            <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{claimBlockReason}</p>
          )}
          {isConnected && lc && !claimBlockReason && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-gray-500">
                Claim before {new Date(lc.claimDeadline * 1000).toLocaleString()}. After claiming you will have a
                limited time to submit before/after photos.
              </p>
              <WorldIdButton
                role="worker"
                bountyId={bountyId}
                wallet={address}
                disabled={!canWrite}
                label="Verify with World ID & claim"
                onAttestation={handleAttestation}
                onError={setError}
              />
            </div>
          )}

        </section>
      )}

      {phase === "claiming" && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-700">
          Submitting claim() — confirm the transaction in your wallet…
        </div>
      )}

      {/* Step 2 — camera + challenge code */}
      {((isWorker && status === STATUS.Claimed) || phase === "done") && (
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
