"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IDKitWidget, VerificationLevel } from "@worldcoin/idkit";
import type { ISuccessResult } from "@worldcoin/idkit";
import {
  useAccount,
  useBlockNumber,
  useConfig,
  useReadContract,
  useWriteContract
} from "wagmi";
import type { Hash } from "viem";

import {
  ACTIVE_CHAIN,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  USDC_ABI,
  WORLD_APP_ID,
  WORLD_ACTION_REVIEWER,
  contractsDeployed,
  formatUsdc,
  formatUsdcDisplay,
  regionCellFromLatLng
} from "@/config/contracts";
import { approveUsdcExact } from "@/lib/tx";
import { getReviewerAssignments, requestAttestation, type Attestation, type WorldIdSuccessResult } from "@/lib/api";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import { readBountyStruct, shortAddress, statusName, type ReviewerAssignment } from "@/lib/types";
import type { ArkivVerificationResult } from "@streetsync/arkiv-client";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import CommitRevealCard from "@/components/CommitRevealCard";
import { HashBadge } from "@/components/StatusBadge";
import { getVideoPlaybackUrl, getVideoUrl } from "@streetsync/swarm-client";

// ─── Registration card ───────────────────────────────────────────────────────

function RegistrationCard({ onRegistered }: { onRegistered: () => void }) {
  const { address } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const attestationRef = useRef<Attestation | null>(null);

  const { data: reviewerTuple } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "reviewers",
    args: address ? [address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: stakeRaw } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "REVIEWER_STAKE",
    query: { enabled: contractsDeployed }
  });

  const reviewer = reviewerTuple as
    | { wallet: string; regionCell: number; stakedAmount: bigint; active: boolean; rewardBalance: bigint }
    | undefined;
  const registered = !!reviewer && reviewer.active;
  const stake = typeof stakeRaw === "bigint" ? stakeRaw : 2_000_000n;

  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);

  const register = useCallback(
    async (attestation: Attestation) => {
      if (!address) throw new Error("Connect a wallet first");
      if (!ESCROW_ADDRESS) throw new Error("Escrow contract is not deployed on this network");
      setBusy(true);
      setError(null);
      try {
        await approveUsdcExact({
          config,
          owner: address,
          spender: ESCROW_ADDRESS,
          amountUsdc: formatUsdc(stake),
          writeContractAsync
        });

        const hash = await writeContractAsync({
          address: ESCROW_ADDRESS as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: "registerReviewer",
          args: [
            gps ? regionCellFromLatLng(gps.lat, gps.lng) : 0,
            BigInt(attestation.nonce),
            BigInt(attestation.expiry),
            attestation.signature
          ],
          chain: ACTIVE_CHAIN,
          account: address
        });
        setTxHash(hash);
        onRegistered();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [address, config, gps, onRegistered, stake, writeContractAsync]
  );

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation unavailable — registering with region 0");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError(null);
      },
      () => setGpsError("Location denied — registering with region 0"),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, []);

  const handleDevBypassReviewer = useCallback(async () => {
    if (!address) {
      setError("Connect a wallet first");
      return;
    }
    setError(null);
    try {
      const syntheticProof: WorldIdSuccessResult = {
        nullifier_hash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
        merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000001",
        proof: "0x0000000000000000000000000000000000000000000000000000000000000001",
        verification_level: "device"
      };
      const attestation = await requestAttestation({
        wallet: address,
        role: "reviewer",
        bountyId: "0",
        action: WORLD_ACTION_REVIEWER,
        worldIdProof: syntheticProof,
        devBypass: true
      });
      attestationRef.current = attestation;
      await register(attestation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [address, register]);

  return (
    <section className="card p-5 animate-rise">
      <h2 className="heading text-sm">Reviewer registration</h2>
      {registered ? (
        <div className="mt-3 space-y-1 text-sm text-zinc-300">
          <p className="font-semibold text-emerald-300">Active reviewer ✓</p>
          <p className="text-xs text-zinc-400">
            Region cell {reviewer?.regionCell} · stake{" "}
            {reviewer ? formatUsdcDisplay(reviewer.stakedAmount) : "—"} USDC · rewards{" "}
            {reviewer ? formatUsdcDisplay(reviewer.rewardBalance) : "—"} USDC
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-400">
            Verify with World ID, approve exactly {formatUsdcDisplay(stake)} USDC of stake, and
            register. Stakes are slashed if you sit on a panel and fail to reveal.
          </p>
          {!address ? (
            <p className="mt-3 alert-warn text-xs">
              Connect your wallet (header) to register.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between card-inset p-3 text-xs text-zinc-400">
                <span>
                  Region: <span className="font-semibold">{gps ? regionCellFromLatLng(gps.lat, gps.lng) : "—"}</span>
                  {gps && (
                    <span className="ml-1 text-zinc-500">
                      ({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={requestGps}
                  className="btn-ghost btn-sm"
                >
                  {gps ? "Refresh" : "Use my GPS"}
                </button>
              </div>
              {gpsError && <p className="text-xs text-amber-300">{gpsError}</p>}
              {error && <p className="text-xs text-red-300">{error}</p>}
              {txHash && (
                <p className="break-all text-[11px] text-emerald-300">Registration tx: {txHash}</p>
              )}
              <IDKitWidget
                app_id={WORLD_APP_ID}
                action={WORLD_ACTION_REVIEWER}
                signal={address ?? undefined}
                verification_level={VerificationLevel.Device}
                handleVerify={async (result: ISuccessResult) => {
                  if (!address) throw new Error("Connect a wallet first");
                  const attestation = await requestAttestation({
                    wallet: address,
                    role: "reviewer",
                    bountyId: "0",
                    action: WORLD_ACTION_REVIEWER,
                    worldIdProof: {
                      nullifier_hash: result.nullifier_hash,
                      merkle_root: result.merkle_root,
                      proof: result.proof,
                      verification_level: result.verification_level
                    }
                  });
                  attestationRef.current = attestation;
                }}
                onSuccess={() => {
                  if (attestationRef.current) void register(attestationRef.current);
                }}
                onError={(err) => setError(`World ID error: ${err.code} — ${err.message}`)}
              >
                {({ open }) => (
                  <button
                    type="button"
                    onClick={open}
                    disabled={busy}
                    className="btn-primary w-full py-3"
                  >
                    {busy ? (
                      <>
                        <span className="spinner spinner-sm spinner-inherit" />
                        Registering…
                      </>
                    ) : (
                      "Verify & stake to become a reviewer"
                    )}
                  </button>
                )}
              </IDKitWidget>
              <button
                type="button"
                onClick={handleDevBypassReviewer}
                disabled={busy}
                className="btn-ghost w-full py-2.5 text-xs text-brand-300 hover:text-brand-200 border border-brand-500/20 rounded-lg flex items-center justify-center gap-1.5 transition-colors hover:border-brand-500/40"
              >
                ⚡ Instant Reviewer Registration (Dev / Demo Bypass)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Evidence panel (Arkiv fetch + verification) ─────────────────────────────

interface EvidencePanelProps {
  bountyId: string;
  arkivKey: string;
  evidenceHash: string | null;
  worker: string | null;
}

function EvidencePanel({ bountyId, arkivKey, evidenceHash, worker }: EvidencePanelProps) {
  const [verification, setVerification] = useState<ArkivVerificationResult | null>(null);
  const [bundleSize, setBundleSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!arkivKey || arkivKey === "0x" + "0".repeat(64)) {
      setError("No evidence key on-chain yet.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = getArkivClient();
      const candidates = [
        lookupStoredEntityKey(arkivKey),
        lookupBountyEntityKey(bountyId),
        arkivKey
      ]
        .filter((k): k is string => !!k)
        .filter((k, i, arr) => arr.indexOf(k) === i);

      const mod = await import("@streetsync/arkiv-client");
      let read: { bundle: Uint8Array } | null = null;
      let usedKey: string | null = null;
      for (const key of candidates) {
        try {
          read = await mod.readEvidenceBundle(client, key);
          usedKey = key;
          break;
        } catch {
          continue;
        }
      }
      if (!read || !usedKey) {
        throw new Error(
          `Evidence not found in Arkiv storage (tried ${candidates.length} key candidate${candidates.length === 1 ? "" : "s"})`
        );
      }

      setBundleSize(read.bundle.length);

      const result = await mod.verifyEvidenceBundle(
        client,
        usedKey,
        evidenceHash ?? "",
        worker ?? ""
      );
      setVerification(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [arkivKey, bountyId, evidenceHash, worker]);

  useEffect(() => {
    if (arkivKey) void load();
  }, [arkivKey, load]);

  const toWebpBlob = (bytes: Uint8Array): Blob =>
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/webp" });

  const beforeUrl = useMemo(() => {
    const img = verification?.beforeImage;
    return img ? URL.createObjectURL(toWebpBlob(img)) : null;
  }, [verification]);

  const afterUrl = useMemo(() => {
    const img = verification?.afterImage;
    return img ? URL.createObjectURL(toWebpBlob(img)) : null;
  }, [verification]);

  return (
    <section className="card p-5 animate-rise">
      <div className="flex items-center justify-between">
        <h3 className="heading text-sm">Evidence (Arkiv)</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost btn-sm"
        >
          {loading ? (
            <>
              <span className="spinner spinner-sm" />
              Fetching…
            </>
          ) : (
            "Re-fetch"
          )}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      {verification && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                verification.evidenceHashMatch
                  ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
                  : "bg-red-400/10 text-red-300 ring-red-400/30"
              }`}
            >
              {verification.evidenceHashMatch ? "SHA-256 hash match" : "Hash mismatch"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                verification.signatureValid
                  ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
                  : "bg-red-400/10 text-red-300 ring-red-400/30"
              }`}
            >
              {verification.signatureValid ? "Worker signature valid" : "Signature invalid"}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-300 ring-1 ring-white/10">
              {bundleSize ? `${(bundleSize / 1024).toFixed(1)} KiB bundle` : ""}
            </span>
          </div>

          {beforeUrl && afterUrl ? (
            <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={afterUrl} />
          ) : (
            <p className="text-xs text-zinc-500">Photos unavailable in bundle.</p>
          )}

          {verification.metadata?.video && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                    Ethereum Swarm (BZZ)
                  </span>
                  <span className="text-xs font-semibold text-amber-200">
                    Video Walkthrough ({verification.metadata.video.durationSeconds}s)
                  </span>
                </div>
                <a
                  href={getVideoUrl(verification.metadata.video.swarmReference)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline"
                >
                  Verify on Swarm Gateway ↗
                </a>
              </div>
              <video
                src={getVideoPlaybackUrl(verification.metadata.video.swarmReference)}
                controls
                playsInline
                className="w-full max-h-64 rounded-lg bg-black object-contain"
              />
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-amber-200">
                <span>Ref: {verification.metadata.video.swarmReference.slice(0, 20)}…</span>
                <span>SHA: {verification.metadata.video.videoSha256.slice(0, 16)}…</span>
              </div>
            </div>
          )}

          {verification.metadata && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              <dt>Challenge code</dt>
              <dd className="font-mono font-semibold text-zinc-200">
                {String(verification.metadata.visualChallengeCode).padStart(4, "0")}
              </dd>
              <dt>GPS accuracy</dt>
              <dd>±{Math.round(verification.metadata.gpsAccuracyM)} m</dd>
              <dt>Heading</dt>
              <dd>
                {verification.metadata.compassHeadingDeg !== null
                  ? `${Math.round(verification.metadata.compassHeadingDeg)}°`
                  : "n/a"}
              </dd>
              <dt>Captured</dt>
              <dd>{new Date(verification.metadata.beforeTimestamp).toLocaleString()}</dd>
              <dt>Worker</dt>
              <dd>{shortAddress(verification.recoveredWorker ?? worker, 4)}</dd>
            </dl>
          )}
          {verification.errors.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-amber-300">
              {verification.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!verification && !loading && !error && (
        <p className="mt-2 text-xs text-zinc-500">Press Re-fetch to pull the bundle.</p>
      )}
    </section>
  );
}

// ─── Per-bounty assignment card ──────────────────────────────────────────────

function AssignmentCard({
  assignment,
  onTx
}: {
  assignment: ReviewerAssignment;
  onTx: () => void;
}) {
  const { address } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const bountyIdBig = BigInt(assignment.bountyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [justSettled, setJustSettled] = useState(false);

  const { data: raw } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getBounty",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed, refetchInterval: 15_000 }
  });

  const { data: blockNumber } = useBlockNumber({ watch: true });

  const { data: panel } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getPanel",
    args: [bountyIdBig, assignment.reviewRound],
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: myVoteTuple } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getVote",
    args: address ? [bountyIdBig, assignment.reviewRound, address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: commitDeadlineRaw } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "commitDeadline",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed }
  });
  const { data: revealDeadlineRaw } = useReadContract({
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "revealDeadline",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed }
  });

  const b = readBountyStruct(raw);
  const status = b ? b.status : (assignment.bountyStatus ?? -1);
  const worker = b ? b.worker : assignment.worker;
  const arkivKey = b ? b.arkivEntityKey : null;
  const evidenceHash = b ? b.evidenceHash : null;
  const selectionBlock = b ? BigInt(b.selectionBlock) : null;
  const reviewRound = b ? b.reviewRound : assignment.reviewRound;
  const totalPledged = b ? b.totalPledged : BigInt(assignment.totalPledged || "0");

  const panelMembers = (panel as unknown as string[] | undefined) ?? [];
  const onPanel = !!address && panelMembers.some((m) => m.toLowerCase() === address.toLowerCase());
  const myVote = myVoteTuple as
    | { commitHash: string; revealed: boolean; approve: boolean; committed: boolean }
    | undefined;

  const blocksRemaining =
    selectionBlock !== null && typeof blockNumber === "bigint"
      ? Number(selectionBlock) - Number(blockNumber)
      : null;
  const panelReady =
    selectionBlock !== null && typeof blockNumber === "bigint" && blockNumber > selectionBlock;

  const runTx = useCallback(
    async (fn: "assignPanel" | "settle" | "pokeOrReplace") => {
      setBusy(true);
      setError(null);
      try {
        const hash = await writeContractAsync({
          address: ESCROW_ADDRESS as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: fn,
          args: [bountyIdBig],
          chain: ACTIVE_CHAIN,
          account: address
        });
        setTxHash(hash);
        if (fn === "settle") setJustSettled(true);
        onTx();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [address, bountyIdBig, onTx, writeContractAsync]
  );

  const revealExpired =
    typeof revealDeadlineRaw === "bigint" &&
    Date.now() / 1000 > Number(revealDeadlineRaw) &&
    status === 3;

  return (
    <div className="space-y-3 card p-5">
      <div className="flex items-center justify-between">
        <Link
          href={`/bounty/${assignment.bountyId}`}
          className="text-sm font-semibold text-brand-300 hover:text-brand-200 hover:underline"
        >
          Bounty #{assignment.bountyId}
        </Link>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10">
          {statusName(status)} · round {reviewRound}
        </span>
      </div>
      <p className="text-xs text-zinc-400">
        Pool {formatUsdcDisplay(totalPledged)} USDC · panel{" "}
        {panelMembers.filter((m) => m !== "0x0000000000000000000000000000000000000000").length}/3
        {myVote?.committed ? ` · committed${myVote.revealed ? " & revealed" : ""}` : ""}
      </p>

      {status === 2 && (
        <div className="card-inset p-3">
          <p className="text-xs text-zinc-300">
            {panelReady
              ? "Selection block reached — you can assign the panel now."
              : `Waiting for randomness: ${blocksRemaining !== null && blocksRemaining > 0 ? `${blocksRemaining} more block${blocksRemaining === 1 ? "" : "s"}` : "confirming…"} (needs block > ${selectionBlock?.toString()})`}
          </p>
          <button
            type="button"
            disabled={!panelReady || busy}
            onClick={() => void runTx("assignPanel")}
            className="btn-primary btn-sm mt-2 w-full"
          >
            Assign panel
          </button>
        </div>
      )}

      {status === 3 && (
        <>
          <EvidencePanel
            bountyId={assignment.bountyId}
            arkivKey={arkivKey ?? ""}
            evidenceHash={evidenceHash}
            worker={worker}
          />
          {onPanel ? (
            typeof commitDeadlineRaw === "bigint" && typeof revealDeadlineRaw === "bigint" ? (
              <CommitRevealCard
                bountyId={bountyIdBig}
                reviewRound={reviewRound}
                commitDeadline={commitDeadlineRaw}
                revealDeadline={revealDeadlineRaw}
                totalPledged={totalPledged}
                onTxSuccess={onTx}
              />
            ) : (
              <p className="text-xs text-zinc-500">Loading voting windows…</p>
            )
          ) : (
            <p className="card-inset p-3 text-xs text-zinc-400">
              You are not on this panel (3 reviewers were drawn from your region pool). You can
              still inspect the evidence above and settle once the window closes.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!revealExpired || busy}
              onClick={() => void runTx("pokeOrReplace")}
              className="btn btn-sm w-full bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30 hover:bg-amber-400/20"
              title="Slash & replace reviewers who missed the reveal window"
            >
              Slash / replace inactive
            </button>
            <button
              type="button"
              disabled={!revealExpired || busy || justSettled}
              onClick={() => void runTx("settle")}
              className="btn btn-sm w-full bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-400/20"
            >
              {justSettled ? (
                <>
                  <span className="spinner spinner-sm border-emerald-300/30 border-t-emerald-300" />
                  Settling…
                </>
              ) : (
                "Settle bounty"
              )}
            </button>
          </div>
        </>
      )}

      {(status === 4 || status === 5) && (
        <EvidencePanel
          bountyId={assignment.bountyId}
          arkivKey={arkivKey ?? ""}
          evidenceHash={evidenceHash}
          worker={worker}
        />
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}
      {txHash && (
        <HashBadge label="tx" hash={txHash} href={`${ACTIVE_CHAIN.blockExplorers?.default?.url}/tx/${txHash}`} />
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const { address } = useAccount();
  const [assignments, setAssignments] = useState<ReviewerAssignment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    if (!address) {
      setAssignments(null);
      return;
    }
    try {
      const list = await getReviewerAssignments(address);
      setAssignments(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [address]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      <header className="mb-8 animate-rise">
        <h1 className="heading text-3xl">Reviewer dashboard</h1>
        <p className="mt-1.5 text-[15px] leading-5 text-zinc-400">
          Stake, inspect evidence, commit-reveal your vote, and keep panels honest.
        </p>
      </header>

      <div className="space-y-4">
        <RegistrationCard onRegistered={() => void loadAssignments()} />

        {loadError && (
          <div className="alert-warn text-sm">
            {loadError} — the backend may be offline. Registration still works on-chain.
          </div>
        )}

        {assignments && assignments.length === 0 && (
          <p className="card border-dashed p-5 text-sm text-zinc-400">
            No panel assignments yet. Once registered, panels are drawn from your region pool
            after a worker submits evidence.
          </p>
        )}

        {assignments?.map((a) => (
          <AssignmentCard
            key={`${a.bountyId}:${a.reviewRound}`}
            assignment={a}
            onTx={() => void loadAssignments()}
          />
        ))}

        <p className="pt-4 text-center text-xs text-zinc-500">
          Escrow {shortAddress(ESCROW_ADDRESS, 4)} ·{" "}
          <Link href="/audit/1" className="text-zinc-400 underline hover:text-zinc-200">
            try the public audit
          </Link>
        </p>
      </div>
    </main>
  );
}
