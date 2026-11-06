"use client";

import { useState } from "react";

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/**
 * Draggable before/after comparison. The "before" photo is clipped over the
 * "after" photo with clip-path, so no image-width syncing is needed.
 */
export default function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After"
}: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);

  return (
    <div>
      <div className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt={afterLabel}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-brand-300 shadow-glow"
          style={{ left: `${position}%` }}
        />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-semibold text-white ring-1 ring-white/15 backdrop-blur">
          {beforeLabel}
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-semibold text-white ring-1 ring-white/15 backdrop-blur">
          {afterLabel}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Compare before and after"
        className="mt-3 w-full accent-brand-500"
      />
    </div>
  );
}
