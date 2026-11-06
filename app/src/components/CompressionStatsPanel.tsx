"use client";

import { MAX_ARKIV_PAYLOAD, MAX_SAFE_BUNDLE_BYTES } from "@streetsync/evidence";
import type { CompressionStats } from "@streetsync/evidence";
import { formatBytes } from "@/lib/types";

/**
 * Rule 7: live benchmark of the hybrid compression pipeline.
 * Raw camera bytes → WebP images → CBOR metadata → Zstd CBOR → final bundle,
 * always measured against the 128 KiB single-entity Arkiv budget
 * (120 KiB safe framing budget marked separately).
 */
export default function CompressionStatsPanel({
  stats,
  busy
}: {
  stats: CompressionStats | null;
  busy?: boolean;
}) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5">
        <p className="text-sm font-semibold text-gray-700">Live Compression Benchmark</p>
        <p className="mt-1 text-xs text-gray-500">
          {busy
            ? "Running pipeline — resize → WebP → CBOR → Zstd…"
            : "Capture the before and after photos, then build the bundle to see the live benchmark."}
        </p>
      </div>
    );
  }

  const limitPct = Math.min(100, (stats.totalBundleBytes / MAX_ARKIV_PAYLOAD) * 100);
  const safePct = Math.min(100, (MAX_SAFE_BUNDLE_BYTES / MAX_ARKIV_PAYLOAD) * 100);
  const withinBudget = stats.totalBundleBytes <= MAX_SAFE_BUNDLE_BYTES;

  const rows: Array<{ label: string; value: string; detail?: string }> = [
    {
      label: "Raw camera bytes",
      value: formatBytes(stats.rawImagesBytes),
      detail: "before + after JPEG frames"
    },
    {
      label: "WebP (≤48 KiB each)",
      value: formatBytes(stats.encodedImagesBytes),
      detail: `−${stats.imageSavingsPercent.toFixed(1)}% vs raw`
    },
    {
      label: "Metadata: raw JSON → CBOR → Zstd",
      value: `${formatBytes(stats.rawMetadataBytes)} → ${formatBytes(
        stats.cborMetadataBytes
      )} → ${formatBytes(stats.zstdMetadataBytes)}`,
      detail: `−${stats.metadataSavingsPercent.toFixed(1)}% vs raw JSON`
    },
    {
      label: "Header + signature overhead",
      value: `${stats.headerBytes} B + ${stats.signatureBytes} B`
    }
  ];

  return (
    <div className="rounded-xl bg-white p-5 shadow-card ring-1 ring-gray-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Live Compression Benchmark</p>
          <p className="text-xs text-gray-500">Rule 7 — single atomic Arkiv entity write</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
            withinBudget
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-red-50 text-red-700 ring-red-200"
          }`}
        >
          {withinBudget ? "WITHIN 120 KiB BUDGET" : "OVER SAFE BUDGET"}
        </span>
      </div>

      <div className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-gray-500">{row.label}</span>
            <span className="text-right">
              <span className="font-mono font-semibold text-gray-900">{row.value}</span>
              {row.detail && <span className="ml-1.5 text-gray-400">{row.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-gray-700">
            Final bundle: {formatBytes(stats.totalBundleBytes)}
          </span>
          <span className="text-gray-500">
            {formatBytes(stats.rawTotalBytes)} raw → {stats.overallCompressionRatio.toFixed(1)}×
            smaller ({stats.overallSavingsPercent.toFixed(1)}% saved)
          </span>
        </div>
        <div className="relative mt-1.5 h-4 w-full overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              withinBudget ? "bg-emerald-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.max(2, limitPct)}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-500"
            style={{ left: `${safePct}%` }}
            title="120 KiB safe budget"
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-400">
          <span>0</span>
          <span className="text-amber-600">120 KiB safe budget</span>
          <span>128 KiB Arkiv hard limit ({MAX_ARKIV_PAYLOAD.toLocaleString()} B)</span>
        </div>
      </div>
    </div>
  );
}
