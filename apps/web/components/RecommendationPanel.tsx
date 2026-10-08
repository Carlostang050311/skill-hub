"use client";

import Link from "next/link";
import { useState } from "react";
import type { Recommendation } from "@skillhub/core";
import { apiJson } from "@/lib/client-api";

export function RecommendationPanel() {
  const [task, setTask] = useState("");
  const [client, setClient] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function recommend() {
    setBusy(true); setMessage("");
    try { setRecommendations(await apiJson<Recommendation[]>(`/api/recommend?${new URLSearchParams({ task, client })}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "推荐失败"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void recommend(); }}>
      <label className="min-w-0 flex-1 text-xs text-slate-400">当前任务<input aria-label="当前任务" value={task} onChange={(event) => setTask(event.target.value)} placeholder="例如：把研究材料制作成学术演示文稿" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" /></label>
      <label className="text-xs text-slate-400">使用客户端<select aria-label="推荐客户端" value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200"><option value="">不限制</option><option value="agents">通用 agents</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <button type="submit" disabled={busy || !task.trim()} className="self-end rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-sm text-violet-200 disabled:opacity-50">推荐技能</button>
    </form>
    <p className="text-xs text-slate-500">名称、同义词和适用场景参与排序；匹配分用于排序。只排除明确声明不兼容的技能。</p>
    {recommendations ? recommendations.length ? <div className="grid gap-3 md:grid-cols-2">{recommendations.map((item) => <div key={item.name} className="rounded-lg border border-slate-800 p-3"><Link href={`/skills/${encodeURIComponent(item.name)}`} className="text-sm text-violet-300">{item.name}</Link><p className="mt-1 text-xs text-slate-500">匹配分 {item.score} · {item.source}</p><ul className="mt-2 space-y-1 text-xs text-slate-400">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>)}</div> : <p className="text-sm text-slate-500">没有足够匹配的技能，请补充任务中的具体输入和目标。</p> : null}
    {message ? <p role="status" className="text-xs text-amber-300">{message}</p> : null}
  </div>;
}
