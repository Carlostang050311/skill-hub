import { buildGraph } from "@/lib/graph";
import { GraphView } from "@/components/GraphView";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  const scan = getScan();
  const graph = buildGraph(scan.skills);
  const topHubs = graph.nodes.slice(0, 10);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">依赖图谱</h1>
        <p className="mt-1 text-sm text-slate-500">
          实线 = 显式链接（链接到其他 skill 的 SKILL.md 或 wiki 链接），虚线 = 正文提及 ·{" "}
          {graph.nodes.length} 个节点 · {graph.linkEdgeCount} 条链接边 · {graph.mentionEdgeCount} 条提及边 ·{" "}
          {graph.isolatedCount} 个孤立 skill
        </p>
      </header>
      <GraphView graph={graph} />
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">枢纽 skill（被链接 + 被提及最多）</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs md:grid-cols-5">
          {topHubs.map((n) => (
            <div key={n.name} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-slate-300">{n.name}</span>
              <span className="tabular-nums text-slate-500">
                ↓{n.inDegree}+{n.mentionIn}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
