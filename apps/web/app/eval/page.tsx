import Link from "next/link";
import { Badge, Bar, Card, Mono, SectionTitle, Stat, gradeTone } from "@/components/ui";
import { TrendChart } from "@/components/TrendChart";
import { getScan } from "@/lib/data";
import { getAllRunReports, getEvalData, getExecResults } from "@/lib/evaldb";
import { gradeOf, healthScore, warningCategories } from "@/lib/health";
import { buildTrend, skillDeltas } from "@/lib/trend";

export const dynamic = "force-dynamic";

export default function EvalPage() {
  const scan = getScan();
  const evalData = getEvalData();
  const categories = warningCategories(scan.skills);
  const maxCat = Math.max(...categories.map((c) => c.count), 1);
  const latest = evalData?.latest ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">评测体检</h1>
        <p className="mt-1 text-sm text-slate-500">
          模型评测（触发准确性 + 指令清晰度）与静态质量分的合成报告
        </p>
      </header>

      {latest ? (
        <>
          <Card>
            <SectionTitle hint={`${latest.summary.backend}${latest.summary.model ? ` / ${latest.summary.model}` : ""}`}>
              最新模型评测 run #{latest.summary.id}（{new Date(latest.summary.startedAt).toLocaleString("zh-CN")}）
            </SectionTitle>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="平均 overall" value={latest.summary.avgOverall == null ? "—" : Math.round(latest.summary.avgOverall)} tone="violet" />
              <Stat label="平均触发" value={latest.summary.avgTrigger == null ? "—" : `${Math.round(latest.summary.avgTrigger)}%`} />
              <Stat label="平均清晰度" value={latest.summary.avgClarity == null ? "—" : Math.round(latest.summary.avgClarity)} />
              <Stat label="平均静态" value={Math.round(latest.summary.avgStatic)} />
            </div>
          </Card>

          {(() => {
            const execRows = getExecResults();
            if (execRows.length === 0) return null;
            return (
              <Card>
                <SectionTitle hint="沙箱真实作业 + 双评审独立复核">执行级实测成绩</SectionTitle>
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4 lg:grid-cols-6">
                  {execRows.map((r) => (
                    <div key={r.skill} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <Link href={`/skills/${r.skill}`} className="block truncate text-slate-200 hover:text-violet-300">
                        {r.skill}
                      </Link>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className={r.score === 100 ? "text-emerald-400" : r.score >= 50 ? "text-amber-400" : "text-rose-400"}>
                          {r.score}
                        </span>
                        <span className="tabular-nums text-slate-600">
                          {r.passed}/{r.total}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-600">
                  共 {execRows.length} 个 skill 执行过沙箱任务；每格为官方评审通过率（{execRows[0]?.passed}/{execRows[0]?.total} 制）。
                </p>
              </Card>
            );
          })()}

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Skill</th>
                  <th className="px-4 py-3 font-medium">评级</th>
                  <th className="px-4 py-3 text-right font-medium">Overall</th>
                  <th className="px-4 py-3 text-right font-medium">触发</th>
                  <th className="px-4 py-3 text-right font-medium">过触发</th>
                  <th className="px-4 py-3 text-right font-medium">清晰度</th>
                  <th className="px-4 py-3 text-right font-medium">静态</th>
                  <th className="px-4 py-3 text-right font-medium">发现的问题</th>
                </tr>
              </thead>
              <tbody>
                {latest.report.results.map((r) => {
                  const grade = gradeOf(r.overall ?? 0);
                  return (
                    <tr key={r.skill} className="border-b border-slate-800/60 align-top last:border-0 hover:bg-slate-800/30">
                      <td className="px-4 py-2.5">
                        <Link href={`/skills/${r.skill}`} className="text-violet-300 hover:text-violet-200">
                          {r.skill}
                        </Link>
                        <div className="mt-0.5 font-mono text-[10px] text-slate-600">
                          {r.source} · {r.triggerCorrect}/{r.triggerTotal} 例
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={gradeTone(grade)}>{grade}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">{r.overall ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                        {r.triggerScore == null ? "—" : `${r.triggerScore}%`}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.falsePositives > 0 ? <Badge tone="rose">{r.falsePositives}</Badge> : <Badge tone="emerald">0</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                        {r.clarityScore == null ? "—" : r.clarityScore}
                        {r.consistency != null ? (
                          <div className="text-[10px] text-slate-600">
                            自洽 {r.consistency} · 可执行 {r.actionability} · 边界 {r.boundedness}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{r.staticScore}</td>
                      <td className="max-w-xs px-4 py-2.5">
                        {r.issues.length === 0 ? (
                          <span className="text-xs text-slate-600">—</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer text-xs text-amber-300">{r.issues.length} 条</summary>
                            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-slate-400">
                              {r.issues.map((issue, i) => (
                                <li key={i}>{issue}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {evalData && evalData.runs.length > 1 ? (
            <Card>
              <SectionTitle hint="每次 run 的平均分（0-100）">历史趋势</SectionTitle>
              <TrendChart points={buildTrend(evalData.runs)} />
              <table className="mt-4 w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-500">
                    <th className="py-1.5 font-medium">run</th>
                    <th className="py-1.5 font-medium">时间</th>
                    <th className="py-1.5 text-right font-medium">skill 数</th>
                    <th className="py-1.5 text-right font-medium">overall</th>
                    <th className="py-1.5 text-right font-medium">触发</th>
                    <th className="py-1.5 text-right font-medium">清晰度</th>
                    <th className="py-1.5 text-right font-medium">静态</th>
                  </tr>
                </thead>
                <tbody>
                  {evalData.runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                      <td className="py-1.5 font-mono text-slate-300">#{r.id}</td>
                      <td className="py-1.5 text-slate-500">{new Date(r.startedAt).toLocaleString("zh-CN")}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{r.totalSkills}</td>
                      <td className="py-1.5 text-right tabular-nums text-violet-300">
                        {r.avgOverall == null ? "—" : Math.round(r.avgOverall)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">
                        {r.avgTrigger == null ? "—" : `${Math.round(r.avgTrigger)}%`}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">
                        {r.avgClarity == null ? "—" : Math.round(r.avgClarity)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{Math.round(r.avgStatic)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(() => {
                const deltas = skillDeltas(
                  getAllRunReports().flatMap((run) =>
                    run.report.results
                      .filter((r) => r.overall != null)
                      .map((r) => ({ runId: run.summary.id, skill: r.skill, overall: r.overall as number })),
                  ),
                ).slice(0, 8);
                if (deltas.length === 0) return null;
                return (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <div className="mb-2 text-xs font-medium text-slate-300">同名 skill 跨 run 变化（修复前后对比）</div>
                    <div className="space-y-1">
                      {deltas.map((d) => (
                        <div key={d.name} className="flex items-baseline justify-between gap-3 text-xs">
                          <Link href={`/skills/${d.name}`} className="truncate text-slate-300 hover:text-violet-300">
                            {d.name}
                          </Link>
                          <span className="tabular-nums text-slate-500">
                            #{d.first.runId} {d.first.overall} → #{d.latest.runId} {d.latest.overall}
                          </span>
                          <span className={`w-10 text-right tabular-nums ${d.delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {d.delta > 0 ? "+" : ""}
                            {d.delta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <SectionTitle>还没有模型评测报告</SectionTitle>
          <p className="text-xs text-slate-400">
            跑法：写 <Mono>scenarios/*.yaml</Mono>（skill 名 + should_trigger / should_not_trigger 用例）→{" "}
            <Mono>skillhub-eval plan</Mono> 生成作业 → 模型端执行 → <Mono>skillhub-eval ingest</Mono> 评分入库，本页自动展示。
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="静态层 · 按去重名字计">警告类别分布</SectionTitle>
          <div className="space-y-3">
            {categories.map((c) => (
              <Bar key={c.key} label={c.label} value={c.count} max={maxCat} tone={c.count > 0 ? "amber" : "emerald"} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle hint="静态层 · 无模型评测也始终可用">静态分口径</SectionTitle>
          <ul className="list-inside list-disc space-y-1.5 text-xs text-slate-400">
            <li>静态分 = 100 − 10 × 警告数（下限 0）</li>
            <li>模型层：触发准确性（scenario 用例判定）+ 指令清晰度（自洽 / 可执行 / 边界，各 1-5 分）</li>
            <li>overall = 触发 40% + 清晰度 30% + 静态 30%，缺失层权重再归一</li>
            <li>报告存于 <Mono>~/.skillhub/eval.db</Mono>，历史可对比</li>
          </ul>
        </Card>
      </div>

      <p className="text-xs text-slate-600">
        静态层覆盖全部 {scan.skills.length} 条记录；当前静态满分 skill{" "}
        {scan.skills.filter((s) => healthScore(s.quality.warnings.length) === 100).length} 个。
      </p>
    </div>
  );
}
