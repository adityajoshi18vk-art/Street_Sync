"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { ACTIVE_CHAIN, ESCROW_ABI, ESCROW_ADDRESS, contractsDeployed } from "@/config/contracts";
import { loadBounties } from "@/lib/bounty-source";
import { IndexStatusBanner } from "@/components/IndexStatusBanner";
import { STATUS, countdownLabel } from "@/lib/lifecycle";
import { bountyDisplayStatus, formatUsdcDisplaySafe } from "@/lib/map-utils";
import { normalizeBounty, type BountyMapItem } from "@/lib/types";
import { useNowSeconds } from "@/lib/useNow";

const ACTIVE_JOB_STATUSES: number[] = [STATUS.Claimed, STATUS.Submitted, STATUS.InReview, STATUS.Rejected];

const JOB_HINT: Record<number, string> = {
  [STATUS.Claimed]: "Take before/after photos and submit evidence.",
  [STATUS.Submitted]: "Evidence submitted. Waiting for a review panel to be drawn.",
  [STATUS.InReview]: "Reviewers are voting on your work.",
  [STATUS.Rejected]: "Rejected. You can rework once before the deadline."
};

export default function WorkDashboard() {
  const { address } = useAccount();
  const now = useNowSeconds();
  const [bounties, setBounties] = useState<BountyMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromChain, setFromChain] = useState(false);
  const config = useConfig();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadBounties(config, { limit: 200 });
      setBounties(res.rows.map(normalizeBounty));
      setFromChain(res.source === "chain");
      setError(res.backendError);
    } catch (e) {
      setFromChain(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void load();
  }, [load]);

  const me = address?.toLowerCase();
  const myJobs = useMemo(
    () => bounties.filter((b) => !!me && b.worker?.toLowerCase() === me && ACTIVE_JOB_STATUSES.includes(b.status)),
    [bounties, me]
  );
  const { data: quorumRaw } = useReadContract({
    chainId: ACTIVE_CHAIN.id,
    address: contractsDeployed ? (ESCROW_ADDRESS as `0x${string}`) : undefined,
    abi: ESCROW_ABI,
    functionName: "validationQuorum",
    query: { enabled: contractsDeployed }
  });
  // Contract treats a quorum of 0 as 1.
  const quorum = Math.max(1, typeof quorumRaw === "number" ? quorumRaw : Number(quorumRaw ?? 2));
  const upcomingJobs = useMemo(
    () => bounties.filter((b) => b.status === STATUS.Proposed && now <= b.validationDeadline),
    [bounties, now]
  );
  const openJobs = useMemo(
    () => bounties.filter((b) => b.status === STATUS.Open && !bountyDisplayStatus(b, now).expired),
    [bounties, now]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">Worker dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pick a confirmed problem, verify you are a unique human with World ID, fix it, and get paid 90% of the
          escrow when reviewers approve your before/after photos.
        </p>
      </header>

      <section className="rounded-xl bg-brand-50 p-4 text-xs text-brand-900 ring-1 ring-brand-200">
        <p className="font-semibold">Who can claim a job</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Anyone with World App, using a wallet that did not create, fund, or vote on that problem.</li>
          <li>After claiming you get a 4-digit code to show in your photos and a deadline to submit.</li>
          <li>Taking photos needs camera and location access on your phone.</li>
        </ul>
      </section>

      {error && <IndexStatusBanner error={error} fallback={fromChain} onRetry={() => void load()} />}

      {address && myJobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-gray-900">Your jobs</h2>
          {myJobs.map((b) => (
            <JobCard key={b.bountyId} b={b} now={now} hint={JOB_HINT[b.status]} cta="Open workbench" />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">Open for work</h2>
          <button onClick={() => void load()} className="text-xs font-semibold text-brand-700 hover:underline">
            Refresh
          </button>
        </div>
        {loading ? (
          [0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200" />)
        ) : openJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-gray-700">No jobs open to claim yet</p>
            <p className="mt-1 text-xs text-gray-500">
              {upcomingJobs.length > 0
                ? `${upcomingJobs.length} ${upcomingJobs.length === 1 ? "job is" : "jobs are"} coming up below — each opens here the moment ${quorum} neighbours confirm it.`
                : `New reports open for work once ${quorum} neighbours confirm them.`}
            </p>
          </div>
        ) : (
          openJobs.map((b) => {
            const own = !!me && b.creator?.toLowerCase() === me;
            return (
              <JobCard
                key={b.bountyId}
                b={b}
                now={now}
                hint={own ? "You created this bounty, so you can't claim it." : `Claim window ${countdownLabel(b.claimDeadline, now)}.`}
                cta={own ? "View" : "Claim this job"}
                href={own ? `/bounty/${b.bountyId}` : undefined}
              />
            );
          })
        )}
      </section>

      {!loading && upcomingJobs.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Coming up — waiting for neighbours</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              These can&apos;t be claimed yet. Each needs {quorum} neighbours to confirm the problem is real, then it
              opens for claims instantly. Want to work on one? Don&apos;t confirm it yourself — voting on a problem
              rules you out as its worker. Share it with people nearby instead.
            </p>
          </div>
          {upcomingJobs.map((b) => {
            const own = !!me && b.creator?.toLowerCase() === me;
            return (
              <JobCard
                key={b.bountyId}
                b={b}
                now={now}
                progress={{ done: b.confirmations, of: quorum }}
                hint={
                  own
                    ? "You reported this, so you can't work on it."
                    : `${b.confirmations} of ${quorum} neighbour confirmations · voting ${countdownLabel(b.validationDeadline, now)}`
                }
                cta="View job"
                href={`/bounty/${b.bountyId}/work`}
                secondary
              />
            );
          })}
        </section>
      )}
    </div>
  );
}

function JobCard({
  b,
  now,
  hint,
  cta,
  href,
  progress,
  secondary
}: {
  b: BountyMapItem;
  now: number;
  hint?: string;
  cta: string;
  href?: string;
  progress?: { done: number; of: number };
  secondary?: boolean;
}) {
  const display = bountyDisplayStatus(b, now);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-card ring-1 ring-gray-200 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-gray-900">Bounty #{b.bountyId}</p>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: display.color }} aria-hidden />
            {display.label}
          </span>
        </div>
        {b.description && <p className="mt-0.5 line-clamp-2 text-sm text-gray-700">{b.description}</p>}
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
        {progress && (
          <div className="mt-2 flex gap-1" aria-label={`${progress.done} of ${progress.of} confirmations`}>
            {Array.from({ length: progress.of }, (_, i) => (
              <span key={i} className={`h-1.5 w-8 rounded-full ${i < progress.done ? "bg-emerald-500" : "bg-gray-200"}`} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
        <p className="text-right">
          <span className="text-lg font-bold text-gray-900">{formatUsdcDisplaySafe(b.totalPledged)}</span>
          <span className="ml-1 text-xs text-gray-400">USDC</span>
        </p>
        <Link
          href={href ?? `/bounty/${b.bountyId}/work`}
          className={
            secondary
              ? "rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              : "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          }
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
