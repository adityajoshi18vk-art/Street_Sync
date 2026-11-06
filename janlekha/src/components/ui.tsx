import Link from "next/link";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import type { ReadFailure } from "@/lib/janlekha/chain";
import { addressUrl, shortHex, txUrl } from "@/lib/janlekha/format";

type BadgeTone = "onchain" | "mock" | "offchain" | "neutral" | "good" | "warn";

const TONES: Record<BadgeTone, string> = {
  onchain: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  mock: "bg-amber-50 text-amber-900 ring-amber-300",
  offchain: "bg-slate-50 text-slate-600 ring-slate-200",
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  good: "bg-blue-50 text-blue-800 ring-blue-200",
  warn: "bg-orange-50 text-orange-800 ring-orange-200",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const OnChain = () => <Badge tone="onchain">On-chain state</Badge>;
export const OffChain = () => <Badge tone="offchain">Off-chain metadata · not verified</Badge>;
export const MockPayment = () => <Badge tone="mock">Mock PFMS payment attested</Badge>;

export function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-900">{children}</dd>
    </div>
  );
}

/** Full hash in monospace: citizens compare these characters, so never truncate them here. */
export function HashText({ hash }: { hash: Hex }) {
  return <code className="block break-all font-mono text-xs text-neutral-800">{hash}</code>;
}

export function TxLink({ hash, explorerUrl }: { hash: Hex; explorerUrl: string | null }) {
  const url = txUrl(explorerUrl, hash);
  const label = <code className="font-mono text-xs">{shortHex(hash, 10)}</code>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2" title={hash}>
      {label}
    </a>
  ) : (
    <span title={hash}>{label}</span>
  );
}

export function AddressText({ address, explorerUrl }: { address: Address; explorerUrl: string | null }) {
  const url = addressUrl(explorerUrl, address);
  const label = <code className="font-mono text-xs">{shortHex(address)}</code>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2" title={address}>
      {label}
    </a>
  ) : (
    <span title={address}>{label}</span>
  );
}

export function ErrorPanel({ failure }: { failure: ReadFailure }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">
      <p className="font-semibold text-red-900">{failure.title}</p>
      <p className="mt-1 text-sm text-red-800">{failure.detail}</p>
    </div>
  );
}

export function NotFoundPanel({ reason }: { reason: string }) {
  return (
    <div role="alert" className="rounded-xl border border-neutral-300 bg-white p-6">
      <p className="font-semibold text-neutral-900">Project not found</p>
      <p className="mt-1 text-sm text-neutral-600">{reason}</p>
      <Link href="/projects" className="mt-3 inline-block text-sm text-blue-700 underline underline-offset-2">
        Browse all projects
      </Link>
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">{label}</div>
  );
}
