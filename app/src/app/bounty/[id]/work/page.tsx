"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import WorldIdButton from "@/components/WorldIdButton";
import { useAccount, useChainId, useConfig, useReadContract, useSignMessage, useWriteContract } from "wagmi";
import { type Hash } from "viem";

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
import { useNowSeconds } from "@/lib/useNow";
import { waitTx } from "@/lib/tx";
import ReportCard from "@/components/ReportCard";
import CameraCapture, { type CaptureResult } from "@/components/CameraCapture";
import CompressionStatsPanel from "@/components/CompressionStatsPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { resizeAndEncodePhoto } from "@streetsync/evidence";
import {
  getVideoPlaybackUrl,
  type VideoEvidence
} from "@streetsync/swarm-client";

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
  const [videoWalkthrough, setVideoWalkthrough] = useState<VideoEvidence | null>(null);
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
        confirmations: number;
      }
    | undefined;
  const now = useNowSeconds();
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

  const { data: quorumRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "validationQuorum",
    query: { enabled: contractsDeployed }
  });
  const quorum = Math.max(1, Number(quorumRaw ?? 2));
  const awaitingNeighbours = status === STATUS.Proposed;
  const confirmations = b ? Number(b.confirmations) : 0;
  // Conflicts that will block claim() once the bounty opens.
  const futureConflict = isCreator
    ? "You reported this problem, so you won't be able to claim it."
    : (myPledge ?? 0n) > 0n
      ? "You pledged to this bounty, so you won't be able to claim it."
      : (myProblemVote ?? 0) !== 0
        ? "You voted on this problem as a neighbour, so you won't be able to claim it."
        : null;

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
            ? "You voted on this problem as a neighbour, so you won't be able to claim it."
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
        notes: "",
        video: videoWalkthrough ?? undefined
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
    signMessageAsync,
    videoWalkthrough
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
      let writeRes: { entityKey: string; entityKeyBytes32: string };
      if (bundleResult.entityKeyBytes32) {
        writeRes = { entityKey: bundleResult.entityKey, entityKeyBytes32: bundleResult.entityKeyBytes32 };
      } else {
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
    setVideoWalkthrough(null);
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
        <p className="text-sm text-red-300">Invalid bounty id: {bountyId}</p>
        <Link href="/" className="btn-ghost btn-sm mt-4">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to the map
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="animate-rise mb-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Work bounty #{bountyId}</h1>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Verify → claim → before/after photos → Arkiv → submitEvidence
        </p>
      </header>

      {report && (
        <div className="mb-4">
          <ReportCard report={report} compact title="Problem to fix" />
        </div>
      )}

      {isWorker && status === STATUS.Claimed && workDeadline > 0 && (
        <div className={`alert-warn mb-4 !p-3 text-xs ${now > workDeadline ? "!border-red-400/30 !bg-red-400/10 !text-red-300" : ""}`}>
          {now > workDeadline
            ? "Your work deadline has passed. Anyone can now reopen this bounty for other workers; submit immediately if you can."
            : `Submit your evidence within ${countdownLabel(workDeadline, now)}. After that the bounty can be reopened for other workers.`}
        </div>
      )}

      {isWorker && status === STATUS.Rejected && lc && (
        <section className="alert-error mb-4">
          <h2 className="font-semibold text-red-200">Reviewers rejected the work</h2>
          {canRework(lc, now, true) ? (
            <>
              <p className="mt-1 text-xs text-red-300">
                You have one chance to redo it. Rework within ${countdownLabel(lc.workDeadline, now)}, then take new
                before/after photos and submit again.
              </p>
              <button
                type="button"
                onClick={() => void runRework()}
                disabled={reworkBusy || !canWrite}
                className="btn-danger mt-3 w-full py-3"
              >
                {reworkBusy ? "Confirm in your wallet…" : "Rework this bounty"}
              </button>
            </>
          ) : willReopenAfterRejection(lc, now) ? (
            <p className="mt-1 text-xs text-red-300">
              The rework window is over, so this bounty will reopen for other workers.
            </p>
          ) : null}
        </section>
      )}

      {error && (
        <div className="alert-error mb-4">
          {error}
        </div>
      )}
      {txHash && (
        <div className="alert-success mb-4 break-all !p-3 text-xs">
          Last tx: {txHash}
        </div>
      )}

      {/* Step 1 — World ID + claim */}
      {phase === "verify" && (
        <section className="card animate-rise stagger-1 p-6">
          <h2 className="heading text-base">1 · Verify with World ID</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Prove humanity once with World ID 4.0. The backend countersigns an EIP-712
            attestation which this page submits to <code>claim()</code>.
          </p>
          {!isConnected && (
            <p className="alert-warn mt-3 !p-3 text-xs">
              Connect your wallet (header) before verifying.
            </p>
          )}

          {awaitingNeighbours && lc && (
            <div className="alert-warn mt-3">
              <p className="font-semibold text-amber-200">Not open yet — waiting for neighbours</p>
              <p className="mt-1 text-xs text-amber-300/90">
                {confirmations} of {quorum} neighbour confirmations. The claim button appears here as soon as{" "}
                {quorum} neighbours confirm the problem is real (voting {countdownLabel(lc.validationDeadline, now)}).
                If voting ends without enough confirmations, the report is dismissed and pledges are refunded.
              </p>
              <div className="mt-2 flex gap-1" aria-hidden>
                {Array.from({ length: quorum }, (_, i) => (
                  <span key={i} className={`h-1.5 w-10 rounded-full ${i < confirmations ? "bg-emerald-400" : "bg-amber-400/30"}`} />
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                {futureConflict ??
                  "Planning to do this job? Don't vote on it yourself — voting rules you out as the worker. Share the bounty link with people nearby so they can confirm it."}
              </p>
            </div>
          )}
          {isConnected && claimBlockReason && !isWorker && !awaitingNeighbours && (
            <p className="card-inset mt-3 p-3 text-xs text-zinc-400">{claimBlockReason}</p>
          )}
          {isConnected && lc && !claimBlockReason && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-zinc-400">
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
        <div className="alert-info animate-rise flex items-center gap-3 p-5">
          <span className="spinner spinner-sm" aria-hidden />
          <span>Submitting claim() — confirm the transaction in your wallet…</span>
        </div>
      )}

      {/* Step 2 — camera + challenge code */}
      {((isWorker && status === STATUS.Claimed) || phase === "done") && (
        <section className="mt-4 space-y-4">
          <div className="card animate-rise stagger-1 p-6">
            <h2 className="heading text-base">
              2 · Visual Challenge Code
            </h2>
            {challengeCode > 0 ? (
              <>
                <p className="mt-1 text-xs text-zinc-400">
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
                        className="rounded-xl border border-brand-400/40 bg-brand-500/10 px-3.5 py-2.5 font-mono text-2xl font-bold text-brand-200 shadow-glow-sm"
                      >
                        {digit}
                      </span>
                    ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-zinc-400">
                No challenge code yet — it appears after claim().
              </p>
            )}
          </div>

          {pendingSlot && challengeCode > 0 && (
            <CameraCapture
              slot={pendingSlot}
              challengeCode={challengeCode}
              videoWalkthrough={videoWalkthrough}
              onVideoRecorded={(res) => setVideoWalkthrough(res)}
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
                  <div key={i} className="card overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cap.previewUrl} alt={`${cap.slot} capture`} className="h-40 w-full object-cover" />
                    <div className="p-2.5 text-[11px] text-zinc-400">
                      <span className="font-semibold capitalize text-zinc-200">{cap.slot}</span>
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
                  <div key={i} className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-xs text-zinc-500">
                    {i === 0 ? "Before photo" : "After photo"}
                  </div>
                )
              )}
            </div>
          )}

          {videoWalkthrough && (
            <div className="alert-warn overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">
                    Swarm Video Walkthrough
                  </span>
                  <span className="text-xs text-amber-200">
                    {videoWalkthrough.durationSeconds}s · {(videoWalkthrough.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setVideoWalkthrough(null)}
                  className="text-xs font-medium text-amber-300 underline transition hover:text-amber-200"
                >
                  Remove
                </button>
              </div>
              <video
                src={getVideoPlaybackUrl(videoWalkthrough.swarmReference)}
                controls
                playsInline
                className="w-full max-h-56 rounded-xl bg-black ring-1 ring-white/10"
              />
              <p className="mt-2 text-[11px] font-mono text-amber-300/80 truncate">
                Bzz reference: {videoWalkthrough.swarmReference}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={phase === "building" || !canBuild}
              onClick={buildBundle}
              className="btn-primary flex-1 py-3"
            >
              {phase === "building" ? (
                <>
                  <span className="spinner spinner-sm spinner-inherit" aria-hidden />
                  Building bundle…
                </>
              ) : (
                "Build evidence bundle"
              )}
            </button>
            {(beforeCapture || afterCapture) && phase === "work" && (
              <button
                type="button"
                onClick={resetCaptures}
                className="btn-ghost py-3"
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
              className="btn-success w-full py-3"
            >
              {phase === "done"
                ? "Evidence submitted ✓"
                : "Publish to Arkiv & submitEvidence"}
            </button>
          )}

          {(phase === "publishing" || phase === "submitting") && (
            <div className="alert-info flex items-center gap-3">
              <span className="spinner spinner-sm" aria-hidden />
              <span>
                {phase === "publishing"
                  ? "Writing the SSYN bundle to Arkiv…"
                  : "Calling submitEvidence(bountyId, arkivKey, evidenceHash) — confirm in your wallet…"}
              </span>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-3">
              <div className="alert-success">
                Evidence published. Next, three reviewers are drawn at random: open the bounty page
                and tap <strong>Draw review panel</strong> (anyone can). Reviewers then vote, and you are
                paid when they approve.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/bounty/${bountyId}`}
                  className="btn-ghost py-3"
                >
                  Bounty detail
                </Link>
                <Link
                  href={`/audit/${bountyId}`}
                  className="btn-ghost py-3"
                >
                  Public audit
                </Link>
              </div>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="btn-ghost w-full py-3"
              >
                Back to the map
              </button>
            </div>
          )}
        </section>
      )}

      {evidenceHash && evidenceHash !== "0x" + "0".repeat(64) && (
        <p className="card-inset mt-6 break-all p-3 font-mono text-[11px] text-zinc-400">
          On-chain evidence hash: {evidenceHash}
        </p>
      )}

      <p className="mt-8 text-center text-xs text-zinc-500">
        Escrow {(ESCROW_ADDRESS ?? "").slice(0, 10)}… · USDC{" "}
        {(typeof usdcBalance === "bigint" ? formatUsdcDisplay(usdcBalance) : "—")} available
      </p>
    </main>
  );
}
