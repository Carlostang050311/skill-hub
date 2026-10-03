import Link from "next/link";
import { findConflicts } from "@skillhub/core";
import { Badge, Card, Mono, SectionTitle, Stat } from "@/components/ui";
import { getScan } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function SyncPage() {
  const scan = getScan();
  const conflicts = findConflicts(scan.skills).sort((a, b) => {
    if (a.identical !== b.identical) return a.identical ? 1 : -1;
    return b.occurrences.length - a.occurrences.length;
  });
  const diverged = conflicts.filter((g) => !g.identical);
  const identical = conflicts.filter((g) => g.identical);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">同步状态</h1>
        <p className="mt-1 text-sm text-slate-500">同名 skill 在多个目录中的内容一致性（内容指纹对比）</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="同名组" value={conflicts.length} tone="violet" />
        <Stat label="内容一致（重复部署）" value={identical.length} tone="emerald" />
        <Stat label="内容漂移" value={diverged.length} tone={diverged.length > 0 ? "rose" : "emerald"} />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">Skill</th>
              <th className="px-4 py-3 font-medium">出现位置</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">内容指纹</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((g) => (
              <tr key={g.name} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-2.5">
                  <Link href={`/skills/${g.name}`} className="font-medium text-violet-300 hover:text-violet-200">
                    {g.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {g.occurrences.map((o) => (
                      <Badge key={o.id}>{o.source}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {g.identical ? <Badge tone="emerald">一致</Badge> : <Badge tone="rose">漂移</Badge>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {g.hashes.map((h) => (
                      <Mono key={h}>{h}</Mono>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {conflicts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  没有同名出现的 skill
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionTitle>说明</SectionTitle>
        <ul className="list-inside list-disc space-y-1 text-xs text-slate-400">
          <li>「一致」表示同名 skill 在多个目录内容完全相同（指纹相同），通常是有意多端部署。</li>
          <li>「漂移」表示同名但内容不同——一边改过另一边没同步，用哪个取决于 agent 加载哪个目录。</li>
          <li>一键对齐、安装与更新将在 Phase 3 提供，当前只做检测与展示。</li>
        </ul>
      </Card>
    </div>
  );
}
