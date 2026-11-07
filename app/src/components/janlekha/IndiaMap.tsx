"use client";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINRCompact } from "@/lib/janlekha/format";
import { DemoBadge } from "./ui";

const STATE_POS: Record<string, { x: number; y: number }> = {
  Gujarat: { x: 118, y: 205 },
  Maharashtra: { x: 168, y: 262 },
  Karnataka: { x: 182, y: 330 },
  "Tamil Nadu": { x: 218, y: 378 },
  "Uttar Pradesh": { x: 252, y: 128 },
  Odisha: { x: 302, y: 218 },
};

const OUTLINE =
  "M 155 22 L 195 16 L 226 44 L 246 70 L 286 94 L 320 104 L 356 124 L 376 146 L 360 166 L 342 176 L 326 210 L 306 260 L 286 320 L 262 380 L 246 412 L 236 396 L 212 350 L 186 300 L 162 250 L 142 200 L 132 150 L 136 100 L 146 55 Z";

export default function IndiaMap({ selected, onSelect }: { selected: string | null; onSelect: (state: string | null) => void }) {
  const { projects } = useJanLekha();
  const states = Object.keys(STATE_POS);
  const countFor = (state: string) => projects.filter((p) => p.state === state).length;
  const spentFor = (state: string) => projects.filter((p) => p.state === state).reduce((s, p) => s + p.spentInr, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Marker positions are approximate, not precise geography. Click a marker or a state name to filter projects.</p>
        <DemoBadge />
      </div>
      <svg viewBox="0 0 400 440" className="mx-auto mt-2 w-full max-w-md" role="img" aria-label="Simplified map of India with approximate project locations by state">
        <path d={OUTLINE} fill="#E0F2FE" stroke="#0891B2" strokeWidth={2} strokeLinejoin="round" />
        <text x={200} y={428} textAnchor="middle" fontSize={11} fill="#64748B">Simplified outline, approximate positions only</text>
        {states.map((state) => {
          const pos = STATE_POS[state];
          const count = countFor(state);
          const isSelected = selected === state;
          return (
            <g key={state} onClick={() => onSelect(isSelected ? null : state)} className="cursor-pointer">
              <circle cx={pos.x} cy={pos.y} r={isSelected ? 20 : 14 + Math.min(6, count * 2)} fill={isSelected ? "#080F1C" : "#22D3EE"} stroke="white" strokeWidth={2} />
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={isSelected ? "white" : "#080F1C"}>
                {count}
              </text>
              <text x={pos.x} y={pos.y + (isSelected ? 34 : 30)} textAnchor="middle" fontSize={11} fontWeight={isSelected ? 700 : 500} fill="#080F1C">
                {state}
              </text>
              <title>{state + ": " + count + " demo projects, " + formatINRCompact(spentFor(state)) + " spent"}</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => onSelect(null)} className={"rounded-full px-3 py-1.5 text-xs font-semibold " + (selected === null ? "bg-[#080F1C] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
          All states ({projects.length} projects)
        </button>
        {states.map((state) => (
          <button
            key={state}
            onClick={() => onSelect(selected === state ? null : state)}
            className={"rounded-full px-3 py-1.5 text-xs font-semibold " + (selected === state ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
          >
            {state} ({countFor(state)})
          </button>
        ))}
      </div>
    </div>
  );
}
