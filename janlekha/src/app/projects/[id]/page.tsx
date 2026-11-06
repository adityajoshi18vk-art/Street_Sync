import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import {
  AddressText,
  Badge,
  ErrorPanel,
  Field,
  HashText,
  LoadingPanel,
  MockPayment,
  NotFoundPanel,
  OffChain,
  OnChain,
  Section,
  TxLink,
} from "@/components/ui";
import type { TimelineEvent } from "@/lib/janlekha/events";
import { catalogDocument, catalogProject, formatPaise, formatTimestamp, shortHex } from "@/lib/janlekha/format";
import { getProject, type MilestoneView, type ProjectDetail } from "@/lib/janlekha/reads";

export const metadata: Metadata = { title: "Project" };

function DocumentHash({ projectId, docKey, label, hash }: { projectId: bigint; docKey: string; label: string; hash: Hex }) {
  const offChain = catalogDocument(hash);
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-600">{label} · SHA-256</p>
        <Link
          href={`/verify?project=${projectId}&doc=${encodeURIComponent(docKey)}`}
          className="text-xs font-medium text-blue-700 underline underline-offset-2"
        >
          Verify a copy
        </Link>
      </div>
      <HashText hash={hash} />
      {offChain && (
        <p className="mt-1 text-xs text-neutral-500">
          Off-chain copy:{" "}
          <a href={offChain.file} className="underline underline-offset-2" download>
            {offChain.title}
          </a>
        </p>
      )}
    </div>
  );
}

function Deadline({ label, at, now }: { label: string; at: bigint; now: bigint }) {
  return (
    <Field label={label}>
      {formatTimestamp(at)}{" "}
      <span className="text-xs text-neutral-500">{now >= at ? "(passed)" : "(upcoming)"}</span>
    </Field>
  );
}

const MILESTONE_STEPS = ["Defined", "EvidenceSubmitted", "Approved", "Paid"] as const;
const STEP_LABEL: Record<(typeof MILESTONE_STEPS)[number], string> = {
  Defined: "Defined",
  EvidenceSubmitted: "Evidence submitted",
  Approved: "Inspection approved",
  Paid: "Mock PFMS payment attested",
};

function MilestoneCard({ m, projectId, explorerUrl }: { m: MilestoneView; projectId: bigint; explorerUrl: string | null }) {
  const reached = MILESTONE_STEPS.indexOf(m.status as (typeof MILESTONE_STEPS)[number]);
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Milestone {m.id} · <span className="tabular-nums">{formatPaise(m.amountPaise)}</span>
        </p>
        {m.status === "Paid" ? <MockPayment /> : <Badge tone="neutral">{STEP_LABEL[m.status as keyof typeof STEP_LABEL] ?? m.status}</Badge>}
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {MILESTONE_STEPS.map((step, i) => (
          <li
            key={step}
            className={`rounded-md px-2 py-1.5 ring-1 ring-inset ${i <= reached ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-neutral-50 text-neutral-400 ring-neutral-200"}`}
          >
            {i <= reached ? "✓ " : ""}
            {STEP_LABEL[step]}
          </li>
        ))}
      </ol>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Defined">{formatTimestamp(m.definedAt)}</Field>
        <Field label="Evidence submitted">{m.evidenceSubmittedAt > 0n ? formatTimestamp(m.evidenceSubmittedAt) : "Not yet"}</Field>
        <Field label="Inspection">
          {m.approvedAt > 0n ? (
            <>
              Approved {formatTimestamp(m.approvedAt)} by <AddressText address={m.inspector} explorerUrl={explorerUrl} />
            </>
          ) : m.evidenceSubmittedAt > 0n ? (
            "Awaiting inspector review"
          ) : (
            "Awaiting evidence"
          )}
        </Field>
        <Field label="Mock PFMS payment attestation">
          {m.paidAt > 0n ? (
            <>
              Attested {formatTimestamp(m.paidAt)} by PAO <AddressText address={m.pao} explorerUrl={explorerUrl} />
            </>
          ) : m.approvedAt > 0n ? (
            "Awaiting PAO attestation"
          ) : (
            "Not attested"
          )}
        </Field>
      </dl>
      <div className="mt-3 grid gap-2">
        <DocumentHash projectId={projectId} docKey={`m${m.id}-spec`} label="Specification" hash={m.specificationDocumentHash} />
        {m.evidenceSubmittedAt > 0n && <DocumentHash projectId={projectId} docKey={`m${m.id}-evidence`} label="Evidence" hash={m.evidenceDocumentHash} />}
        {m.approvedAt > 0n && <DocumentHash projectId={projectId} docKey={`m${m.id}-inspection`} label="Inspection report" hash={m.inspectionReportHash} />}
        {m.paidAt > 0n && <DocumentHash projectId={projectId} docKey={`m${m.id}-payment`} label="Mock PFMS payment advice" hash={m.paymentReferenceHash} />}
      </div>
    </div>
  );
}

