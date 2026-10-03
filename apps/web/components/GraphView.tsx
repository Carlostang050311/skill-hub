"use client";

import { useMemo, useState } from "react";
import type { SkillGraph } from "@/lib/graph";

const SOURCE_COLORS: Record<string, string> = {
  agents: "#a78bfa",
  claude: "#34d399",
  codex: "#fbbf24",
  "claude-plugins": "#f472b6",
  "zcode-plugins": "#60a5fa",
};

export function GraphView({ graph }: { graph: SkillGraph }) {
  const [active, setActive] = useState<string | null>(null);

  const layout = useMemo(() => {
    const n = Math.max(graph.nodes.length, 1);
    return graph.nodes.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { ...node, x: 420 + 350 * Math.cos(angle), y: 420 + 350 * Math.sin(angle) };
    });
  }, [graph]);

  const positions = useMemo(() => new Map(layout.map((p) => [p.name, p])), [layout]);

  const connected = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const e of graph.edges) {
      if (e.from === active) set.add(e.to);
      if (e.to === active) set.add(e.from);
    }
    return set;
  }, [active, graph]);

  const activeEdges = useMemo(
    () => (active ? graph.edges.filter((e) => e.from === active || e.to === active) : []),
    [active, graph],
  );
  const node = active ? graph.nodes.find((n) => n.name === active) : undefined;

  if (graph.nodes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-500">
        当前 skill 库中没有发现互相引用关系，图谱为空。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        <svg viewBox="0 0 840 840" className="h-auto w-full">
          {graph.edges.map((e) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const highlight = active === e.from || active === e.to;
            return (
              <line
                key={`${e.kind}:${e.from}->${e.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={highlight ? "#a78bfa" : e.kind === "link" ? "#475569" : "#1e293b"}
                strokeWidth={highlight ? 1.6 : e.kind === "link" ? 0.9 : 0.6}
                strokeDasharray={e.kind === "mention" ? "3 4" : undefined}
                opacity={active && !highlight ? 0.1 : 1}
              />
            );
          })}
          {layout.map((p) => {
            const dim = connected !== null && !connected.has(p.name);
            const isActive = active === p.name;
            const color = p.sources.length > 1 ? "#e2e8f0" : (SOURCE_COLORS[p.sources[0] ?? ""] ?? "#64748b");
            return (
              <g
                key={p.name}
                className="cursor-pointer"
                opacity={dim ? 0.2 : 1}
                onMouseEnter={() => setActive(p.name)}
                onMouseLeave={() => setActive(null)}
              >
                <circle cx={p.x} cy={p.y} r={isActive ? 7 : 4.5} fill={isActive ? "#a78bfa" : color} />
                <text x={p.x + 9} y={p.y + 3.5} fontSize={11} fill={isActive ? "#e2e8f0" : "#94a3b8"}>
                  {p.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
          {Object.entries(SOURCE_COLORS).map(([source, color]) => (
            <span key={source} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {source}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200" />
            多来源同名
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4">
              <line x1="0" y1="2" x2="18" y2="2" stroke="#475569" strokeWidth="1.5" />
            </svg>
            链接
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4">
              <line x1="0" y1="2" x2="18" y2="2" stroke="#475569" strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
            提及
          </span>
        </div>
      </div>
      <div className="w-full shrink-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5 lg:w-80">
        {active && node ? (
          <div>
            <div className="text-base font-semibold text-slate-100">{active}</div>
            <div className="mt-1 text-xs text-slate-500">
              被链接 {node.inDegree} · 链接 {node.outDegree} · 被提及 {node.mentionIn} · 提及 {node.mentionOut}
            </div>
            <div className="mt-4 space-y-1.5 text-xs">
              {activeEdges.length === 0 ? (
                <div className="text-slate-500">没有库内引用关系</div>
              ) : (
                activeEdges.map((e) => (
                  <div key={`${e.kind}:${e.from}->${e.to}`} className="flex items-baseline gap-2 font-mono">
                    <span className={e.kind === "link" ? "text-slate-300" : "text-slate-500"}>
                      {e.from === active ? `→ ${e.to}` : `← ${e.from}`}
                    </span>
                    <span className="text-[10px] text-slate-600">{e.kind === "link" ? "链接" : "提及"}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            <p>鼠标悬停节点查看引用关系。</p>
            <p className="mt-2">
              {graph.nodes.length} 个 skill 参与引用网络：{graph.linkEdgeCount} 条链接边、{graph.mentionEdgeCount} 条提及边，
              {graph.isolatedCount} 个无任何引用。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
