import * as React from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Editorial hero adapted from 21st.dev "hero-03" (Ali Imam): dot-grid field, oversized
 * light display type with inline glyphs, side captions, a separator signature line,
 * and a media + copy row. Content is slot-based so pages supply their own copy and data.
 */

export interface HeroRow {
  /** Display text; inline icons should be sized in `em` so they scale with the type. */
  content: React.ReactNode;
  caption?: React.ReactNode;
  captionSide?: "start" | "end";
}

export interface HeroSection03Props {
  /** Accessible heading text; the oversized rows are decorative. */
  title?: string;
  rows?: HeroRow[];
  meta?: { start?: React.ReactNode; end?: React.ReactNode };
  signature?: { detail?: React.ReactNode; label: React.ReactNode; value: React.ReactNode };
  media?: React.ReactNode;
  aside?: React.ReactNode;
  links?: React.ReactNode;
  /** Vertical tab pinned to the viewport edge on wide screens. */
  sideTab?: React.ReactNode;
  className?: string;
}

function Caption({ children, align }: { children: React.ReactNode; align: "start" | "end" }) {
  return (
    <p
      className={cn(
        "max-w-[240px] text-xs leading-5 text-muted-foreground md:max-w-[190px] md:text-sm",
        align === "start" ? "mb-3 md:mb-0 md:text-right" : "mb-4 mt-3 md:my-0"
      )}
    >
      {children}
    </p>
  );
}

export function HeroSection03({
  title = "StreetSync",
  rows = [],
  meta,
  signature,
  media,
  aside,
  links,
  sideTab,
  className
}: HeroSection03Props) {
  return (
    <section className={cn("relative isolate pb-4", className)}>
      <div
        aria-hidden
        className="absolute inset-x-[-1rem] inset-y-0 -z-10 bg-[radial-gradient(circle,_white_1px,_transparent_1px)] opacity-[0.13] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_75%_70%_at_50%_40%,black_35%,transparent_100%)]"
      />

      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>{meta.start}</span>
          <span>{meta.end}</span>
        </div>
      )}

      <h1 className="sr-only">{title}</h1>
      <div className="flex w-full flex-col gap-1 pt-14 md:items-center md:pt-20">
        {rows.map((row, i) => {
          const side = row.captionSide ?? "end";
          return (
            <div key={i} className="md:flex md:items-center md:gap-8">
              {row.caption && side === "start" && <Caption align="start">{row.caption}</Caption>}
              <p
                aria-hidden
                className="flex flex-wrap items-center font-display text-[clamp(3rem,10.5vw,8.75rem)] font-light uppercase leading-[0.92] tracking-[0.04em] text-foreground"
              >
                {row.content}
              </p>
              {row.caption && side === "end" && <Caption align="end">{row.caption}</Caption>}
            </div>
          );
        })}
      </div>

      {signature && (
        <div className="mt-10 grid items-center gap-3 md:flex md:justify-end md:gap-5">
          <Separator className="md:max-w-xl md:flex-1" />
          {signature.detail && (
            <div className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {signature.detail}
            </div>
          )}
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-extralight uppercase tracking-wide text-foreground md:text-4xl">
              {signature.label}
            </span>
            <span className="font-display text-3xl font-bold italic tabular-nums text-primary md:text-5xl">
              {signature.value}
            </span>
          </div>
        </div>
      )}

      {(media || aside || links) && (
        <div className="mt-12 grid gap-8 md:grid-cols-[21rem_1fr] md:items-end md:gap-10">
          {media && (
            <div className="relative h-52 overflow-hidden rounded-2xl border border-border shadow-card">{media}</div>
          )}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">{aside}</div>
            {links && <div className="flex shrink-0 items-center gap-5 text-muted-foreground">{links}</div>}
          </div>
        </div>
      )}

      {sideTab && (
        <div className="fixed right-0 top-1/2 z-[500] hidden -translate-y-1/2 xl:flex">{sideTab}</div>
      )}
    </section>
  );
}

export default HeroSection03;
