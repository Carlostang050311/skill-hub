import type { FileDifference } from "@skillhub/core";

export function TextCompare({ before, after }: { before: string; after: string }) {
  return <div className="grid min-w-0 gap-3 md:grid-cols-2">{[["当前内容", before], ["应用后内容", after]].map(([label, text]) => <div key={label} className="min-w-0"><p className="mb-1 text-xs text-slate-400">{label}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">{text || "（无）"}</pre></div>)}</div>;
}
export function FileDiff({ files }: { files: FileDifference[] }) {
  return <div className="space-y-3">{files.length === 0 ? <p className="text-xs text-slate-500">目录内容一致</p> : files.map((file) => <details key={file.path} className="rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer break-all text-xs text-slate-300">{({ added: "新增", changed: "修改", removed: "移除" })[file.status]} · {file.path}</summary><div className="mt-3">{file.binary ? <p className="text-xs text-slate-500">二进制资源内容不同</p> : <TextCompare before={file.before ?? ""} after={file.after ?? ""} />}{file.truncated ? <p className="mt-1 text-xs text-amber-300">预览内容已截取，复制时使用完整文件</p> : null}</div></details>)}</div>;
}
