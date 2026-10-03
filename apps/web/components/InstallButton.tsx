"use client";

import { useState } from "react";

interface InstallResponse {
  status: "installed" | "identical" | "conflict";
  dryRun: boolean;
  targetPath: string;
  filesCopied: number;
  error?: string;
}

export function InstallButton({
  name,
  to,
  from,
  force = false,
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

  async function go(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, to, from, force }),
      });
      const data = (await res.json()) as InstallResponse;
      if (data.error) {
        setMsg(`失败：${data.error}`);
      } else if (data.status === "identical") {
        setMsg("已是最新");
      } else if (data.status === "conflict") {
        setMsg("目标已有不同内容，需覆盖安装");
      } else {
        setMsg(`已安装 ${data.filesCopied} 个文件，页面即将刷新…`);
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
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${toneClass}`}
      >
        {busy ? "执行中…" : label}
      </button>
      {msg ? <span className="max-w-56 text-[10px] leading-tight text-slate-500">{msg}</span> : null}
    </span>
  );
}
