"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
  useWriteContract
} from "wagmi";
import {
  ESCROW_ABI,
  ESCROW_ADDRESS,
  ACTIVE_CHAIN,
  contractsDeployed,
  e5ToLatLng,
  formatUsdcDisplay,
  parseUsdc
} from "@/config/contracts";
import { approveUsdcExact, waitTx } from "@/lib/tx";
import { uploadBountyReport } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import {
  STATUS,
  canPledge,
  canReleaseClaim,
  canWithdrawPledge,
  isClaimable,
  isOpenExpired,
  toLifecycleBounty
} from "@/lib/lifecycle";
import { browserStorage, deletePendingReport, loadPendingReport } from "@/lib/report";
import { useBountyReport } from "@/lib/useBountyReport";
import { useNowSeconds } from "@/lib/useNow";
import {
  shortAddress,
  formatUtc,
  isZeroHash,
  type OnChainBounty
} from "@/lib/types";
import { HashBadge, StatusBadge } from "@/components/StatusBadge";
import NeighbourValidationPanel from "@/components/NeighbourValidationPanel";
import ReportCard from "@/components/ReportCard";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const bountyId = params.id;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const canWrite = contractsDeployed && chainId === ACTIVE_CHAIN.id;
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const now = useNowSeconds();

  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeStatus, setPledgeStatus] = useState<string | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingBundle, setPendingBundle] = useState<Uint8Array | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const validId = typeof bountyId === "string" && /^\d{1,30}$/.test(bountyId);
  // An invalid route id reads a never-created bounty, which renders as "not found".
  const bountyIdBig = validId ? BigInt(bountyId) : 2n ** 255n;
  const readBase = {
    chainId: ACTIVE_CHAIN.id,
    address: ESCROW_ADDRESS ?? undefined,
    abi: ESCROW_ABI
  } as const;
  const chainReady = !!ESCROW_ADDRESS && contractsDeployed;

  const { data: bounty, refetch, isLoading } = useReadContract({
    ...readBase,
    functionName: "getBounty",
    args: [bountyIdBig],
    query: { enabled: chainReady, refetchInterval: 15_000 }
  });
  const b = bounty as unknown as OnChainBounty | undefined;

  const { data: tally } = useReadContract({
    ...readBase,
    functionName: "getTally",
    args: [bountyIdBig],
    query: { enabled: chainReady }
  });
  const tallyTuple = tally as readonly [number, number] | undefined;

  const { data: commitDeadline } = useReadContract({
    ...readBase,
    functionName: "commitDeadline",
    args: [bountyIdBig],
    query: { enabled: chainReady }
  });

  const { data: revealDeadline } = useReadContract({
    ...readBase,
    functionName: "revealDeadline",
    args: [bountyIdBig],
    query: { enabled: chainReady }
  });

  const { data: quorumRaw } = useReadContract({
    ...readBase,
    functionName: "validationQuorum",
    query: { enabled: chainReady }
  });

  const { data: myPledgeRaw, refetch: refetchPledge } = useReadContract({
    ...readBase,
    functionName: "pledges",
    args: address ? [bountyIdBig, address] : undefined,
    query: { enabled: chainReady && !!address }
  });

  const { data: eligibleRaw } = useReadContract({
    ...readBase,
    functionName: "eligibleReviewerCount",
    args: [bountyIdBig],
    query: { enabled: chainReady && Number(b?.status) === STATUS.Submitted }
  });

  const { report, loading: reportLoading, reload: reloadReport } = useBountyReport(bountyId);

  const reportHash = b?.reportHash;
  const isCreator = !!address && !!b && address.toLowerCase() === b.creator.toLowerCase();
  useEffect(() => {
    if (report || reportLoading || !isCreator || !reportHash || isZeroHash(reportHash)) {
      setPendingBundle(null);
      return;
    }
    const storage = browserStorage();
    setPendingBundle(storage ? loadPendingReport(storage, reportHash) : null);
  }, [report, reportLoading, isCreator, reportHash]);

  if (!contractsDeployed) {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-amber-200">
        Escrow contracts are not configured on this network. See the home page banner for setup.
      </div>
    );
  }

  if (isLoading || !b) {
    return <div className="h-40 animate-pulse rounded-xl bg-gray-200" />;
  }

  if (!validId || /^0x0{40}$/i.test(b.creator)) {
    return (
      <div className="rounded-xl bg-white p-6 text-sm text-gray-700 shadow-card ring-1 ring-gray-200">
        <p className="font-semibold">Bounty not found</p>
        <p className="mt-1 text-xs text-gray-500">No bounty with id “{bountyId}” exists on {ACTIVE_CHAIN.name}.</p>
        <Link href="/" className="mt-3 inline-block text-xs font-semibold text-brand-700 hover:underline">← Back to the map</Link>
      </div>
    );
  }

  const { lat, lng } = e5ToLatLng(b.latE5, b.lngE5);
  const lc = toLifecycleBounty(b);
  const hasEvidence = !isZeroHash(b.arkivEntityKey);
  const isWorker = !!address && address.toLowerCase() === b.worker?.toLowerCase();
  const nowSeconds = now;
  const quorum = Number(quorumRaw ?? 0);
  const myPledge = typeof myPledgeRaw === "bigint" ? myPledgeRaw : 0n;
  const eligibleCount = eligibleRaw === undefined ? null : Number(eligibleRaw);
  const expired = isOpenExpired(lc, now);
  const showWithdraw = canWithdrawPledge(lc, myPledge, now);
  const showRelease =
    lc.status === STATUS.Submitted
      ? eligibleCount !== null && canReleaseClaim(lc, now, eligibleCount)
      : canReleaseClaim(lc, now, 0);

  const handlePledge = async () => {
    if (!canWrite || !address || !ESCROW_ADDRESS) return;
    setPledgeError(null);
    setPledgeStatus(null);
    try {
      const amountUsdc = pledgeAmount.trim();
      if (parseUsdc(amountUsdc) <= 0n) throw new Error("Enter a valid USDC amount.");
      await approveUsdcExact({
        config,
        owner: address,
        spender: ESCROW_ADDRESS,
        amountUsdc,
        writeContractAsync,
        onPhase: (_p, msg) => setPledgeStatus(msg ?? null)
      });
      setPledgeStatus("Pledging…");
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "pledge",
        args: [bountyIdBig, parseUsdc(amountUsdc)],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      await waitTx(config, hash);
      setPledgeAmount("");
      setPledgeStatus("Pledge confirmed");
      void refetch();
      void refetchPledge();
    } catch (e) {
      setPledgeStatus(null);
      setPledgeError(friendlyError(e));
    }
  };

  const runAction = async (fn: "withdrawPledge" | "releaseClaim", doneMessage: string) => {
    if (!canWrite || !address || !ESCROW_ADDRESS) {
      setActionError("Connect a wallet on the configured network first.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setActionStatus("Confirm in your wallet…");
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: fn,
        args: [bountyIdBig],
        chain: ACTIVE_CHAIN,
        chainId: ACTIVE_CHAIN.id,
        account: address
      });
      setActionStatus("Waiting for confirmation…");
      await waitTx(config, hash);
      setActionStatus(doneMessage);
      void refetch();
      void refetchPledge();
    } catch (e) {
      setActionStatus(null);
      setActionError(friendlyError(e));
    } finally {
      setActionBusy(false);
    }
  };

  const retryUpload = async () => {
    if (!pendingBundle || !reportHash) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadBountyReport(bountyId, pendingBundle);
      const storage = browserStorage();
      if (storage) deletePendingReport(storage, reportHash);
      setPendingBundle(null);
      await reloadReport();
    } catch (e) {
      setUploadError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">
          ← Map
        </Link>
        <div className="flex items-center gap-2">
          {expired && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 ring-1 ring-gray-200">
              Expired
            </span>
          )}
          <StatusBadge status={b.status} />
        </div>
      </div>

      {report && <ReportCard report={report} />}

      {!report && !reportLoading && pendingBundle && (
        <div className="rounded-xl bg-amber-50 p-5 ring-1 ring-amber-200">
          <p className="text-sm font-bold text-amber-900">Your problem photo isn&apos;t uploaded yet</p>
          <p className="mt-1 text-xs text-amber-800">
            The bounty was created on-chain, but the photo upload didn&apos;t finish. The photo is
            saved on this device — upload it now so neighbours can see the problem.
          </p>
          <button
            type="button"
            onClick={() => void retryUpload()}
            disabled={uploading}
            className="mt-3 w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload problem photo"}
          </button>
          {uploadError && (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200">{uploadError}</p>
          )}
        </div>
      )}

      {!report && !reportLoading && !pendingBundle && (
        <p className="rounded-xl bg-gray-50 p-4 text-xs text-gray-500 ring-1 ring-gray-200">
          {isCreator
            ? "No problem photo is stored for this bounty, and none was found on this device."
            : "The reporter's photo isn't available yet."}
        </p>
      )}

      {b.status === STATUS.Proposed && (
        <NeighbourValidationPanel
          bountyId={bountyId}
          address={address}
          creator={b.creator}
          validationDeadline={lc.validationDeadline}
          confirmations={Number(b.confirmations)}
          disputes={Number(b.disputes)}
          quorum={quorum}
          onChanged={() => void refetch()}
        />
      )}

      <div className="rounded-xl bg-white p-6 shadow-card ring-1 ring-gray-200">
        <h1 className="text-xl font-bold text-gray-900">Bounty #{b.id.toString()}</h1>
        {report && <p className="mt-1 text-sm text-gray-700">{report.description}</p>}
        <p className="mt-1 text-sm text-gray-500">
          {lat.toFixed(5)}, {lng.toFixed(5)} · region cell {b.regionCell}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Field label="Escrow pool" value={`${formatUsdcDisplay(b.totalPledged)} USDC`} />
          <Field label="Creator" value={shortAddress(b.creator)} />
          <Field
            label="Worker"
            value={b.worker === ZERO_ADDRESS ? "— unclaimed" : shortAddress(b.worker)}
          />
          <Field label="Review round" value={String(b.reviewRound)} />
          <Field label="Created" value={formatUtc(b.createdAt)} />
          {lc.validationDeadline > 0 && (
            <Field label="Validation ends" value={formatUtc(lc.validationDeadline)} />
          )}
          <Field label="Claim deadline" value={formatUtc(b.claimDeadline)} />
          {lc.workDeadline > 0 && <Field label="Work deadline" value={formatUtc(lc.workDeadline)} />}
          <Field label="Rework count" value={`${b.reworkCount} / 1`} />
          <Field label="Selection block" value={b.selectionBlock.toString()} />
        </div>

        {expired && (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 ring-1 ring-gray-200">
            This bounty expired before anyone claimed it. Pledgers can withdraw their funds.
          </p>
        )}
        {b.status === STATUS.Refunded && (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 ring-1 ring-gray-200">
            This bounty was closed and refunded. Pledgers can withdraw their funds.
          </p>
        )}

        {b.status === 1 && b.visualChallengeCode > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-brand-50 p-4 ring-1 ring-brand-200">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                Visual Challenge Code
              </p>
              <p className="text-3xl font-black tracking-widest text-brand-800">
                {String(b.visualChallengeCode).padStart(4, "0")}
              </p>
            </div>
            <p className="text-[11px] text-brand-700">
              Anti-spoofing code burned into evidence photos by the worker&apos;s camera.
            </p>
          </div>
        )}

        {hasEvidence && (
          <div className="mt-4 space-y-2">
            <HashBadge label="Evidence hash (SHA-256)" hash={b.evidenceHash} />
            <HashBadge label="Arkiv entity key" hash={b.arkivEntityKey} />
          </div>
        )}

        {b.status === 3 && tallyTuple && (
          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <Field label="Revealed" value={`${Number(tallyTuple[0])} / 3`} />
            <Field label="Approvals" value={String(Number(tallyTuple[1]))} />
            <Field
              label="Reveal ends"
              value={revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
            />
            {commitDeadline ? (
              <p className="col-span-3 text-[11px] text-gray-400">
                Commit window ends {formatUtc(commitDeadline as bigint)} · reveal{" "}
                {revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
                {nowSeconds > Number(revealDeadline ?? 0n) && " (expired — pokeOrReplace available)"}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        {canPledge(lc, now) && (
          <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200 md:col-span-2">
            <p className="text-sm font-bold text-gray-900">Fund this bounty</p>
            {b.status === STATUS.Proposed && (
              <p className="mt-1 text-xs text-gray-500">
                Pledges are held in escrow. If neighbours don&apos;t confirm the problem you can
                withdraw them.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <input
                value={pledgeAmount}
                onChange={(e) => setPledgeAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC amount"
                className="w-full rounded-lg text-sm ring-1 ring-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={handlePledge}
                disabled={!isConnected || !canWrite || !pledgeAmount}
                className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
              >
                Pledge
              </button>
            </div>
            {pledgeStatus && <p className="mt-2 text-xs font-medium text-brand-700">{pledgeStatus}</p>}
            {pledgeError && (
              <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200">
                {pledgeError}
              </p>
            )}
          </div>
        )}

        {showWithdraw && (
          <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
            <p className="text-sm font-bold text-gray-900">Get your pledge back</p>
            <p className="mt-1 text-xs text-gray-500">
              You have {formatUsdcDisplay(myPledge)} USDC pledged to this bounty, which is no longer active.
            </p>
            <button
              type="button"
              disabled={actionBusy || !canWrite}
              onClick={() => void runAction("withdrawPledge", "Pledge withdrawn to your wallet.")}
              className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Withdraw my pledge
            </button>
          </div>
        )}

        {showRelease && (
          <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
            <p className="text-sm font-bold text-gray-900">Stalled bounty</p>
            <p className="mt-1 text-xs text-gray-500">
              {b.status === STATUS.Submitted
                ? "Evidence was submitted but not enough reviewers are available. Anyone can reopen it for other workers."
                : "The worker missed the deadline. Anyone can reopen the bounty for other workers."}
            </p>
            <button
              type="button"
              disabled={actionBusy || !canWrite}
              onClick={() => void runAction("releaseClaim", "Bounty reopened for new workers.")}
              className="mt-3 w-full rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
            >
              Reopen stalled bounty
            </button>
          </div>
        )}

        {(actionStatus || actionError) && (
          <div className="md:col-span-3">
            {actionStatus && <p className="text-xs font-medium text-brand-700">{actionStatus}</p>}
            {actionError && (
              <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200">{actionError}</p>
            )}
          </div>
        )}

        {isClaimable(lc, now) && (
          <ActionCard
            title="Work on it"
            description="Verify with World ID, claim, and submit before/after evidence."
            href={`/bounty/${bountyId}/work`}
            cta="Start work"
          />
        )}

        {isWorker && (b.status === STATUS.Claimed || b.status === STATUS.Rejected) && (
          <ActionCard
            title={b.status === STATUS.Rejected ? "Rework needed" : "Continue work"}
            description={
              b.status === STATUS.Rejected
                ? "Reviewers rejected the evidence. You get one chance to redo it before the deadline."
                : "Capture before/after photos and submit evidence."
            }
            href={`/bounty/${bountyId}/work`}
            cta="Open workbench"
          />
        )}

        {hasEvidence && (
          <>
            <ActionCard
              title="Public audit"
              description="Recompute SHA-256 in the browser and test tamper detection. No wallet needed."
              href={`/audit/${bountyId}`}
              cta="Audit evidence"
            />
            <ActionCard
              title="Review dashboard"
              description="Commit-reveal voting for assigned reviewers."
              href="/review"
              cta="Open review"
            />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-mono text-xs font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  cta
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
      <p className="text-sm font-bold text-gray-900">{title}</p>
      <p className="mt-1 flex-1 text-xs text-gray-500">{description}</p>
      <Link
        href={href}
        className="mt-3 rounded-lg bg-brand-600 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        {cta}
      </Link>
    </div>
  );
}
