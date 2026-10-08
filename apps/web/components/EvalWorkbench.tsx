"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EvalTask } from "@skillhub/eval";
import { apiJson } from "@/lib/client-api";

interface Choice { key: string; skill: string; positives: number; negatives: number; hash: string }
interface Summary { id: string; createdAt: string; status: EvalTask["status"]; model: string; backend: string; expectedJobs: number; completedJobs: number; failedJobs: number }
interface Config { tasks: Summary[]; scenarios: Choice[]; configured: boolean; model: string; baseUrl: string; recoveryErrors: string[] }
const labels: Record<EvalTask["status"], string> = { running: "评测中", "awaiting-results": "等待外部结果", completed: "已完成", failed: "需要重试", cancelled: "已取消", interrupted: "服务中断" };
const control = "w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200";
const button = "rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs text-violet-200 disabled:opacity-50";

export function EvalWorkbench({ skills, records, initialSkill, initialRecordId }: { skills: string[]; records: Array<{ id: string; name: string; source: string }>; initialSkill?: string; initialRecordId?: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [filter, setFilter] = useState(initialSkill ?? "");
  const [keys, setKeys] = useState<string[]>([]);
  const [recordIds, setRecordIds] = useState<Record<string, string>>(() => {
    const selected: Record<string, string> = {};
    for (const rec of [...records].sort((a, b) => (a.source === "agents" ? 0 : 1) - (b.source === "agents" ? 0 : 1))) selected[rec.name] ??= rec.id;
    if (initialSkill && records.some((r) => r.name === initialSkill && r.id === initialRecordId)) selected[initialSkill] = initialRecordId!;
    return selected;
  });
  const [backend, setBackend] = useState<"api" | "zcode">("zcode");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [task, setTask] = useState<EvalTask | null>(null);
  const [results, setResults] = useState("");
  const [positives, setPositives] = useState("");
  const [negatives, setNegatives] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh(): Promise<Config> { const data = await apiJson<Config>("/api/eval"); setConfig(data); return data; }
  useEffect(() => {
    let active = true;
    void apiJson<Config>("/api/eval").then((data) => {
      if (!active) return;
      setConfig(data); setModel(data.model); setBaseUrl(data.baseUrl); setBackend(data.configured ? "api" : "zcode");
      const initial = data.scenarios.find((c) => c.skill === initialSkill); if (initial) setKeys([initial.key]);
    }).catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [initialSkill]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await apiJson<EvalTask>(`/api/eval?id=${encodeURIComponent(selectedId)}`);
        if (!active) return;
        setTask(data);
        if (data.status === "running") timer = setTimeout(() => void poll(), 1200);
        else await refresh();
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "读取进度失败"); }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [selectedId]);

  async function act(action: "start" | "retry" | "cancel" | "ingest" | "save-scenario") {
    setBusy(true); setMessage("");
    try {
      if (action === "save-scenario") {
        const saved = await apiJson<{ key: string }>("/api/eval", { action, skill: filter, positives, negatives });
        await refresh(); setKeys((previous) => [...previous.filter((key) => config?.scenarios.find((c) => c.key === key)?.skill !== filter), saved.key]); setMessage("本地用例已保存，可选择它进行评测");
      } else {
        let selectedKeys = keys;
        if (action === "retry" && task) selectedKeys = [...new Set(task.jobs.map((j) => j.skill))].flatMap((name) => { const hash = task.jobs.find((j) => j.skill === name)?.scenarioHash; const candidates = config?.scenarios.filter((c) => c.skill === name) ?? []; const candidate = candidates.find((c) => c.hash === hash) ?? candidates[0]; return candidate ? [candidate.key] : []; });
        const selectedRecords = action === "retry" && task ? Object.fromEntries(task.jobs.filter((j) => j.skillId).map((j) => [j.skill, j.skillId!])) : recordIds;
        const data = await apiJson<EvalTask>("/api/eval", action === "start" || action === "retry" ? { keys: selectedKeys, recordIds: selectedRecords, backend, model, baseUrl, retryOf: action === "retry" ? task?.id : undefined } : { action, id: task?.id, results });
        setTask(data); setSelectedId(data.id); await refresh();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  }
  const available = new Set(skills);
  const choices = config?.scenarios.filter((c) => available.has(c.skill) && (!filter || c.skill === filter)) ?? [];
  const complete = task?.results.filter((r) => !r.error).length ?? 0;
  const attempted = task?.results.length ?? 0;

  return <div className="space-y-6">
    {config?.recoveryErrors.map((error) => <p key={error} role="status" className="text-xs text-amber-300">{error}</p>)}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3"><label className="block text-xs text-slate-400">Skill <select aria-label="选择 Skill" value={filter} onChange={(event) => setFilter(event.target.value)} className={`${control} mt-1`}><option value="">全部已安装技能</option>{skills.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><fieldset className="max-h-64 space-y-2 overflow-auto rounded-lg border border-slate-800 p-3"><legend className="px-1 text-xs text-slate-400">选择用例（每个 skill 一份，已选 {keys.length} 份）</legend>{choices.length ? choices.map((choice) => <label key={choice.key} className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" aria-label={`${choice.skill} ${choice.key.startsWith("local") ? "本地" : choice.key.startsWith("scenarios-auto") ? "生成" : "人工"}用例`} checked={keys.includes(choice.key)} onChange={(event) => setKeys((previous) => event.target.checked ? [...previous.filter((key) => config?.scenarios.find((c) => c.key === key)?.skill !== choice.skill), choice.key] : previous.filter((key) => key !== choice.key))} /><span>{choice.skill} · {choice.key.startsWith("local") ? "本地" : choice.key.startsWith("scenarios-auto") ? "生成" : "人工"}用例 · 正例 {choice.positives} / 反例 {choice.negatives}</span></label>) : <p className="text-xs text-slate-500">没有可用用例，可在下方为这个 skill 编写正反例。</p>}</fieldset></div>
      <div className="space-y-3"><label className="block text-xs text-slate-400">评测后端<select aria-label="评测后端" disabled={!config} value={backend} onChange={(event) => setBackend(event.target.value as "api" | "zcode")} className={`${control} mt-1`}><option value="api">OpenAI 兼容 API</option><option value="zcode">ZCode 作业交换</option></select></label><label className="block text-xs text-slate-400">模型<input aria-label="评测模型" disabled={!config} value={model} onChange={(event) => setModel(event.target.value)} className={`${control} mt-1`} /></label>{backend === "api" ? <><label className="block text-xs text-slate-400">API 地址<input aria-label="API 地址" disabled={!config} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className={`${control} mt-1`} /></label><p className="text-xs text-slate-500">{config?.configured ? "使用本机已配置的 API 凭据，页面不保存密钥。" : "本机尚未配置 API 凭据，可使用 ZCode 作业交换。"}</p></> : <p className="text-xs text-slate-500">下载作业，由模型端执行后导入结果；未完成或无法解析的作业不会获得完整总分。</p>}<button type="button" disabled={busy || !keys.length || !model || (backend === "api" && !config?.configured)} onClick={() => void act("start")} className={button}>启动评测</button></div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">{[...new Set(keys.flatMap((key) => { const c = config?.scenarios.find((s) => s.key === key); return c ? [c.skill] : []; }))].map((name) => <label key={name} className="text-xs text-slate-400">{name} 的评测副本<select aria-label={`评测副本 ${name}`} value={recordIds[name] ?? ""} onChange={(event) => setRecordIds((previous) => ({ ...previous, [name]: event.target.value }))} className={`${control} mt-1`}>{records.filter((r) => r.name === name).map((r) => <option key={r.id} value={r.id}>{r.source} · {r.id}</option>)}</select></label>)}</div>
    <details className="rounded-lg border border-slate-800 p-4"><summary className="cursor-pointer text-sm text-slate-300">编写或更新本地用例</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-400">应该触发（每行一个）<textarea aria-label="应该触发用例" value={positives} onChange={(event) => setPositives(event.target.value)} rows={4} className={`${control} mt-1`} /></label><label className="text-xs text-slate-400">不应该触发（每行一个）<textarea aria-label="不应该触发用例" value={negatives} onChange={(event) => setNegatives(event.target.value)} rows={4} className={`${control} mt-1`} /></label></div><button type="button" disabled={busy || !filter || !positives.trim() || !negatives.trim()} onClick={() => void act("save-scenario")} className={`${button} mt-3`}>保存 {filter || "所选 Skill"} 的本地用例</button></details>
    {message ? <p role="status" className="text-sm text-amber-300">{message}</p> : null}
    <div className="space-y-3"><h2 className="text-sm font-medium text-slate-200">任务与结果</h2><select aria-label="评测任务" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className={control}><option value="">选择评测任务</option>{config?.tasks.map((summary) => <option key={summary.id} value={summary.id}>{new Date(summary.createdAt).toLocaleString("zh-CN")} · {summary.model} · {labels[summary.status]} · {summary.completedJobs}/{summary.expectedJobs}</option>)}</select>
      {task ? <div className="space-y-4 rounded-lg border border-slate-800 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-200">{labels[task.status]} · 成功 {complete}/{task.jobs.length} · 已尝试 {attempted}</p><div className="flex flex-wrap gap-2">{["running", "awaiting-results"].includes(task.status) ? <button type="button" disabled={busy} onClick={() => void act("cancel")} className={button}>取消评测</button> : <button type="button" disabled={busy} onClick={() => void act("retry")} className={button}>重试未完成作业</button>}{task.report ? <><a className={button} href={`/api/eval?id=${task.id}&format=markdown`}>导出 Markdown</a><a className={button} href={`/api/eval?id=${task.id}&format=html`}>导出 HTML</a></> : null}</div></div><progress className="h-2 w-full accent-violet-500" value={attempted} max={task.jobs.length} aria-label="评测进度" /><p className="text-xs text-slate-500">模型 {task.model} · 累计 {task.results.reduce((n, r) => n + (r.tokens ?? 0), 0)} tokens · 请求总耗时 {Math.round(task.results.reduce((n, r) => n + (r.latencyMs ?? 0), 0) / 1000)} 秒</p>{task.error ? <p className="text-xs text-amber-300">{task.error}</p> : null}
        {task.status === "awaiting-results" ? <div className="space-y-3"><a href={`/api/eval?id=${task.id}&download=jobs`} className="text-sm text-violet-300">下载评测作业 JSONL</a><label className="block text-xs text-slate-400">导入结果 JSONL<input aria-label="上传评测结果" type="file" accept=".jsonl,.json,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setResults); }} className="mt-2 block max-w-full" /><textarea aria-label="评测结果 JSONL" value={results} onChange={(event) => setResults(event.target.value)} rows={5} className={`${control} mt-2 font-mono text-xs`} /></label><button type="button" disabled={busy || !results.trim()} onClick={() => void act("ingest")} className={button}>导入并生成报告</button></div> : null}
        <div className="space-y-2">{task.report?.results.map((row) => <div key={row.skill} className="rounded-md border border-slate-800 p-3 text-xs"><Link href={`/skills/${encodeURIComponent(row.skill)}`} className="text-violet-300">{row.skill}</Link><p className="mt-1 text-slate-300">{row.status === "complete" ? "完整评测" : row.status === "stale" ? "版本已变化，需要复测" : "评测未完成"} · 完成率 {row.completionRate}% · 总分 {row.overall ?? "—"} · 指纹 {row.skillHash ?? "未绑定"}</p>{row.issues.length ? <ul className="mt-1 list-inside list-disc text-amber-300">{row.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul> : null}</div>)}</div>
        {task.results.some((r) => r.error) ? <details><summary className="cursor-pointer text-xs text-amber-300">失败原因</summary><ul className="mt-2 text-xs text-slate-400">{task.results.filter((r) => r.error).map((result) => <li key={result.id} className="break-all">{result.id}：{result.error}</li>)}</ul></details> : null}
      </div> : <p className="text-sm text-slate-500">启动评测或选择已有任务后查看进度与结果。</p>}
    </div>
  </div>;
}
