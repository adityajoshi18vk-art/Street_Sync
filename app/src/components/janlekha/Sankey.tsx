"use client";
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJanLekha } from "@/lib/janlekha/context";
import { formatINR } from "@/lib/janlekha/format";
import { Badge, Card, DemoBadge } from "./ui";

interface SNode {
  id: string;
  label: string;
  sub: string;
  value: number;
  level: number;
  color: string;
  kind: string;
  link?: string;
  y: number;
  height: number;
}

interface SLink {
  source: string;
  target: string;
  value: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
}

const LEVEL_X = [8, 208, 408, 608, 808];
const NODE_W = 144;
const HEIGHT = 560;
const DEPT_COLORS = ["#0891B2", "#0E7490", "#22D3EE", "#155E75", "#06B6D4", "#164E63"];

function pathFor(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2;
}

export default function Sankey() {
  const { departments, projects, contractors, payments } = useJanLekha();
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, links } = useMemo(() => {
    const totalAllocated = departments.reduce((s, d) => s + d.allocatedInr, 0);
    const raw: SNode[] = [];
    raw.push({ id: "total", label: "Total budget allocated", sub: "All departments", value: totalAllocated, level: 0, color: "#080F1C", kind: "National budget", y: 0, height: 0 });
    departments.forEach((d, i) => {
      raw.push({ id: "dept-" + d.id, label: d.name, sub: d.code + " . " + d.state, value: d.allocatedInr, level: 1, color: DEPT_COLORS[i % DEPT_COLORS.length], kind: "Department", link: "/janlekha/departments/" + d.id, y: 0, height: 0 });
    });
    projects.forEach((p) => {
      raw.push({ id: "proj-" + p.id, label: p.name, sub: p.location, value: p.allocatedInr, level: 2, color: "#1A2B44", kind: "Project", link: "/janlekha/projects/" + p.id, y: 0, height: 0 });
    });
    contractors.forEach((c) => {
      const v = projects.filter((p) => p.contractorId === c.id).reduce((s, p) => s + p.allocatedInr, 0);
      raw.push({ id: "con-" + c.id, label: c.name, sub: c.type + " . " + c.location, value: v, level: 3, color: "#059669", kind: "Contractor", y: 0, height: 0 });
    });
    contractors.forEach((c) => {
      const v = payments.filter((p) => p.payee === c.name && p.status === "Settled").reduce((s, p) => s + p.amountInr, 0);
      if (v > 0) {
        raw.push({ id: "pay-" + c.id, label: "Paid to " + c.name, sub: "Settled payments, simulated USDC", value: v, level: 4, color: "#34D399", kind: "Payments settled", y: 0, height: 0 });
      }
    });

    const byLevel: SNode[][] = [[], [], [], [], []];
    raw.forEach((n) => byLevel[n.level].push(n));
    byLevel.forEach((list) => {
      const colTotal = list.reduce((s, n) => s + n.value, 0) || 1;
      const gap = 10;
      const avail = HEIGHT - 20 - gap * Math.max(0, list.length - 1);
      let y = 10;
      list
        .slice()
        .sort((a, b) => b.value - a.value)
        .forEach((n) => {
          n.height = Math.max(6, (n.value / colTotal) * avail);
          n.y = y;
          y += n.height + gap;
        });
    });

    const nodeById = new Map(raw.map((n) => [n.id, n]));
    const rawLinks: { source: string; target: string; value: number }[] = [];
    departments.forEach((d) => rawLinks.push({ source: "total", target: "dept-" + d.id, value: d.allocatedInr }));
    projects.forEach((p) => rawLinks.push({ source: "dept-" + p.departmentId, target: "proj-" + p.id, value: p.allocatedInr }));
    projects.forEach((p) => rawLinks.push({ source: "proj-" + p.id, target: "con-" + p.contractorId, value: p.allocatedInr }));
    contractors.forEach((c) => {
      const v = payments.filter((p) => p.payee === c.name && p.status === "Settled").reduce((s, p) => s + p.amountInr, 0);
      if (v > 0) rawLinks.push({ source: "con-" + c.id, target: "pay-" + c.id, value: v });
    });

    const outOff = new Map<string, number>();
    const inOff = new Map<string, number>();
    const built: SLink[] = [];
    rawLinks.forEach((l) => {
      const s = nodeById.get(l.source);
      const t = nodeById.get(l.target);
      if (!s || !t) return;
      const so = outOff.get(l.source) ?? 0;
      const io = inOff.get(l.target) ?? 0;
      const w = Math.max(1, (l.value / (s.value || 1)) * s.height);
      const y1 = s.y + so + w / 2;
      const y2 = t.y + io + w / 2;
      built.push({ ...l, x1: LEVEL_X[s.level] + NODE_W, y1, x2: LEVEL_X[t.level], y2, width: w, color: s.color });
      outOff.set(l.source, so + w);
      inOff.set(l.target, io + (l.value / (t.value || 1)) * t.height);
    });
    return { nodes: raw, links: built };
  }, [departments, projects, contractors, payments]);

  const related = useMemo(() => {
    if (!selected) return null;
    const adj = new Map<string, Set<string>>();
    links.forEach((l) => {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source)?.add(l.target);
      adj.get(l.target)?.add(l.source);
    });
    const seen = new Set<string>([selected]);
    const queue = [selected];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      adj.get(cur)?.forEach((n) => {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      });
    }
    return seen;
  }, [selected, links]);

  const selectedNode = selected ? nodes.find((n) => n.id === selected) : null;
  const connectedNodes = selectedNode && related ? nodes.filter((n) => related.has(n.id) && n.id !== selected) : [];
  const selectedLinks = selected ? links.filter((l) => l.source === selected || l.target === selected) : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Click any node to highlight its flow and see the detail below. Amounts are demo data.</p>
        <div className="flex items-center gap-2">
          <DemoBadge />
          {selected ? (
            <button onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear selection</button>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 960 560" className="min-w-[860px]" role="img" aria-label="Sankey diagram of demo budget flow from total budget to departments, projects, contractors and payments">
          {links.map((l) => {
            const active = !selected || (related?.has(l.source) && related?.has(l.target));
            return (
              <path
                key={l.source + ">" + l.target}
                d={pathFor(l.x1, l.y1, l.x2, l.y2)}
                fill="none"
                stroke={l.color}
                strokeWidth={l.width}
                strokeOpacity={active ? 0.45 : 0.06}
              />
            );
          })}
          {nodes.map((n) => {
            const active = !selected || related?.has(n.id);
            return (
              <g key={n.id} onClick={() => setSelected(n.id)} className="cursor-pointer" opacity={active ? 1 : 0.35}>
                <rect x={LEVEL_X[n.level]} y={n.y} width={NODE_W} height={n.height} rx={6} fill={n.color} stroke={selected === n.id ? "#080F1C" : "white"} strokeWidth={selected === n.id ? 3 : 1} />
                {n.height >= 26 ? (
                  <text x={LEVEL_X[n.level] + 8} y={n.y + 16} fill="white" fontSize={11} fontWeight={700}>
                    {n.label.length > 22 ? n.label.slice(0, 22) + "..." : n.label}
                  </text>
                ) : null}
                {n.height >= 42 ? (
                  <text x={LEVEL_X[n.level] + 8} y={n.y + 32} fill="white" fontSize={10} opacity={0.85}>
                    {formatINR(n.value)}
                  </text>
                ) : null}
                <title>{n.label + " . " + formatINR(n.value)}</title>
              </g>
            );
          })}
          {["Total budget", "Departments", "Projects", "Contractors", "Payments"].map((label, i) => (
            <text key={label} x={LEVEL_X[i]} y={HEIGHT - 2} fontSize={11} fontWeight={700} fill="#080F1C">
              {label}
            </text>
          ))}
        </svg>
      </div>
      {selectedNode ? (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge tone="cyan">{selectedNode.kind}</Badge>
              <h3 className="mt-2 text-lg font-bold text-[#080F1C]">{selectedNode.label}</h3>
              <p className="text-sm text-slate-600">{selectedNode.sub}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Demo amount</p>
              <p className="text-xl font-bold text-cyan-700">{formatINR(selectedNode.value)}</p>
              <DemoBadge />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Connected in this flow: {connectedNodes.length > 0 ? connectedNodes.map((n) => n.label).join(", ") : "none"}. Direct links from this node: {selectedLinks.length}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedNode.link ? (
              <Link href={selectedNode.link} className="rounded-lg bg-[#080F1C] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open detail page</Link>
            ) : null}
            <button onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Show full flow</button>
          </div>
        </Card>
      ) : (
        <Card className="mt-4 p-5">
          <p className="text-sm text-slate-600">No node selected. The full demo flow is shown, from the total allocated budget on the left to settled payments on the right. Settled payments are shown in INR budget records and, separately, as simulated USDC on Arc Testnet.</p>
        </Card>
      )}
    </div>
  );
}
