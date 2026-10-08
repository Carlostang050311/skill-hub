"use client";

import { useState } from "react";
import type { FileDifference } from "@skillhub/core";
import { FileDiff } from "./FileDiff";
import { apiJson } from "@/lib/client-api";

interface InstallResponse {
  status: "installed" | "identical" | "conflict";
  dryRun: boolean;
  targetPath: string;
  filesCopied: number;
  error?: string;
  backupId?: string;
}

export function InstallButton({
  name,
  to,
  from,
  label,
  tone = "slate",
}: {
  name: string;
  to: string;
  from?: string;
  force?: boolean;
  label: string;
  tone?: "slate" | "violet";
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ sourceHash: string; targetHash: string | null; differences: FileDifference[] } | null>(null);

  async function go(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      if (!preview) {
        const data = await apiJson<{ sourceHash: string; targetHash: string | null; differences: FileDifference[] }>("/api/install", { action: "preview", name, to, from });
        if (!data.differences.length) { setMsg("完整目录内容一致"); return; }
        setPreview(data);
        return;
      }
      const data = await apiJson<InstallResponse>("/api/install", { name, to, from, force: preview.targetHash !== null, expectedSourceHash: preview.sourceHash, expectedTargetHash: preview.targetHash });
      if (data.error) {
        setMsg(`失败：${data.error}`);
      } else if (data.status === "identical") {
        setMsg("已是最新");
      } else if (data.status === "conflict") {
        setMsg("目标已有不同内容，需覆盖安装");
      } else {
        setMsg(`已安装 ${data.filesCopied} 个文件${data.backupId ? "，原件已备份" : ""}，页面即将刷新…`);
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (err) {
      setMsg(`失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const toneClass =
    tone === "violet"
      ? "border-violet-500/40 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
      : "border-slate-700 bg-slate-900 text-slate-300 hover:border-violet-500/40 hover:text-violet-300";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${toneClass}`}
      >
        {busy ? "执行中…" : preview ? preview.targetHash ? "备份并应用" : "确认安装" : `${label} · 预览`}
      </button>
      {preview ? <div className="w-full min-w-0 space-y-3 rounded-lg border border-violet-500/30 bg-slate-900 p-3"><p className="text-xs text-slate-300">{preview.differences.length} 个文件变化；原件将保存在同步备份中。</p><FileDiff files={preview.differences} /><button type="button" className="text-xs text-slate-400" onClick={() => setPreview(null)}>取消预览</button></div> : null}
      {msg ? <span className="max-w-56 text-[10px] leading-tight text-slate-500">{msg}</span> : null}
    </div>
  );
}