function describe(e: TimelineEvent, explorerUrl: string | null): { title: string; body: ReactNode; mock?: boolean } {
  const a = e.args;
  const addr = (v: unknown) => <AddressText address={v as Address} explorerUrl={explorerUrl} />;
  const paise = (v: unknown) => <span className="tabular-nums">{formatPaise(v as bigint)}</span>;
  const hash = (v: unknown) => <code className="font-mono" title={v as string}>{shortHex(v as Hex, 10)}</code>;
  switch (e.name) {
    case "ProjectCreated":
      return { title: "Project created", body: <>Department {addr(a.department)} recorded an allocation of {paise(a.allocationPaise)} with sanction document {hash(a.sanctionDocumentHash)}.</> };
    case "TenderPublished":
      return { title: "Tender published", body: <>Tender document {hash(a.tenderDocumentHash)}. Bids close {formatTimestamp(a.bidDeadline as bigint)}; reveals close {formatTimestamp(a.revealDeadline as bigint)}.</> };
    case "BidCommitted":
      return { title: "Sealed bid committed", body: <>Vendor {addr(a.vendor)} committed a sealed bid (commitment {hash(a.commitment)}). The amount stays hidden until reveal.</> };
    case "BidRevealed":
      return { title: "Bid revealed", body: <>Vendor {addr(a.vendor)} revealed a quotation of {paise(a.amountPaise)} (document {hash(a.quotationDocumentHash)}).</> };
    case "ContractAwarded":
      return { title: "Contract awarded", body: <>Awarded to {addr(a.vendor)} for {paise(a.amountPaise)}, the vendor&apos;s revealed bid. Evaluation {hash(a.evaluationDocumentHash)}, contract {hash(a.contractDocumentHash)}.</> };
    case "MilestoneDefined":
      return { title: `Milestone ${a.milestoneId} defined`, body: <>{paise(a.amountPaise)} with specification {hash(a.specificationDocumentHash)}.</> };
    case "MilestoneEvidenceSubmitted":
      return { title: `Milestone ${a.milestoneId} evidence submitted`, body: <>Vendor {addr(a.vendor)} submitted evidence {hash(a.evidenceDocumentHash)}.</> };
    case "MilestoneApproved":
      return { title: `Milestone ${a.milestoneId} approved by inspector`, body: <>Inspector {addr(a.inspector)} approved with report {hash(a.inspectionReportHash)}.</> };
    case "MockPaymentAttested":
      return { title: `Milestone ${a.milestoneId}: mock PFMS payment attested`, body: <>PAO {addr(a.pao)} attested {paise(a.amountPaise)} to vendor {addr(a.vendor)} (advice {hash(a.paymentReferenceHash)}). No funds moved on-chain.</>, mock: true };
    default:
      return { title: e.name, body: null };
  }
}

