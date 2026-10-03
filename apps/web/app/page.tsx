import Link from "next/link";
import { findConflicts } from "@skillhub/core";
import { Bar, Card, Mono, SectionTitle, Stat } from "@/components/ui";
import { getScan } from "@/lib/data";
import { warningCategories } from "@/lib/health";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  agents: "~/.agents/skills",
  claude: "~/.claude/skills",
  codex: "~/.codex/skills",
  "claude-plugins": "~/.claude/plugins",
  "zcode-plugins": "~/.zcode/plugins",
};

export default function OverviewPage() {
  const scan = getScan();
  const conflicts = findConflicts(scan.skills);
  const diverged = conflicts.filter((g) => !g.identical);
  const categories = warningCategories(scan.skills);
  const totalWarnings = scan.skills.reduce((n, s) => n + s.quality.warnings.length, 0);
  const failed = scan.roots.flatMap((r) => r.failedFiles);
  const sourceCounts = scan.roots
    .filter((r) => r.exists)
    .map((r) => ({ source: r.source, count: r.count }))
    .sort((a, b) => b.count - a.count);
  const maxSource = Math.max(...sourceCounts.map((s) => s.count), 1);
  const maxCat = Math.max(...categories.map((c) => c.count), 1);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">总览</h1>
        <p className="mt-1 text-sm text-slate-500">本机 Agent Skill 库的实时体检结果</p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Skill 总数" value={scan.skills.length} hint="含重复出现" />
        <Stat label="去重名字" value={scan.skills.length - conflicts.reduce((n, g) => n + g.occurrences.length - 1, 0)} />
        <Stat label="同名组" value={conflicts.length} hint="跨目录出现" tone="violet" />
        <Stat label="内容漂移" value={diverged.length} hint="同名不同内容" tone={diverged.length > 0 ? "rose" : "emerald"} />
        <Stat label="质量警告" value={totalWarnings} tone="amber" />
        <Stat label="解析失败" value={failed.length} tone={failed.length > 0 ? "rose" : "emerald"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="按扫描目录">来源分布</SectionTitle>
          <div className="space-y-3">
            {sourceCounts.map((s) => (
              <Bar key={s.source} label={SOURCE_LABELS[s.source] ?? s.source} value={s.count} max={maxSource} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle hint="按去重名字计">质量信号分布</SectionTitle>
          <div className="space-y-3">
            {categories.map((c) => (
              <Bar key={c.key} label={c.label} value={c.count} max={maxCat} tone={c.count > 0 ? "amber" : "emerald"} />
            ))}
          </div>
        </Card>
      </div>

      {diverged.length > 0 ? (
        <Card>
          <SectionTitle hint={<Link href="/sync" className="text-violet-400 hover:text-violet-300">查看全部 →</Link>}>
            同名 skill 内容漂移
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {diverged.map((g) => (
              <Link key={g.name} href={`/skills/${g.name}`} className="inline-block">
                <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20">
                  {g.name}（{g.occurrences.length} 处）
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {failed.length > 0 ? (
        <Card>
          <SectionTitle hint="通常是 frontmatter YAML 语法问题">解析失败的 SKILL.md</SectionTitle>
          <ul className="space-y-1.5 text-xs">
            {failed.map((f) => (
              <li key={f}>
                <Mono>{f}</Mono>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
