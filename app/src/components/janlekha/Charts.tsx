// Hand built SVG charts. No recharts and no other chart dependency.
"use client";

import { formatINRCompact } from "@/lib/janlekha/format";

export const CHART_COLORS = ["#0891B2", "#22D3EE", "#0B1626", "#34D399", "#F59E0B", "#6366F1", "#EC4899", "#14B8A6"];

export interface MoneyBarDatum {
  name: string;
  Budget: number;
  Allocated: number;
  Released: number;
  Spent: number;
}

const BAR_SERIES: { key: keyof MoneyBarDatum; color: string; label: string }[] = [
  { key: "Budget", color: "#0B1626", label: "Budget" },
  { key: "Allocated", color: "#0891B2", label: "Allocated" },
  { key: "Released", color: "#22D3EE", label: "Released" },
  { key: "Spent", color: "#34D399", label: "Spent" },
];

export function MoneyBarChart({ data }: { data: MoneyBarDatum[] }) {
  const W = 640;
  const H = 280;
  const padL = 64;
  const padB = 28;
  const padT = 12;
  const max = Math.max(1, ...data.flatMap((d) => [d.Budget, d.Allocated, d.Released, d.Spent]));
  const plotW = W - padL - 16;
  const plotH = H - padT - padB;
  const groupW = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.max(4, Math.min(22, (groupW - 16) / 4));
  return (
    <div>
      <svg viewBox={"0 0 " + W + " " + H} className="w-full" role="img" aria-label="Grouped bar chart of budget, allocated, released and spent by department">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + plotH * (1 - f);
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={W - 16} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#64748B">
                {formatINRCompact(max * f)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const gx = padL + i * groupW + (groupW - barW * 4 - 6) / 2;
          return (
            <g key={d.name}>
              {BAR_SERIES.map((s, j) => {
                const v = d[s.key] as number;
                const h = (v / max) * plotH;
                return (
                  <rect key={s.key} x={gx + j * (barW + 2)} y={padT + plotH - h} width={barW} height={Math.max(1, h)} rx={3} fill={s.color}>
                    <title>
                      {d.name} {s.label}: {formatINRCompact(v)}
                    </title>
                  </rect>
                );
              })}
              <text x={padL + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#334155">
                {d.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {BAR_SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface PieDatum {
  name: string;
  value: number;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

export function SharePieChart({ data }: { data: PieDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 140;
  const cy = 140;
  const r = 100;
  const inner = 58;
  let acc = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = acc;
    const a1 = acc + frac * Math.PI * 2;
    acc = a1;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const [ix1, iy1] = polar(cx, cy, inner, a1);
    const [ix0, iy0] = polar(cx, cy, inner, a0);
    const large = frac > 0.5 ? 1 : 0;
    const path =
      "M " + x0 + " " + y0 + " A " + r + " " + r + " 0 " + large + " 1 " + x1 + " " + y1 + " L " + ix1 + " " + iy1 + " A " + inner + " " + inner + " 0 " + large + " 0 " + ix0 + " " + iy0 + " Z";
    return { d, path, color: CHART_COLORS[i % CHART_COLORS.length], frac };
  });
  return (
    <div>
      <svg viewBox="0 0 280 280" className="mx-auto w-full max-w-xs" role="img" aria-label="Donut chart of share of spend by department">
        {slices.map((s) => (
          <path key={s.d.name} d={s.path} fill={s.color}>
            <title>
              {s.d.name}: {formatINRCompact(s.d.value)} ({(s.frac * 100).toFixed(1)}%)
            </title>
          </path>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#080F1C">
          Spend share
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill="#64748B">
          Demo data
        </text>
      </svg>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
        {slices.map((s) => (
          <li key={s.d.name} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.d.name}
            </span>
            <span className="font-semibold">
              {formatINRCompact(s.d.value)} ({(s.frac * 100).toFixed(1)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LineDatum {
  label: string;
  Released: number;
  Spent: number;
}

function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => (i === 0 ? "M " + p.x + " " + p.y : "L " + p.x + " " + p.y)).join(" ");
}

export function FlowLineChart({ data }: { data: LineDatum[] }) {
  const W = 640;
  const H = 280;
  const padL = 64;
  const padB = 48;
  const padT = 12;
  const max = Math.max(1, ...data.flatMap((d) => [d.Released, d.Spent]));
  const plotW = W - padL - 16;
  const plotH = H - padT - padB;
  const xAt = (i: number) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH * (1 - v / max);
  const released = data.map((d, i) => ({ x: xAt(i), y: yAt(d.Released) }));
  const spent = data.map((d, i) => ({ x: xAt(i), y: yAt(d.Spent) }));
  return (
    <div>
      <svg viewBox={"0 0 " + W + " " + H} className="w-full" role="img" aria-label="Line chart of released versus spent by project">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + plotH * (1 - f);
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={W - 16} y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#64748B">
                {formatINRCompact(max * f)}
              </text>
            </g>
          );
        })}
        <path d={linePath(released)} fill="none" stroke="#22D3EE" strokeWidth={2.5} />
        <path d={linePath(spent)} fill="none" stroke="#34D399" strokeWidth={2.5} />
        {released.map((p, i) => (
          <circle key={"r" + i} cx={p.x} cy={p.y} r={4} fill="#22D3EE" stroke="white" strokeWidth={1.5}>
            <title>
              {data[i].label} Released: {formatINRCompact(data[i].Released)}
            </title>
          </circle>
        ))}
        {spent.map((p, i) => (
          <circle key={"s" + i} cx={p.x} cy={p.y} r={4} fill="#34D399" stroke="white" strokeWidth={1.5}>
            <title>
              {data[i].label} Spent: {formatINRCompact(data[i].Spent)}
            </title>
          </circle>
        ))}
        {data.map((d, i) => (
          <text key={d.label + i} x={xAt(i)} y={H - 28} textAnchor="middle" fontSize={11} fill="#334155">
            {d.label}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-6 rounded-full bg-cyan-400" /> Released
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-6 rounded-full bg-emerald-400" /> Spent
        </span>
      </div>
    </div>
  );
}
