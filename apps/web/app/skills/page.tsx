import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const source = sp.source ?? "";
  const scan = getScan();

  const sources = [...new Set(scan.roots.filter((r) => r.exists).map((r) => r.source))];
  const skills = scan.skills
    .filter((s) => !source || s.source === source)
    .filter((s) => {
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
  const LIMIT = 120;
  const visible = skills.slice(0, LIMIT);
  const truncated = skills.length > LIMIT;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">技能库</h1>
        <p className="mt-1 text-sm text-slate-500">共 {skills.length} 条{q ? `（匹配 “${q}”）` : ""}</p>
      </header>

      <form className="flex flex-wrap items-center gap-3" action="/skills">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="搜索名称或描述…"
          className="w-72 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <select
          name="source"
          defaultValue={source}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 focus:border-violet-500 focus:outline-none"
        >
          <option value="">全部来源</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-violet-500/20 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/30">
          筛选
        </button>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">来源</th>
              <th className="px-4 py-3 font-medium">描述预览</th>
              <th className="px-4 py-3 text-right font-medium">正文</th>
              <th className="px-4 py-3 text-right font-medium">警告</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-2.5">
                  <Link href={`/skills/${s.name}`} className="font-medium text-violet-300 hover:text-violet-200">
                    {s.name}
                  </Link>
                  {s.version ? <span className="ml-2 font-mono text-xs text-slate-600">@{s.version}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge>{s.source}</Badge>
                </td>
                <td className="max-w-md px-4 py-2.5">
                  <span className="line-clamp-1 text-slate-400">
                    {s.description ? s.description.slice(0, 120) : "（无描述）"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{s.bodyChars}</td>
                <td className="px-4 py-2.5 text-right">
                  {s.quality.warnings.length > 0 ? (
                    <Badge tone="amber">{s.quality.warnings.length}</Badge>
                  ) : (
                    <Badge tone="emerald">0</Badge>
                  )}
                </td>
              </tr>
            ))}
            {skills.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  没有匹配的 skill
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-600">
        {truncated ? `仅显示前 ${LIMIT} 条，共 ${skills.length} 条匹配——用搜索或来源筛选缩小范围。` : `共 ${skills.length} 条`}
      </p>
    </div>
  );
}
