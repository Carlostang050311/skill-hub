"use client";

import { useEffect, useState } from "react";
import type { FileDifference, SkillBackup } from "@skillhub/core";
import { apiJson } from "@/lib/client-api";
import { FileDiff } from "./FileDiff";

export function BackupPanel() {
  const [backups, setBackups] = useState<SkillBackup[]>([]);
  const [preview, setPreview] = useState<{ backup: SkillBackup; targetHash: string; differences: FileDifference[] } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void apiJson<SkillBackup[]>("/api/backups").then(setBackups).catch((e: Error) => setMessage(e.message)); }, []);
  async function act(id: string, apply = false) {
    setBusy(true); setMessage("");
    try {
      if (apply && preview) { await apiJson("/api/backups", { id, expectedCurrentHash: preview.targetHash }); setMessage("已恢复；恢复前的内容也已备份"); setPreview(null); setBackups(await apiJson<SkillBackup[]>("/api/backups")); }
      else setPreview(await apiJson(`/api/backups?id=${encodeURIComponent(id)}`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); } finally { setBusy(false); }
  }
  return <div className="space-y-3"><p className="text-xs text-slate-500">同步和修复的原件保存在本机。先查看恢复差异，再应用；页面预览后内容变化会被拒绝。</p>{backups.length ? backups.slice(0, 20).map((backup) => <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2"><div className="min-w-0 text-xs"><p className="break-all text-slate-300">{backup.targetPath}</p><p className="text-slate-500">{new Date(backup.createdAt).toLocaleString("zh-CN")} · {backup.originalHash}</p></div><button type="button" disabled={busy} onClick={() => void act(backup.id)} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-violet-300">预览恢复</button></div>) : <p className="text-sm text-slate-500">还没有同步或修复备份</p>}{preview ? <div className="space-y-3 rounded-lg border border-violet-500/30 p-3"><FileDiff files={preview.differences} /><button type="button" disabled={busy} onClick={() => void act(preview.backup.id, true)} className="rounded-md bg-violet-500/20 px-3 py-2 text-xs text-violet-200">备份当前内容并恢复</button><button type="button" onClick={() => setPreview(null)} className="ml-3 text-xs text-slate-400">取消</button></div> : null}{message ? <p role="status" className="text-xs text-amber-300">{message}</p> : null}</div>;
}
