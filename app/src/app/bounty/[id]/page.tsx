"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera } from "lucide-react";
import { useParams } from "next/navigation";
import {
  useAccount,
  useBlockNumber,
  useChainId,
  useConfig,
  useReadContract,
  useWriteContract
} from "wagmi";
import {
  ACTIVE_CHAIN,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  contractsDeployed,
  e5ToLatLng,
  formatUsdcDisplay,
  parseUsdc
} from "@/config/contracts";
import { approveUsdcExact, waitTx } from "@/lib/tx";
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
import { useBountyReport } from "@/lib/useBountyReport";
import { useNowSeconds } from "@/lib/useNow";
import { browserStorage, deletePendingReport, loadPendingReport } from "@/lib/report";
import { uploadBountyReport } from "@/lib/api";
import {
  shortAddress,
  formatUtc,
  isZeroHash,
  type OnChainBounty
} from "@/lib/types";
import { HashBadge, StatusBadge } from "@/components/StatusBadge";
import NeighbourValidationPanel from "@/components/NeighbourValidationPanel";
import ReportCard from "@/components/ReportCard";
import { getArkivClient, lookupBountyEntityKey, lookupStoredEntityKey } from "@/lib/arkiv";
import { readEvidenceBundle } from "@streetsync/arkiv-client";
import { unpackBundle } from "@streetsync/evidence";
import { getVideoPlaybackUrl, getVideoUrl, type VideoEvidence } from "@streetsync/swarm-client";

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
  const [pledging, setPledging] = useState(false);
  const [pledgeStatus, setPledgeStatus] = useState<string | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  const [videoEvidence, setVideoEvidence] = useState<VideoEvidence | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingBundle, setPendingBundle] = useState<Uint8Array | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const validId = typeof bountyId === "string" && /^\d{1,30}$/.test(bountyId);
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
    query: { enabled: chainReady, refetchInterval: 15_000 }
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
    query: { enabled: chainReady && Number(b?.status) === STATUS.Submitted, refetchInterval: 20_000 }
  });
  const { data: blockNumber } = useBlockNumber({
    chainId: ACTIVE_CHAIN.id,
    watch: true,
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

  // Load video evidence if available from bundle or local storage
  const evidenceKey = b?.arkivEntityKey;
  useEffect(() => {
    if (!evidenceKey || isZeroHash(evidenceKey)) return;
    let cancelled = false;
    (async () => {
      try {
        const client = getArkivClient();
        const ZERO_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const candidates = [
          lookupStoredEntityKey(evidenceKey),
          lookupBountyEntityKey(bountyId ?? ""),
          evidenceKey
        ].filter((k): k is string => !!k && k !== ZERO_KEY);

        for (const k of candidates) {
          try {
            const res = await readEvidenceBundle(client, k);
            const unpacked = await unpackBundle(res.bundle);
            if (!cancelled && unpacked.metadata?.video) {
              setVideoEvidence({
                ...unpacked.metadata.video,
                mimeType: "video/mp4"
              });
              break;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evidenceKey, bountyId]);

  if (!contractsDeployed) {
    return (
      <div className="card p-6 text-sm">
        <p className="font-semibold text-amber-300">Escrow contracts not deployed</p>
        <p className="mt-1 text-xs text-zinc-400">
          Deploy StreetSyncEscrow to {ACTIVE_CHAIN.name} before viewing bounties.
        </p>
      </div>
    );
  }

  if (isLoading || !b) {
    return <div className="skeleton h-48 w-full rounded-2xl" />;
  }

  if (!validId || /^0x0{40}$/i.test(b.creator)) {
    return (
      <div className="card p-6 text-sm text-zinc-300">
        <p className="font-semibold text-zinc-100">Bounty not found</p>
        <p className="mt-1 text-xs text-zinc-400">No bounty with id “{bountyId}” exists on {ACTIVE_CHAIN.name}.</p>
        <Link href="/" className="btn-ghost btn-sm mt-3 inline-block">← Back to the map</Link>
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
    setPledging(true);
    try {
      const amountUsdc = pledgeAmount.trim();
      if (parseUsdc(amountUsdc) <= 0n) throw new Error("Enter a valid USDC amount.");
      await approveUsdcExact({
        config,
        owner: address,
        spender: ESCROW_ADDRESS,
        amountUsdc,
        writeContractAsync
      });

      setPledgeStatus("Pledging " + amountUsdc + " USDC…");
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
    } finally {
      setPledging(false);
    }
  };

  const runAction = async (
    fn: "withdrawPledge" | "releaseClaim" | "assignPanel" | "settle" | "pokeOrReplace",
    doneMessage: string
  ) => {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="btn-ghost btn-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Map
        </Link>
        <div className="flex items-center gap-2">
          {expired && (
            <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-700">
              Expired
            </span>
          )}
          <StatusBadge status={b.status} />
        </div>
      </div>

      {report && <ReportCard report={report} />}

      {!report && !reportLoading && pendingBundle && (
        <div className="alert-warn">
          <p className="text-sm font-bold text-amber-200">Your problem photo isn&apos;t uploaded yet</p>
          <p className="mt-1 text-xs text-amber-300/80">
            The bounty was created on-chain, but the photo upload didn&apos;t finish. The photo is
            saved on this device — upload it now so neighbours can see the problem.
          </p>
          <button
            type="button"
            onClick={() => void retryUpload()}
            disabled={uploading}
            className="btn-primary mt-3 w-full"
          >
            {uploading ? "Uploading…" : "Upload problem photo"}
          </button>
          {uploadError && (
            <p className="alert-error mt-2 !p-2 text-xs">{uploadError}</p>
          )}
        </div>
      )}

      {!report && !reportLoading && !pendingBundle && (
        <p className="card p-4 text-xs text-zinc-500">
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

      <div className="card p-6">
        <h1 className="heading text-2xl">Bounty #{b.id.toString()}</h1>
        {report && <p className="mt-1 text-sm text-zinc-300">{report.description}</p>}
        <p className="mt-1 text-xs text-zinc-500">
          {lat.toFixed(5)}, {lng.toFixed(5)} · region cell {b.regionCell}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
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
          <p className="alert-warn mt-4 text-xs">
            This bounty expired before anyone claimed it. Pledgers can withdraw their funds.
          </p>
        )}
        {b.status === STATUS.Refunded && (
          <p className="alert-warn mt-4 text-xs">
            This bounty was closed and refunded. Pledgers can withdraw their funds.
          </p>
        )}

        {b.status === 1 && b.visualChallengeCode > 0 && (
          <div className="alert-info mt-4 flex items-center gap-4 p-5">
            <div>
              <p className="label-micro !text-brand-300">
                Visual Challenge Code
              </p>
              <p className="text-gradient font-mono text-4xl font-black tracking-[0.3em]">
                {String(b.visualChallengeCode).padStart(4, "0")}
              </p>
            </div>
            <p className="text-xs text-zinc-400">
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

        {videoEvidence && (
          <div className="alert-warn mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
                  Ethereum Swarm (BZZ)
                </span>
                <span className="text-xs font-semibold text-amber-200">
                  Walkthrough Video Attached ({videoEvidence.durationSeconds}s)
                </span>
              </div>
              <a
                href={getVideoUrl(videoEvidence.swarmReference)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-amber-300 underline transition hover:text-amber-200"
              >
                Verify on Swarm Gateway ↗
              </a>
            </div>
            <video
              src={getVideoPlaybackUrl(videoEvidence.swarmReference)}
              controls
              playsInline
              className="w-full max-h-64 rounded-xl bg-black object-contain ring-1 ring-white/10"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-amber-300/80">
              <span>Swarm Ref: {videoEvidence.swarmReference.slice(0, 20)}…</span>
              <span>SHA: {videoEvidence.videoSha256.slice(0, 16)}…</span>
            </div>
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
              <p className="col-span-3 text-[11px] text-zinc-500">
                Commit window ends {formatUtc(commitDeadline as bigint)} · reveal{" "}
                {revealDeadline ? formatUtc(revealDeadline as bigint) : "—"}
                {nowSeconds > Number(revealDeadline ?? 0n) && " (ended)"}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        {canPledge(lc, now) && (
          <div className="card p-5 md:col-span-2">
            <p className="heading text-base">Fund this bounty</p>
            {b.status === STATUS.Proposed && (
              <p className="mt-1 text-xs text-zinc-400">
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
                className="field"
              />
              <button
                onClick={handlePledge}
                disabled={!isConnected || !canWrite || !pledgeAmount || pledging}
                className="btn-success shrink-0 px-5"
              >
                {pledging && <span className="spinner spinner-sm spinner-inherit" aria-hidden />}
                {pledging ? "Pledging…" : "Pledge"}
              </button>
            </div>
            {pledgeStatus && <p className="mt-2 text-xs font-medium text-brand-300">{pledgeStatus}</p>}
            {pledgeError && (
              <p className="alert-error mt-2 !p-2 text-xs">
                {pledgeError}
              </p>
            )}
          </div>
        )}

        {showWithdraw && (
          <div className="card p-5">
            <p className="heading text-base">Get your pledge back</p>
            <p className="mt-1 text-xs text-zinc-400">
              You have {formatUsdcDisplay(myPledge)} USDC pledged to this bounty, which is no longer active.
            </p>
            <button
              type="button"
              disabled={actionBusy || !canWrite}
              onClick={() => void runAction("withdrawPledge", "Pledge withdrawn to your wallet.")}
              className="btn-success mt-3 w-full"
            >
              Withdraw my pledge
            </button>
          </div>
        )}

        {(b.status === STATUS.Submitted || b.status === STATUS.InReview) && (
          <ReviewProgressCard
            status={Number(b.status)}
            selectionBlock={BigInt(b.selectionBlock)}
            blockNumber={typeof blockNumber === "bigint" ? blockNumber : null}
            eligibleCount={eligibleCount}
            revealed={tallyTuple ? Number(tallyTuple[0]) : null}
            approvals={tallyTuple ? Number(tallyTuple[1]) : null}
            commitDeadline={typeof commitDeadline === "bigint" ? Number(commitDeadline) : null}
            revealDeadline={typeof revealDeadline === "bigint" ? Number(revealDeadline) : null}
            now={now}
            busy={actionBusy}
            canWrite={canWrite}
            onDraw={() => void runAction("assignPanel", "Review panel drawn. The three reviewers can now vote.")}
            onSettle={() => void runAction("settle", "Bounty settled.")}
            onReplace={() => void runAction("pokeOrReplace", "Inactive reviewers replaced. Draw the new panel in a few seconds.")}
          />
        )}

        {showRelease && (
          <div className="card p-5">
            <p className="heading text-base">Stalled bounty</p>
            <p className="mt-1 text-xs text-zinc-400">
              {b.status === STATUS.Submitted
                ? "Evidence was submitted but not enough reviewers are available. Anyone can reopen it for other workers."
                : "The worker missed the deadline. Anyone can reopen the bounty for other workers."}
            </p>
            <button
              type="button"
              disabled={actionBusy || !canWrite}
              onClick={() => void runAction("releaseClaim", "Bounty reopened for new workers.")}
              className="btn-ghost mt-3 w-full"
            >
              Reopen stalled bounty
            </button>
          </div>
        )}

        {(actionStatus || actionError) && (
          <div className="md:col-span-3">
            {actionStatus && <p className="alert-info p-2 text-xs">{actionStatus}</p>}
            {actionError && (
              <p className="alert-error p-2 text-xs">{actionError}</p>
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
    <div className="card-inset px-3 py-2.5">
      <p className="label-micro">{label}</p>
      <p className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">{value}</p>
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
    <div className="card card-hover flex flex-col p-5">
      <p className="heading text-base">{title}</p>
      <p className="mt-1 flex-1 text-xs text-zinc-400">{description}</p>
      <Link
        href={href}
        className="btn-primary mt-4"
      >
        {cta}
      </Link>
    </div>
  );
}

function ReviewProgressCard(props: {
  status: number;
  selectionBlock: bigint;
  blockNumber: bigint | null;
  eligibleCount: number | null;
  revealed: number | null;
  approvals: number | null;
  commitDeadline: number | null;
  revealDeadline: number | null;
  now: number;
  busy: boolean;
  canWrite: boolean;
  onDraw: () => void;
  onSettle: () => void;
  onReplace: () => void;
}) {
  const { status, selectionBlock, blockNumber, eligibleCount, revealed, now, busy, canWrite } = props;

  if (status === STATUS.Submitted) {
    const blocksLeft = blockNumber === null ? null : Number(selectionBlock - blockNumber) + 1;
    const tooFew = eligibleCount !== null && eligibleCount < 3;
    const ready = blockNumber !== null && blockNumber > selectionBlock && !tooFew;
    return (
      <div className="card p-5 border-violet-500/30 md:col-span-3">
        <p className="heading text-sm">Next step: draw the review panel</p>
        <p className="mt-1 text-xs text-zinc-400">
          Evidence is submitted. Three reviewers are now picked at random from registered reviewers. Anyone can
          trigger the draw.
        </p>
        {tooFew ? (
          <p className="alert-warn mt-2 p-2 text-xs">
            Only {eligibleCount} eligible reviewer{eligibleCount === 1 ? "" : "s"} registered; 3 are needed. Reviewers
            register on the{" "}
            <Link href="/review" className="font-semibold underline">
              Review
            </Link>{" "}
            page. The creator, funders and worker of this bounty can&apos;t review it.
          </p>
        ) : blocksLeft !== null && blocksLeft > 0 ? (
          <p className="mt-2 text-xs text-zinc-400">Randomness is ready in {blocksLeft} block{blocksLeft === 1 ? "" : "s"}…</p>
        ) : null}
        <button
          type="button"
          disabled={!ready || busy || !canWrite}
          onClick={props.onDraw}
          className="btn-primary mt-3 w-full"
        >
          Draw review panel
        </button>
      </div>
    );
  }

  const revealEnd = props.revealDeadline ?? 0;
  const commitEnd = props.commitDeadline ?? 0;
  const afterReveal = revealEnd > 0 && now > revealEnd;
  const canSettle = revealed !== null && (revealed === 3 || (afterReveal && revealed >= 2));
  const canReplace = revealed !== null && afterReveal && revealed < 2;
  const phase = now <= commitEnd ? "Reviewers are committing their votes" : now <= revealEnd ? "Reviewers are revealing their votes" : "Voting has ended";
  return (
    <div className="card p-5 border-orange-500/30 md:col-span-3">
      <p className="heading text-sm">Review in progress</p>
      <p className="mt-1 text-xs text-zinc-400">
        {phase}. {revealed ?? 0} of 3 votes revealed, {props.approvals ?? 0} approving.
        {!afterReveal && revealEnd > 0 && ` Voting ends ${new Date(revealEnd * 1000).toLocaleString()}.`}
      </p>
      {canSettle && (
        <button
          type="button"
          disabled={busy || !canWrite}
          onClick={props.onSettle}
          className="btn-success mt-3 w-full"
        >
          Settle &amp; release payment
        </button>
      )}
      {canReplace && (
        <>
          <p className="alert-warn mt-2 p-2 text-xs">Fewer than 2 reviewers revealed in time. Replace them with a new panel.</p>
          <button
            type="button"
            disabled={busy || !canWrite}
            onClick={props.onReplace}
            className="btn-danger mt-3 w-full"
          >
            Replace inactive reviewers
          </button>
        </>
      )}
      <Link href="/review" className="mt-3 inline-block text-xs font-semibold text-brand-300 hover:underline">
        Reviewers vote on the Review page →
      </Link>
    </div>
  );
}
