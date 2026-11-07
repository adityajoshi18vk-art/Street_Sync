"use client";

import React from "react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck,
  Compass,
  Plus,
  ArrowDown,
  ExternalLink,
  MapPin,
  CheckCircle2,
  Lock,
  Layers,
  Activity,
  Zap,
  Globe
} from "lucide-react";
import { ACTIVE_CHAIN, JANLEKHA_URL } from "@/config/contracts";

export interface StreetSyncHeroProps {
  bountyCount: number;
  onExploreMap: () => void;
  onCreateClick: () => void;
}

export function StreetSyncHero({
  bountyCount,
  onExploreMap,
  onCreateClick
}: StreetSyncHeroProps) {
  return (
    <div className="relative w-full overflow-hidden pb-12 pt-4">
      {/* Subtle architectural dot matrix grid */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,_rgba(255,255,255,0.08)_1px,_transparent_1px)] [background-size:24px_24px] opacity-70"
        aria-hidden="true"
      />

      {/* Ambient gradient glows */}
      <div
        className="pointer-events-none absolute left-1/4 top-0 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute right-1/4 top-1/3 -z-10 h-80 w-80 translate-x-1/3 rounded-full bg-accent-400/10 blur-3xl"
        aria-hidden="true"
      />

      {/* Status pill header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-6 pt-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs font-semibold text-slate-300 shadow-sm backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-emerald-400">ESCROW LIVE</span>
          <span className="text-slate-600">·</span>
          <span>{ACTIVE_CHAIN.name}</span>
          <span className="text-slate-600">·</span>
          <span>USDC 6-Decimals</span>
        </div>

        <div className="hidden items-center gap-4 text-xs text-slate-400 sm:flex font-mono">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-accent-400" /> World ID v4 ZK
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-brand-400" /> 81 KiB Arkiv Bundle
          </span>
        </div>
      </div>

      {/* Main Brutalist Editorial Typographic Display */}
      <section className="relative px-2 pt-6">
        <div className="flex flex-col justify-center gap-1 sm:gap-2">
          {/* Row 1: CIVIC */}
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-baseline md:justify-between">
            <h1 className="font-display text-6xl font-light tracking-tight text-white sm:text-7xl md:text-8xl xl:text-[9.5rem] leading-none">
              CIVIC
            </h1>
            <p className="max-w-[280px] text-xs leading-relaxed text-slate-400 md:text-right md:text-sm">
              Neighbors discover and crowdfund urgent street repairs directly in Circle
              USDC on Arc Testnet.
            </p>
          </div>

          {/* Row 2: RE[Shield]PAIRS */}
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
            <p className="order-2 max-w-[280px] text-xs leading-relaxed text-slate-400 md:order-1 md:text-left md:text-sm">
              Work is executed by World ID biometrically verified humans and anchored in
              atomic Arkiv storage.
            </p>
            <h1 className="order-1 flex items-center font-display text-6xl font-light tracking-tight text-white sm:text-7xl md:order-2 md:text-8xl xl:text-[9.5rem] leading-none">
              <span>RE</span>
              <div className="mx-1 inline-flex items-center justify-center rounded-2xl border border-brand-400/40 bg-brand-500/10 px-2 py-1 shadow-glow-sm">
                <ShieldCheck className="h-10 w-10 text-brand-400 sm:h-14 sm:w-14 md:h-18 md:w-18 xl:h-28 xl:w-28" />
              </div>
              <span>PAIRS</span>
            </h1>
          </div>

          {/* Row 3: ON-CHAIN */}
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-baseline md:justify-between">
            <h1 className="font-display text-6xl font-light tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-brand-400 sm:text-7xl md:text-8xl xl:text-[9.5rem] leading-none">
              ON-CHAIN
            </h1>
            <div className="flex items-center gap-3">
              <div className="hidden rounded-full border border-accent-400/30 bg-accent-400/10 px-3 py-1.5 text-xs font-semibold text-accent-300 md:flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-accent-400 animate-pulse" />
                Commit-Reveal Consensus
              </div>
            </div>
          </div>
        </div>

        {/* Spec Bar / Protocol Telemetry Line */}
        <div className="w-full pt-8">
          <Separator className="w-full my-4" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-400 font-mono">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand-400" />
              <span>ARC PROTOCOL · ESCROW CONTRACT v1.0</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span>GPS TELEMETRY ± 2.5M</span>
              <span className="text-slate-700">/</span>
              <span>COMPASS ORIENTATION</span>
              <span className="text-slate-700">/</span>
              <span className="text-white font-semibold">SWARM 4KiB CHUNK VIDEO</span>
            </div>
          </div>
        </div>

        {/* Oriented Command Bar & Real Infrastructure Feature Showcase */}
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-center">
          {/* Action Buttons: Oriented, Purposeful, Non-AI */}
          <div className="space-y-4 lg:col-span-7">
            <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
              StreetSync replaces municipal red tape with cryptographic certainty:
              neighbors fund it, a verified human fixes it, community reviewers confirm
              it, and escrow releases only when all parties agree.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onExploreMap}
                className="btn-primary px-6 py-3 text-sm sm:text-base flex items-center gap-2.5 group cursor-pointer"
              >
                <Compass className="h-4 w-4 transition-transform group-hover:rotate-45 text-accent-300" />
                <span>Explore Bounties Map</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-xs font-bold text-white">
                  {bountyCount}
                </span>
                <ArrowDown className="h-3.5 w-3.5 text-white/70 transition-transform group-hover:translate-y-0.5" />
              </button>

              <button
                type="button"
                onClick={onCreateClick}
                className="btn-white px-5 py-3 text-sm sm:text-base flex items-center gap-2 group cursor-pointer"
              >
                <Plus className="h-4 w-4 text-black transition-transform group-hover:scale-125" />
                <span>Fund a Repair</span>
              </button>

              <Link
                href="/review"
                className="btn-ghost px-5 py-3 text-sm sm:text-base flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Review Panel</span>
              </Link>

              <a
                href={JANLEKHA_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost px-4 py-3 text-xs sm:text-sm text-slate-400 hover:text-accent-300 flex items-center gap-1.5"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>Spending Trail</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </div>

            {/* Micro-metrics */}
            <div className="grid grid-cols-3 gap-3 pt-4 max-w-lg border-t border-white/[0.08]">
              <div>
                <p className="font-display text-xl font-bold text-white">6-Dec</p>
                <p className="text-[11px] text-slate-500 font-mono uppercase">USDC Strict</p>
              </div>
              <div>
                <p className="font-display text-xl font-bold text-white">97.8%</p>
                <p className="text-[11px] text-slate-500 font-mono uppercase">Zstd Savings</p>
              </div>
              <div>
                <p className="font-display text-xl font-bold text-white">&lt; 120 KB</p>
                <p className="text-[11px] text-slate-500 font-mono uppercase">Arkiv Atomic</p>
              </div>
            </div>
          </div>

          {/* High-Resolution Civic Infrastructure Showcase Card */}
          <div className="lg:col-span-5">
            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-2xl backdrop-blur-xl transition hover:border-brand-400/40">
              <div className="relative h-56 w-full overflow-hidden rounded-xl sm:h-64">
                <img
                  src="https://images.unsplash.com/photo-1541888946425-d0fbb186156f?q=80&w=1200&auto=format&fit=crop"
                  alt="Verified street infrastructure and asphalt repair in progress"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Overlaid evidence tag */}
                <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>COMMUNITY REPAIR ESCROW</span>
                </div>

                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                  <div>
                    <p className="text-xs font-bold text-white">Civic Work Order #0x7f9a</p>
                    <p className="font-mono text-[11px] text-slate-300">
                      Crosswalk & Pothole Restoration
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/20 bg-black/70 px-2 py-1 text-right">
                    <p className="font-mono text-xs font-bold text-emerald-400">100.00 USDC</p>
                    <p className="text-[9px] text-slate-400 uppercase">Released</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-slate-400 font-mono">
                <span>VERIFIER: WORLD ID v4</span>
                <span className="text-brand-300">HASH: 0xcc04fa...e819</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Floating Right-Edge Protocol Status Ribbon */}
      <div className="fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 md:block">
        <div className="flex items-center gap-2 rounded-l-xl border-y border-l border-white/15 bg-black/90 py-5 px-2.5 shadow-2xl backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-glow-pulse" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-slate-300 uppercase [writing-mode:vertical-rl] rotate-180">
            ARC TESTNET · USDC ESCROW
          </span>
        </div>
      </div>
    </div>
  );
}

export default StreetSyncHero;

