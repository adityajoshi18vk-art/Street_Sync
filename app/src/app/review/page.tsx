"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import WorldIdButton from "@/components/WorldIdButton";
import {
  useAccount,
  useBlockNumber,
  useChainId,
  useConfig,
  useReadContract,
  useWriteContract
} from "wagmi";
import type { Hash } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";

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
import { getReviewerAssignments, type Attestation } from "@/lib/api";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import { shortAddress, statusName, type OnChainBounty, type ReviewerAssignment } from "@/lib/types";
import { friendlyError } from "@/lib/errors";
import { useBountyReport } from "@/lib/useBountyReport";
import ReportCard from "@/components/ReportCard";
import type { ArkivVerificationResult } from "@streetsync/arkiv-client";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import CommitRevealCard from "@/components/CommitRevealCard";
import { HashBadge } from "@/components/StatusBadge";

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

  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);

  const register = useCallback(
    async (attestation: Attestation) => {
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
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Reviewer registration</h2>
      {rewards > 0n && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
          <span>
            Unclaimed rewards: <span className="font-semibold">{formatUsdcDisplay(rewards)} USDC</span>
          </span>
          <button
            type="button"
            onClick={() => void withdrawRewards()}
            disabled={withdrawing || !canWrite}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw rewards"}
          </button>
        </div>
      )}
      {withdrawMsg && <p className="mt-2 text-xs text-emerald-700">{withdrawMsg}</p>}
      {registered ? (
        <div className="mt-3 space-y-1 text-sm text-gray-700">
          <p className="font-semibold text-emerald-700">Active reviewer ✓</p>
          <p className="text-xs text-gray-500">
            Region cell {reviewer?.regionCell} · stake{" "}
            {reviewer ? formatUsdcDisplay(reviewer.stakedAmount) : "—"} USDC · rewards{" "}
            {reviewer ? formatUsdcDisplay(reviewer.rewardBalance) : "—"} USDC
          </p>
        </div>
      ) : (
        <>
          {previouslyRegistered && (
            <p className="mt-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              {reviewer && reviewer.stakedAmount === 0n && rewards >= 0n
                ? "Your last review is settled and your stake was returned (or slashed if you missed a reveal). Stake again to keep reviewing; any unclaimed rewards stay yours."
                : "Your reviewer registration is inactive. Stake again to keep reviewing."}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Verify with World ID, approve exactly {formatUsdcDisplay(stake)} USDC of stake, and
            register. Stakes are slashed if you sit on a panel and fail to reveal. After each review
            you settle, your stake comes back and you re-stake to take the next one.
          </p>
          {!address ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              Connect your wallet (header) to register.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                <span>
                  Region: <span className="font-semibold">{gps ? regionCellFromLatLng(gps.lat, gps.lng) : "—"}</span>
                  {gps && (
                    <span className="ml-1 text-gray-400">
                      ({gps.lat.toFixed(4)}, {gps.lng.toFixed(4)})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={requestGps}
                  className="rounded-lg border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-white"
                >
                  {gps ? "Refresh" : "Use my GPS"}
                </button>
              </div>
              {gpsError && <p className="text-xs text-amber-600">{gpsError}</p>}
              {error && <p className="text-xs text-red-600">{error}</p>}
              {txHash && (
                <p className="break-all text-[11px] text-emerald-600">Registration tx: {txHash}</p>
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
      setError(friendlyError(err));
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
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Evidence (Arkiv)</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          {loading ? "Fetching…" : "Re-fetch"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {verification && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                verification.evidenceHashMatch
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-red-50 text-red-700 ring-red-200"
              }`}
            >
              {verification.evidenceHashMatch ? "SHA-256 hash match" : "Hash mismatch"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                verification.signatureValid
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-red-50 text-red-700 ring-red-200"
              }`}
            >
              {verification.signatureValid ? "Worker signature valid" : "Signature invalid"}
            </span>
            <span className="rounded-full bg-gray-50 px-2 py-0.5 text-gray-600 ring-1 ring-gray-200">
              {bundleSize ? `${(bundleSize / 1024).toFixed(1)} KiB bundle` : ""}
            </span>
          </div>

          {report && <ReportCard report={report} compact title="Problem as reported" />}
          {beforeUrl && afterUrl ? (
            <BeforeAfterSlider beforeUrl={beforeUrl} afterUrl={afterUrl} />
          ) : (
            <p className="text-xs text-gray-400">Photos unavailable in bundle.</p>
          )}

          {verification.metadata && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600">
              <dt>Challenge code</dt>
              <dd className="font-mono font-semibold text-gray-800">
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
            <ul className="list-disc pl-4 text-[11px] text-amber-600">
              {verification.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!verification && !loading && !error && (
        <p className="mt-2 text-xs text-gray-400">Press Re-fetch to pull the bundle.</p>
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

  const blocksRemaining =
    selectionBlock !== null && typeof blockNumber === "bigint"
      ? Number(selectionBlock) - Number(blockNumber)
      : null;
  const panelReady =
    selectionBlock !== null && typeof blockNumber === "bigint" && blockNumber > selectionBlock;

  const runTx = useCallback(
    async (fn: "assignPanel" | "settle" | "pokeOrReplace") => {
      if (!canWrite || !ESCROW_ADDRESS) {
        setError("Connect a wallet on the configured contract network before taking this action.");
        return;
      }
      setBusy(true);
      setError(null);
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
        if (fn === "settle") setJustSettled(true);
        onTx();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setBusy(false);
      }
    },
    [address, bountyIdBig, canWrite, config, onTx, writeContractAsync]
  );

  const revealExpired =
    typeof revealDeadlineRaw === "bigint" &&
    Date.now() / 1000 > Number(revealDeadlineRaw) &&
    status === 3;

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <Link
          href={`/bounty/${assignment.bountyId}`}
          className="text-sm font-semibold text-indigo-600 hover:underline"
        >
          Bounty #{assignment.bountyId}
        </Link>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
          {statusName(status)} · round {reviewRound}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        Pool {formatUsdcDisplay(totalPledged)} USDC · panel{" "}
        {panelMembers.filter((m) => m !== "0x0000000000000000000000000000000000000000").length}/3
        {myVote?.committed ? ` · committed${myVote.revealed ? " & revealed" : ""}` : ""}
      </p>

      {status === 2 && (
        <div className="rounded-lg bg-violet-50 p-3">
          <p className="text-xs text-violet-700">
            {panelReady
              ? "Selection block reached — you can assign the panel now."
              : `Waiting for randomness: ${blocksRemaining !== null && blocksRemaining > 0 ? `${blocksRemaining} more block${blocksRemaining === 1 ? "" : "s"}` : "confirming…"} (needs block > ${selectionBlock?.toString()})`}
          </p>
          <button
            type="button"
            disabled={!panelReady || busy || !canWrite}
            onClick={() => void runTx("assignPanel")}
            className="mt-2 w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:bg-gray-300"
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
              <p className="text-xs text-gray-400">Loading voting windows…</p>
            )
          ) : (
            <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
              You are not on this panel (3 reviewers were drawn from your region pool). You can
              still inspect the evidence above and settle once the window closes.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!revealExpired || busy || !canWrite}
              onClick={() => void runTx("pokeOrReplace")}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
              title="Slash & replace reviewers who missed the reveal window"
            >
              Slash / replace inactive
            </button>
            <button
              type="button"
              disabled={!revealExpired || busy || justSettled || !canWrite}
              onClick={() => void runTx("settle")}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              {justSettled ? "Settling…" : "Settle bounty"}
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

      {error && <p className="text-xs text-red-600">{error}</p>}
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
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Reviewer dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Stake, inspect evidence, commit-reveal your vote, and keep panels honest.
        </p>
      </header>

      <div className="space-y-4">
        <RegistrationCard onRegistered={() => void loadAssignments()} />

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            {loadError} — the backend may be offline. Registration still works on-chain.
          </div>
        )}

        {assignments && assignments.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
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

        <p className="pt-4 text-center text-xs text-gray-400">
          Escrow {shortAddress(ESCROW_ADDRESS, 4)} ·{" "}
          <Link href="/audit/1" className="text-gray-400 underline">
            try the public audit
          </Link>
        </p>
      </div>
    </main>
  );
}
