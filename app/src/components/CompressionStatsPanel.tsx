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
      <div className="card border-dashed p-5">
        <p className="text-sm font-semibold text-white">Live Compression Benchmark</p>
        <p className="mt-1 text-xs text-slate-400">
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
    <div className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="heading text-base">Live Compression Benchmark</p>
          <p className="text-xs text-slate-400">Rule 7 — single atomic Arkiv entity write</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
            withinBudget
              ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
              : "bg-red-400/10 text-red-300 ring-red-400/30"
          }`}
        >
          {withinBudget ? "WITHIN 120 KiB BUDGET" : "OVER SAFE BUDGET"}
        </span>
      </div>

      <div className="card-inset mt-5 flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="label-micro">Overall savings</p>
          <p className="font-display text-5xl font-bold leading-none text-gradient">
            {stats.overallSavingsPercent.toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <p className="label-micro">Compression ratio</p>
          <p className="font-display text-3xl font-bold leading-none text-white">
            {stats.overallCompressionRatio.toFixed(1)}×
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="card-inset flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-xs"
          >
            <span className="text-slate-400">{row.label}</span>
            <span className="text-right">
              <span className="font-mono font-semibold text-slate-200">{row.value}</span>
              {row.detail && <span className="ml-1.5 text-slate-500">{row.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
          <span className="font-semibold text-slate-200">
            Final bundle: {formatBytes(stats.totalBundleBytes)}
          </span>
          <span className="text-slate-400">
            {formatBytes(stats.rawTotalBytes)} raw → {stats.overallCompressionRatio.toFixed(1)}×
            smaller ({stats.overallSavingsPercent.toFixed(1)}% saved)
          </span>
        </div>
        <div className="relative mt-2 h-4 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              withinBudget ? "bg-gradient-to-r from-brand-500 to-accent-400" : "bg-gradient-to-r from-red-600 to-red-400"
            }`}
            style={{ width: `${Math.max(2, limitPct)}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-400"
            style={{ left: `${safePct}%` }}
            title="120 KiB safe budget"
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
          <span>0</span>
          <span className="text-amber-300">120 KiB safe budget</span>
          <span>128 KiB Arkiv hard limit ({MAX_ARKIV_PAYLOAD.toLocaleString()} B)</span>
        </div>
      </div>
    </div>
  );
}
