"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import WorldIdButton from "@/components/WorldIdButton";
import {
  useAccount,
  useBlockNumber,
  useChainId,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { erc20Abi, type Hash } from "viem";

import {
  ACTIVE_CHAIN,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  USDC_ABI,
  contractsDeployed,
  formatUsdc,
  formatUsdcDisplay,
  regionCellFromLatLng
} from "@/config/contracts";
import { approveUsdcExact, waitTx } from "@/lib/tx";
import { getReviewerAssignments } from "@/lib/api";
import { loadBounties } from "@/lib/bounty-source";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import { normalizeBounty, shortAddress, statusName, type OnChainBounty, type ReviewerAssignment } from "@/lib/types";
import { friendlyError } from "@/lib/errors";
import { useBountyReport } from "@/lib/useBountyReport";
import ReportCard from "@/components/ReportCard";
import type { ArkivVerificationResult } from "@streetsync/arkiv-client";
import { verifyEvidenceBundle } from "@streetsync/arkiv-client";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import CommitRevealCard from "@/components/CommitRevealCard";
import { HashBadge } from "@/components/StatusBadge";
import { getVideoPlaybackUrl, getVideoUrl } from "@streetsync/swarm-client";

// ─── Registration card ───────────────────────────────────────────────────────

function RegistrationCard({ onRegistered }: { onRegistered: () => void }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id && !!address;
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const { data: reviewerTuple } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "reviewers",
    args: address ? [address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: stakeRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "REVIEWER_STAKE",
    query: { enabled: contractsDeployed }
  });

  const reviewer = reviewerTuple as
    | { wallet: string; regionCell: number; stakedAmount: bigint; active: boolean; rewardBalance: bigint }
    | undefined;
  const registered = !!reviewer && reviewer.active;
  const rewards = reviewer?.rewardBalance ?? 0n;
  const previouslyRegistered = !!reviewer && reviewer.wallet !== "0x0000000000000000000000000000000000000000";
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<string | null>(null);
  const stake = typeof stakeRaw === "bigint" ? stakeRaw : 2_000_000n;
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: balanceRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: USDC_ADDRESS ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!USDC_ADDRESS && !!address, refetchInterval: 20_000 }
  });
  const usdcBalance = typeof balanceRaw === "bigint" ? balanceRaw : null;
  const onArc = chainId === ACTIVE_CHAIN.id;
  const enoughUsdc = usdcBalance === null ? null : usdcBalance >= stake;

  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);

  const register = useCallback(
    async (attestation: any) => {
      if (!canWrite || !address || !ESCROW_ADDRESS || !USDC_ADDRESS) {
        throw new Error("Connect a wallet on the configured contract network first");
      }
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
          chainId: ACTIVE_CHAIN.id,
          account: address
        });
        setTxHash(hash);
        await waitTx(config, hash);
        onRegistered();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(false);
      }
    },
    [address, canWrite, config, gps, onRegistered, stake, writeContractAsync]
  );

  const withdrawRewards = useCallback(async () => {
    if (!canWrite || !address || !ESCROW_ADDRESS) return;
    setWithdrawing(true);
    setError(null);
    setWithdrawMsg(null);
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "withdrawReward",
        args: [],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setTxHash(hash);
      await waitTx(config, hash);
      setWithdrawMsg("Rewards sent to your wallet.");
      onRegistered();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setWithdrawing(false);
    }
  }, [address, canWrite, config, onRegistered, writeContractAsync]);

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

  return (
    <section className="card p-5 animate-rise">
      <h2 className="heading text-base">Reviewer registration</h2>
      {rewards > 0n && (
        <div className="alert-success mt-3 flex items-center justify-between gap-3">
          <span>
            Unclaimed rewards: <span className="font-semibold">{formatUsdcDisplay(rewards)} USDC</span>
          </span>
          <button
            type="button"
            onClick={() => void withdrawRewards()}
            disabled={withdrawing || !canWrite}
            className="btn-success btn-sm"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw rewards"}
          </button>
        </div>
      )}
      {withdrawMsg && <p className="mt-2 text-xs text-emerald-300">{withdrawMsg}</p>}
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
          {previouslyRegistered && (
            <p className="alert-info mt-2 text-xs">
              {reviewer && reviewer.stakedAmount === 0n && rewards >= 0n
                ? "Your last review is settled and your stake was returned (or slashed if you missed a reveal). Stake again to keep reviewing; any unclaimed rewards stay yours."
                : "Your reviewer registration is inactive. Stake again to keep reviewing."}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            Verify with World ID, approve exactly {formatUsdcDisplay(stake)} USDC of stake, and
            register. Stakes are slashed if you sit on a panel and fail to reveal. After each review
            you settle, your stake comes back and you re-stake to take the next one.
          </p>
          <ul className="mt-3 space-y-1.5 card-inset p-3 text-xs text-zinc-300" aria-label="Staking requirements">
            <Requirement ok={!!address} label="Wallet connected" hint="Use Connect Wallet in the header." />
            <Requirement
              ok={!!address && onArc}
              label={`Wallet on ${ACTIVE_CHAIN.name}`}
              action={
                address && !onArc ? (
                  <button
                    type="button"
                    onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}
                    disabled={switching}
                    className="btn-primary btn-sm !min-h-[1.5rem] !px-2 !py-0.5 text-xs"
                  >
                    {switching ? "Switching…" : "Switch"}
                  </button>
                ) : null
              }
            />
            <Requirement
              ok={address ? enoughUsdc : false}
              label={`At least ${formatUsdcDisplay(stake)} USDC`}
              hint={
                address
                  ? `Balance: ${usdcBalance === null ? "…" : `${formatUsdcDisplay(usdcBalance)} USDC`}. Keep a little extra for gas — Arc fees are paid in USDC.`
                  : "Arc fees are paid in USDC, so keep a little extra for gas."
              }
            />
            <Requirement ok={null} label="World App for the World ID check" hint="One verified human = one reviewer." />
          </ul>
          <p className="mt-2 text-xs text-zinc-400">
            Two wallet prompts: approve, then register. Once staked, you&apos;re only drawn for
            bounties you didn&apos;t create, fund, work on, or vote on as a neighbour.
          </p>
          {!address ? (
            <p className="alert-warn mt-3 text-xs">
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
              <WorldIdButton
                role="reviewer"
                bountyId="0"
                wallet={address}
                disabled={busy || !canWrite}
                label={busy ? "Registering…" : "Verify & stake to become a reviewer"}
                onAttestation={register}
                onError={setError}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Requirement({
  ok,
  label,
  hint,
  action
}: {
  ok: boolean | null;
  label: string;
  hint?: string;
  action?: ReactNode;
}) {
  const dot = ok === true ? "bg-emerald-400" : ok === false ? "bg-amber-400" : "bg-zinc-600";
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="flex-1">
        <span className={ok === true ? "text-zinc-500 line-through" : "font-medium text-zinc-200"}>{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </span>
      {action}
    </li>
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
  const { report } = useBountyReport(bountyId);
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
      const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const candidates = [
        lookupStoredEntityKey(arkivKey),
        lookupBountyEntityKey(bountyId),
        arkivKey
      ].filter((k): k is string => !!k && k !== ZERO_KEY);

      let found = false;
      for (const k of candidates) {
        try {
          const res = await verifyEvidenceBundle(client, k, evidenceHash ?? "", worker ?? "");
          setVerification(res);
          setBundleSize(res.bundleSizeBytes);
          found = true;
          break;
        } catch {
          // try next
        }
      }
      if (!found) {
        throw new Error(
          "Evidence entity could not be verified on Arkiv. The entity may not be sealed yet."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [arkivKey, bountyId, evidenceHash, worker]);

  useEffect(() => {
    void load();
  }, [load]);

  const beforeUrl = useMemo(() => {
    return verification?.beforeImage
      ? URL.createObjectURL(new Blob([verification.beforeImage as any], { type: "image/webp" }))
      : "";
  }, [verification?.beforeImage]);
  const afterUrl = useMemo(() => {
    return verification?.afterImage
      ? URL.createObjectURL(new Blob([verification.afterImage as any], { type: "image/webp" }))
      : "";
  }, [verification?.afterImage]);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="heading text-sm">Evidence bundle verification</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn-ghost btn-sm"
        >
          {loading ? "Verifying…" : "Re-fetch"}
        </button>
      </div>

      {report && (
        <div className="space-y-1">
          <p className="label-micro">Reporter&apos;s problem photo</p>
          <ReportCard report={report} compact />
        </div>
      )}

      {error && <p className="alert-error !p-2 text-xs">{error}</p>}

      {verification && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                verification.valid
                  ? "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30"
                  : "bg-red-400/10 text-red-300 ring-1 ring-red-400/30"
              }`}
            >
              {verification.valid ? "Cryptographically valid ✓" : "Signature invalid ✗"}
            </span>
            {bundleSize && (
              <span className="text-zinc-500">
                {(bundleSize / 1024).toFixed(1)} KB CBOR+Zstd bundle
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="label-micro">Worker before / after photos</p>
            <BeforeAfterSlider
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
            />
          </div>

          {verification.metadata?.video && (
            <div className="alert-warn">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
                  Ethereum Swarm (BZZ)
                </span>
                <a
                  href={getVideoUrl(verification.metadata.video.swarmReference)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-amber-300 underline transition hover:text-amber-200"
                >
                  Verify on Swarm Gateway ↗
                </a>
              </div>
              <video
                src={getVideoPlaybackUrl(verification.metadata.video.swarmReference)}
                controls
                playsInline
                className="w-full max-h-56 rounded-xl bg-black object-contain ring-1 ring-white/10"
              />
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-amber-300/80">
                <span>Ref: {verification.metadata.video.swarmReference.slice(0, 16)}…</span>
                <span>SHA: {verification.metadata.video.videoSha256.slice(0, 16)}…</span>
              </div>
            </div>
          )}

          {verification.metadata && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400 card-inset p-3">
              <dt>Challenge code</dt>
              <dd className="font-mono font-semibold text-zinc-200">
                {String(verification.metadata.challengeCode).padStart(4, "0")}
              </dd>
              <dt>GPS accuracy</dt>
              <dd>±{Math.round(verification.metadata.gps.accuracyMeters)} m</dd>
              <dt>Orientation α</dt>
              <dd>
                {verification.metadata.orientation.alpha !== null
                  ? `${Math.round(verification.metadata.orientation.alpha)}°`
                  : "n/a"}
              </dd>
              <dt>Captured</dt>
              <dd>{new Date(verification.metadata.beforeTimestampMs).toLocaleString()}</dd>
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
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id && !!address;
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();

  const bountyIdBig = BigInt(assignment.bountyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [justSettled, setJustSettled] = useState(false);

  const { data: raw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getBounty",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed, refetchInterval: 15_000 }
  });

  const { data: blockNumber } = useBlockNumber({ chainId: ACTIVE_CHAIN.id, watch: true });

  const { data: panel } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getPanel",
    args: [bountyIdBig, assignment.reviewRound],
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: myVoteTuple } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "getVote",
    args: address ? [bountyIdBig, assignment.reviewRound, address] : undefined,
    query: { enabled: contractsDeployed && !!address }
  });

  const { data: commitDeadlineRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "commitDeadline",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed }
  });
  const { data: revealDeadlineRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "revealDeadline",
    args: [bountyIdBig],
    query: { enabled: contractsDeployed }
  });

  const b = raw as OnChainBounty | undefined;
  const status = b ? Number(b.status) : (assignment.bountyStatus ?? -1);
  const worker = b ? b.worker : assignment.worker;
  const arkivKey = b ? b.arkivEntityKey : null;
  const evidenceHash = b ? b.evidenceHash : null;
  const selectionBlock = b ? BigInt(b.selectionBlock) : null;
  const reviewRound = b ? Number(b.reviewRound) : assignment.reviewRound;
  const totalPledged = b ? BigInt(b.totalPledged) : BigInt(assignment.totalPledged || "0");

  const panelMembers = (panel as unknown as string[] | undefined) ?? [];
  const onPanel = !!address && panelMembers.some((m) => m.toLowerCase() === address.toLowerCase());
  const myVote = myVoteTuple as
    | { commitHash: string; revealed: boolean; approve: boolean; committed: boolean }
    | undefined;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const revealExpired =
    typeof revealDeadlineRaw === "bigint" && nowSeconds > Number(revealDeadlineRaw);

  const panelReady =
    status === 2 &&
    selectionBlock !== null &&
    blockNumber !== undefined &&
    blockNumber > selectionBlock;

  const blocksRemaining =
    selectionBlock !== null && blockNumber !== undefined
      ? Number(selectionBlock - blockNumber) + 1
      : null;

  const runTx = useCallback(
    async (fn: "assignPanel" | "pokeOrReplace" | "settle") => {
      if (!canWrite || !address || !ESCROW_ADDRESS) return;
      setBusy(true);
      setError(null);
      if (fn === "settle") setJustSettled(true);
      try {
        const hash = await writeContractAsync({
          address: ESCROW_ADDRESS as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: fn,
          args: [bountyIdBig],
          chain: ACTIVE_CHAIN,
          chainId: ACTIVE_CHAIN.id,
          account: address
        });
        setTxHash(hash);
        await waitTx(config, hash);
        onTx();
      } catch (err) {
        setError(friendlyError(err));
        setJustSettled(false);
      } finally {
        setBusy(false);
      }
    },
    [address, bountyIdBig, canWrite, config, onTx, writeContractAsync]
  );

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
        <div>
          <Link
            href={`/bounty/${assignment.bountyId}`}
            className="heading text-base hover:text-brand-300"
          >
            Bounty #{assignment.bountyId}
          </Link>
          <p className="text-xs text-zinc-400">
            Escrow {formatUsdc(totalPledged)} USDC · round {reviewRound}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs font-semibold text-zinc-300">
          Status: {statusName(status)}
        </span>
      </div>

      {status === 2 && (
        <div className="card-inset p-3 text-xs">
          <p className="font-semibold text-zinc-200">Panel selection pending</p>
          <p className="mt-1 text-zinc-400">
            {panelReady
              ? "Randomness seed confirmed. Any registered reviewer can trigger the panel draw."
              : `Waiting for randomness: ${blocksRemaining !== null && blocksRemaining > 0 ? `${blocksRemaining} more block${blocksRemaining === 1 ? "" : "s"}` : "confirming…"} (needs block > ${selectionBlock?.toString()})`}
          </p>
          <button
            type="button"
            disabled={!panelReady || busy || !canWrite}
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
              disabled={!revealExpired || busy || !canWrite}
              onClick={() => void runTx("pokeOrReplace")}
              className="btn btn-sm w-full bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30 hover:bg-amber-400/20"
              title="Slash & replace reviewers who missed the reveal window"
            >
              Slash / replace inactive
            </button>
            <button
              type="button"
              disabled={!revealExpired || busy || justSettled || !canWrite}
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

      {error && <p className="alert-error !p-2 text-xs">{error}</p>}
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
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-6 animate-rise">
        <h1 className="heading text-2xl">Reviewer dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Reviewers decide whether the work was really done. You earn a share of the escrow when you vote with the
          majority.
        </p>
        <ol className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          {[
            ["1", "Stake 2 USDC", "Verify with World ID and stake."],
            ["2", "Get drawn", "3 reviewers are picked per job."],
            ["3", "Vote", "Compare photos, commit, then reveal."],
            ["4", "Earn", "Majority shares 10% of the escrow."]
          ].map(([n, t, d]) => (
            <li key={n} className="card flex gap-2 p-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold text-ink-950">
                {n}
              </span>
              <span>
                <span className="block font-semibold text-zinc-200">{t}</span>
                <span className="text-zinc-500">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </header>

      <div className="space-y-4">
        <RegistrationCard onRegistered={() => void loadAssignments()} />

        {loadError && (
          <div className="alert-warn text-sm">
            {loadError} — the backend may be offline. Registration still works on-chain.
          </div>
        )}

        <AwaitingPanel />

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
          <Link href="/audit/0" className="text-zinc-400 underline hover:text-zinc-200">
            try the public audit
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Submitted bounties that still need their review panel drawn (anyone may trigger it). */
function AwaitingPanel() {
  const [items, setItems] = useState<{ bountyId: string; description: string | null }[]>([]);
  const config = useConfig();
  useEffect(() => {
    let cancelled = false;
    loadBounties(config, { status: 2, limit: 50 })
      .then(({ rows }) => {
        if (!cancelled) setItems(rows.map(normalizeBounty).map((b) => ({ bountyId: b.bountyId, description: b.description ?? null })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config]);
  if (items.length === 0) return null;
  return (
    <section className="card p-5 border-violet-500/30">
      <h2 className="heading text-sm">Waiting for a review panel</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Workers submitted evidence for these. Open one and tap <strong>Draw review panel</strong>; if you are
        registered you may be picked.
      </p>
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {items.map((b) => (
          <li key={b.bountyId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 text-sm text-zinc-300">
              <span className="font-semibold text-white">#{b.bountyId}</span>{" "}
              <span className="line-clamp-1 text-zinc-400">{b.description}</span>
            </span>
            <Link
              href={`/bounty/${b.bountyId}`}
              className="btn-primary btn-sm !min-h-[1.75rem] shrink-0"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