function Timeline({ project, explorerUrl, isHedera }: { project: ProjectDetail; explorerUrl: string | null; isHedera: boolean }) {
  if (!project.timeline.ok) return <ErrorPanel failure={project.timeline.failure} />;
  if (project.timeline.events.length === 0) return <p className="text-sm text-neutral-500">No events found for this project.</p>;
  return (
    <ol className="relative space-y-4 border-l border-neutral-200 pl-5">
      {project.timeline.events.map((e) => {
        const d = describe(e, explorerUrl);
        return (
          <li key={`${e.txHash}-${e.logIndex}`} className="relative">
            <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${d.mock ? "bg-amber-500" : "bg-emerald-600"}`} />
            <p className="text-xs text-neutral-500">{formatTimestamp(e.timestamp)}</p>
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {d.title} {d.mock && <MockPayment />}
            </p>
            <p className="mt-0.5 text-sm text-neutral-700">{d.body}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {isHedera ? "Hedera transaction" : "Transaction"} <TxLink hash={e.txHash} explorerUrl={explorerUrl} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

async function ProjectContent({ id }: { id: string }) {
  await connection();
  const result = await getProject(id);
  if (result.status === "not-found") return <NotFoundPanel reason={result.reason} />;
  if (result.status === "error") return <ErrorPanel failure={result.failure} />;

  const { project: p, ctx } = result;
  const { explorerUrl, isHedera } = ctx.cfg;
  const meta = catalogProject(p.sanctionDocumentHash);
  const unreserved = p.budget.allocationPaise - p.budget.reservedPaise - p.budget.paidPaise;
  const winner = p.award?.vendor.toLowerCase();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-neutral-500">Project #{p.id.toString()}</p>
        <h1 className="text-2xl font-semibold">{meta?.title ?? `Untitled project #${p.id}`}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <Badge tone="good">{p.stage}</Badge>
          {meta && (
            <span>
              {meta.department} · {meta.location} <OffChain />
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Department account <AddressText address={p.department} explorerUrl={explorerUrl} /> · created {formatTimestamp(p.createdAt)} · read live at block{" "}
          {ctx.blockNumber.toString()} (chain time {formatTimestamp(ctx.chainTime)})
        </p>
      </header>

      <Section title="Budget" badge={<OnChain />}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Allocation"><span className="text-lg font-semibold tabular-nums">{formatPaise(p.budget.allocationPaise)}</span></Field>
          <Field label="Reserved (awarded, unpaid)"><span className="text-lg font-semibold tabular-nums">{formatPaise(p.budget.reservedPaise)}</span></Field>
          <Field label="Paid (mock PFMS attested)"><span className="text-lg font-semibold tabular-nums">{formatPaise(p.budget.paidPaise)}</span></Field>
          <Field label="Unreserved"><span className="text-lg font-semibold tabular-nums">{formatPaise(unreserved)}</span></Field>
        </dl>
        <p className="mt-3 text-xs text-neutral-500">
          Contract accounting records in paise. INR is not transferred on-chain; payments are mock PFMS attestations only.
        </p>
        <div className="mt-3">
          <DocumentHash projectId={p.id} docKey="sanction" label="Sanction order" hash={p.sanctionDocumentHash} />
        </div>
      </Section>

      <Section title="Tender and sealed bids" badge={<OnChain />}>
        {!p.tender ? (
          <p className="text-sm text-neutral-600">No tender has been published for this project yet.</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Published">{formatTimestamp(p.tender.publishedAt)}</Field>
              <Deadline label="Bid deadline" at={p.tender.bidDeadline} now={ctx.chainTime} />
              <Deadline label="Reveal deadline" at={p.tender.revealDeadline} now={ctx.chainTime} />
              <Field label="Bids">
                <span className="tabular-nums">{p.tender.commitCount} committed · {p.tender.revealCount} revealed</span>
              </Field>
            </dl>
            <DocumentHash projectId={p.id} docKey="tender" label="Tender document" hash={p.tender.tenderDocumentHash} />
            {p.bids.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Vendor</th>
                      <th className="py-2 pr-3 font-medium">Committed</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Quotation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {p.bids.map((b) => (
                      <tr key={b.vendor} className="align-top">
                        <td className="py-2 pr-3">
                          <AddressText address={b.vendor} explorerUrl={explorerUrl} />{" "}
                          {winner === b.vendor.toLowerCase() && <Badge tone="onchain">Awarded</Badge>}
                        </td>
                        <td className="py-2 pr-3 text-xs">{formatTimestamp(b.committedAt)}</td>
                        <td className="py-2 pr-3">{b.revealed ? <Badge tone="good">Revealed</Badge> : <Badge tone="neutral">Sealed</Badge>}</td>
                        <td className="py-2 pr-3">
                          {b.revealed ? (
                            <>
                              <span className="font-medium tabular-nums">{formatPaise(b.amountPaise)}</span>
                              <code className="mt-0.5 block break-all font-mono text-[11px] text-neutral-500">{b.quotationDocumentHash}</code>
                            </>
                          ) : (
                            <span className="text-xs text-neutral-500">Hidden until the vendor reveals after the bid deadline</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Award" badge={<OnChain />}>
        {!p.award ? (
          <p className="text-sm text-neutral-600">
            {p.tender && ctx.chainTime >= p.tender.revealDeadline ? "Reveal period has ended; awaiting the department's award." : "Not awarded yet. An award is only possible after the reveal deadline."}
          </p>
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Field label="Awarded vendor"><AddressText address={p.award.vendor} explorerUrl={explorerUrl} /></Field>
              <Field label="Award amount (from revealed bid)"><span className="font-semibold tabular-nums">{formatPaise(p.award.amountPaise)}</span></Field>
              <Field label="Awarded">{formatTimestamp(p.award.awardedAt)}</Field>
            </dl>
            <div className="grid gap-2 md:grid-cols-2">
              <DocumentHash projectId={p.id} docKey="evaluation" label="Bid evaluation report" hash={p.award.evaluationDocumentHash} />
              <DocumentHash projectId={p.id} docKey="contract" label="Contract agreement" hash={p.award.contractDocumentHash} />
            </div>
          </div>
        )}
      </Section>

      {p.award && (
        <Section title={`Milestones (${p.milestones.length})`} badge={<OnChain />}>
          {p.milestones.length === 0 ? (
            <p className="text-sm text-neutral-600">No milestones defined yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">
                {formatPaise(p.award.milestoneTotalPaise)} of {formatPaise(p.award.amountPaise)} allocated to milestones.
              </p>
              {p.milestones.map((m) => (
                <MilestoneCard key={m.id} m={m} projectId={p.id} explorerUrl={explorerUrl} />
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Event timeline" badge={<OnChain />}>
        <Timeline project={p} explorerUrl={explorerUrl} isHedera={isHedera} />
      </Section>

      <p className="text-xs text-neutral-500">
        Contract <AddressText address={ctx.contractAddress} explorerUrl={explorerUrl} /> on chain {ctx.cfg.chainId}. On-chain records prove
        timestamps, approvals and document integrity; they do not independently prove physical work or bank settlement.
      </p>
    </div>
  );
}

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<LoadingPanel label="Reading project records from the contract…" />}>
      {params.then(({ id }) => (
        <ProjectContent id={id} />
      ))}
    </Suspense>
  );
}
