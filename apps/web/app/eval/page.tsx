import Link from "next/link";
import { Badge, Bar, Card, SectionTitle, Stat, gradeTone } from "@/components/ui";
import { getScan } from "@/lib/data";
import { healthBoard, warningCategories } from "@/lib/health";

export const dynamic = "force-dynamic";

export default function EvalPage() {
  const scan = getScan();
  const board = healthBoard(scan.skills);
  const categories = warningCategories(scan.skills);
  const maxCat = Math.max(...categories.map((c) => c.count), 1);
  const worst = board.filter((r) => r.grade === "差");
  const poor = board.filter((r) => r.grade === "中");
  const avg = board.length > 0 ? Math.round(board.reduce((n, r) => n + r.score, 0) / board.length) : 100;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">评测体检</h1>
        <p className="mt-1 text-sm text-slate-500">
          当前展示静态质量分（每条警告 −10 分）。模型评测（触发准确性 / 指令清晰度）将在 Phase 2 接入。
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="平均静态分" value={avg} tone={avg >= 90 ? "emerald" : avg >= 70 ? "violet" : "amber"} />
        <Stat label="评为「差」" value={worst.length} tone={worst.length > 0 ? "rose" : "emerald"} hint="低于 50 分" />
        <Stat label="评为「中」" value={poor.length} tone={poor.length > 0 ? "amber" : "emerald"} hint="50–69 分" />
        <Stat label="满分 skill" value={board.filter((r) => r.score === 100).length} tone="emerald" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="按去重名字计">警告类别分布</SectionTitle>
          <div className="space-y-3">
            {categories.map((c) => (
              <Bar key={c.key} label={c.label} value={c.count} max={maxCat} tone={c.count > 0 ? "amber" : "emerald"} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle hint="模型评测接入后替换为多维 rubric">Phase 2 预告</SectionTitle>
          <ul className="list-inside list-disc space-y-1.5 text-xs text-slate-400">
            <li>scenario YAML：为每个 skill 定义任务描述、期望触发条件、验收 checklist</li>
            <li>跑批后端：ZCode 子代理（烧 plan 额度，无需 API key）+ OpenAI 兼容 API 接口</li>
            <li>rubric：静态 lint → 模型评触发准确性 / 指令清晰度 / 资源完整性分层打分</li>
            <li>报告入库（SQLite）并在本页展示历史趋势</li>
          </ul>
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">Skill</th>
              <th className="px-4 py-3 font-medium">评级</th>
              <th className="px-4 py-3 text-right font-medium">静态分</th>
              <th className="px-4 py-3 text-right font-medium">警告数</th>
              <th className="px-4 py-3 text-right font-medium">出现次数</th>
            </tr>
          </thead>
          <tbody>
            {board.slice(0, 50).map((r) => (
              <tr key={r.name} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-2.5">
                  <Link href={`/skills/${r.name}`} className="text-violet-300 hover:text-violet-200">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={gradeTone(r.grade)}>{r.grade}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{r.score}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{r.warnings}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{r.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-600">只展示最差的 50 个，按分数升序。</p>
    </div>
  );
}
