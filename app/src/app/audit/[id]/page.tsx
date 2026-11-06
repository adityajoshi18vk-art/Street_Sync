"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

import AuditVerifier from "@/components/AuditVerifier";
import { ESCROW_ADDRESS } from "@/config/contracts";
import { shortAddress } from "@/lib/types";

export default function AuditPage() {
  const params = useParams<{ id: string }>();
  const bountyId = params?.id ?? "";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="animate-rise mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="heading text-2xl">Public audit · bounty #{bountyId}</h1>
          <span className="shrink-0 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            no wallet required
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Anyone can verify the evidence: fetch the raw SSYN bundle from Arkiv, recompute the
          SHA-256 commitment in your browser, and check the worker&apos;s EIP-191 signature
          against what the escrow stored on Arc. Flip one byte with &quot;Simulate Tamper&quot;
          to see the on-chain hash check fail.
        </p>
        <p className="mt-2 font-mono text-xs text-slate-500">
          Escrow {shortAddress(ESCROW_ADDRESS, 4)}
        </p>
      </header>

      {bountyId ? (
        <AuditVerifier bountyId={bountyId} />
      ) : (
        <p className="alert-error">Missing bounty id.</p>
      )}

      <div className="animate-rise stagger-3 mt-6 grid grid-cols-2 gap-2 text-center text-sm">
        <Link
          href={`/bounty/${bountyId}`}
          className="btn-ghost py-3"
        >
          Bounty detail
        </Link>
        <Link
          href="/"
          className="btn-ghost py-3"
        >
          Bounty map
        </Link>
      </div>
    </main>
  );
}
