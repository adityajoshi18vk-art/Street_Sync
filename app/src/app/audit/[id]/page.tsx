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
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Public audit · bounty #{bountyId}</h1>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
            no wallet required
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Anyone can verify the evidence: fetch the raw SSYN bundle from Arkiv, recompute the
          SHA-256 commitment in your browser, and check the worker&apos;s EIP-191 signature
          against what the escrow stored on Arc. Flip one byte with &quot;Simulate Tamper&quot;
          to see the on-chain hash check fail.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Escrow {shortAddress(ESCROW_ADDRESS, 4)}
        </p>
      </header>

      {bountyId ? (
        <AuditVerifier bountyId={bountyId} />
      ) : (
        <p className="text-sm text-red-600">Missing bounty id.</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2 text-center text-sm">
        <Link
          href={`/bounty/${bountyId}`}
          className="rounded-xl border border-gray-300 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-50"
        >
          Bounty detail
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-gray-300 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-50"
        >
          Bounty map
        </Link>
      </div>
    </main>
  );
}
