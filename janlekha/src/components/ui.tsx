import Link from "next/link";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import type { ReadFailure } from "@/lib/janlekha/chain";
import { addressUrl, shortHex, txUrl } from "@/lib/janlekha/format";

type BadgeTone = "onchain" | "mock" | "offchain" | "neutral" | "good" | "warn";

const TONES: Record<BadgeTone, string> = {
  onchain: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
  mock: "bg-amber-400/10 text-amber-300 ring-amber-400/40",
  offchain: "bg-white/[0.05] text-slate-400 ring-white/10",
  neutral: "bg-white/[0.05] text-slate-200 ring-white/10",
  good: "bg-blue-400/10 text-blue-300 ring-blue-400/30",
  warn: "bg-orange-400/10 text-orange-300 ring-orange-400/30",
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
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="heading text-base">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-white">{children}</dd>
    </div>
  );
}

/** Full hash in monospace: citizens compare these characters, so never truncate them here. */
export function HashText({ hash }: { hash: Hex }) {
  return <code className="block break-all font-mono text-xs text-slate-100">{hash}</code>;
}

export function TxLink({ hash, explorerUrl }: { hash: Hex; explorerUrl: string | null }) {
  const url = txUrl(explorerUrl, hash);
  const label = <code className="font-mono text-xs">{shortHex(hash, 10)}</code>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline" title={hash}>
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
    <a href={url} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline" title={address}>
      {label}
    </a>
  ) : (
    <span title={address}>{label}</span>
  );
}

export function ErrorPanel({ failure }: { failure: ReadFailure }) {
  return (
    <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-5">
      <p className="font-semibold text-red-300">{failure.title}</p>
      <p className="mt-1 text-sm text-red-300">{failure.detail}</p>
    </div>
  );
}

export function NotFoundPanel({ reason }: { reason: string }) {
  return (
    <div role="alert" className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
      <p className="font-semibold text-white">Project not found</p>
      <p className="mt-1 text-sm text-slate-300">{reason}</p>
      <Link href="/projects" className="mt-3 inline-block text-sm text-brand-400 hover:underline">
        Browse all projects
      </Link>
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="card p-6">
      <div className="flex items-center gap-3 text-[15px] text-slate-500">
        <span className="spinner" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-5 space-y-3" aria-hidden="true">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    </div>
  );
}
