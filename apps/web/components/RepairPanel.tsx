"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EditPreview } from "@skillhub/core";
import { apiJson } from "@/lib/client-api";
import { TextCompare } from "./FileDiff";

export function RepairPanel({ name, copies }: { name: string; copies: Array<{ id: string; source: string }> }) {
  const [id, setId] = useState(copies[0]?.id ?? "");
  const [raw, setRaw] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setPreview(null); setRaw(""); setMessage("");
    void apiJson<{ raw: string; suggestions: string[] }>(`/api/repair?id=${encodeURIComponent(id)}`).then((data) => { if (active) { setRaw(data.raw); setSuggestions(data.suggestions); } }).catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [id]);
  async function act(apply = false) {
    setBusy(true); setMessage("");
    try {
      if (apply && preview) {
        const result = await apiJson<{ backupId?: string }>("/api/repair", { action: "apply", id, raw, expectedHash: preview.expectedHash });
        setMessage(`修复已应用，原件已备份（${result.backupId}）。请复测确认实际效果。`);
        setSuggestions(preview.afterQuality.warnings);
        setPreview(null);
      } else setPreview(await apiJson<EditPreview>("/api/repair", { action: "preview", id, raw }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "修复失败"); } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><label className="text-xs text-slate-400">编辑副本 <select aria-label="编辑副本" value={id} onChange={(event) => setId(event.target.value)} className="ml-2 rounded-md border border-slate-700 bg-slate-950 p-2">{copies.map((copy) => <option key={copy.id} value={copy.id}>{copy.source}</option>)}</select></label><Link href={`/workbench?skill=${encodeURIComponent(name)}&recordId=${encodeURIComponent(id)}`} className="text-xs text-violet-300">进入复测 →</Link></div>
    {suggestions.length ? <ul className="list-inside list-disc space-y-1 text-xs text-amber-300">{suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul> : <p className="text-xs text-slate-500">当前没有静态修复建议。可在下方补充适用场景、输入输出和验收条件。</p>}
    <label className="block text-xs text-slate-400">指导书源文件<textarea aria-label="指导书源文件" value={raw} onChange={(event) => { setRaw(event.target.value); setPreview(null); }} spellCheck={false} rows={12} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" /></label>
    <button type="button" disabled={busy || !raw} onClick={() => void act()} className="rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs text-violet-200 disabled:opacity-50">预览修复与质量变化</button>
    {preview ? <div className="space-y-3 rounded-lg border border-violet-500/30 p-3"><p className="text-xs text-slate-300">静态警告 {preview.beforeQuality.warnings.length} → {preview.afterQuality.warnings.length}；静态改善需要通过实际复测验证。</p><TextCompare before={preview.before} after={preview.after} /><ul className="text-xs text-amber-300">{preview.afterQuality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><button type="button" disabled={busy} onClick={() => void act(true)} className="rounded-md bg-violet-500/20 px-3 py-2 text-xs text-violet-200">备份并应用修复</button></div> : null}
    {message ? <p role="status" className="break-all text-xs text-amber-300">{message}</p> : null}
  </div>;
}
