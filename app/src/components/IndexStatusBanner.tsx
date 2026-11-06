"use client";

import { ACTIVE_CHAIN } from "@/config/contracts";

/** Shown when the backend index is down; `fallback` means bounties were read from the chain instead. */
export function IndexStatusBanner({ error, fallback, onRetry }: { error: string; fallback: boolean; onRetry: () => void }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl p-4 text-sm ring-1 ${
        fallback ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-red-50 text-red-700 ring-red-200"
      }`}
    >
      <span>
        {fallback ? (
          <>
            <span className="font-semibold">Live index offline</span> — {error}. Showing bounties read directly from{" "}
            {ACTIVE_CHAIN.name}; descriptions and photos may be missing.
          </>
        ) : (
          <>
            <span className="font-semibold">Couldn&apos;t load bounties</span> — {error}. If you opened an older link, it
            may have expired; reload or use the latest one.
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
          fallback ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
        }`}
      >
        Retry
      </button>
    </div>
  );
}
