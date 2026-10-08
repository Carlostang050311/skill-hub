"use client";

import { useEffect, useState } from "react";
import type { FileDifference, SkillBackup } from "@skillhub/core";
import { apiJson } from "@/lib/client-api";
import { FileDiff } from "./FileDiff";

export function BackupPanel() {
  const [backups, setBackups] = useState<SkillBackup[]>([]);
  const [recoveryErrors, setRecoveryErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ backup: SkillBackup; targetHash: string | null; differences: FileDifference[] } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() { const data = await apiJson<{ backups: SkillBackup[]; recoveryErrors: string[] }>("/api/backups"); setBackups(data.backups); setRecoveryErrors(data.recoveryErrors); }
  useEffect(() => { void refresh().catch((e: Error) => setMessage(e.message)); }, []);
  async function act(id: string, apply = false) {
    setBusy(true); setMessage("");
    try {
      if (apply && preview) { const restored = await apiJson<{ backupId?: string }>("/api/backups", { id, expectedCurrentHash: preview.targetHash }); setMessage(restored.backupId ? "已恢复；恢复前的内容也已备份" : "已恢复缺失的目标目录"); setPreview(null); await refresh(); }
      else setPreview(await apiJson(`/api/backups?id=${encodeURIComponent(id)}`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); } finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">同步和修复的原件保存在本机。先查看恢复差异，再应用；页面预览后内容变化会被拒绝。</p>
    {recoveryErrors.map((error) => <p key={error} role="status" className="break-all text-xs text-amber-300">{error}</p>)}
    {backups.length ? backups.slice(0, 20).map((backup) => <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2"><div className="min-w-0 text-xs"><p className="break-all text-slate-300">{backup.targetPath}</p><p className="text-slate-500">{new Date(backup.createdAt).toLocaleString("zh-CN")} · {backup.originalHash}</p></div><button type="button" disabled={busy} onClick={() => void act(backup.id)} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-violet-300">预览恢复</button></div>) : <p className="text-sm text-slate-500">还没有同步或修复备份</p>}
    {preview ? <div className="space-y-3 rounded-lg border border-violet-500/30 p-3">{preview.targetHash === null ? <p className="text-xs text-amber-300">目标目录已不存在，应用后将恢复备份中的文件。</p> : null}<FileDiff files={preview.differences} /><button type="button" disabled={busy} onClick={() => void act(preview.backup.id, true)} className="rounded-md bg-violet-500/20 px-3 py-2 text-xs text-violet-200">备份当前内容并恢复</button><button type="button" onClick={() => setPreview(null)} className="ml-3 text-xs text-slate-400">取消</button></div> : null}
    {message ? <p role="status" className="text-xs text-amber-300">{message}</p> : null}
  </div>;
}
